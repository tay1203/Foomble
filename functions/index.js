const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { Pinecone } = require("@pinecone-database/pinecone");
const cors = require("cors")({ origin: true });
const busboy = require("busboy");
const { logger } = functions;

// 1. Initialize Firebase Admin
admin.initializeApp();

// 2. Export the Cloud Function
exports.nutritionChat = functions.https.onRequest((req, res) => {
  // CORS middleware must wrap the entire request
  cors(req, res, async () => {
    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }

    // Safely load environment variables INSIDE the function execution
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
    const PINECONE_INDEX_NAME = process.env.PINECONE_INDEX_NAME;

    if (!GEMINI_API_KEY || !PINECONE_API_KEY || !PINECONE_INDEX_NAME) {
      logger.error("Missing keys! Current env:", process.env);
      res.status(500).send("Server Configuration Error");
      return;
    }

    // Initialize Pinecone
    const pc = new Pinecone({ apiKey: PINECONE_API_KEY });
    const index = pc.Index(PINECONE_INDEX_NAME);

    // Initialize Google AI with a strict System Instruction
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const geminiChatModel = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash", // Using the latest recommended model
      systemInstruction: "You are a strict food safety and packaging regulation expert for Malaysia. Your answers MUST be based ONLY on the provided legal context. Do not use any outside knowledge. If the provided legal context does not contain the answer, state that you do not know based on the provided documents. Always cite the specific part or section of the legal context you used."
    });
    const geminiEmbeddingModel = genAI.getGenerativeModel({ 
      model: "gemini-embedding-001" 
    });

    // Initialize Busboy for multipart/form-data parsing
    const bb = busboy({ headers: req.headers });
    const fields = {};
    const filePromises = [];

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
        return res.status(400).json({ message: "Only image files are allowed." });
      }
      
      const chunks = [];
      file.on("data", (chunk) => chunks.push(chunk));

      const filePromise = new Promise((resolve, reject) => {
        file.on("end", () => {
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

    // When all data is parsed
    bb.on("finish", async () => {
      try {
        const imageParts = await Promise.all(filePromises);
        const userQuestion = fields.question || "Summarize this label and packaging for me.";

        if (imageParts.length === 0) {
            return res.status(400).json({ message: "An image is required." });
        }

        // --- STEP 1: VISION-TO-TEXT FOR BETTER SEARCH ---
        // We need Pinecone to know what the image actually is.
        logger.info("Extracting visual context for Pinecone search...");
        const visionPrompt = [
            ...imageParts, 
            "Briefly identify the food product, packaging material, and any visible labels or claims in this image in one or two sentences."
        ];
        
        // We use a temporary model without the strict system prompt just for visual extraction
        const visionModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const visionResult = await visionModel.generateContent(visionPrompt);
        const imageDescription = visionResult.response.text();
        
        // --- STEP 2: RAG RETRIEVAL ---
        // Combine the visual description with the user's question for a highly accurate search query
        const searchQuery = `Image contains: ${imageDescription}. User asks: ${userQuestion}`;
        logger.info(`RAG Search Query: ${searchQuery}`);

        const embeddingResult = await geminiEmbeddingModel.embedContent(searchQuery);
        const queryVector = embeddingResult.embedding.values;

        logger.info("Querying Pinecone for legal context...");
        const queryResponse = await index.query({
          topK: 4, // Retrieve top 4 most relevant chunks
          vector: queryVector,
          includeMetadata: true, 
        });

        const legalContext = queryResponse.matches
          .map(match => match.metadata.text)
          .join("\n\n---\n\n");
          
        logger.info("Legal context retrieved successfully.");

        // --- STEP 3: AUGMENTED GENERATION ---
        // Inject the user's question, the image, and the retrieved laws
        const finalPrompt = [
          ...imageParts,
          `USER QUESTION: "${userQuestion}"\n\nLEGAL CONTEXT FROM MALAYSIAN FOOD REGULATIONS:\n${legalContext}`
        ];

        logger.info("Sending augmented prompt to Gemini...");
        const chatResult = await geminiChatModel.generateContent(finalPrompt);
        const message = chatResult.response.text();
        
        res.status(200).json({ message });

      } catch (error) {
        logger.error("Error processing RAG pipeline:", error);
        res.status(500).json({ message: "An internal error occurred during processing." });
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
  });
});