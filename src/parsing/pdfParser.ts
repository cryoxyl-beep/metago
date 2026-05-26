import * as pdfjsLibInstance from "pdfjs-dist";
import { Question } from "../types";

// Setup worker source dynamically based on pdfjs-dist's version
const pdfjs = pdfjsLibInstance as any;
if (typeof window !== "undefined") {
  // Use a stable, clean version of the worker that aligns with installed packages.
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version || '4.0.379'}/pdf.worker.min.mjs`;
}

/**
 * Extracts plain text line-by-line from a PDF file using coordinates of tokens for page formatting.
 */
export async function extractTextFromPdf(
  file: File,
  onProgress?: (current: number, total: number) => void
): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  
  let fullText = "";
  const totalPages = pdf.numPages;

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    
    // Sort items by vertical coordinate descending, then horizontal coordinate ascending
    const items = textContent.items as any[];
    items.sort((a, b) => {
      const yDiff = b.transform[5] - a.transform[5];
      if (Math.abs(yDiff) > 3) return yDiff; 
      return a.transform[4] - b.transform[4];
    });

    let pageText = "";
    let lastY = -1;

    for (const item of items) {
      if (!item.str.trim()) continue;

      const y = item.transform[5];
      // If of a different line, insert newline
      if (lastY !== -1 && Math.abs(y - lastY) > 5) {
        pageText += "\n";
      }
      pageText += item.str + " ";
      lastY = y;
    }

    fullText += pageText + "\n\n";
    if (onProgress) {
      onProgress(pageNum, totalPages);
    }
  }

  return fullText;
}

/**
 * Parses raw extracted text deterministically into structured Question models.
 */
export function parseQuestionsFromText(text: string): Question[] {
  const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  const questions: Question[] = [];
  
  let currentQuestion: Partial<Question> | null = null;
  let currentOptionIndex: number = -1;

  // Regular expressions
  // Matches "Question 1.", "Q1:", "1.", "1) ", "Question(1)", "Q.1 "
  const questionRegex = /^(?:Q|q)?(?:uestion)?\s*\(?(\d{1,3})\)?[\.\-\)\s:]+\s*(.*)$/i;
  
  // Matches "(A) Choice", "A. Choice", "A) Choice", "[a] Choice"
  const optionRegex = /^\s*[\(\[=]?([A-Da-d])[\)\]\.\-\s=]+\s*(.*)$/;

  // Matches "Answer: A" or "Ans. (B)" or "Correct: C"
  const answerRegex = /^(?:Ans(?:wer)?|Correct(?:\s*Option)?)\s*[:\.\-]?\s*[\(\[]?([A-Da-d])[\)\]\.]?\s*$/i;

  const flushCurrent = () => {
    if (currentQuestion && currentQuestion.questionText) {
      // Validate option completeness. Ensure we default to 4 options
      const finalOptions = currentQuestion.options || [];
      while (finalOptions.length < 4) {
        finalOptions.push("");
      }
      // Trim empty strings inside options
      currentQuestion.options = finalOptions.map(opt => opt.trim());
      currentQuestion.questionText = currentQuestion.questionText.trim();
      
      questions.push({
        id: currentQuestion.id || Math.random().toString(36).substr(2, 9),
        questionText: currentQuestion.questionText,
        options: currentQuestion.options,
        correctOptionIndex: currentQuestion.correctOptionIndex ?? -1,
        explanation: currentQuestion.explanation || "",
      } as Question);
    }
    currentQuestion = null;
    currentOptionIndex = -1;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 1. Check for Question Match
    const qMatch = line.match(questionRegex);
    if (qMatch) {
      flushCurrent();
      const num = qMatch[1];
      const rest = qMatch[2] || "";
      currentQuestion = {
        id: `q-${num}-${Math.random().toString(36).substr(2, 5)}`,
        questionText: rest,
        options: [],
        correctOptionIndex: -1,
        explanation: "",
      };
      continue;
    }

    // If we're not inside a question yet, ignore standalone lines
    if (!currentQuestion) continue;

    // 2. Check for Option Match
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

    // 3. Check for Answer Key Match
    const aMatch = line.match(answerRegex);
    if (aMatch) {
      const ansLetter = aMatch[1].toUpperCase();
      const ansIdx = ansLetter.charCodeAt(0) - 65;
      if (ansIdx >= 0 && ansIdx < 4) {
        currentQuestion.correctOptionIndex = ansIdx;
      }
      continue;
    }

    // 4. Handle continuation of either Question or last Option
    if (currentOptionIndex !== -1 && currentQuestion.options) {
      // Append line as continuation or details of the last option
      currentQuestion.options[currentOptionIndex] = 
        (currentQuestion.options[currentOptionIndex] || "") + " " + line;
    } else {
      // Check for standalone explanations lines
      if (line.toLowerCase().startsWith("explanation:") || line.toLowerCase().startsWith("exp:")) {
        currentQuestion.explanation = line.replace(/^(?:explanation|exp)\s*:\s*/i, "");
      } else {
        // Simple continuation of question text
        currentQuestion.questionText = (currentQuestion.questionText || "") + " " + line;
      }
    }
  }

  // Flush the last parsed question
  flushCurrent();

  return questions;
}
