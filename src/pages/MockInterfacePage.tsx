import React, { useEffect, useState, useRef } from "react";
import { MockTest } from "../types";
import { useAuth } from "../firebase/context";
import { gradeMockTest } from "../mockEngine/generator";
import { doc, updateDoc, Timestamp } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../firebase/config";
import { 
  Clock, 
  ChevronLeft, 
  ChevronRight, 
  Send, 
  AlertTriangle,
  Award,
  BookOpen
} from "lucide-react";

interface MockInterfacePageProps {
  mock: MockTest;
  onFinishMock: (completedMock: MockTest) => void;
}

export const MockInterfacePage: React.FC<MockInterfacePageProps> = ({ 
  mock, 
  onFinishMock 
}) => {
  const { dbOnline } = useAuth();

  // Active question index
  const [activeIndex, setActiveIndex] = useState(0);
  
  // Selected answers: map of activeIndex -> optionIndex
  const [answers, setAnswers] = useState<Record<number, number>>({});
  
  // Time remaining in seconds
  const [secondsLeft, setSecondsLeft] = useState(mock.timeLimit * 60);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);

  // Initialize and run countdown
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          // Force auto-submit on countdown expiry
          triggerAutoSubmit();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const triggerAutoSubmit = () => {
    console.log("Timer expired. Triggering auto-submit...");
    submitExam(true);
  };

  // Convert seconds remaining to HH:MM:SS format
  const formatTime = (totalSeconds: number) => {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;

    const pad = (num: number) => String(num).padStart(2, "0");

    if (h > 0) {
      return `${pad(h)}:${pad(m)}:${pad(s)}`;
    }
    return `${pad(m)}:${pad(s)}`;
  };

  const currentQuestion = mock.questions[activeIndex];

  const handleSelectOption = (opIdx: number) => {
    setAnswers((prev) => ({
      ...prev,
      [activeIndex]: opIdx,
    }));
  };

  const handleClearAnswer = () => {
    setAnswers((prev) => {
      const copy = { ...prev };
      delete copy[activeIndex];
      return copy;
    });
  };

  const handlePrev = () => {
    if (activeIndex > 0) {
      setActiveIndex(activeIndex - 1);
    }
  };

  const handleNext = () => {
    if (activeIndex < mock.questions.length - 1) {
      setActiveIndex(activeIndex + 1);
    }
  };

  const submitExam = async (isAuto = false) => {
    if (submitting) return;
    setSubmitting(true);

    const outcomes = gradeMockTest(mock, answers);
    const completedMock: MockTest = {
      ...mock,
      status: "completed",
      answers,
      score: outcomes.score,
      correctCount: outcomes.correctCount,
      wrongCount: outcomes.wrongCount,
      unansweredCount: outcomes.unansweredCount,
      completedAt: new Date(),
    };

    try {
      if (dbOnline) {
        // Run atomic batch updates strictly as enforced in rules
        const mockRef = doc(db, "mockTests", mock.id);
        await updateDoc(mockRef, {
          status: "completed",
          answers,
          score: outcomes.score,
          correctCount: outcomes.correctCount,
          wrongCount: outcomes.wrongCount,
          unansweredCount: outcomes.unansweredCount,
          completedAt: Timestamp.now()
        }).catch((err) => {
          handleFirestoreError(err, OperationType.UPDATE, `mockTests/${mock.id}`);
        });
      } else {
        // Localstorage fallback sandbox
        const localMocks = JSON.parse(localStorage.getItem("mockgo_mocks") || "[]");
        const updated = localMocks.map((m: any) => m.id === mock.id ? {
          ...completedMock,
          createdAt: m.createdAt,
          completedAt: new Date().toISOString()
        } : m);
        localStorage.setItem("mockgo_mocks", JSON.stringify(updated));
      }

      // Add to activities log
      const localActivity = JSON.parse(localStorage.getItem("mockgo_activity") || "[]");
      localActivity.unshift({
        type: "mock_submit",
        title: `Submitted mock: ${mock.title}`,
        meta: `Scored ${outcomes.score} points • ${outcomes.correctCount} correct`,
        date: new Date().toISOString()
      });
      localStorage.setItem("mockgo_activity", JSON.stringify(localActivity.slice(0, 15)));

      onFinishMock(completedMock);
    } catch (e) {
      console.error("Failed to commit grading results: ", e);
    } finally {
      setSubmitting(false);
      setShowSubmitConfirm(false);
    }
  };

  const unansweredCount = mock.questions.length - Object.keys(answers).length;

  return (
    <div className="fixed inset-0 bg-black text-zinc-100 flex flex-col z-[100] font-sans">
      
      {/* Top Header Panel */}
      <header className="w-full h-16 border-b border-zinc-900 bg-zinc-950 px-6 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <BookOpen className="w-4 h-4 text-zinc-400" />
          <span className="font-semibold text-xs uppercase tracking-wider text-zinc-400">
            {mock.title}
          </span>
        </div>

        {/* Clock countdown widget */}
        <div className="flex items-center gap-2 px-3 py-1.5 border border-zinc-800 bg-zinc-900 rounded-md font-mono text-sm font-semibold tracking-wide text-white">
          <Clock className="w-4 h-4 text-zinc-400 shrink-0" />
          <span>{formatTime(secondsLeft)}</span>
        </div>

        {/* Submit */}
        <button
          onClick={() => setShowSubmitConfirm(true)}
          className="flex items-center gap-1.5 bg-white text-black hover:bg-zinc-200 font-semibold text-xs px-4 py-2 rounded-md transition-colors"
        >
          <Send className="w-3.5 h-3.5" />
          <span>Submit Exam</span>
        </button>
      </header>

      {/* Main split work layout */}
      <div className="flex-1 w-full flex flex-col md:flex-row overflow-hidden">
        
        {/* Left Side Question Grid Palette */}
        <aside className="w-full md:w-64 border-b md:border-b-0 md:border-r border-zinc-900 bg-zinc-950 p-5 shrink-0 flex flex-col gap-4 overflow-y-auto">
          <div>
            <h3 className="text-[10px] font-bold font-mono tracking-wider uppercase text-zinc-500 mb-1">
              Question Navigator
            </h3>
            <p className="text-[11px] text-zinc-500">
              Jump to any question index instantly. Statuses update in real-time.
            </p>
          </div>

          <div className="grid grid-cols-5 md:grid-cols-4 gap-2">
            {mock.questions.map((_, idx) => {
              const isActive = activeIndex === idx;
              const isAnswered = answers[idx] !== undefined;

              return (
                <button
                  key={idx}
                  onClick={() => setActiveIndex(idx)}
                  className={`aspect-square font-semibold text-xs rounded border flex items-center justify-center transition-colors
                    ${isActive 
                      ? "border-white bg-zinc-900 text-white" 
                      : isAnswered 
                        ? "border-zinc-805 bg-zinc-800 text-zinc-100" 
                        : "border-zinc-900 bg-black hover:border-zinc-800 text-zinc-500"
                    }
                  `}
                >
                  {idx + 1}
                </button>
              );
            })}
          </div>

          {/* Status color notes */}
          <div className="border-t border-zinc-900 pt-4 flex flex-col gap-2 mt-auto">
            <div className="flex items-center gap-2 text-[10px] text-zinc-500">
              <span className="w-2.5 h-2.5 rounded bg-zinc-800 border border-zinc-705 shrink-0" />
              <span>Answered</span>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-zinc-500">
              <span className="w-2.5 h-2.5 rounded bg-black border border-zinc-900 shrink-0" />
              <span>Unanswered / Skipped</span>
            </div>
          </div>
        </aside>

        {/* Center / Right Question Workspace */}
        <main className="flex-1 overflow-y-auto p-6 md:p-12 flex flex-col justify-between">
          <div className="w-full max-w-3xl mx-auto flex flex-col gap-8">
            
            {/* Meta indicator */}
            <div className="flex justify-between items-center px-1 border-b border-zinc-900 pb-3">
              <span className="text-xs font-semibold font-mono text-zinc-500 uppercase tracking-wider">
                Question {activeIndex + 1} of {mock.questions.length}
              </span>
              <span className="text-[10px] bg-zinc-900 text-zinc-400 font-mono px-2 py-0.5 rounded border border-zinc-805">
                Positive: +{mock.markingScheme.positive} | Negative: -{mock.markingScheme.negative}
              </span>
            </div>

            {/* Question Text */}
            <div className="text-zinc-100 text-sm md:text-base leading-relaxed tracking-normal font-medium py-3">
              {currentQuestion?.questionText}
            </div>

            {/* MCQ selections */}
            <div className="flex flex-col gap-3">
              {currentQuestion?.options.map((optionText, opIdx) => {
                const isSelected = answers[activeIndex] === opIdx;
                return (
                  <button
                    key={opIdx}
                    onClick={() => handleSelectOption(opIdx)}
                    className={`w-full flex items-center gap-4 p-4 border rounded-lg text-left text-xs md:text-sm font-medium transition-colors group
                      ${isSelected 
                        ? "bg-zinc-900 border-zinc-550 text-white" 
                        : "bg-zinc-950 border-zinc-900 hover:border-zinc-800 text-zinc-300"
                      }
                    `}
                  >
                    <div className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 font-mono text-[9px] font-bold transition-colors
                      ${isSelected 
                        ? "border-white bg-white text-black" 
                        : "border-zinc-800 bg-zinc-900 text-zinc-500 group-hover:border-zinc-700"
                      }
                    `}>
                      {String.fromCharCode(65 + opIdx)}
                    </div>
                    <span>{optionText || "(No option written)"}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Action Row */}
          <div className="w-full max-w-3xl mx-auto border-t border-zinc-900 pt-6 mt-12 flex justify-between items-center gap-4 chunk-0">
            <div className="flex items-center gap-2">
              <button
                onClick={handlePrev}
                disabled={activeIndex === 0}
                className="p-2 border border-zinc-900 bg-zinc-950 hover:bg-zinc-900 rounded disabled:opacity-30 disabled:hover:bg-zinc-950 transition-colors"
              >
                <ChevronLeft className="w-4 h-4 text-white" />
              </button>

              <button
                onClick={handleNext}
                disabled={activeIndex === mock.questions.length - 1}
                className="p-2 border border-zinc-900 bg-zinc-950 hover:bg-zinc-900 rounded disabled:opacity-30 disabled:hover:bg-zinc-950 transition-colors"
              >
                <ChevronRight className="w-4 h-4 text-white" />
              </button>
            </div>

            {answers[activeIndex] !== undefined && (
              <button
                onClick={handleClearAnswer}
                className="text-[10px] font-mono text-zinc-500 hover:text-white uppercase tracking-tight"
              >
                Clear Selected Choice
              </button>
            )}

            <button
              onClick={() => setShowSubmitConfirm(true)}
              className="bg-white text-black font-semibold text-xs px-4 py-2 rounded border hover:bg-zinc-205 transition-colors font-mono"
            >
              Finish Exam
            </button>
          </div>
        </main>
      </div>

      {/* Confirmation Modal */}
      {showSubmitConfirm && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[150] p-4">
          <div className="w-full max-w-sm border border-zinc-900 bg-zinc-950 p-6 rounded-lg text-center flex flex-col items-center gap-4">
            <div className="p-3 bg-red-950/20 border border-red-900/60 rounded">
              <AlertTriangle className="w-6 h-6 text-red-500" />
            </div>

            <div>
              <h4 className="text-sm font-semibold text-white">Confirm Exam Submission</h4>
              <p className="text-xs text-zinc-500 mt-1 max-w-xs">
                {unansweredCount > 0 
                  ? `You leave ${unansweredCount} questions unanswered. Submit now to generate performance reviews?`
                  : "All questions have been evaluated. Choose submit to finalize scoring."
                }
              </p>
            </div>

            <div className="flex w-full gap-3 pt-2">
              <button
                onClick={() => setShowSubmitConfirm(false)}
                className="w-full py-2 border border-zinc-900 hover:border-zinc-800 text-xs text-zinc-400 hover:text-white rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => submitExam(false)}
                disabled={submitting}
                className="w-full py-2 bg-white text-black font-semibold text-xs rounded hover:bg-zinc-200 transition-colors"
              >
                {submitting ? "Grading..." : "Submit Answers"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
