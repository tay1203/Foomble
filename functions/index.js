// Load environment variables from .env file
require('dotenv').config();

const functions = require("firebase-functions");
const { ImageAnnotatorClient } = require("@google-cloud/vision");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cors = require("cors")({ origin: true });
const logger = require("firebase-functions/logger");
const busboy = require("busboy");

// Initialize clients
const visionClient = new ImageAnnotatorClient();

// Use environment variable or fallback to functions.config()
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || functions.config().gemini?.key;

if (!GEMINI_API_KEY) {
  logger.error("GEMINI_API_KEY environment variable is not set");
  throw new Error("GEMINI_API_KEY is required");
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// Helper function to perform OCR on a single image buffer
const performOcr = async (imageBuffer) => {
  const request = {
    image: { content: imageBuffer.toString("base64") },
    features: [{ type: "TEXT_DETECTION" }],
  };
  const [result] = await visionClient.annotateImage(request);
  const detections = result.textAnnotations;
  return detections && detections.length > 0 ? detections[0].description : "";
};

// We'll keep the function name 'nutritionChat' for consistency with the frontend
exports.nutritionChat = functions.https.onRequest((req, res) => {
  cors(req, res, () => {
    if (req.method !== "POST") {
      return res.status(405).send("Method Not Allowed");
    }

    const bb = busboy({ headers: req.headers });
    const fields = {};
    const imageBuffers = [];

    // Process text fields (like 'question' and 'context')
    bb.on("field", (fieldname, val) => {
      fields[fieldname] = val;
    });

    // Process image files
    bb.on("file", (fieldname, file, filenameInfo) => {
      const chunks = [];
      file.on("data", (chunk) => chunks.push(chunk));
      file.on("end", () => {
        imageBuffers.push(Buffer.concat(chunks));
      });
    });

    // When all fields and files are processed
    bb.on("finish", async () => {
      try {
        let ocrContext = fields.context || '';

        if (imageBuffers.length > 0) {
          logger.info(`Starting OCR for ${imageBuffers.length} image(s)...`);
          const ocrPromises = imageBuffers.map(buffer => performOcr(buffer));
          const ocrResults = await Promise.all(ocrPromises);
          ocrContext = ocrResults.join("\n\n");
        }
        
        if (!ocrContext && !fields.question) {
            return res.status(400).json({ message: "Please provide an image or a question with context." });
        }

        let prompt;
        if (fields.question) {
          // This is a follow-up question
          prompt = `You are a food safety and regulation expert for Malaysia. A user has uploaded a nutrition label with the following information:
          --- OCR CONTEXT ---
          ${ocrContext}
          --- END CONTEXT ---
          Now, please answer their specific question based on this context. Be helpful and clear.
          Question: "${fields.question}"`;
        } else {
          // This is the initial analysis of the image(s)
          prompt = `You are a food safety and regulation expert for Malaysia. Analyze the following nutrition label text extracted via OCR. 
          Provide a brief, easy-to-understand summary. Highlight key aspects like high sugar/sodium, potential allergens, and its general classification.
          Start with a friendly greeting like "I've analyzed the label for you!".
          --- OCR CONTEXT ---
          ${ocrContext}
          --- END CONTEXT ---`;
        }

        logger.info("Sending prompt to Gemini...");
        const geminiResult = await geminiModel.generateContent(prompt);
        const geminiResponse = await geminiResult.response;
        const message = geminiResponse.text();

        // Send back BOTH the AI message and the context for the next turn
        res.status(200).json({ message, context: ocrContext });

      } catch (error) {
        logger.error("Error in nutritionChat function:", error);
        res.status(500).json({ message: "An internal error occurred." });
      }
    });

    bb.end(req.rawBody);
  });
});