import * as pdfjsLib from "pdfjs-dist";
import { Question, OcrTelemetry } from "../types";
import { createWorker } from "tesseract.js";

// Setup stable Vite-compatible worker source using local dependency resolution
if (typeof window !== "undefined") {
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();
}

/**
 * Extracts plain text from a PDF file using a highly resilient multi-stage pipeline with client-side OCR fallback.
 * Features automated fallbacks for malformed encodings, normalization control, and selective Tesseract.js OCR engine execution.
 */
export async function extractTextFromPdf(
  file: File,
  onProgress?: (current: number, total: number, stage?: string) => void,
  onOcrTelemetry?: (telemetry: OcrTelemetry) => void
): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  
  const totalPages = pdf.numPages;
  
  // Track detailed per-page information for evaluation and telemetry
  interface PageExtraction {
    pageNum: number;
    text: string;
    itemsCount: number;
    initialLength: number;
    isLowText: boolean;
    ocrEligible: boolean;
    ocrTriggered: boolean;
    ocrConfidence: number | null;
    ocrTextLength: number;
    finalLength: number;
    status: "native" | "ocr-success" | "ocr-discarded" | "ocr-failed" | "ocr-skipped";
  }

  const pageExtractions: PageExtraction[] = [];

  // ==========================================
  // PHASE 1 — NATIVE PDF TEXT EXTRACTION PASS
  // ==========================================
  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    let pageText = "";
    let itemsCount = 0;
    let pageParsedOk = false;

    if (onProgress) {
      onProgress(pageNum, totalPages, `Phase 1: Native layout extraction on page ${pageNum}...`);
    }

    try {
      const page = await pdf.getPage(pageNum);

      // Stage 1 — Standard PDF.js Extraction
      try {
        const textContent = await page.getTextContent();
        itemsCount = textContent.items.length;
        const stage1Text = textContent.items
          .filter(item => item && typeof item === "object" && "str" in item)
          .map(item => (item as any).str)
          .join(" ");

        if (stage1Text.trim().length > 10) {
          pageText = stage1Text;
          pageParsedOk = true;
        }
      } catch (stage1Err) {
        console.warn(`[PDF Parser] Stage 1 failed on page ${pageNum}:`, stage1Err);
      }

      // Stage 2 — Disable Layout Normalization
      if (!pageParsedOk) {
        try {
          const textContent = await page.getTextContent({ disableNormalization: true });
          itemsCount = textContent.items.length;
          const stage2Text = textContent.items
            .filter(item => item && typeof item === "object" && "str" in item)
            .map(item => (item as any).str)
            .join(" ");

          if (stage2Text.trim().length > 10) {
            pageText = stage2Text;
            pageParsedOk = true;
          }
        } catch (stage2Err) {
          console.warn(`[PDF Parser] Stage 2 failed on page ${pageNum}:`, stage2Err);
        }
      }

      // Stage 3 — Raw Coordination Pass
      if (!pageParsedOk) {
        try {
          const textContent = await page.getTextContent().catch(() => 
            page.getTextContent({ disableNormalization: true })
          );
          
          itemsCount = textContent.items.length;
          const recoveredTokens: string[] = [];

          for (const item of textContent.items) {
            if (!item) continue;
            if (typeof item === "string") {
              recoveredTokens.push(item);
            } else if (typeof item === "object") {
              if ("str" in item && typeof (item as any).str === "string") {
                recoveredTokens.push((item as any).str);
              } else {
                for (const key of Object.keys(item)) {
                  const val = (item as any)[key];
                  if (typeof val === "string" && val.trim().length > 0) {
                    recoveredTokens.push(val);
                  }
                }
              }
            }
          }

          const stage3Text = recoveredTokens.join(" ");
          if (stage3Text.trim().length > 0) {
            pageText = stage3Text;
            pageParsedOk = true;
          }
        } catch (stage3Err) {
          console.error(`[PDF Parser] Stage 3 failed on page ${pageNum}:`, stage3Err);
        }
      }

    } catch (pageErr) {
      console.error(`[PDF Parser] Extreme failure loading page ${pageNum}:`, pageErr);
    }

    const initialLength = pageText.trim().length;
    const isLowText = initialLength < 150; // LOW_TEXT_THRESHOLD

    pageExtractions.push({
      pageNum,
      text: pageText,
      itemsCount,
      initialLength,
      isLowText,
      ocrEligible: isLowText,
      ocrTriggered: false,
      ocrConfidence: null,
      ocrTextLength: 0,
      finalLength: initialLength,
      status: isLowText ? "ocr-skipped" : "native"
    });

    console.log(`[PDF Native Pass] Page ${pageNum}/${totalPages}: length=${initialLength}, lowText=${isLowText}`);
  }

  // ==========================================
  // PHASE 2 — HYBRID SELECTIVE OCR FALLBACK
  // ==========================================
  const lowTextPages = pageExtractions.filter(pe => pe.isLowText);
  const lowTextPagesCount = lowTextPages.length;
  let ocrPagesProcessed = 0;
  let ocrSuccessCount = 0;
  let ocrFailureCount = 0;
  const ocrStartTime = performance.now();
  
  // Sort candidate low-text pages in ascending order of initial length (lowest first!)
  lowTextPages.sort((a, b) => a.initialLength - b.initialLength);

  // Maximum of 5 pages evaluated for performance and safety
  const MAX_OCR_PAGES = 5;
  const ocrCandidates = lowTextPages.slice(0, MAX_OCR_PAGES);
  const ocrLimitExceeded = lowTextPages.length > MAX_OCR_PAGES;

  let worker: any = null;

  if (ocrCandidates.length > 0) {
    try {
      console.log(`[OCR Pipeline] Low-text pages detected: ${lowTextPagesCount}. Standard OCR Fallback active.`);
      if (onProgress) {
        onProgress(0, ocrCandidates.length, "Stage 4: Initializing browser OCR engine...");
      }
      worker = await createWorker("eng");
      console.log(`[OCR Pipeline] Tesseract.js Worker loaded successfully.`);
    } catch (workerInitErr) {
      console.error(`[OCR Pipeline] Worker initialization failed:`, workerInitErr);
    }
  }

  if (worker && ocrCandidates.length > 0) {
    for (let i = 0; i < ocrCandidates.length; i++) {
      const pe = ocrCandidates[i];
      const targetPE = pageExtractions.find(p => p.pageNum === pe.pageNum);
      if (!targetPE) continue;

      targetPE.ocrTriggered = true;
      ocrPagesProcessed++;

      console.log(`[OCR Pipeline] Processing page ${pe.pageNum} (${i + 1}/${ocrCandidates.length}). Density: ${pe.initialLength} chars.`);
      if (onProgress) {
        onProgress(i + 1, ocrCandidates.length, `Stage 4: OCR scanning low-text page ${pe.pageNum}...`);
      }

      const pageStartTime = performance.now();

      try {
        const pageObj = await pdf.getPage(pe.pageNum);
        // Render scale 2.5x to improve accuracy on tiny math texts & compressions
        const scale = 2.5;
        const viewport = pageObj.getViewport({ scale });
        
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        if (!context) {
          throw new Error("Unable to create offscreen canvas context");
        }

        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const renderContext = {
          canvasContext: context,
          viewport: viewport,
          canvas: canvas
        } as any;

        // Render PDF page onto high-resolution canvas
        await pageObj.render(renderContext).promise;

        // Obtain image dataURL
        const imgDataUrl = canvas.toDataURL("image/png");

        // Run Tesseract OCR on page
        const { data: { text, confidence } } = await worker.recognize(imgDataUrl);
        const latency = performance.now() - pageStartTime;

        console.log(`[OCR Pipeline] Page ${pe.pageNum} OCR completed in ${latency.toFixed(0)}ms. Confidence: ${confidence}%. Text length: ${text?.length || 0}`);

        // Safety: Discard low-confidence or corrupted outputs
        const MIN_OCR_CONFIDENCE = 30; // Min confidence percentage
        const cleanOcrText = (text || "").trim();

        if (confidence >= MIN_OCR_CONFIDENCE && cleanOcrText.length > 5) {
          targetPE.ocrConfidence = confidence;
          targetPE.ocrTextLength = cleanOcrText.length;
          
          // Merge PDF.js standard text & OCR recovered text
          const mergedText = (targetPE.text + "\n\n" + cleanOcrText).trim();
          targetPE.text = mergedText;
          targetPE.finalLength = mergedText.length;
          targetPE.status = "ocr-success";
          ocrSuccessCount++;
        } else {
          targetPE.status = "ocr-discarded";
          ocrFailureCount++;
          console.warn(`[OCR Pipeline] Discarded OCR text for page ${pe.pageNum} due to low confidence/character constraints`);
        }

      } catch (ocrPageErr: any) {
        targetPE.status = "ocr-failed";
        ocrFailureCount++;
        console.error(`[OCR Pipeline] Failed to perform OCR scan on page ${pe.pageNum}:`, ocrPageErr);
      }

      // Fire intermediate progress telemetry updates
      if (onOcrTelemetry) {
        onOcrTelemetry({
          lowTextPagesCount,
          ocrPagesProcessed,
          ocrDurationMs: Math.round(performance.now() - ocrStartTime),
          ocrSuccessCount,
          ocrFailureCount,
          ocrLimitExceeded,
          pagesHandled: pageExtractions.map(p => ({
            pageNum: p.pageNum,
            initialLength: p.initialLength,
            ocrEligible: p.ocrEligible,
            ocrTriggered: p.ocrTriggered,
            ocrConfidence: p.ocrConfidence,
            ocrTextLength: p.ocrTextLength,
            finalLength: p.finalLength,
            status: p.status
          }))
        });
      }
    }
  }

  // Gracefully terminate the worker to prevent resource/worker memory leaks
  if (worker) {
    try {
      await worker.terminate();
      console.log("[OCR Pipeline] Tesseract worker terminated cleanly.");
    } catch (termErr) {
      console.error("[OCR Pipeline] Error terminating worker:", termErr);
    }
  }

  // Ensure telemetry is fired at least once after everything finishes
  if (onOcrTelemetry) {
    onOcrTelemetry({
      lowTextPagesCount,
      ocrPagesProcessed,
      ocrDurationMs: Math.round(performance.now() - ocrStartTime),
      ocrSuccessCount,
      ocrFailureCount,
      ocrLimitExceeded,
      pagesHandled: pageExtractions.map(p => ({
        pageNum: p.pageNum,
        initialLength: p.initialLength,
        ocrEligible: p.ocrEligible,
        ocrTriggered: p.ocrTriggered,
        ocrConfidence: p.ocrConfidence,
        ocrTextLength: p.ocrTextLength,
        finalLength: p.finalLength,
        status: p.status
      }))
    });
  }

  // Rebuild final structured fullText
  let fullText = "";
  let totalPageItems = 0;
  let succeededPagesCount = 0;

  for (const pe of pageExtractions) {
    totalPageItems += pe.itemsCount;
    if (pe.text.trim().length > 0) {
      fullText += pe.text + "\n\n";
      succeededPagesCount++;
    } else {
      fullText += `[RAW PAGE ${pe.pageNum} UNREADABLE]\n\n`;
    }
  }

  const trimmedFullText = fullText.trim();
  const fullyEmpty = totalPageItems === 0 && trimmedFullText.replace(/\[RAW PAGE \d+ UNREADABLE\]|\[PAGE \d+ STRUCTURAL FAILURE\]/g, "").trim().length === 0;

  if (fullyEmpty) {
    throw new Error(
      "All extraction methods failed completely. No readable text characters were found inside this PDF file."
    );
  }

  console.log(`[PDF Parser Completed] Succeeded pages: ${succeededPagesCount}/${totalPages}. OCR: processed ${ocrPagesProcessed}, success ${ocrSuccessCount}, failure ${ocrFailureCount}. Total text length: ${trimmedFullText.length}`);
  return fullText;
}

