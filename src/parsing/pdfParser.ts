import * as pdfjsLib from "pdfjs-dist";
import { Question } from "../types";

// Setup stable Vite-compatible worker source using local dependency resolution
if (typeof window !== "undefined") {
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();
}

/**
 * Extracts plain text from a PDF file using a highly resilient multi-stage pipeline.
 * Features automated fallbacks for malformed encodings, normalization control, and raw recovery pass.
 */
export async function extractTextFromPdf(
  file: File,
  onProgress?: (current: number, total: number, stage?: string) => void
): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  
  let fullText = "";
  const totalPages = pdf.numPages;
  let totalPageItems = 0;
  let succeededPagesCount = 0;

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    let pageText = "";
    let itemsCount = 0;
    let pageParsedOk = false;

    try {
      const page = await pdf.getPage(pageNum);

      // ==========================================
      // STAGE 1 — STANDARD PDF.js EXTRACTION
      // ==========================================
      if (onProgress) {
        onProgress(pageNum, totalPages, "Stage 1 — Standard Layout Extraction");
      }
      try {
        const textContent = await page.getTextContent();
        itemsCount = textContent.items.length;
        const stage1Text = textContent.items
          .filter(item => item && typeof item === "object" && "str" in item)
          .map(item => (item as any).str)
          .join(" ");

        console.log(`[PDF Parser Stage 1] Page ${pageNum}/${totalPages}: items.length = ${itemsCount}, text.length = ${stage1Text.length} chars. Sample: "${stage1Text.substring(0, 100)}"`);

        if (stage1Text.trim().length > 10) {
          pageText = stage1Text;
          pageParsedOk = true;
        }
      } catch (stage1Err) {
        console.warn(`[PDF Parser] Stage 1 failed on page ${pageNum}:`, stage1Err);
      }

      // ==========================================
      // STAGE 2 — DISABLE NORMALIZATION
      // ==========================================
      if (!pageParsedOk) {
        if (onProgress) {
          onProgress(pageNum, totalPages, "Stage 2 — Disabling Layout Normalization");
        }
        try {
          const textContent = await page.getTextContent({ disableNormalization: true });
          itemsCount = textContent.items.length;
          const stage2Text = textContent.items
            .filter(item => item && typeof item === "object" && "str" in item)
            .map(item => (item as any).str)
            .join(" ");

          console.log(`[PDF Parser Stage 2] Page ${pageNum}/${totalPages}: items.length = ${itemsCount}, text.length = ${stage2Text.length} chars. Sample: "${stage2Text.substring(0, 100)}"`);

          if (stage2Text.trim().length > 10) {
            pageText = stage2Text;
            pageParsedOk = true;
          }
        } catch (stage2Err) {
          console.warn(`[PDF Parser] Stage 2 failed on page ${pageNum}:`, stage2Err);
        }
      }

      // ==========================================
      // STAGE 3 — RAW COORDINATE / TOKEN RECOVERY
      // ==========================================
      if (!pageParsedOk) {
        if (onProgress) {
          onProgress(pageNum, totalPages, "Stage 3 — Raw Token Recovery Mode");
        }
        try {
          // Attempt raw coordinate recovery pass. We grab everything resembling text,
          // ignore layout structuring entirely, and prioritize character retrieval.
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
                // Recover any string-like properties
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
          console.log(`[PDF Parser Stage 3] Page ${pageNum}/${totalPages}: items.length = ${itemsCount}, text.length = ${stage3Text.length} chars. Sample: "${stage3Text.substring(0, 100)}"`);

          if (stage3Text.trim().length > 0) {
            pageText = stage3Text;
            pageParsedOk = true;
          }
        } catch (stage3Err) {
          console.error(`[PDF Parser] Stage 3 failed on page ${pageNum}:`, stage3Err);
        }
      }

      totalPageItems += itemsCount;

      if (pageText.trim().length > 0) {
        fullText += pageText + "\n\n";
        succeededPagesCount++;
      } else {
        // Even if empty, add a small space gap to keep page separation
        fullText += `[RAW PAGE ${pageNum} UNREADABLE]\n\n`;
      }

    } catch (pageErr) {
      console.error(`[PDF Parser] Extreme failure loading page ${pageNum}:`, pageErr);
      fullText += `[PAGE ${pageNum} STRUCTURAL FAILURE]\n\n`;
    }

    if (onProgress) {
      onProgress(pageNum, totalPages, "Finalizing pages");
    }
  }

  // ==========================================
  // STAGE 4 — PARTIAL SUCCESS MODE
  // ==========================================
  // ONLY show a fatal error if every single page has 0 raw items of data AND the entire string list is empty.
  // Otherwise, fallback mode always yields whatever readable text is recovered.
  const trimmedFullText = fullText.trim();
  const fullyEmpty = totalPageItems === 0 && trimmedFullText.replace(/\[RAW PAGE \d+ UNREADABLE\]|\[PAGE \d+ STRUCTURAL FAILURE\]/g, "").trim().length === 0;

  if (fullyEmpty) {
    throw new Error(
      "All extraction methods failed completely. No readable text characters were found inside this PDF file."
    );
  }

  console.log(`[PDF Parser Completed] Successfully parsed content across multi-stage pipeline. Succeeded pages: ${succeededPagesCount}/${totalPages}. Total extracted length: ${trimmedFullText.length} characters.`);
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
