import React, { useState, useRef } from "react";
import { useAuth } from "../firebase/context";
import { extractTextFromPdf, parseQuestionsFromText, assessChunkConfidence } from "../parsing/pdfParser";
import { Question, QuestionSet } from "../types";
import { collection, doc, writeBatch, Timestamp } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../firebase/config";
import { GoogleGenAI, Type } from "@google/genai";
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

  // Apply AI Cleanup Fallback for low-confidence blocks
  const runAiCleanupPipeline = async (initialQuestions: Question[]) => {
    if (initialQuestions.length === 0) {
      setParserConfidence(0);
      setQuestions([]);
      return;
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
      return;
    }

    setIsAiCleaning(true);
    setExtractionStage(`Applying AI recovery to ${malformedChunks.length} malformed question blocks...`);

    try {
      const apiKey = (import.meta as any).env.VITE_GEMINI_API_KEY;
      if (!apiKey || apiKey.trim() === "" || apiKey === "YOUR_GEMINI_API_KEY") {
        console.warn("[Gemini Client] VITE_GEMINI_API_KEY is not configured or left as placeholder in environment variables.");
        throw new Error("Missing VITE_GEMINI_API_KEY. Please provide the key in the settings panel or .env file.");
      }

      // Log: Gemini request started
      // Log: malformed chunk count
      console.log(`[Gemini Request] Started. Malformed chunk count: ${malformedChunks.length}. Initial confidence score: ${initialConfidence}%`);

      const ai = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build"
          }
        }
      });

      // Batch 3 to 5 malformed chunks maximum per request
      const batchSize = 4;
      const batches: string[][] = [];
      for (let i = 0; i < malformedChunks.length; i += batchSize) {
        batches.push(malformedChunks.slice(i, i + batchSize));
      }

      console.log(`[Gemini Client] Batching ${malformedChunks.length} malformed chunks into ${batches.length} requests (size: ${batchSize}).`);

      const batchPromises = batches.map(async (batch, batchIdx) => {
        const userPrompt = `Reconstruct the following mangled multiple choice question blocks from a PDF reading extraction.
Separate any merged questions if they got lumped together. Isolate options correctly (A, B, C, D) and preserve the wording, equations, and symbols.
Do not invent any details or answers or explanations that are not present in the source text.
If no answer key is clearly mentioned, keep "correct_option_index" as null.
If there is no explanation, keep "explanation" as an empty string.

--- START QUESTION BLOCKS TO RECONSTRUCT ---
${batch.map((c, i) => `Block ${i + 1}:\n${c}`).join("\n\n---\n\n")}
--- END QUESTION BLOCKS ---`;

        console.log(`[Gemini Client] Requesting batch ${batchIdx + 1} of ${batches.length}...`);

        const payloadConfig = {
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
        };

        let response;
        try {
          console.log(`[Gemini Client] Attempting generation with active model: gemini-2.5-flash (Batch ${batchIdx + 1} of ${batches.length})`);
          response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            ...payloadConfig
          });
        } catch (firstTryError: any) {
          console.warn(`[Gemini Client] Active model (gemini-2.5-flash) failed for batch ${batchIdx + 1}.`);
          console.warn(`[Gemini Client] Model failure reason:`, firstTryError?.message || firstTryError);
          console.log(`[Gemini Client] Fallback model usage triggered. Retrying batch ${batchIdx + 1} using fallback model: gemini-flash-latest`);
          
          try {
            response = await ai.models.generateContent({
              model: "gemini-flash-latest",
              ...payloadConfig
            });
          } catch (secondTryError: any) {
            console.error(`[Gemini Client] Both active and fallback model requests failed for batch ${batchIdx + 1}:`, secondTryError?.message || secondTryError);
            throw secondTryError;
          }
        }

        // Log: Gemini response received
        const responseText = response.text || "[]";
        console.log(`[Gemini Client] Response received for batch ${batchIdx + 1}. Raw length: ${responseText.length}`);

        try {
          const parsedGroup = JSON.parse(responseText.trim());
          // Log: JSON parse success
          console.log(`[Gemini Client] JSON parse success for batch ${batchIdx + 1}. Reconstructed ${parsedGroup.length} items.`);
          return parsedGroup;
        } catch (jsonErr) {
          // Log: JSON parse failure
          console.error(`[Gemini Client] JSON parse failure for batch ${batchIdx + 1}:`, responseText, jsonErr);
          throw jsonErr;
        }
      });

      const results = await Promise.all(batchPromises);
      const combinedResults = results.flat();

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
    } catch (apiErr: any) {
      console.warn("[Gemini Client Fallback] direct model request failed:", apiErr);
      setQuestions(initialQuestions);
      setAiCleanedCount(0);
      setWarning(`Notice: AI-powered recovery was bypassed (${apiErr.message || "Invalid API key or network block"}). Reverting to default regex parsed result.`);
    } finally {
      setIsAiCleaning(false);
    }
  };

  // Convert PDF to questions
  const processPdf = async (pdfFile: File) => {
    setExtracting(true);
    setParserConfidence(null);
    setAiCleanedCount(0);
    setError(null);
    setWarning(null);
    setProgress({ current: 0, total: 0 });
    setExtractionStage("Initializing multi-stage extraction...");
    try {
      const text = await extractTextFromPdf(pdfFile, (current, total, stage) => {
        setProgress({ current, total });
        if (stage) {
          setExtractionStage(stage);
        }
      });
      
      setRawText(text);
      const parsed = parseQuestionsFromText(text);
      
      if (parsed.length === 0) {
        setWarning("Notice: We couldn't detect any structured multi-choice questions in this PDF, but the raw text was extracted successfully! You can review or edit the Extracted Raw Text below and hit 'Re-run Parser', or continue manually.");
        setQuestions([createNewQuestion(1)]);
      } else {
        await runAiCleanupPipeline(parsed);
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
              Running gemini-3.5-flash semantic recovery
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
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin mb-2" />
              <p className="text-sm text-zinc-300 font-medium font-mono text-amber-200">
                {extractionStage || "Extracting PDF structures..."}
              </p>
              {progress.total > 0 && (
                <span className="text-xs text-zinc-500 font-mono">
                  Page {progress.current} of {progress.total}
                </span>
              )}
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