/**
 * Parses inline choices (e.g. A. option1 B. option2 C. option3 D. option4) from text.
 */
export function tryExtractInlineOptions(text: string): { questionText: string, options: string[] } | null {
  const optionPatterns = [
    { regex: /(?:\s+|^)\(([A-Da-d])\)\s+/g },
    { regex: /(?:\s+|^)([A-Da-d])\)\s+/g },
    { regex: /(?:\s+|^)\[([A-Da-d])\]\s+/g },
    { regex: /(?:\s+|^)([A-Da-d])\.\s+/g }
  ];

  for (const pat of optionPatterns) {
    pat.regex.lastIndex = 0;
    const matches: { char: string; index: number; contentStartIndex: number }[] = [];
    let match;
    while ((match = pat.regex.exec(text)) !== null) {
      const char = match[1].toUpperCase();
      matches.push({
        char,
        index: match.index,
        contentStartIndex: pat.regex.lastIndex
      });
    }

    const indices: Record<string, number> = {};
    matches.forEach(m => {
      if (indices[m.char] === undefined) {
        indices[m.char] = m.index;
      }
    });

    if (indices["A"] !== undefined && indices["B"] !== undefined) {
      const foundKeys = ["A", "B", "C", "D"].filter(k => indices[k] !== undefined);
      if (foundKeys.length >= 2) {
        const qText = text.substring(0, indices[foundKeys[0]]).trim();
        const options: string[] = ["", "", "", ""];

        for (let i = 0; i < foundKeys.length; i++) {
          const currentKey = foundKeys[i];
          const nextKey = foundKeys[i + 1];
          const currentMatch = matches.find(m => m.char === currentKey && m.index === indices[currentKey]);
          const startIdx = currentMatch ? currentMatch.contentStartIndex : text.indexOf(currentKey, indices[currentKey]) + 2;

          const endIdx = nextKey ? indices[nextKey] : text.length;
          const optValue = text.substring(startIdx, endIdx).trim();

          const optIdx = currentKey.charCodeAt(0) - 65;
          options[optIdx] = optValue;
        }
        return { questionText: qText, options };
      }
    }
  }
  return null;
}

