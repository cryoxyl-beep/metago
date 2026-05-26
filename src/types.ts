export interface Question {
  id: string;
  questionText: string;
  options: string[];
  correctOptionIndex: number; // 0 for A, 1 for B, 2 for C, 3 for D, or -1 if unselected/unprovided
  explanation?: string;
  subject?: string;
  exam?: string;
  year?: string;
  hasWarning?: boolean;
  warningReason?: string;
  isAiCleaned?: boolean;
  rawChunkText?: string;
  questionImage?: string;
  question_image_local?: string;
  question_image_url?: string;
  image_upload_status?: "pending" | "uploaded" | "failed";
}

export interface WorksheetQuestion {
  question_text: string;
  question_image_url?: string;
  options: string[];
  correct_option_index: number | null;
  explanation: string;
  subject: string;
  topic: string;
}

export interface Worksheet {
  id?: string;
  userId: string;
  title: string;
  createdAt: any; // Firestore Timestamp
  questions: WorksheetQuestion[];
}

export interface QuestionSet {
  id: string;
  userId: string;
  fileName: string;
  subject: string;
  exam: string;
  year: string;
  questionsCount: number;
  questions: Question[];
  createdAt: any; // Firestore Timestamp
}

export interface MarkingScheme {
  positive: number;
  negative: number;
}

export interface MockTest {
  id: string;
  userId: string;
  title: string;
  questionSetIds: string[];
  questions: Question[];
  numQuestions: number;
  timeLimit: number; // in minutes
  markingScheme: MarkingScheme;
  status: "pending" | "completed";
  createdAt: any; // Firestore Timestamp
  startedAt?: any; // Firestore Timestamp
  completedAt?: any; // Firestore Timestamp
  answers?: Record<number, number>; // index of question -> index of option
  score?: number;
  correctCount?: number;
  wrongCount?: number;
  unansweredCount?: number;
}

export interface OcrTelemetry {
  lowTextPagesCount: number;
  ocrPagesProcessed: number;
  ocrDurationMs: number;
  ocrSuccessCount: number;
  ocrFailureCount: number;
  ocrLimitExceeded: boolean;
  pagesHandled: {
    pageNum: number;
    initialLength: number;
    ocrEligible: boolean;
    ocrTriggered: boolean;
    ocrConfidence: number | null;
    ocrTextLength: number;
    finalLength: number;
    status: "native" | "ocr-success" | "ocr-discarded" | "ocr-failed" | "ocr-skipped";
  }[];
}

export type AppView = "dashboard" | "upload" | "setup-mock" | "mock-test" | "results" | "auth";
