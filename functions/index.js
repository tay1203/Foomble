const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { Pinecone } = require("@pinecone-database/pinecone");
const busboy = require("busboy");
const { performance } = require('perf_hooks');
const { timingSafeEqual } = require("crypto");

// Restrict CORS to your deployed frontend. Set ALLOWED_ORIGIN in your
// Firebase Functions env config
// Falls back to allowing all origins only when unset, so local dev still works.
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const CORS_OPTION = ALLOWED_ORIGIN === "*" ? true : ALLOWED_ORIGIN;

// v2 functions don't auto-inject .env-style secrets in production - they
// must be declared here and set once via:
//   firebase functions:secrets:set GEMINI_API_KEY
//   firebase functions:secrets:set PINECONE_API_KEY
// Locally, the emulator still reads them from .env, so nothing changes
// for local dev.
const GEMINI_API_KEY_SECRET = defineSecret("GEMINI_API_KEY");
const PINECONE_API_KEY_SECRET = defineSecret("PINECONE_API_KEY");
const PINECONE_INDEX_NAME_SECRET = defineSecret("PINECONE_INDEX_NAME");
const TEST_ACCESS_CODE_SECRET = defineSecret("TEST_ACCESS_CODE");

// Basic keyword gate so we only pay for vision-extraction + embedding +
// Pinecone query on questions that actually need regulatory context.
// Mirrors rule #1/#2 in the system instruction below - keeps it a plain
// keyword check rather than an extra classification call.
const LEGAL_KEYWORDS = /\b(regulation|regulations|law|laws|legal|illegal|permitted|allowed|compliance|comply|limit|limits|banned|prohibited|standard|requirement)\b/i;
const OUT_OF_SCOPE_MESSAGE = "I can only help with food label and food-related questions.";
const OUT_OF_SCOPE_KEYWORDS = /\b(capital|country|weather|forecast|joke|poem|story|movie|music|song|programming|code|coding|politics|president|football|soccer)\b/i;
const MATH_EXPRESSION = /\b\d+(?:\.\d+)?\s*[+\-*/×÷]\s*\d+(?:\.\d+)?\b/;

const isOutOfScopeQuestion = (question) =>
  OUT_OF_SCOPE_KEYWORDS.test(question) || MATH_EXPRESSION.test(question);
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const RATE_LIMIT_WINDOW_MAX = 10;            // max 10 requests
const RATE_LIMIT_DAILY_MAX = 30;             // max 30 requests/day