/**
 * Splits the entire text into isolated, self-contained question chunks.
 * Uses aggressive boundary regex patterns representing Q1, Q1., 1., 1), Question 1, etc.
 * Terminates previous questions immediately when a new number appears, avoiding text-bleeding.
 */
export function splitIntoQuestionChunks(text: string): { number: number; text: string }[] {
  // Regex designed to match Q1, Q1., Q1:, 1., 1), Question 1, Q 15 :, 15.
  // Must make sure pure digits with punctuation match only after newline/start of text (to prevent inline number conflict).
  // Digit length constrained to 1-3 to prevent conflicts with year marks (e.g. 2024).
  const boundaryRegex = /(?:^|\r?\n)\s*(?:(?:[Qq]uestion|[Qq])\s*(\d{1,3})(?:\s*[\.\)\-\:\s]+)?|(\d{1,3})\s*[\.\)\-\:]+)/gi;
  boundaryRegex.lastIndex = 0;

  const matches: { number: number; index: number; length: number }[] = [];
  let match;
  while ((match = boundaryRegex.exec(text)) !== null) {
    const numStr = match[1] || match[2];
    const num = parseInt(numStr, 10);
    matches.push({
      number: num,
      index: match.index,
      length: match[0].length
    });
  }

  // Sort matched positions ascendingly by character offset
  matches.sort((a, b) => a.index - b.index);

  // Filter consecutive matches targeting identical indices to prevent duplicate splits
  const uniqueMatches: typeof matches = [];
  matches.forEach(m => {
    if (uniqueMatches.length === 0 || uniqueMatches[uniqueMatches.length - 1].index !== m.index) {
      uniqueMatches.push(m);
    }
  });

  const chunks: { number: number; text: string }[] = [];

  if (uniqueMatches.length === 0) {
    // Stage 1 Fallback Split: lax numeric prefix split for start of lines
    const laxRegex = /(?:^|\r?\n)\s*(\d{1,3})\s+/gi;
    let laxMatch;
    while ((laxMatch = laxRegex.exec(text)) !== null) {
      uniqueMatches.push({
        number: parseInt(laxMatch[1], 10),
        index: laxMatch.index,
        length: laxMatch[0].length
      });
    }
    uniqueMatches.sort((a, b) => a.index - b.index);
  }

  if (uniqueMatches.length > 0) {
    for (let i = 0; i < uniqueMatches.length; i++) {
      const current = uniqueMatches[i];
      const startIdx = current.index;
      const endIdx = (i + 1 < uniqueMatches.length) ? uniqueMatches[i + 1].index : text.length;
      
      const chunkText = text.substring(startIdx, endIdx);
      chunks.push({
        number: current.number,
        text: chunkText
      });
    }
  } else {
    // Stage 2 Fallback Split: Paragraph block chunking
    const paragraphs = text.split(/\r?\n\r?\n/).map(p => p.trim()).filter(p => p.length > 8);
    paragraphs.forEach((para, idx) => {
      chunks.push({
        number: idx + 1,
        text: para
      });
    });
  }

  return chunks;
}

