import { Question, MockTest, MarkingScheme } from "../types";

/**
 * Fisher-Yates shuffle implementation to randomize arrays with high entropy.
 */
export function shuffleArray<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Composites and generates a randomized mock test from selected question pools.
 */
export function generateMockTest(params: {
  userId: string;
  title: string;
  questionSets: { id: string; questions: Question[] }[];
  numQuestions: number;
  timeLimit: number; // in minutes
  markingScheme: MarkingScheme;
}): MockTest {
  // Aggregate all questions from selected sets
  let pool: Question[] = [];
  params.questionSets.forEach((set) => {
    // Add set identifiers so question source is traceable
    const questionsWithMeta = set.questions.map((q) => ({
      ...q,
      subject: q.subject || "(General)",
    }));
    pool = [...pool, ...questionsWithMeta];
  });

  // Shuffle the aggregate pool
  const shuffledPool = shuffleArray(pool);

  // Take requested number of questions or pool length if standard pool is smaller
  const limit = Math.min(params.numQuestions, shuffledPool.length);
  const selectedQuestions = shuffledPool.slice(0, limit);

  // Create MockTest object
  return {
    id: `mock-${Math.random().toString(36).substr(2, 9)}`,
    userId: params.userId,
    title: params.title || `Mock Practice - ${new Date().toLocaleDateString()}`,
    questionSetIds: params.questionSets.map((qs) => qs.id),
    questions: selectedQuestions,
    numQuestions: limit,
    timeLimit: params.timeLimit,
    markingScheme: params.markingScheme,
    status: "pending",
    createdAt: new Date(),
  };
}

/**
 * Grade a mock test attempt. Calculates score, counts correct/wrong, and outputs outcomes.
 */
export function gradeMockTest(
  test: MockTest,
  answers: Record<number, number>
): {
  score: number;
  correctCount: number;
  wrongCount: number;
  unansweredCount: number;
} {
  let score = 0;
  let correctCount = 0;
  let wrongCount = 0;
  let unansweredCount = 0;

  test.questions.forEach((question, idx) => {
    const selected = answers[idx];

    if (selected === undefined || selected === null || selected === -1) {
      unansweredCount++;
    } else if (selected === question.correctOptionIndex) {
      correctCount++;
      score += test.markingScheme.positive;
    } else {
      wrongCount++;
      score -= Math.abs(test.markingScheme.negative);
    }
  });

  return {
    score,
    correctCount,
    wrongCount,
    unansweredCount,
  };
}
