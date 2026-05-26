import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

// Set up larger limits for payload in case of large PDFs
app.use(express.json({ limit: "25mb" }));

// Lazy initializer for Gemini client to prevent startup crashes if key is omitted
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY environment variable is required.");
    }
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

// API Route: Healthcheck
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// API Route: AI-powered structural cleanup for malformed question chunks
app.post("/api/gemini/clean-questions", async (req, res): Promise<any> => {
  const { chunks } = req.body;

  if (!Array.isArray(chunks) || chunks.length === 0) {
    return res.status(400).json({ error: "No question chunks provided." });
  }

  console.log(`[Server API] Received ${chunks.length} malformed chunks for AI cleanup.`);

  try {
    const ai = getGeminiClient();
    
    // Batch size of 3-5 as requested in the requirements
    const batchSize = 4;
    const batches: string[][] = [];
    for (let i = 0; i < chunks.length; i += batchSize) {
      batches.push(chunks.slice(i, i + batchSize));
    }

    console.log(`[Server API] Cleaning malformed chunks in ${batches.length} batches.`);

    const batchPromises = batches.map(async (batch, batchIdx) => {
      const userPrompt = `Reconstruct the following mangled multiple choice question blocks from a PDF reading extraction.
Separate any merged questions if they got lumped together. Isolate options correctly (A, B, C, D) and preserve the wording, equations, and symbols.
Do not invent any details or answers or explanations that are not present in the source text.
If no answer key is clearly mentioned, keep "correct_option_index" as null.
If there is no explanation, keep "explanation" as an empty string.

--- START QUESTION BLOCKS TO RECONSTRUCT ---
${batch.map((c, i) => `Block ${i + 1}:\n${c}`).join("\n\n---\n\n")}
--- END QUESTION BLOCKS ---`;

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: userPrompt,
        config: {
          systemInstruction: "You are an expert curriculum assistant specializing in PDF reading recovery. Your sole job is to clean, separate, and reconstruct malformed question blocks into JSON format. Do not make up answers, do not speculate explanations, and do not invent content. Always preserve exact math equations, symbols, and formatting where possible.",
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                question_text: { 
                  type: Type.STRING,
                  description: "The complete visual text of the question, preserving symbols." 
                },
                options: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: "The 4 options for multiple choices (A, B, C, D). If fewer are present, pad with empty strings."
                },
                correct_option_index: { 
                  type: Type.INTEGER, 
                  description: "Index (0 to 3) matching A to D. Null if not specified or unclear in the source chunk."
                },
                explanation: { 
                  type: Type.STRING,
                  description: "Explanation details if found. Empty string if none is present."
                }
              },
              required: ["question_text", "options", "correct_option_index", "explanation"]
            }
          }
        }
      });

      const responseText = response.text || "[]";
      try {
        const cleanedGroup = JSON.parse(responseText.trim());
        console.log(`[Server API] Batch ${batchIdx + 1} processed. Extracted ${cleanedGroup.length} structured questions.`);
        return cleanedGroup;
      } catch (jsonErr) {
        console.error(`[Server API] Failed to parse JSON from batch ${batchIdx + 1}:`, responseText, jsonErr);
        return [];
      }
    });

    const results = await Promise.all(batchPromises);
    const combinedQuestions = results.flat();

    console.log(`[Server API] Finished cleanup. Reconstructed ${combinedQuestions.length} clean questions.`);
    return res.json({ questions: combinedQuestions });

  } catch (error: any) {
    console.error("[Server API] Gemini cleanup error:", error);
    return res.status(500).json({ 
      error: "AI Cleanup service failed.", 
      message: error.message || "An issue occurred querying the Gemini model." 
    });
  }
});

// Setup Vite or Serve Static Files
async function setupFrontend() {
  if (process.env.NODE_ENV !== "production") {
    console.log("[Server] Mounting Vite Middleware in Dev Mode...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("[Server] Serving Static Build Files in Production Mode...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Server] Core suite online and running on http://localhost:${PORT}`);
  });
}

setupFrontend().catch((err) => {
  console.error("[Server] Startup failed during integration mounting:", err);
});