/**
 * Parses raw extracted text deterministically into structured Question models.
 * Completely isolates text into separate sub-chunks to prevent cross-question bleeding.
 */
export function parseQuestionsFromText(text: string): Question[] {
  console.log(`[PDF Parser] Init parsing. Text length: ${text.length} chars.`);
  
  // STEP 1: Global Question Splitting
  const chunks = splitIntoQuestionChunks(text);
  console.log(`[PDF Parser] Chunking Complete: Isolated ${chunks.length} distinct question segments.`);

  const questions: Question[] = [];
  const failedIndexes: number[] = [];

  // Scorer patterns to locate multiple choice option boundaries
  const optionPatterns = [
    { regex: /(?:\s+|^)\(([A-Da-d])\)\s+/gi, type: "parentheses" },
    { regex: /(?:\s+|^)([A-Da-d])\)\s+/gi, type: "right-parenthesis" },
    { regex: /(?:\s+|^)\[([A-Da-d])\]\s+/gi, type: "brackets" },
    { regex: /(?:\s+|^)([A-Da-d])\.\s+/gi, type: "dot" },
    { regex: /(?:\s+|^)([A-Da-d])\s*[\-\:]\s+/gi, type: "dash-or-colon" }
  ];

  for (let idx = 0; idx < chunks.length; idx++) {
    const chunkObj = chunks[idx];
    const chunkNumber = chunkObj.number;
    
    // STEP 2: Clean Question Chunk - Normalizes spacing but preserves newlines which guide separators
    let chunkText = chunkObj.text.trim();
    chunkText = chunkText.replace(/[ \t]+/g, " ");

    // Remove the starting question tag (e.g. "Question 1.", "1.", "Q15:") from question content
    let qContentRaw = chunkText;
    const startingHeaderRegex = /^(?:(?:[Qq]uestion|[Qq])\s*(\d{1,3})(?:\s*[\.\)\-\:\s]+)?|(\d{1,3})\s*[\.\)\-\:]+)/i;
    const stripMatch = qContentRaw.match(startingHeaderRegex);
    if (stripMatch) {
      qContentRaw = qContentRaw.substring(stripMatch[0].length).trim();
    }

    // STEP 3: Multi-Pattern Option Marker Extraction
    interface OptionMarker {
      key: string;
      index: number;
      contentIndex: number;
    }

    let bestMatches: OptionMarker[] = [];
    let maxScore = 0;

    for (const pat of optionPatterns) {
      pat.regex.lastIndex = 0;
      const currentMatches: OptionMarker[] = [];
      let m;
      while ((m = pat.regex.exec(qContentRaw)) !== null) {
        currentMatches.push({
          key: m[1].toUpperCase(),
          index: m.index,
          contentIndex: m.index + m[0].length
        });
      }

      // Check unique matching options A -> B -> C -> D in strict ascending indexing order to ensure layout symmetry
      const orderedMatches: OptionMarker[] = [];
      let lastMatchIndex = -1;
      const targetOptionLetters = ["A", "B", "C", "D"];

      for (const letter of targetOptionLetters) {
        const found = currentMatches.find(matchObj => matchObj.key === letter && matchObj.index > lastMatchIndex);
        if (found) {
          orderedMatches.push(found);
          lastMatchIndex = found.index;
        }
      }

      const score = orderedMatches.length;
      if (score > maxScore) {
        maxScore = score;
        bestMatches = orderedMatches;
      }
    }

    let finalQText = qContentRaw;
    let finalOptions: string[] = ["", "", "", ""];
    let extractedOptionCount = 0;

    // STEP 4: Question Body / Option Isolation
    if (bestMatches.length >= 2) {
      // Everything preceding the first option marker serves as the body
      finalQText = qContentRaw.substring(0, bestMatches[0].index).trim();

      for (let i = 0; i < bestMatches.length; i++) {
        const curr = bestMatches[i];
        const next = bestMatches[i + 1];
        const start = curr.contentIndex;
        const end = next ? next.index : qContentRaw.length;

        let optionContent = qContentRaw.substring(start, end).trim();

        // Strip any trailing answer keys or explanations leaking inside option contents
        const ansTriggerPos = optionContent.search(/(?:Ans(?:wer)?|Correct(?:\s*Option)?)\s*[:\.\-]?/i);
        if (ansTriggerPos !== -1) {
          optionContent = optionContent.substring(0, ansTriggerPos);
        }
        const expTriggerPos = optionContent.search(/(?:Explanation|Exp|Rationale)\s*[:\.\-]/i);
        if (expTriggerPos !== -1) {
          optionContent = optionContent.substring(0, expTriggerPos);
        }

        const optionIdx = curr.key.charCodeAt(0) - 65; // A=0, B=1, C=2, D=3
        if (optionIdx >= 0 && optionIdx < 4) {
          finalOptions[optionIdx] = optionContent.trim();
          extractedOptionCount++;
        }
      }
    } else {
      // Fallback: Split on lines if pattern scoring yields no strong option structure
      const lines = qContentRaw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (lines.length > 1) {
        finalQText = lines[0];
        let currentOptIdx = 0;
        for (let lIdx = 1; lIdx < lines.length; lIdx++) {
          const cleanLine = lines[lIdx].replace(/^\s*[-*•]\s*/, "");
          if (currentOptIdx < 4) {
            finalOptions[currentOptIdx++] = cleanLine;
            extractedOptionCount++;
          }
        }
      }
    }

    // Capture Correct Answer Index
    let correctOptionIndex = -1;
    const answerRegex = /(?:Ans(?:wer)?|Correct(?:\s*Option)?)\s*[:\.\-]?\s*[\(\[=]?([A-Da-d])[\)\]\.]?/i;
    const ansMatch = chunkText.match(answerRegex);
    if (ansMatch) {
      const charLetter = ansMatch[1].toUpperCase();
      correctOptionIndex = charLetter.charCodeAt(0) - 65;
    }

    // Capture Explanation / Rationale text
    let explanation = "";
    const expRegex = /(?:Explanation|Exp|Rationale)\s*[:\.\-]\s*([\s\S]*)$/i;
    const expMatch = chunkText.match(expRegex);
    if (expMatch) {
      explanation = expMatch[1].trim();
    }

    // STEP 5: Parse Validation & Safety Checking
    const isQuestionBlank = finalQText.trim().length === 0;
    const emptyOptionsCount = finalOptions.filter(o => o.trim().length === 0).length;

    let hasWarning = false;
    let warningReason = "";

    if (isQuestionBlank) {
      hasWarning = true;
      warningReason = "Question description is completely blank.";
    } else if (extractedOptionCount < 2 || emptyOptionsCount >= 3) {
      hasWarning = true;
      warningReason = `Missing multiple-choice options (Extracted only ${extractedOptionCount} options).`;
    } else if (correctOptionIndex === -1) {
      hasWarning = true;
      warningReason = "No correct answer index detected. Specify answer key manually on the card.";
    }

    if (hasWarning) {
      failedIndexes.push(idx);
    }

    questions.push({
      id: `q-${chunkNumber}-${Math.random().toString(36).substr(2, 5)}`,
      questionText: finalQText || `[Parsed Empty Question ${idx + 1}]`,
      options: finalOptions,
      correctOptionIndex,
      explanation,
      hasWarning,
      warningReason,
      rawChunkText: chunkText
    });

    // STEP 7: Debugging logs for segmentation monitoring
    console.log(`[PDF Parser Chunk ${idx + 1}/${chunks.length}] Q-Num: ${chunkNumber}. Text chars: ${chunkText.length}. Option lengths: [${finalOptions.map(o => o.length).join(", ")}]. Warning: ${hasWarning ? warningReason : "None"}`);
  }

  console.log(`[PDF Parser Segmentation Done] Total: ${questions.length} questions parsed. Flagged Warning Cards: ${failedIndexes.length} (Indexes: [${failedIndexes.join(", ")}]).`);
  return questions;
}

