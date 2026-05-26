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

    // Sort/filter unique matches to keep the first occurrence of each letter option
    const indices: Record<string, number> = {};
    matches.forEach(m => {
      if (indices[m.char] === undefined) {
        indices[m.char] = m.index;
      }
    });

    if (indices["A"] !== undefined && indices["B"] !== undefined) {
      const foundKeys = ["A", "B", "C", "D"].filter(k => indices[k] !== undefined);
      if (foundKeys.length >= 2) {
        // Question text is everything before the first option key
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
 * Parses raw extracted text deterministically into structured Question models.
 * Highly tolerant to spacing issues, different formats, inconsistent numbering, and custom structures.
 */
export function parseQuestionsFromText(text: string): Question[] {
  // Pre-clean text: handle typical double-spacing and broken spaces around some punctuation
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);

  const questions: Question[] = [];
  let currentQuestion: Partial<Question> | null = null;
  let currentOptionIndex: number = -1;

  // Tolerant regular expressions for question headings
  // Matches "Question 1.", "Q1:", "1.", "1)", "Question(1)", "Q.1", "15 "
  const questionRegex = /^(?:Q|q)?(?:uestion)?\s*\(?(\d{1,3})\)?[\.\-\)\s:]+\s*(.*)$/i;

  // Matches "(A) xyz", "A. xyz", "A) xyz", "A - xyz"
  const optionRegex = /^\s*[\(\[=]?([A-Da-d])[\)\]\.\-\s=]+\s*(.*)$/;

  // Matches "Answer: A" or "Ans. B" or "Correct Option: C"
  const answerRegex = /^(?:Ans(?:wer)?|Correct(?:\s*Option)?)\s*[:\.\-]?\s*[\(\[]?([A-Da-d])[\)\]\.]?\s*$/i;

  const flushCurrent = () => {
    if (currentQuestion && currentQuestion.questionText) {
      // Inline options extraction fallback (if we didn't extract options split on different lines)
      const existingOptionsCount = (currentQuestion.options || []).filter(o => o && o.trim().length > 0).length;
      if (existingOptionsCount < 2) {
        const inlineRes = tryExtractInlineOptions(currentQuestion.questionText);
        if (inlineRes) {
          currentQuestion.questionText = inlineRes.questionText;
          currentQuestion.options = inlineRes.options;
        }
      }

      // Check options inside options[0] as a fallback
      if (currentQuestion.options && currentQuestion.options[0] && currentQuestion.options[1] === "") {
        const inlineRes = tryExtractInlineOptions(currentQuestion.options[0]);
        if (inlineRes) {
          currentQuestion.options[0] = inlineRes.questionText;
          for (let oi = 1; oi < 4; oi++) {
            if (inlineRes.options[oi]) {
              currentQuestion.options[oi] = inlineRes.options[oi];
            }
          }
        }
      }

      // Ensure we always have exactly 4 options (A, B, C, D)
      const finalOptions = currentQuestion.options || [];
      while (finalOptions.length < 4) {
        finalOptions.push("");
      }

      const qText = currentQuestion.questionText.trim();
      const sanitizedOptions = finalOptions.map((opt, oIdx) => {
        let cleanOpt = opt ? opt.trim() : "";
        // Clean out trailing options delimiter leaks if any
        return cleanOpt;
      });

      questions.push({
        id: currentQuestion.id || `q-${Math.random().toString(36).substr(2, 9)}`,
        questionText: qText,
        options: sanitizedOptions,
        correctOptionIndex: currentQuestion.correctOptionIndex !== undefined ? currentQuestion.correctOptionIndex : -1,
        explanation: currentQuestion.explanation ? currentQuestion.explanation.trim() : "",
      } as Question);
    }
    currentQuestion = null;
    currentOptionIndex = -1;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for Question signature
    const qMatch = line.match(questionRegex);
    if (qMatch) {
      flushCurrent();
      const num = qMatch[1];
      const rest = qMatch[2] || "";

      // See if inline options exist immediately in the rest of the question title
      const inlineRes = tryExtractInlineOptions(rest);
      if (inlineRes) {
        currentQuestion = {
          id: `q-${num}-${Math.random().toString(36).substr(2, 5)}`,
          questionText: inlineRes.questionText,
          options: inlineRes.options,
          correctOptionIndex: -1,
          explanation: "",
        };
      } else {
        currentQuestion = {
          id: `q-${num}-${Math.random().toString(36).substr(2, 5)}`,
          questionText: rest,
          options: [],
          correctOptionIndex: -1,
          explanation: "",
        };
      }
      continue;
    }

    if (!currentQuestion) {
      // Tolerate messy text starting lines - if we haven't seen a numbered question title, 
      // check if it looks like a question or contains options, if so, we auto-create an unnumbered question block
      if (line.toLowerCase().includes("select the correct") || line.toLowerCase().includes("which is") || line.toLowerCase().includes("find the option")) {
        currentQuestion = {
          id: `q-auto-${Math.random().toString(36).substr(2, 5)}`,
          questionText: line,
          options: [],
          correctOptionIndex: -1,
          explanation: "",
        };
      }
      continue;
    }

    // Check for Option match
    const oMatch = line.match(optionRegex);
    if (oMatch) {
      const choice = oMatch[1].toUpperCase();
      const optionContent = oMatch[2] || "";
      const optIdx = choice.charCodeAt(0) - 65; // A=0, B=1, C=2, D=3

      if (optIdx >= 0 && optIdx < 4) {
        currentOptionIndex = optIdx;
        if (!currentQuestion.options) currentQuestion.options = [];
        currentQuestion.options[optIdx] = optionContent;
      }
      continue;
    }

    // Check for correct key specification
    const aMatch = line.match(answerRegex);
    if (aMatch) {
      const ansLetter = aMatch[1].toUpperCase();
      const ansIdx = ansLetter.charCodeAt(0) - 65;
      if (ansIdx >= 0 && ansIdx < 4) {
        currentQuestion.correctOptionIndex = ansIdx;
      }
      continue;
    }

    // Handle standard line continuation or Explanation keywords
    if (line.toLowerCase().startsWith("explanation:") || line.toLowerCase().startsWith("exp:") || line.toLowerCase().startsWith("rationale:")) {
      currentQuestion.explanation = line.replace(/^(?:explanation|exp|rationale)\s*:\s*/i, "");
    } else {
      if (currentOptionIndex !== -1 && currentQuestion.options) {
        // Option text continuation
        currentQuestion.options[currentOptionIndex] = 
          (currentQuestion.options[currentOptionIndex] || "") + " " + line;
      } else {
        // Question text continuation
        currentQuestion.questionText = (currentQuestion.questionText || "") + " " + line;
      }
    }
  }

  // Flush the last active question
  flushCurrent();

  // Robust parsing: If we didn't parse any questions using the regex line-by-line model,
  // but there is text, let's create chunks based on question numbers to extract whatever is there
  if (questions.length === 0 && text.trim().length > 0) {
    console.warn("[PDF Parser] Regex parsing failed to find structured questions. Trying secondary chunked extractor.");
    const numMatches = [...text.matchAll(/(?:\r?\n|^)\s*\(?(\d{1,3})\)?[\.\-\)\s:]+/g)];
    if (numMatches.length >= 2) {
      for (let k = 0; k < numMatches.length; k++) {
        const start = numMatches[k].index!;
        const end = (k + 1 < numMatches.length) ? numMatches[k + 1].index : text.length;
        const chunk = text.substring(start, end).trim();
        if (chunk.length > 10) {
          const num = numMatches[k][1];
          // Try to split this chunk by inline options or lines
          let qText = chunk;
          let opts: string[] = ["", "", "", ""];
          const inlineRes = tryExtractInlineOptions(chunk);
          if (inlineRes) {
            qText = inlineRes.questionText;
            opts = inlineRes.options;
          } else {
            // Split by lines
            const chunkLines = chunk.split("\n").map(cl => cl.trim()).filter(Boolean);
            if (chunkLines.length > 1) {
              qText = chunkLines[0];
              let currentOptIdx = 0;
              for (let ci = 1; ci < chunkLines.length; ci++) {
                if (currentOptIdx < 4) {
                  opts[currentOptIdx++] = chunkLines[ci];
                }
              }
            }
          }
          questions.push({
            id: `q-fallback-${num}-${Math.random().toString(36).substr(2, 5)}`,
            questionText: qText,
            options: opts,
            correctOptionIndex: -1,
            explanation: ""
          });
        }
      }
    }
  }

  return questions;
}
