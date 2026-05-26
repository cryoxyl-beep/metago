import React, { useState, useRef } from "react";
import { useAuth } from "../firebase/context";
import { extractTextFromPdf, parseQuestionsFromText, assessChunkConfidence } from "../parsing/pdfParser";
import { Question, QuestionSet, OcrTelemetry } from "../types";
import { collection, doc, writeBatch, Timestamp } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../firebase/config";
import { 
  FileText, 
  Upload, 
  Plus, 
  Trash2, 
  Check, 
  AlertCircle, 
  Save, 
  Grid,
  Info,
  Sparkles
} from "lucide-react";

interface PdfUploadPageProps {
  onUploadSuccess: () => void;
}

export const PdfUploadPage: React.FC<PdfUploadPageProps> = ({ onUploadSuccess }) => {
  const { user, dbOnline } = useAuth();
  
  // File upload state
  const [file, setFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [extractionStage, setExtractionStage] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Staged QuestionSet state
  const [subject, setSubject] = useState("");
  const [exam, setExam] = useState("");
  const [year, setYear] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // Fallback states for raw / partial extraction
  const [rawText, setRawText] = useState("");
  const [showRawText, setShowRawText] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  // AI cleanup metrics states
  const [parserConfidence, setParserConfidence] = useState<number | null>(null);
  const [aiCleanedCount, setAiCleanedCount] = useState<number>(0);
  const [isAiCleaning, setIsAiCleaning] = useState<boolean>(false);
  const [ocrTelemetry, setOcrTelemetry] = useState<OcrTelemetry | null>(null);
  const [geminiDebug, setGeminiDebug] = useState<{
    modelName: string;
    statusCode: number | null;
    rawResponse: string;
    parsedError: any | null;
    malformedChunksCount: number;
    durationMs: number | null;
    endpoint: string;
    requestPayload: any;
    errorOccurred: boolean;
    errorMessage: string | null;
  } | null>(null);

  const [showDebugPanel, setShowDebugPanel] = useState<boolean>(false);
  const [selectedModel, setSelectedModel] = useState<string>("gemini-3.1-flash-lite");

  // Handle local PDF upload
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      if (selectedFile.type !== "application/pdf") {
        setError("Only PDF files are supported");
        return;
      }
      setFile(selectedFile);
      setSubject(selectedFile.name.replace(/\.[^/.]+$/, "").substring(0, 30));
      await processPdf(selectedFile);
    }
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const selectedFile = e.dataTransfer.files[0];
      if (selectedFile.type !== "application/pdf") {
        setError("Only PDF files are supported");
        return;
      }
      setFile(selectedFile);
      setSubject(selectedFile.name.replace(/\.[^/.]+$/, "").substring(0, 30));
      await processPdf(selectedFile);
    }
  };

  const runAiCleanupPipeline = async (initialQuestions: Question[]): Promise<Question[]> => {
    if (initialQuestions.length === 0) {
      setParserConfidence(0);
      setQuestions([]);
      return [];
    }

    // Identify low confidence and high confidence items
    const highConfQuestions: Question[] = [];
    const malformedChunks: string[] = [];

    initialQuestions.forEach((q) => {
      const rawChunk = q.rawChunkText || q.questionText + "\n" + q.options.join("\n");
      const confidence = assessChunkConfidence(rawChunk, q);
      if (confidence.isLowConfidence) {
        malformedChunks.push(rawChunk);
      } else {
        highConfQuestions.push(q);
      }
    });

    const malformedCount = malformedChunks.length;
    const initialTotal = initialQuestions.length;
    const initialConfidence = Math.round(((initialTotal - malformedCount) / initialTotal) * 100);
    setParserConfidence(initialConfidence);

    if (malformedChunks.length === 0) {
      setQuestions(initialQuestions);
      setAiCleanedCount(0);
      return initialQuestions;
    }

    setGeminiDebug(null); // Clear previous debug info

    // If regex-only-mode selected, skip all AI cleanup entirely
    if (selectedModel === "regex-only-mode") {
      console.log(`[AI Performance Telemetry] Regex-only mode selected. Skipping all AI cleanup.
      - Selected Model: ${selectedModel}
      - Success State: true
      `);
      setQuestions(initialQuestions);
      setAiCleanedCount(0);
      return initialQuestions;
    }

    setIsAiCleaning(true);

    // Setting active model name visibly during parsing
    let modelLabel = selectedModel;
    if (selectedModel === "gemini-3.1-flash-lite") modelLabel = "Gemini 3.1 Flash Lite";
    else if (selectedModel === "gemini-3.5-flash") modelLabel = "Gemini 3.5 Flash";
    else if (selectedModel === "gemini-2.5-flash") modelLabel = "Gemini 2.5 Flash";
    else if (selectedModel === "gemini-2.0-flash") modelLabel = "Gemini 2.0 Flash";
    else if (selectedModel === "qwen/qwen3-32b") modelLabel = "Groq Qwen3";
    else if (selectedModel === "llama-3.3-70b-versatile") modelLabel = "Groq Llama";

    setExtractionStage(`Using ${modelLabel}...`);

    try {
      const geminiApiKey = (import.meta as any).env.VITE_GEMINI_API_KEY;
      const groqApiKey = (import.meta as any).env.VITE_GROQ_API_KEY;

      const hasGemini = geminiApiKey && geminiApiKey.trim() !== "" && geminiApiKey !== "YOUR_GEMINI_API_KEY";
      const hasGroq = groqApiKey && groqApiKey.trim() !== "" && groqApiKey !== "YOUR_GROQ_API_KEY";

      const isGemini = selectedModel.startsWith("gemini-");

      if (isGemini && !hasGemini) {
        const errMsg = "Missing VITE_GEMINI_API_KEY. Please specify it in the settings panel or .env file.";
        console.warn("[AI Cleanup] No valid VITE_GEMINI_API_KEY configured.");
        
        setGeminiDebug({
          modelName: selectedModel,
          statusCode: null,
          rawResponse: "No prompt sent - missing API keys configuration.",
          parsedError: { error: "Missing API Key", message: errMsg },
          malformedChunksCount: malformedChunks.length,
          durationMs: 0,
          endpoint: `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=undefined`,
          requestPayload: null,
          errorOccurred: true,
          errorMessage: errMsg
        });
        throw new Error(errMsg);
      }

      if (!isGemini && !hasGroq) {
        const errMsg = "Missing VITE_GROQ_API_KEY. Please specify it in the settings panel or .env file.";
        console.warn("[AI Cleanup] No valid VITE_GROQ_API_KEY configured.");
        
        setGeminiDebug({
          modelName: selectedModel,
          statusCode: null,
          rawResponse: "No prompt sent - missing API keys configuration.",
          parsedError: { error: "Missing API Key", message: errMsg },
          malformedChunksCount: malformedChunks.length,
          durationMs: 0,
          endpoint: "https://api.groq.com/openai/v1/chat/completions",
          requestPayload: null,
          errorOccurred: true,
          errorMessage: errMsg
        });
        throw new Error(errMsg);
      }

      // Step 7: Telemetry Started Log
      console.log(`[AI Performance Telemetry] Request Started:
      - Selected Model: ${selectedModel}
      - Provider: ${isGemini ? "Gemini" : "Groq"}
      - Malformed Chunk Count: ${malformedChunks.length}
      `);

      // STEP 4: Limit malformed reconstruction batches to: MAXIMUM 2 QUESTIONS PER CHUNK
      const batchSize = 2;
      const batches: string[][] = [];
      for (let i = 0; i < malformedChunks.length; i += batchSize) {
        batches.push(malformedChunks.slice(i, i + batchSize));
      }

      console.log(`[AI Pipeline] Batching ${malformedChunks.length} chunks into ${batches.length} groups of size ${batchSize}.`);

      // STEP 6: Reduced Prompt Verbosity. Keep only essential reconstruction rules.
      const systemMessage = `You are an expert curriculum assistant. Clean and reconstruct malformed question blocks into JSON. Restore equations and layout. Preserve content without inventing answers. Output JSON with a "questions" key matching this schema:
{"questions": [{"question_text": "text", "options": ["str", "str", "str", "str"], "correct_option_index": null, "explanation": ""}]}`;

      const processBatchWithSelectedModel = async (batch: string[], batchIdx: number) => {
        const userPrompt = `JSON-repair these malformed PDF question blocks:
${batch.map((c, i) => `Block ${i + 1}:\n${c}`).join("\n\n---\n\n")}`;

        const startTime = performance.now();
        let finalStatus: number | null = null;
        let responseText = "";
        let lastPayload: any = null;
        let lastEndpoint = "";

        if (isGemini) {
          const endpointUrl = `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${geminiApiKey}`;
          lastEndpoint = endpointUrl;

          // STEP 3: thinkingConfig: { thinkingBudget: 0 }
          const requestPayload = {
            systemInstruction: { parts: [{ text: systemMessage }] },
            contents: [{ parts: [{ text: `${systemMessage}\n\nTask:\n${userPrompt}` }] }],
            generationConfig: { 
              responseMimeType: "application/json",
              thinkingConfig: {
                thinkingBudget: 0
              }
            }
          };
          lastPayload = requestPayload;

          console.log(`[Gemini Request Debug]
- Selected Model: ${selectedModel}
- GenerationConfig:`, JSON.stringify(requestPayload.generationConfig, null, 2), `
- ThinkingConfig:`, JSON.stringify(requestPayload.generationConfig.thinkingConfig, null, 2), `
- Final Request Body:`, JSON.stringify(requestPayload, null, 2));

          const response = await fetch(endpointUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestPayload)
          });

          finalStatus = response.status;
          responseText = await response.text();

          const isRateLimit = response.status === 429 || 
            responseText.toLowerCase().includes("quota") || 
            responseText.toLowerCase().includes("limit exceeded") || 
            responseText.toLowerCase().includes("rate limit") || 
            responseText.toLowerCase().includes("rate_limit");

          if (isRateLimit) {
            throw new Error("Selected model is currently rate-limited. Try another provider/model.");
          }

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${responseText}`);
          }

          const data = JSON.parse(responseText);
          const textResult = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!textResult) {
            const finishReason = data.candidates?.[0]?.finishReason || "No candidates found";
            throw new Error(`Empty contents or candidate blocked on ${selectedModel}. Finish reason: ${finishReason}`);
          }

          responseText = textResult;
        } else {
          // Groq Endpoint Route
          const endpointUrl = "https://api.groq.com/openai/v1/chat/completions";
          lastEndpoint = endpointUrl;

          const requestPayload = {
            model: selectedModel,
            messages: [
              { role: "system", content: systemMessage },
              { role: "user", content: userPrompt }
            ],
            temperature: 0.1,
            response_format: { type: "json_object" }
          };
          lastPayload = requestPayload;

          const response = await fetch(endpointUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${groqApiKey}`
            },
            body: JSON.stringify(requestPayload)
          });

          finalStatus = response.status;
          responseText = await response.text();

          const isRateLimit = response.status === 429 || 
            responseText.toLowerCase().includes("quota") || 
            responseText.toLowerCase().includes("limit exceeded") || 
            responseText.toLowerCase().includes("rate limit") || 
            responseText.toLowerCase().includes("rate_limit");

          if (isRateLimit) {
            throw new Error("Selected model is currently rate-limited. Try another provider/model.");
          }

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${responseText}`);
          }

          const responseData = JSON.parse(responseText);
          const content = responseData?.choices?.[0]?.message?.content;
          if (!content) {
            throw new Error("Empty message content returned from Groq API");
          }

          responseText = content;
        }

        const duration = performance.now() - startTime;
        let parsedGroup: any;
        try {
          parsedGroup = JSON.parse(responseText.trim());
        } catch (jsonErr: any) {
          console.error(`[AI Parser] JSON Parse failure on restored text or chunk:`, responseText, jsonErr);
          throw jsonErr;
        }

        let list: any[] = [];
        if (Array.isArray(parsedGroup)) {
          list = parsedGroup;
        } else if (parsedGroup && Array.isArray(parsedGroup.questions)) {
          list = parsedGroup.questions;
        } else if (parsedGroup && typeof parsedGroup === "object") {
          const firstArrayKey = Object.keys(parsedGroup).find(k => Array.isArray((parsedGroup as any)[k]));
          if (firstArrayKey) {
            list = (parsedGroup as any)[firstArrayKey];
          }
        }

        if (batchIdx === batches.length - 1) {
          setGeminiDebug({
            modelName: selectedModel,
            statusCode: finalStatus,
            rawResponse: responseText,
            parsedError: null,
            malformedChunksCount: malformedChunks.length,
            durationMs: duration,
            endpoint: lastEndpoint,
            requestPayload: lastPayload,
            errorOccurred: false,
            errorMessage: null
          });
        }

        return { list, durationMs: duration };
      };

      // STEP 5: Parallel request execution with controlled concurrency (Limit to 2 simultaneous requests)
      const concurrencyLimit = 2;
      const combinedResults: any[] = [];
      const startTimeTotal = performance.now();

      for (let i = 0; i < batches.length; i += concurrencyLimit) {
        const currentGroup = batches.slice(i, i + concurrencyLimit);
        const groupPromises = currentGroup.map((batch, subIdx) => {
          const batchIndex = i + subIdx;
          return processBatchWithSelectedModel(batch, batchIndex);
        });

        const groupResults = await Promise.all(groupPromises);
        groupResults.forEach(r => {
          combinedResults.push(...r.list);
        });

        // STEP 1: Small throttling delay of 300ms between consecutive parallel bunches
        if (i + concurrencyLimit < batches.length) {
          console.log(`[AI Performance Telemetry] Small throttling block (300ms) between parallel batches...`);
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }

      const totalDuration = performance.now() - startTimeTotal;
      
      // Step 7: Telemetry succeeded log
      console.log(`[AI Performance Telemetry] Request Succeeded:
      - Selected Model: ${selectedModel}
      - Provider: ${isGemini ? "Gemini" : "Groq"}
      - Request Latency (Total): ${totalDuration.toFixed(1)} ms
      - Malformed Chunks Repaired: ${malformedChunks.length}
      - Average Batch Timing: ${(totalDuration / batches.length).toFixed(1)} ms
      - Success State: true
      `);

      const aiQuestions: Question[] = combinedResults.map((q: any, index: number) => {
        const options = Array.isArray(q.options) ? q.options : ["", "", "", ""];
        while (options.length < 4) {
          options.push("");
        }

        const isBlank = !q.question_text || q.question_text.trim() === "";
        const insufficientOpts = options.filter((o: any) => o && o.trim()).length < 2;
        const correctIndex = typeof q.correct_option_index === "number" ? q.correct_option_index : -1;

        let hasWarning = isBlank || insufficientOpts || correctIndex === -1;
        let warningReason = "";

        if (isBlank) {
          warningReason = "Question description is completely blank.";
        } else if (insufficientOpts) {
          warningReason = "Missing multiple-choice options (Requires at least 2).";
        } else if (correctIndex === -1) {
          warningReason = "No correct answer index detected. Specify answer key manually on the card.";
        }

        return {
          id: `q-ai-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 5)}`,
          questionText: q.question_text || `[Empty AI Reconstructed Question ${index + 1}]`,
          options: options.map((opt: any) => String(opt || "").trim()),
          correctOptionIndex: correctIndex,
          explanation: q.explanation || "",
          hasWarning,
          warningReason,
          isAiCleaned: true
        } as Question;
      });

      const finalQuestionsList = [...highConfQuestions, ...aiQuestions];
      setQuestions(finalQuestionsList);
      setAiCleanedCount(aiQuestions.length);

      // Re-calculate post confidence
      const postWarnings = finalQuestionsList.filter(q => q.hasWarning).length;
      const postConfidence = Math.round(((finalQuestionsList.length - postWarnings) / finalQuestionsList.length) * 100);
      setParserConfidence(postConfidence);

      if (aiQuestions.length > 0) {
        setWarning(`AI cleanup recovery applied to malformed question blocks. Reconstructed ${aiQuestions.length} questions semantically from mangled PDF layout.`);
      }

      return finalQuestionsList;
    } catch (apiErr: any) {
      console.warn("[AI STRICT COMBINED PIPELINE] Semantic cleanup request failed:", apiErr);

      const isRateLimitError = apiErr.message && apiErr.message.toLowerCase().includes("rate-limited");
      const isGemini = selectedModel.startsWith("gemini-");

      setGeminiDebug({
        modelName: selectedModel,
        statusCode: apiErr.message?.includes("HTTP") ? parseInt(apiErr.message.match(/\d+/)?.[0] || "429") : 429,
        rawResponse: apiErr.message || "Request failed with error",
        parsedError: { error: apiErr.name || "Error", message: apiErr.message },
        malformedChunksCount: malformedChunks.length,
        durationMs: 0,
        endpoint: isGemini 
          ? `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=...` 
          : "https://api.groq.com/openai/v1/chat/completions",
        requestPayload: { selectedModel },
        errorOccurred: true,
        errorMessage: apiErr.message || "Unknown API disruption occurred."
      });

      setQuestions(initialQuestions);
      setAiCleanedCount(0);

      // Step 7: Telemetry failed log
      console.log(`[AI Performance Telemetry] Request Failed:
      - Selected Model: ${selectedModel}
      - Provider: ${isGemini ? "Gemini" : "Groq"}
      - Malformed Chunk Count: ${malformedChunks.length}
      - Success State: false
      - Error: ${apiErr.message || String(apiErr)}
      `);

      const warnMsg = isRateLimitError 
        ? "Selected model is currently rate-limited. Try another provider/model." 
        : `Notice: AI-powered recovery was bypassed with errors (${apiErr.message || "Invalid API keys or network blocks"}). Reverting to default regex parsed result.`;

      setWarning(warnMsg);
      return initialQuestions;
    } finally {
      setIsAiCleaning(false);
    }
  };

  // Helper to compute stable fast hash of PDF file metadata and head data
  const computeSimpleFileHash = async (file: File): Promise<string> => {
    try {
      const slice = file.slice(0, 100 * 1024); // Use first 100KB for speed
      const arrayBuffer = await slice.arrayBuffer();
      const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
      return `${hex}-${file.size}-${file.name}`;
    } catch (e) {
      // Fallback identifier if crypto API fails
      return `fallback-${file.name}-${file.size}-${file.lastModified}`;
    }
  };

  // Convert PDF to questions
  const processPdf = async (pdfFile: File) => {
    setExtracting(true);
    setParserConfidence(null);
    setAiCleanedCount(0);
    setOcrTelemetry(null);
    setError(null);
    setWarning(null);
    setProgress({ current: 0, total: 0 });
    setExtractionStage("Checking cached results first...");
    try {
      // STEP 7: Check lightweight PDF parse caching
      const fileHash = await computeSimpleFileHash(pdfFile);
      const cacheKey = `pdf_cache_${fileHash}`;
      const cachedDataStr = localStorage.getItem(cacheKey);
      if (cachedDataStr) {
        try {
          const cached = JSON.parse(cachedDataStr);
          if (cached && Array.isArray(cached.questions)) {
            console.log("[Cache Engine] Cache HIT! Reusing previously extracted structures for file:", pdfFile.name);
            setRawText(cached.rawText || "");
            setQuestions(cached.questions);
            setParserConfidence(cached.parserConfidence ?? null);
            setOcrTelemetry(cached.ocrTelemetry ?? null);
            setAiCleanedCount(cached.aiCleanedCount ?? 0);
            setWarning(`Notice: Loaded from quick cache! Re-used previously compiled layout recoveries.`);
            setExtracting(false);
            return;
          }
        } catch (cacheErr) {
          console.warn("[Cache Engine] Cache corrupt or expired. Proceeding to parse...", cacheErr);
        }
      }

      setExtractionStage("Initializing multi-stage extraction...");
      const text = await extractTextFromPdf(
        pdfFile, 
        (current, total, stage) => {
          setProgress({ current, total });
          if (stage) {
            setExtractionStage(stage);
          }
        },
        (telemetry) => {
          setOcrTelemetry(telemetry);
        }
      );
      
      setRawText(text);
      const parsed = parseQuestionsFromText(text);
      
      let finalQuestions: Question[] = [];
      if (parsed.length === 0) {
        setWarning("Notice: We couldn't detect any structured multi-choice questions in this PDF, but the raw text was extracted successfully! You can review or edit the Extracted Raw Text below and hit 'Re-run Parser', or continue manually.");
        finalQuestions = [createNewQuestion(1)];
        setQuestions(finalQuestions);
      } else {
        finalQuestions = await runAiCleanupPipeline(parsed);
      }

      // Save successful extraction states to localStorage Cache
      try {
        const postWarnings = finalQuestions.filter(q => q.hasWarning).length;
        const postConfidence = finalQuestions.length ? Math.round(((finalQuestions.length - postWarnings) / finalQuestions.length) * 100) : 0;

        localStorage.setItem(cacheKey, JSON.stringify({
          questions: finalQuestions,
          parserConfidence: postConfidence,
          ocrTelemetry: ocrTelemetry,
          rawText: text,
          aiCleanedCount: finalQuestions.filter(q => q.isAiCleaned).length
        }));
        console.log("[Cache Engine] PDF processed results saved successfully to client-side localStorage.");
      } catch (cacheSaveErr) {
        console.warn("[Cache Engine] Failed to cache processed results:", cacheSaveErr);
      }
    } catch (e: any) {
      console.error(e);
      // Fallback mode: show warning banner instead of hard error, allow manual entry anyway
      setWarning(`PDF Extraction completed with warning notice: ${e.message || "Failed to parse structured characters."}`);
      setRawText("");
      setQuestions([createNewQuestion(1)]);
    } finally {
      setExtracting(false);
    }
  };

  const handleReparseRawText = async () => {
    if (!rawText.trim()) return;
    setError(null);
    setWarning(null);
    setParserConfidence(null);
    setAiCleanedCount(0);
    setIsAiCleaning(true);
    try {
      const parsed = parseQuestionsFromText(rawText);
      if (parsed.length === 0) {
        setWarning("Re-parsed text, but no structured questions could be detected. Please ensure questions are structured with numbered headings (e.g., '1.', '2.') and options are clearly delimited.");
        setIsAiCleaning(false);
      } else {
        await runAiCleanupPipeline(parsed);
      }
    } catch (e: any) {
      console.error(e);
      setError("Re-parsing failed: " + e.message);
      setIsAiCleaning(false);
    }
  };

  // Helper code to mock a blank question
  const createNewQuestion = (num: number): Question => ({
    id: `q-manual-${Math.random().toString(36).substr(2, 5)}`,
    questionText: `Sample question text ${num}`,
    options: ["Option A", "Option B", "Option C", "Option D"],
    correctOptionIndex: 0,
    explanation: ""
  });

  const handleAddQuestion = () => {
    const nextNum = questions.length + 1;
    setQuestions([...questions, createNewQuestion(nextNum)]);
  };

  const handleRemoveQuestion = (id: string) => {
    setQuestions(questions.filter(q => q.id !== id));
  };

  // Inline worksheet cell updates
  const handleQuestionTextChange = (id: string, text: string) => {
    setQuestions(questions.map(q => {
      if (q.id === id) {
        const isBlank = text.trim() === "";
        const insufficientOpts = q.options.filter(o => o.trim()).length < 2;
        const hasWarning = isBlank || insufficientOpts || q.correctOptionIndex === -1;
        let warningReason = "";
        if (isBlank) {
          warningReason = "Question description is completely blank.";
        } else if (insufficientOpts) {
          warningReason = "Missing multiple-choice options (Requires at least 2).";
        } else if (q.correctOptionIndex === -1) {
          warningReason = "No correct answer index selected. Specify answer key manually on the card.";
        }
        return { ...q, questionText: text, hasWarning, warningReason };
      }
      return q;
    }));
  };

  const handleOptionTextChange = (id: string, optIdx: number, text: string) => {
    setQuestions(questions.map(q => {
      if (q.id === id) {
        const nextOptions = [...q.options];
        nextOptions[optIdx] = text;
        const isBlank = q.questionText.trim() === "";
        const insufficientOpts = nextOptions.filter(o => o.trim()).length < 2;
        const hasWarning = isBlank || insufficientOpts || q.correctOptionIndex === -1;
        let warningReason = "";
        if (isBlank) {
          warningReason = "Question description is completely blank.";
        } else if (insufficientOpts) {
          warningReason = "Missing multiple-choice options (Requires at least 2).";
        } else if (q.correctOptionIndex === -1) {
          warningReason = "No correct answer index selected. Specify answer key manually on the card.";
        }
        return { ...q, options: nextOptions, hasWarning, warningReason };
      }
      return q;
    }));
  };

  const handleCorrectOptionChange = (id: string, opIdx: number) => {
    setQuestions(questions.map(q => {
      if (q.id === id) {
        const isBlank = q.questionText.trim() === "";
        const insufficientOpts = q.options.filter(o => o.trim()).length < 2;
        const hasWarning = isBlank || insufficientOpts || opIdx === -1;
        let warningReason = "";
        if (isBlank) {
          warningReason = "Question description is completely blank.";
        } else if (insufficientOpts) {
          warningReason = "Missing multiple-choice options (Requires at least 2).";
        } else if (opIdx === -1) {
          warningReason = "No correct answer index selected. Specify answer key manually on the card.";
        }
        return { ...q, correctOptionIndex: opIdx, hasWarning, warningReason };
      }
      return q;
    }));
  };

  const handleExplanationChange = (id: string, explanation: string) => {
    setQuestions(questions.map(q => q.id === id ? { ...q, explanation } : q));
  };

  // Save parsed set
  const handleSaveSet = async () => {
    if (!user) return;
    if (!subject.trim()) {
      setError("Please key in a Subject name");
      return;
    }
    if (questions.length === 0) {
      setError("Please add at least 1 question to the set");
      return;
    }

    setIsSaving(true);
    setError(null);

    const questionSetId = `set-${Math.random().toString(36).substr(2, 9)}`;
    const firestorePath = `questionSets/${questionSetId}`;

    const newSet: QuestionSet = {
      id: questionSetId,
      userId: user.uid,
      fileName: file?.name || "ManualEntry.pdf",
      subject: subject.trim(),
      exam: exam.trim() || "General Practice",
      year: year.trim() || new Date().getFullYear().toString(),
      questionsCount: questions.length,
      questions: questions.map((q, idx) => ({
        ...q,
        subject: subject.trim(),
        exam: exam.trim() || "General Practice",
        year: year.trim() || new Date().getFullYear().toString()
      })),
      createdAt: new Date() // Will convert correctly inside Firestore batch or setDoc
    };

    try {
      if (dbOnline) {
        const batch = writeBatch(db);
        const setDocRef = doc(collection(db, "questionSets"), questionSetId);
        
        // Formulate Firestore data strictly compatible with the blueprint rules
        batch.set(setDocRef, {
          ...newSet,
          createdAt: Timestamp.now()
        });
        await batch.commit();
      } else {
        // Fallback save in localStorage for local sandbox environment
        const localSets = JSON.parse(localStorage.getItem("mockgo_question_sets") || "[]");
        localSets.push({
          ...newSet,
          id: questionSetId,
          createdAt: new Date().toISOString()
        });
        localStorage.setItem("mockgo_question_sets", JSON.stringify(localSets));
      }

      // Track activity log
      const localActivity = JSON.parse(localStorage.getItem("mockgo_activity") || "[]");
      localActivity.unshift({
        type: "upload",
        title: `Uploaded set: ${newSet.subject} (${newSet.exam})`,
        meta: `${questions.length} questions extracted`,
        date: new Date().toISOString()
      });
      localStorage.setItem("mockgo_activity", JSON.stringify(localActivity.slice(0, 15)));

      onUploadSuccess();
    } catch (e: any) {
      console.error(e);
      handleFirestoreError(e, OperationType.CREATE, firestorePath);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="w-full h-full text-zinc-100 flex flex-col gap-6 max-w-5xl mx-auto pb-12 font-sans relative">
      {isAiCleaning && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center gap-4 text-center animate-fade-in">
          <div className="p-6 bg-zinc-950 border border-zinc-900 rounded-xl max-w-md flex flex-col items-center gap-4 shadow-2xl">
            <div className="relative flex items-center justify-center">
              <div className="w-12 h-12 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              <Sparkles className="w-5 h-5 text-emerald-400 absolute animate-pulse" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white tracking-tight">
                AI Cleanup Fallback Recovery Active
              </p>
              <p className="text-xs text-zinc-400 mt-1">
                {extractionStage || "Reconstructing low-confidence text blocks..."}
              </p>
            </div>
            <div className="w-full bg-zinc-900 h-1.5 rounded-full overflow-hidden border border-zinc-800">
              <div className="bg-emerald-555 h-full w-1/3 rounded-full animate-pulse" />
            </div>
            <p className="text-[10px] text-zinc-500 font-mono">
              Selected Developer Target: {selectedModel}
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-white mb-1">
          Upload and Parse PYQ PDF
        </h2>
        <p className="text-zinc-500 text-xs">
          Client-side extraction. Your files never hit third-party servers. Review and fix parse structures instantly.
        </p>
      </div>

      {/* TEMPORARY DEV MODEL SELECTION DROPDOWN */}
      {questions.length === 0 && (
        <div className="bg-zinc-950/60 border border-zinc-900 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 animate-fade-in" id="dev-model-select-panel">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              <label htmlFor="model-select" className="text-xs font-semibold text-zinc-300 uppercase tracking-wider font-mono">
                Semantic Cleanup Model
              </label>
              <span className="text-[10px] bg-amber-950/50 text-amber-400 border border-amber-900/30 px-1.5 py-0.5 rounded font-mono font-medium">
                Testing Module
              </span>
            </div>
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              Select which LLM provider or offline fallback algorithm will perform semantic reconstruction on low-confidence PDF parsing streams.
            </p>
          </div>
          <div className="w-full sm:w-auto shrink-0">
            <select
              id="model-select"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="w-full sm:w-64 bg-zinc-900/80 border border-zinc-800 text-xs text-zinc-200 rounded px-2.5 py-2 font-mono transition-colors focus:outline-none focus:border-zinc-700 hover:border-zinc-700 cursor-pointer"
            >
              <optgroup label="Gemini REST API Models">
                <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite (Smart Default)</option>
                <option value="gemini-3.5-flash">gemini-3.5-flash</option>
                <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                <option value="gemini-2.0-flash">gemini-2.0-flash</option>
              </optgroup>
              <optgroup label="Groq OpenAI-Compatible Models">
                <option value="qwen/qwen3-32b">Groq Qwen3 (qwen/qwen3-32b)</option>
                <option value="llama-3.3-70b-versatile">Groq Llama (llama-3.3-70b-versatile)</option>
              </optgroup>
              <optgroup label="Offline Regex Core Engine">
                <option value="regex-only-mode">regex-only-mode (Bypass AI entirely)</option>
              </optgroup>
            </select>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-950/20 border border-red-900 text-red-400 p-3.5 rounded-md text-xs flex gap-3 items-start animate-fade-in">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <p>{error}</p>
        </div>
      )}

      {warning && (
        <div className="bg-amber-950/20 border border-amber-900/60 text-amber-300 p-3.5 rounded-md text-xs flex gap-3 items-start animate-fade-in">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
          <div className="flex-1 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div>
              <p className="font-semibold mb-0.5 text-amber-200">Parser Notice</p>
              <p>{warning}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setWarning(null);
                if (questions.length === 0) {
                  setQuestions([createNewQuestion(1)]);
                }
              }}
              className="px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 font-mono text-[10px] font-bold rounded border border-amber-500/30 uppercase tracking-wider transition-colors shrink-0"
            >
              Continue Anyway
            </button>
          </div>
        </div>
      )}

      {/* Raw Extracted Text Edit / Fallback Zone Accordion */}
      {rawText.trim().length > 0 && (
        <div className="border border-zinc-900 bg-zinc-950 p-4 rounded-lg flex flex-col gap-3">
          <button
            type="button"
            onClick={() => setShowRawText(!showRawText)}
            className="flex items-center justify-between w-full text-xs font-semibold tracking-wider text-zinc-400 uppercase font-mono text-left focus:outline-none"
          >
            <span>Raw Extracted Text Buffer ({showRawText ? "Hide Pane" : "Show / Edit Text"})</span>
            <span className="text-[10px] text-zinc-550 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800 font-mono">
              {rawText.length} chars
            </span>
          </button>

          {showRawText && (
            <div className="flex flex-col gap-3 mt-1 animate-fade-in">
              <p className="text-[11px] text-zinc-500">
                You can directly edit this raw text buffer to fix line breaks, spacing, option names, or formatting errors. Then click "Re-run Parser on Raw Text" to re-generate the structural list.
              </p>
              <textarea
                rows={8}
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded p-3 text-xs text-zinc-300 font-mono focus:outline-none focus:border-zinc-700"
                placeholder="Raw PDF text character stream..."
              />
              <button
                type="button"
                onClick={handleReparseRawText}
                className="self-end px-3 py-1.5 bg-white text-black text-[11px] font-mono font-semibold rounded hover:bg-zinc-200 transition-colors"
              >
                Re-run Parser on Raw Text
              </button>
            </div>
          )}
        </div>
      )}

      {/* Upload Zone */}
      {questions.length === 0 && (
        <div 
          onDragOver={onDragOver}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className="border border-dashed border-zinc-800 bg-zinc-950/50 hover:bg-zinc-950 hover:border-zinc-700 transition-colors p-16 rounded-lg text-center cursor-pointer flex flex-col items-center justify-center gap-4 group"
        >
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileChange} 
            accept=".pdf" 
            className="hidden" 
          />

          {extracting ? (
            <div className="flex flex-col items-center gap-3 w-full">
              <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin mb-2" />
              <p className="text-sm text-zinc-300 font-medium font-mono text-amber-200 text-center">
                {extractionStage || "Extracting PDF structures..."}
              </p>
              {progress.total > 0 && (
                <span className="text-xs text-zinc-500 font-mono text-center">
                  Page {progress.current} of {progress.total}
                </span>
              )}
              {ocrTelemetry?.lowTextPagesCount && ocrTelemetry.lowTextPagesCount > 0 ? (
                <div className="mt-3 flex flex-col items-center gap-1.5 max-w-sm bg-zinc-900 border border-zinc-800 p-4 rounded-lg text-left w-full animate-fade-in font-mono text-[11px] text-zinc-400 cursor-default" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-between w-full border-b border-zinc-800 pb-1.5 mb-1 text-zinc-300 font-semibold uppercase text-[10px]">
                    <span>OCR Real-time Telemetry</span>
                    <span className="text-amber-400 animate-pulse">Scanning...</span>
                  </div>
                  <div className="flex justify-between w-full">
                    <span>Low-text pages:</span>
                    <span className="text-zinc-200 font-bold">{ocrTelemetry.lowTextPagesCount} detected</span>
                  </div>
                  <div className="flex justify-between w-full">
                    <span>OCR Pages Scanned:</span>
                    <span className="text-zinc-200 font-bold">{ocrTelemetry.ocrPagesProcessed}</span>
                  </div>
                  <div className="flex justify-between w-full">
                    <span>OCR Successful:</span>
                    <span className="text-emerald-400 font-bold">{ocrTelemetry.ocrSuccessCount}</span>
                  </div>
                  <div className="flex justify-between w-full">
                    <span>OCR Failed/Dismissed:</span>
                    <span className="text-rose-400 font-bold">{ocrTelemetry.ocrFailureCount}</span>
                  </div>
                  <div className="flex justify-between w-full">
                    <span>OCR Elapsed Time:</span>
                    <span className="text-amber-400">{(ocrTelemetry.ocrDurationMs / 1000).toFixed(1)}s</span>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <>
              <div className="p-3 bg-zinc-900 border border-zinc-800 rounded group-hover:border-zinc-700 transition-all">
                <Upload className="w-6 h-6 text-zinc-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-300">
                  Select or drag a PYQ PDF here
                </p>
                <p className="text-xs text-zinc-500 mt-1">
                  Supports select-enabled PDFs up to 25MB
                </p>
              </div>
              <div className="flex flex-col items-center gap-2 mt-2">
                <button type="button" className="px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded text-xs hover:bg-zinc-850 text-zinc-300">
                  Browse Files
                </button>
                <div className="flex items-center gap-1 text-[11px] text-zinc-500 mt-1">
                  <span>Or</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setQuestions([createNewQuestion(1)]);
                      setWarning("Manual editing mode activated. You can now build questions manually.");
                    }}
                    className="text-zinc-300 hover:text-white underline cursor-pointer transition-colors"
                  >
                    Start with a blank worksheet
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Worksheet Review Section */}
      {questions.length > 0 && (
        <div className="flex flex-col gap-6 animate-fade-in">
          {/* Collapse/Expand Toggle for Gemini API Debug diagnostics */}
          {geminiDebug && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowDebugPanel(!showDebugPanel)}
                className="text-xs font-mono font-medium text-zinc-500 hover:text-zinc-300 flex items-center gap-1.5 bg-zinc-950 px-3 py-1.5 rounded border border-zinc-900 transition-colors"
                id="toggle-debug-panel"
              >
                <span>🔧 {showDebugPanel ? "Collapse" : "Expand"} Developer Debug Panel</span>
                <span className={`h-1.5 w-1.5 rounded-full ${geminiDebug.errorOccurred ? "bg-rose-500 animate-pulse" : "bg-emerald-500"}`} />
                <span className="text-[10px] text-zinc-600">({geminiDebug.errorOccurred ? "API FAILURE" : "API SUCCESS"})</span>
              </button>
            </div>
          )}

          {/* STRICT GEMINI-ONLY DEVELOPER DEBUG PANEL */}
          {geminiDebug && showDebugPanel && (
            <div className={`border rounded-lg p-5 flex flex-col gap-4 font-sans ${
              geminiDebug.errorOccurred 
                ? "border-rose-900 bg-rose-950/10 text-rose-200" 
                : "border-emerald-900 bg-emerald-950/10 text-emerald-200"
            }`} id="developer-debug-panel">
              <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: geminiDebug.errorOccurred ? "rgba(224, 36, 36, 0.2)" : "rgba(16, 185, 129, 0.2)" }}>
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${geminiDebug.errorOccurred ? "bg-rose-500 animate-pulse" : "bg-emerald-500"}`} />
                  <h3 className="text-xs font-bold uppercase tracking-wider font-mono">
                    🔧 Gemini API Debug Diagnostics (Collapsible Developer Mode)
                  </h3>
                </div>
                <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded uppercase border ${
                  geminiDebug.errorOccurred 
                    ? "bg-rose-950/40 text-rose-400 border-rose-900/40" 
                    : "bg-emerald-950/40 text-emerald-400 border-emerald-900/40"
                }`}>
                  {geminiDebug.errorOccurred ? "API FAILURE" : "API SUCCESS"}
                </span>
              </div>

              {geminiDebug.errorOccurred && geminiDebug.errorMessage && (
                <div className="flex items-start gap-2 bg-rose-950/30 border border-rose-900/45 p-3 rounded text-xs select-text">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-semibold text-rose-300">Exact Gemini API Error Displayed:</p>
                    <p className="font-mono mt-1 break-words leading-relaxed whitespace-pre-wrap">{geminiDebug.errorMessage}</p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono text-xs text-zinc-300">
                <div className="bg-zinc-950/60 p-3 rounded border border-zinc-900 flex flex-col justify-center">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold mb-1">Active Model Name</span>
                  <span className="font-bold text-zinc-100">{geminiDebug.modelName}</span>
                </div>
                <div className="bg-zinc-950/60 p-3 rounded border border-zinc-900 flex flex-col justify-center">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold mb-1">HTTP Status Code</span>
                  <span className={`font-bold ${
                    geminiDebug.statusCode === 200 
                      ? "text-emerald-400" 
                      : geminiDebug.statusCode 
                        ? "text-rose-400" 
                        : "text-amber-400"
                  }`}>
                    {geminiDebug.statusCode !== null ? `${geminiDebug.statusCode}` : "CORS / NETWORK BLOCK"}
                  </span>
                </div>
                <div className="bg-zinc-950/60 p-3 rounded border border-zinc-900 flex flex-col justify-center">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold mb-1">Reconstruction Duration</span>
                  <span className="font-bold text-amber-400">
                    {geminiDebug.durationMs !== null ? `${geminiDebug.durationMs.toFixed(1)} ms` : "N/A"}
                  </span>
                </div>
                <div className="bg-zinc-950/60 p-3 rounded border border-zinc-900 flex flex-col justify-center">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold mb-1">Malformed Chunks repaired</span>
                  <span className="font-bold text-zinc-100">{geminiDebug.malformedChunksCount} Chunks</span>
                </div>
                <div className="bg-zinc-950/60 p-3 rounded border border-zinc-900 md:col-span-2 flex flex-col justify-center font-mono">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold mb-1">Target Endpoint API URL</span>
                  <span className="text-zinc-400 break-all select-all font-mono text-[10px] truncate">{geminiDebug.endpoint}</span>
                </div>
              </div>

              {/* Developer details and logs collapsible container */}
              <div className="flex flex-col gap-2.5 mt-2">
                <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">Payload inspection panels (Details)</span>
                
                <details className="group border border-zinc-900 rounded bg-zinc-950/50 p-2.5 transition-colors">
                  <summary className="cursor-pointer text-xs font-mono font-semibold text-zinc-400 hover:text-zinc-200 flex justify-between items-center select-none">
                    <span>1. Request Payload JSON Stream</span>
                    <span className="text-[10px] text-zinc-500 group-open:hidden">Expand</span>
                    <span className="text-[10px] text-zinc-500 hidden group-open:block">Collapse</span>
                  </summary>
                  <div className="mt-2.5 text-[11px] font-mono bg-zinc-900/80 border border-zinc-950 p-3 rounded overflow-x-auto text-zinc-355 max-h-60 leading-relaxed scrollbar-thin select-all">
                    <pre className="whitespace-pre-wrap">{JSON.stringify(geminiDebug.requestPayload, null, 2)}</pre>
                  </div>
                </details>

                <details className="group border border-zinc-900 rounded bg-zinc-950/50 p-2.5 transition-colors">
                  <summary className="cursor-pointer text-xs font-mono font-semibold text-zinc-400 hover:text-zinc-200 flex justify-between items-center select-none">
                    <span>2. Raw Gemini API Response Stream</span>
                    <span className="text-[10px] text-zinc-500 group-open:hidden">Expand</span>
                    <span className="text-[10px] text-zinc-500 hidden group-open:block">Collapse</span>
                  </summary>
                  <div className="mt-2.5 text-[11px] font-mono bg-zinc-900/80 border border-zinc-950 p-3 rounded overflow-x-auto text-zinc-355 max-h-60 leading-relaxed scrollbar-thin select-all">
                    <pre className="whitespace-pre-wrap">{geminiDebug.rawResponse || "(No response stream received)"}</pre>
                  </div>
                </details>

                <details className="group border border-zinc-900 rounded bg-zinc-950/50 p-2.5 transition-colors">
                  <summary className="cursor-pointer text-xs font-mono font-semibold text-zinc-400 hover:text-zinc-200 flex justify-between items-center select-none">
                    <span>3. Parsed Error / Payload Diagnostic Tree</span>
                    <span className="text-[10px] text-zinc-500 group-open:hidden">Expand</span>
                    <span className="text-[10px] text-zinc-500 hidden group-open:block">Collapse</span>
                  </summary>
                  <div className="mt-2.5 text-[11px] font-mono bg-zinc-900/80 border border-zinc-950 p-3 rounded overflow-x-auto text-zinc-355 max-h-60 leading-relaxed scrollbar-thin select-all">
                    <pre className="whitespace-pre-wrap">
                      {geminiDebug.parsedError 
                        ? JSON.stringify(geminiDebug.parsedError, null, 2) 
                        : "null (No parsed API error object present)"}
                    </pre>
                  </div>
                </details>
              </div>
            </div>
          )}

          {/* AI Metrics & Insights Panel */}
          {parserConfidence !== null && (
            <div className="border border-zinc-900 bg-zinc-950 p-5 rounded-lg flex flex-col gap-4">
              <h3 className="text-xs font-semibold tracking-wider text-zinc-400 flex items-center justify-between uppercase">
                <div className="flex items-center gap-1.5">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  <span>AI Extraction Recovery Diagnostics</span>
                </div>
                {aiCleanedCount > 0 && (
                  <span className="bg-emerald-950/45 text-emerald-300 text-[10px] font-mono px-2 py-0.5 rounded border border-emerald-900/60 flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-emerald-400 shrink-0" />
                    <span>AI cleanup recovery applied to malformed question blocks.</span>
                  </span>
                )}
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-zinc-900/40 p-4 rounded border border-zinc-900 flex flex-col justify-center">
                  <p className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider mb-1">Parser Confidence Score</p>
                  <p className="text-2xl font-bold tracking-tight font-mono">
                    <span className={parserConfidence >= 80 ? "text-emerald-400" : parserConfidence >= 50 ? "text-amber-400" : "text-rose-400"}>
                      {parserConfidence}%
                    </span>
                  </p>
                  <p className="text-[11px] text-zinc-500 mt-1">
                    {parserConfidence >= 80 
                      ? "High-fidelity extraction. Structural grammar and option bounds resolved." 
                      : "Sparsely formatted layout. Manual validation of highlighted warning cards recommended."}
                  </p>
                </div>

                <div className="bg-zinc-900/40 p-4 rounded border border-zinc-900 flex flex-col justify-center">
                  <p className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider mb-1">Low Confidence Detections</p>
                  <p className="text-2xl font-bold tracking-tight font-mono text-zinc-355">
                    {questions.filter(q => q.hasWarning).length} Chunks
                  </p>
                  <p className="text-[11px] text-zinc-500 mt-1">
                    Total blocks flagged with missing options, blank descriptions, or unmapped keys.
                  </p>
                </div>

                <div className="bg-zinc-900/40 p-4 rounded border border-zinc-900 flex flex-col justify-center">
                  <p className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider mb-1">AI Reconstructed Questions</p>
                  <p className="text-2xl font-bold tracking-tight font-mono text-emerald-400">
                    {aiCleanedCount} Cleaned
                  </p>
                  <p className="text-[11px] text-zinc-500 mt-1">
                    Mashed or low-confidence layouts semantically restored with Gemini Flash.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* OCR Metrics & Diagnostics Panel */}
          {ocrTelemetry && ocrTelemetry.lowTextPagesCount > 0 && (
            <div className="border border-zinc-900 bg-zinc-950 p-5 rounded-lg flex flex-col gap-4">
              <h3 className="text-xs font-semibold tracking-wider text-zinc-400 flex items-center justify-between uppercase">
                <div className="flex items-center gap-1.5">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                  </span>
                  <span>Hybrid Client-Side OCR Diagnostics</span>
                </div>
                <span className="bg-zinc-900 text-zinc-400 text-[10px] font-mono px-2 py-0.5 rounded border border-zinc-805">
                  Tesseract.js ("eng") fallback engine
                </span>
              </h3>

              {ocrTelemetry.ocrLimitExceeded && (
                <div className="bg-amber-950/20 border border-amber-900/40 text-amber-355 p-3 rounded-md text-[11px] flex gap-2 items-center">
                  <AlertCircle className="w-4 h-4 shrink-0 text-amber-500" />
                  <span>OCR fallback limited to first 5 low-text pages for performance stability. Prioritized by lowest character density first.</span>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-zinc-900/40 p-4 rounded border border-zinc-900 flex flex-col justify-center">
                  <p className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider mb-1">OCR Pages Processed</p>
                  <p className="text-xl font-bold tracking-tight font-mono text-zinc-200">
                    {ocrTelemetry.ocrPagesProcessed} / {ocrTelemetry.lowTextPagesCount}
                  </p>
                  <p className="text-[11px] text-zinc-500 mt-1">
                    Number of scanned pages where native characters fell under 150.
                  </p>
                </div>

                <div className="bg-zinc-900/40 p-4 rounded border border-zinc-900 flex flex-col justify-center">
                  <p className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider mb-1">OCR Success Count</p>
                  <p className="text-xl font-bold tracking-tight font-mono text-emerald-400">
                    {ocrTelemetry.ocrSuccessCount} Saved
                  </p>
                  <p className="text-[11px] text-zinc-500 mt-1">
                    Pages successfully transcribed with confidence above 30%.
                  </p>
                </div>

                <div className="bg-zinc-900/40 p-4 rounded border border-zinc-900 flex flex-col justify-center">
                  <p className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider mb-1">OCR Dismissed/Failed</p>
                  <p className="text-xl font-bold tracking-tight font-mono text-zinc-400">
                    {ocrTelemetry.ocrFailureCount} Discarded
                  </p>
                  <p className="text-[11px] text-zinc-500 mt-1">
                    Pages discarded due to low OCR confidence or scan failure.
                  </p>
                </div>

                <div className="bg-zinc-900/40 p-4 rounded border border-zinc-900 flex flex-col justify-center">
                  <p className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider mb-1">OCR Engine Duration</p>
                  <p className="text-xl font-bold tracking-tight font-mono text-amber-400 font-semibold">
                    {(ocrTelemetry.ocrDurationMs / 1000).toFixed(1)}s
                  </p>
                  <p className="text-[11px] text-zinc-500 mt-1">
                    Total client-side execution time of Tesseract.js WebAssembly workers.
                  </p>
                </div>
              </div>

              {/* Individual Page Logs Row */}
              <div className="mt-2 flex flex-col gap-1.5">
                <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">Interactive Page-Level Log Table</span>
                <div className="border border-zinc-900 rounded overflow-hidden max-h-36 overflow-y-auto font-mono text-[10px]">
                  <table className="w-full text-left text-zinc-400">
                    <thead className="bg-zinc-900 text-zinc-500 uppercase text-[9px] border-b border-zinc-900 sticky top-0">
                      <tr>
                        <th className="p-2">Page No.</th>
                        <th className="p-2">Initial Chars</th>
                        <th className="p-2">Status</th>
                        <th className="p-2">Confidence</th>
                        <th className="p-2">Final Chars</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-900">
                      {ocrTelemetry.pagesHandled.map((page, index) => (
                        <tr key={index} className="hover:bg-zinc-900/30">
                          <td className="p-2 font-semibold">Page {page.pageNum}</td>
                          <td className="p-2">{page.initialLength}</td>
                          <td className="p-2">
                            <span className={`px-1.5 py-0.5 rounded text-[9px] uppercase font-bold tracking-wider ${
                              page.status === 'ocr-success' ? 'bg-emerald-950/50 text-emerald-400 border border-emerald-950' :
                              page.status === 'ocr-discarded' ? 'bg-zinc-900 text-zinc-500 border border-zinc-800' :
                              page.status === 'ocr-failed' ? 'bg-rose-955/45 text-rose-400 border border-rose-900/55' :
                              page.status === 'ocr-skipped' ? 'bg-amber-950/45 text-amber-500 border border-amber-900/55' :
                              'bg-zinc-950 text-zinc-600'
                            }`}>
                              {page.status === 'ocr-success' ? 'OCR MERGED' :
                               page.status === 'ocr-discarded' ? 'DISCARDED' :
                               page.status === 'ocr-failed' ? 'FAILED' :
                               page.status === 'ocr-skipped' ? 'LIMIT BYPASSED' :
                               'NATIVE ONLY'}
                            </span>
                          </td>
                          <td className="p-2">
                            {page.ocrConfidence !== null ? `${page.ocrConfidence}%` : 'N/A'}
                          </td>
                          <td className="p-2">
                            {page.finalLength} {page.ocrTextLength > 0 && `(+${page.ocrTextLength} OCR)`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Metadata Grid */}
          <div className="border border-zinc-900 bg-zinc-950 p-5 rounded-lg flex flex-col gap-4">
            <h3 className="text-xs font-semibold tracking-wider text-zinc-400 flex items-center gap-1.5 uppercase">
              <Grid className="w-3.5 h-3.5" />
              <span>Question Set Metadata</span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] text-zinc-500 font-medium font-mono uppercase">Subject</label>
                <input 
                  type="text" 
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g. Inorganic Chemistry, Physics"
                  className="bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-zinc-600 font-medium"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] text-zinc-500 font-medium font-mono uppercase">Exam Category</label>
                <input 
                  type="text" 
                  value={exam}
                  onChange={(e) => setExam(e.target.value)}
                  placeholder="e.g. JEE Mains, NEET, Civil Services"
                  className="bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-zinc-600 font-medium"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] text-zinc-500 font-medium font-mono uppercase">Year</label>
                <input 
                  type="text" 
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  placeholder="e.g. 2024"
                  className="bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-zinc-600 font-medium"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 text-[10px] text-zinc-500 mt-1 bg-zinc-900/40 p-2.5 rounded border border-zinc-900">
              <Info className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              <span>Verify that questions parsed cleanly. Mark the correct radio answers so mock simulations can grade correctly.</span>
            </div>
          </div>

          {/* Worksheet questions stream */}
          <div className="flex flex-col gap-4">
            <div className="flex justify-between items-center px-1">
              <span className="text-xs text-zinc-400 font-medium font-mono">
                {questions.length} Question{questions.length > 1 ? "s" : ""} Parsed
              </span>
              <button
                onClick={handleAddQuestion}
                className="flex items-center gap-1.5 bg-zinc-900 hover:bg-zinc-850 text-white text-xs px-2.5 py-1.5 border border-zinc-800 rounded transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Question</span>
              </button>
            </div>

            <div className="flex flex-col gap-5">
              {questions.map((q, qIdx) => (
                <div 
                  key={q.id}
                  className={`border p-5 rounded-lg flex flex-col gap-4 relative transition-all
                  ${q.hasWarning 
                    ? "border-amber-600/35 bg-amber-950/5 shadow-sm shadow-amber-950/10" 
                    : "border-zinc-900 bg-zinc-950"
                  }`}
                >
                  {q.hasWarning && (
                    <div className="flex items-center gap-2 bg-amber-950/20 border border-amber-900/60 p-2.5 rounded text-[11px] text-amber-300 animate-fade-in font-mono">
                      <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
                      <span>{q.warningReason || "Notice: Question requires correction."}</span>
                    </div>
                  )}

                  {/* Delete button */}
                  <button 
                    onClick={() => handleRemoveQuestion(q.id)}
                    className="absolute top-4 right-4 text-zinc-600 hover:text-red-400 p-1 rounded hover:bg-zinc-900 transition-colors"
                    title="Delete Question"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>

                  <div className="flex items-start gap-3">
                    <span className="bg-zinc-900 text-zinc-400 font-mono text-[10px] font-semibold w-6 h-6 rounded flex items-center justify-center shrink-0 border border-zinc-800">
                      {qIdx + 1}
                    </span>
                    <div className="w-full flex flex-col gap-1.5 pt-0.5">
                      <label className="text-[10px] text-zinc-500 font-mono uppercase font-semibold">Question Description</label>
                      <textarea
                        value={q.questionText}
                        rows={2}
                        onChange={(e) => handleQuestionTextChange(q.id, e.target.value)}
                        className="w-full bg-zinc-900 focus:bg-zinc-900/60 transition-all border border-zinc-800 focus:border-zinc-700 text-xs rounded p-2.5 text-white focus:outline-none placeholder-zinc-600"
                        placeholder="Enter Question Description..."
                      />
                    </div>
                  </div>

                  {/* Options panel */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pl-9">
                    {q.options.map((optionText, opIdx) => (
                      <div 
                        key={opIdx} 
                        className={`flex items-center gap-2.5 px-3 py-2 border rounded-md transition-colors
                        ${q.correctOptionIndex === opIdx 
                          ? "bg-zinc-900 border-zinc-600 text-white" 
                          : "bg-zinc-950 border-zinc-900 hover:border-zinc-800 text-zinc-400"
                        }`}
                      >
                        <input 
                          type="radio" 
                          name={`correct-radio-${q.id}`}
                          id={`correct-${q.id}-${opIdx}`}
                          checked={q.correctOptionIndex === opIdx}
                          onChange={() => handleCorrectOptionChange(q.id, opIdx)}
                          className="w-3.5 h-3.5 accent-white shrink-0 cursor-pointer"
                        />
                        <span className="text-[10px] font-bold font-mono text-zinc-500 uppercase shrink-0">
                          {String.fromCharCode(65 + opIdx)}.
                        </span>
                        <input 
                          type="text"
                          value={optionText}
                          onChange={(e) => handleOptionTextChange(q.id, opIdx, e.target.value)}
                          className="bg-transparent text-xs w-full focus:outline-none text-white border-b border-transparent focus:border-zinc-800"
                          placeholder={`Option ${String.fromCharCode(65 + opIdx)}`}
                        />
                        {q.correctOptionIndex === opIdx && (
                          <Check className="w-3.5 h-3.5 text-zinc-300 shrink-0" />
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Explanation Section */}
                  <div className="pl-9 flex flex-col gap-1.5">
                    <label className="text-[10px] text-zinc-500 font-mono uppercase">Explanation / Rational Answer (Optional)</label>
                    <input 
                      type="text"
                      value={q.explanation || ""}
                      onChange={(e) => handleExplanationChange(q.id, e.target.value)}
                      className="bg-zinc-900/40 focus:bg-zinc-900 transition-all border border-zinc-900 focus:border-zinc-800 text-xs rounded px-3 py-1.5 focus:outline-none text-zinc-300"
                      placeholder="Explain correct option..."
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Action Row */}
          <div className="border-t border-zinc-900 pt-6 flex justify-between items-center gap-4">
            <button
              onClick={() => {
                setQuestions([]);
                setFile(null);
                setError(null);
              }}
              className="px-4 py-2 text-zinc-400 hover:text-white text-xs font-medium border border-transparent rounded bg-transparent"
            >
              Discard and Reset
            </button>

            <button
              onClick={handleSaveSet}
              disabled={isSaving}
              className="flex items-center gap-2 bg-white text-black font-semibold text-xs px-5 py-2.5 rounded hover:bg-zinc-200 transition-colors disabled:opacity-50"
            >
              {isSaving ? (
                <div className="w-3.5 h-3.5 border-2 border-black border-t-transparent rounded-full animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              <span>Import to Firestore Collection</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