export interface ChunkConfidence {
  isLowConfidence: boolean;
  reasons: string[];
}

/**
 * Evaluates the confidence level of a single parsed question chunk.
 * Flags typical PDF extraction issues such as merged structures, too-large text bodies,
 * missing option tokens, duplicate option keys, or scrambled letter sequences.
 */
export function assessChunkConfidence(chunkText: string, parsed: Question): ChunkConfidence {
  const reasons: string[] = [];

  // 1. Fewer than 2 detected options
  const populatedOptions = parsed.options.filter(o => o.trim().length > 0).length;
  if (populatedOptions < 2) {
    reasons.push("Fewer than 2 multiple-choice options detected.");
  }

  // 2. Question text too large
  if (parsed.questionText.trim().length > 1000) {
    reasons.push("Question text body is unusually large (exceeds 1000 characters).");
  }

  // 3. Multiple question numbers detected inside one chunk (merged questions)
  let remainingText = chunkText.trim();
  const startingHeaderRegex = /^(?:(?:[Qq]uestion|[Qq])\s*(\d{1,3})(?:\s*[\.\)\-\:\s]+)?|(\d{1,3})\s*[\.\)\-\:]+)/i;
  remainingText = remainingText.replace(startingHeaderRegex, "");

  const questionHeaderRegexSub = /(?:(?:[Qq]uestion|[Qq])\s*(\d{1,3})|(?:\s+|^)(\d{1,3})\s*[\.\)\-\:]+)/g;
  const subMatches: string[] = [];
  let m;
  while ((m = questionHeaderRegexSub.exec(remainingText)) !== null) {
    subMatches.push(m[0]);
  }
  if (subMatches.length > 0) {
    reasons.push(`Possible merged questions: detected mid-chunk question numbers (e.g. ${subMatches.join(", ")}).`);
  }

  // 4. Repeated option markers or malformed option order
  const optionPrefixRegex = /(?:\s+|^)[\(\[=]?([A-Da-d])[\)\]\.\-\s=]+/g;
  const matches: string[] = [];
  let optMatch;
  while ((optMatch = optionPrefixRegex.exec(chunkText)) !== null) {
    matches.push(optMatch[1].toUpperCase());
  }
  const hasRepeatedMarkers = matches.some((val, i) => matches.indexOf(val) !== i);
  if (hasRepeatedMarkers) {
    reasons.push("Repeated option characters detected.");
  }

  let isSorted = true;
  for (let i = 0; i < matches.length - 1; i++) {
    if (matches[i].charCodeAt(0) > matches[i + 1].charCodeAt(0)) {
      isSorted = false;
      break;
    }
  }
  if (!isSorted) {
    reasons.push("Irregular or shuffled option letters order.");
  }

  // 5. Chunk exceeds expected size (too big)
  if (chunkText.length > 1500) {
    reasons.push("Raw question chunk exceeds safe size threshold (1500 characters).");
  }

  return {
    isLowConfidence: reasons.length > 0,
    reasons
  };
}