const malaysiaDayKey = (date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur" }).format(date);
const malaysiaTime = (date) =>
  new Intl.DateTimeFormat("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);

const hasValidAccessCode = (submittedCode, accessCode) => {
  if (typeof submittedCode !== "string" || !accessCode) return false;
  const submitted = Buffer.from(submittedCode.trim());
  const expected = Buffer.from(accessCode.trim());
  return submitted.length === expected.length && timingSafeEqual(submitted, expected);
};

async function getAuthenticatedUser(req) {
  const token = req.get("Authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) {
    const error = new Error("Sign in is required.");
    error.status = 401;
    throw error;
  }
  try {
    return await admin.auth().verifyIdToken(token);
  } catch {
    const error = new Error("Your sign-in session has expired. Please sign in again.");
    error.status = 401;
    throw error;
  }
}

async function checkRateLimit(uid) {
  const now = new Date();
  const today = malaysiaDayKey(now);
  const rateRef = db.collection("test_rate_limits").doc(uid);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(rateRef);
    const data = snapshot.data() || {};
    const windowStartedAt = data.windowStartedAt?.toDate?.() || new Date(0);
    const windowExpired = now.getTime() - windowStartedAt.getTime() >= RATE_LIMIT_WINDOW_MS;
    const windowCount = windowExpired ? 0 : data.windowCount || 0;
    const dayCount = data.dayKey === today ? data.dayCount || 0 : 0;

    if (windowCount >= RATE_LIMIT_WINDOW_MAX) {
      const retryAt = new Date(windowStartedAt.getTime() + RATE_LIMIT_WINDOW_MS);
      return {
        allowed: false,
        retryAt: retryAt.toISOString(),
        message: `You have reached the ${RATE_LIMIT_WINDOW_MAX}-request limit. Your next request is available at ${malaysiaTime(retryAt)} Malaysia time.`,
      };
    }
    if (dayCount >= RATE_LIMIT_DAILY_MAX) {
      return {
        allowed: false,
        message: `You have reached today's ${RATE_LIMIT_DAILY_MAX}-request testing limit. Your allowance refreshes at 12:00 AM Malaysia time.`,
      };
    }

    transaction.set(rateRef, {
      windowStartedAt: windowExpired ? now : windowStartedAt,
      windowCount: windowCount + 1,
      dayKey: today,
      dayCount: dayCount + 1,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { allowed: true };
  });
}

// Small retry helper for transient failures against Gemini/Pinecone, so a
// single dropped connection doesn't fail the whole request. Retries twice
// with a short backoff; only used for network calls, not for user errors.
async function withRetry(fn, { retries = 2, delayMs = 500, label = "call" } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        logger.warn(`${label} failed (attempt ${attempt + 1}/${retries + 1}), retrying...`, err.message);
        await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

// 1. Initialize Firebase Admin
admin.initializeApp();
const db = admin.firestore();

async function logTestCase(question, retrievedContext, generatedAnswer, timeTakenMs) {
  try {
    // Convert milliseconds to seconds with 2 decimal places
    const timeTakenSec = parseFloat((timeTakenMs / 1000).toFixed(2));

    const docRef = await db.collection("rag_evaluations").add({
      question: question || "No question provided",
      context: retrievedContext || "No context retrieved",
      generated_answer: generatedAnswer || "No answer generated",
      time_taken: timeTakenSec,
      ground_truth: "",
      timestamp: FieldValue.serverTimestamp()
    });
    logger.info(`Evaluation logged with ID: ${docRef.id}`);
  } catch (e) {
    logger.error("Error adding evaluation log: ", e);
  }
}

exports.redeemTestCode = onRequest(
  { cors: CORS_OPTION, invoker: "public", secrets: [TEST_ACCESS_CODE_SECRET] },
  async (req, res) => {
    if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed." });
    try {
      const user = await getAuthenticatedUser(req);
      const accessCode = TEST_ACCESS_CODE_SECRET.value();
      logger.info("Testing code validation attempt", {
        submittedLength: typeof req.body?.code === "string" ? req.body.code.trim().length : null,
        configuredLength: accessCode ? accessCode.trim().length : null,
      });
      if (!hasValidAccessCode(req.body?.code, accessCode)) {
        return res.status(403).json({ message: "That testing code is not valid." });
      }
      await db.collection("test_users").doc(user.uid).set({
        approved: true,
        email: user.email || null,
        approvedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return res.status(200).json({ approved: true });
    } catch (error) {
      logger.warn("Unable to redeem testing code", error);
      return res.status(error.status || 500).json({ message: error.status ? error.message : "Unable to verify the testing code. Please try again." });
    }
  },
);

exports.testAccessStatus = onRequest(
  { cors: CORS_OPTION, invoker: "public" },
  async (req, res) => {
    if (req.method !== "GET") return res.status(405).json({ message: "Method not allowed." });
    try {
      const user = await getAuthenticatedUser(req);
      const tester = await db.collection("test_users").doc(user.uid).get();
      return res.status(200).json({ approved: tester.exists && tester.data()?.approved === true });
    } catch (error) {
      return res.status(error.status || 500).json({ message: error.status ? error.message : "Unable to check test access." });
    }
  },
);

// 2. Export the Cloud Function
// v2 onRequest: timeoutSeconds/memory replace v1's runWith(), and cors is
// handled natively (no separate cors package/middleware needed).
exports.nutritionChat = onRequest(
  {
    timeoutSeconds: 120,
    memory: "512MiB",
    cors: CORS_OPTION,
    invoker: "public",
    secrets: [GEMINI_API_KEY_SECRET, PINECONE_API_KEY_SECRET, PINECONE_INDEX_NAME_SECRET],
  },
  async (req, res) => {
    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }

    try {
      const user = await getAuthenticatedUser(req);
      const tester = await db.collection("test_users").doc(user.uid).get();
      if (!tester.exists || tester.data()?.approved !== true) {
        return res.status(403).json({ message: "Testing access is required. Enter a valid testing code after signing in." });
      }
      const rateLimit = await checkRateLimit(user.uid);
      if (!rateLimit.allowed) return res.status(429).json({ message: rateLimit.message });
    } catch (error) {
      return res.status(error.status || 500).json({
        message: error.status ? error.message : "Unable to verify testing access. Please try again.",
      });
    }

    // Gemini and Pinecone configuration comes from Secret Manager in
    // production (declared above) and fall back to .env locally via the
    // emulator, so this read works in both environments unchanged.
    const GEMINI_API_KEY = GEMINI_API_KEY_SECRET.value() || process.env.GEMINI_API_KEY;
    const PINECONE_API_KEY = PINECONE_API_KEY_SECRET.value() || process.env.PINECONE_API_KEY;
    const PINECONE_INDEX_NAME = PINECONE_INDEX_NAME_SECRET.value() || process.env.PINECONE_INDEX_NAME;

    if (!GEMINI_API_KEY || !PINECONE_API_KEY || !PINECONE_INDEX_NAME) {
      // Log presence only - never dump process.env, it contains secrets.
      logger.error("Missing required config", {
        hasGeminiKey: Boolean(GEMINI_API_KEY),
        hasPineconeKey: Boolean(PINECONE_API_KEY),
        hasPineconeIndex: Boolean(PINECONE_INDEX_NAME),
      });
      res.status(500).send("Server Configuration Error");
      return;
    }

    // Initialize Pinecone
    const pc = new Pinecone({ apiKey: PINECONE_API_KEY });
    const index = pc.Index(PINECONE_INDEX_NAME);

    // Initialize Google AI with a strict System Instruction
    // Initialize Google AI with a dual-purpose System Instruction
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const geminiChatModel = genAI.getGenerativeModel({
      model: "gemini-3.6-flash",
      generationConfig: {
        // The UI asks for short answers; low thinking and a bounded response
        // avoid spending extra time generating reasoning the user will not see.
        maxOutputTokens: 600,
        thinkingConfig: { thinkingLevel: "low" },
      },
      systemInstruction: `You are a helpful, friendly food safety and nutrition assistant for Malaysia.
      Follow these rules strictly:
      1. LEGAL QUESTIONS: If the user asks about laws, limits, or compliance, answer strictly based on the provided legal context. Briefly cite the regulation (e.g., 'Under Regulation 18...').
      2. GENERAL QUESTIONS: If the user asks about ingredients, health recommendations, or what is on the label (e.g., 'Is this healthy?', 'What are the main ingredients?', 'Is this vegan?'), ignore the legal context. Answer directly based on the uploaded image and standard nutritional knowledge.
      3. OUT-OF-SCOPE QUESTIONS: For anything unrelated to food, ingredients, nutrition, food labels, packaging, food safety, or Malaysian food regulations, reply exactly: "I can only help with food label and food-related questions." Do not add anything else.
      4. STYLE: Answer the user's exact question first. Use plain language, friendly tone, and no more than 3 bullets when a list makes the answer clearer. Do not add repetition or unnecessary background. Only state details visible in the image or supported by the supplied context.`
    });

    const geminiEmbeddingModel = genAI.getGenerativeModel({
      model: "gemini-embedding-001"
    });

    // Initialize Busboy for multipart/form-data parsing.
    // Limits: max 4 images per request, 8MB each, and cap the text fields
    // (question, history) so a request can't be used to smuggle huge payloads.
    const MAX_IMAGES = 4;
    const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024; // 8MB
    const bb = busboy({
      headers: req.headers,
      limits: {
        files: MAX_IMAGES,
        fileSize: MAX_FILE_SIZE_BYTES,
        fields: 5,
        fieldSize: 20000, // ~20KB, enough for a question + short history JSON
      },
    });
    const fields = {};
    const filePromises = [];
    let uploadRejected = false;

    // Parse text fields
    bb.on("field", (fieldname, val) => {
      fields[fieldname] = val;
    });

    // Parse files (images)
    bb.on("file", (fieldname, file, filenameInfo) => {
      const { mimeType } = filenameInfo;
      if (!mimeType.startsWith("image/")) {
        // Drain the stream if it's not an image to prevent memory leaks
        file.resume();
        if (!uploadRejected) {
          uploadRejected = true;
          res.status(400).json({ message: "Only image files are allowed." });
        }
        return;
      }

      const chunks = [];
      file.on("data", (chunk) => chunks.push(chunk));

      // busboy emits 'limit' on the file stream if fileSize is exceeded -
      // reject explicitly rather than silently sending a truncated image.
      file.on("limit", () => {
        if (!uploadRejected) {
          uploadRejected = true;
          res.status(400).json({
            message: `Each image must be under ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB.`,
          });
        }
      });

      const filePromise = new Promise((resolve, reject) => {
        file.on("end", () => {
          if (file.truncated) return; // already handled by 'limit' above
          const buffer = Buffer.concat(chunks);
          resolve({
            inlineData: {
              data: buffer.toString("base64"),
              mimeType,
            },
          });
        });
        file.on("error", reject);
      });
      filePromises.push(filePromise);
    });

    // busboy emits this once the 'files' limit is exceeded
    bb.on("filesLimit", () => {
      if (!uploadRejected) {
        uploadRejected = true;
        res.status(400).json({ message: `You can upload up to ${MAX_IMAGES} images at once.` });
      }
    });

    // When all data is parsed
    bb.on("finish", async () => {
      if (uploadRejected) return; // response already sent by a limit handler above
      try {
        const startTime = performance.now()
        const imageParts = await Promise.all(filePromises);
        const userQuestion = (fields.question || "Summarize this label and packaging for me.").slice(0, 2000);

        if (imageParts.length === 0) {
            return res.status(400).json({ message: "An image is required." });
        }

        // Do not spend an AI request on clearly unrelated questions. This
        // makes the response immediate and guarantees a focused reply.
        if (isOutOfScopeQuestion(userQuestion)) {
          return res.status(200).json({ message: OUT_OF_SCOPE_MESSAGE });
        }

        // Optional short conversation history, sent by the frontend as a
        // JSON string: [{ role: "user"|"model", text: "..." }, ...]
        // Kept text-only (no images) and capped so a bad payload can't
        // blow up the prompt or the request size.
        let history = [];
        if (fields.history) {
          try {
            const parsed = JSON.parse(fields.history);
            if (Array.isArray(parsed)) {
              history = parsed
                .filter(
                  (m) =>
                    m &&
                    (m.role === "user" || m.role === "model") &&
                    typeof m.text === "string"
                )
                .slice(-8) // last 8 turns max
                .map((m) => ({
                  role: m.role,
                  parts: [{ text: m.text.slice(0, 2000) }],
                }));
            }
          } catch (e) {
            logger.warn("Ignoring malformed history field:", e.message);
          }
        }

        // --- STEP 1 & 2: VISION-TO-TEXT + RAG RETRIEVAL (legal questions only) ---
        // The system instruction below already tells Gemini to ignore legal
        // context for general nutrition/ingredient questions, so skip the
        // vision-extraction + embedding + Pinecone round trip entirely when
        // the question doesn't look like a compliance/regulation question.
        // Cuts latency and API cost for the majority of questions.
        const needsLegalContext = LEGAL_KEYWORDS.test(userQuestion);
        let legalContext = "";

        if (needsLegalContext) {
          logger.info("Legal question detected - extracting visual context for Pinecone search...");
          const visionPrompt = [
              ...imageParts,
              "Carefully identify the food product, packaging material, and any visible labels or claims in this image in one or two sentences."
          ];

          // We use a temporary model without the strict system prompt just for visual extraction
          const visionModel = genAI.getGenerativeModel({
            model: "gemini-3.6-flash",
            generationConfig: {
              maxOutputTokens: 120,
              thinkingConfig: { thinkingLevel: "low" },
            },
          });
          const visionResult = await withRetry(
            () => visionModel.generateContent(visionPrompt),
            { label: "vision extraction" }
          );
          const imageDescription = visionResult.response.text();

          // Combine the visual description with the user's question for a highly accurate search query
          const searchQuery = `Image contains: ${imageDescription}. User asks: ${userQuestion}`;
          logger.info(`RAG Search Query: ${searchQuery}`);

          const embeddingResult = await withRetry(
            () => geminiEmbeddingModel.embedContent(searchQuery),
            { label: "embedding" }
          );
          const queryVector = embeddingResult.embedding.values;

          logger.info("Querying Pinecone for legal context...");
          const queryResponse = await withRetry(
            () => index.query({
              topK: 4, // Retrieve top 4 most relevant chunks
              vector: queryVector,
              includeMetadata: true,
            }),
            { label: "pinecone query" }
          );

          legalContext = queryResponse.matches
            .map(match => match.metadata.text)
            .join("\n\n---\n\n");

          logger.info("Legal context retrieved successfully.");
        } else {
          logger.info("General question detected - skipping RAG retrieval.");
        }

        // --- STEP 3: AUGMENTED GENERATION ---
        // Inject the user's question, the image, and the retrieved laws
        const contextBlock = needsLegalContext
          ? `\n\nLEGAL CONTEXT FROM MALAYSIAN FOOD REGULATIONS:\n${legalContext}`
          : "";
        const finalPrompt = [
          ...imageParts,
          `USER QUESTION: "${userQuestion}"${contextBlock}`
        ];

        logger.info("Sending augmented prompt to Gemini...");
        const chatSession = geminiChatModel.startChat({ history });
        const chatResult = await withRetry(
          () => chatSession.sendMessage(finalPrompt),
          { label: "chat generation" }
        );
        const endTime = performance.now()
        const message = chatResult.response.text();
        const timeTakenMs = endTime - startTime;
        logger.info("Nutrition chat completed", {
          durationMs: Math.round(timeTakenMs),
          usedLegalRetrieval: needsLegalContext,
          imageCount: imageParts.length,
        });

        // Fire-and-forget logging - don't block the response on it.
        logTestCase(userQuestion, legalContext, message, timeTakenMs).catch((e) =>
          logger.error("logTestCase failed:", e)
        );

        res.status(200).json({ message });

      } catch (error) {
        logger.error("Error processing RAG pipeline:", error);
        res.status(500).json({
          message: "Unable to analyse this label right now. Please try again with a clear image.",
        });
      }
    });

    bb.on("error", (error) => {
      logger.error("Busboy parsing error:", error);
      res.status(500).json({ message: "Error parsing the form data." });
    });

    // End the busboy stream properly depending on the environment
    if (req.rawBody) {
      bb.end(req.rawBody);
    } else {
      req.pipe(bb);
    }
  }
);
