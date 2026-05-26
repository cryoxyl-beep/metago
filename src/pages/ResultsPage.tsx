import React, { useState } from "react";
import { MockTest } from "../types";
import { 
  Award, 
  CheckCircle, 
  XCircle, 
  HelpCircle, 
  ArrowLeft, 
  Info,
  Layers,
  ChevronDown,
  ChevronUp
} from "lucide-react";

interface ResultsPageProps {
  mock: MockTest;
  onNavigateHome: () => void;
}

export const ResultsPage: React.FC<ResultsPageProps> = ({ 
  mock, 
  onNavigateHome 
}) => {
  const [selectedQuestionIdx, setSelectedQuestionIdx] = useState<number | null>(0);

  const totalPossible = mock.questions.length * mock.markingScheme.positive;
  const attemptedCount = (mock.correctCount || 0) + (mock.wrongCount || 0);
  const accuracy = attemptedCount > 0 
    ? Math.round(((mock.correctCount || 0) / attemptedCount) * 100) 
    : 0;

  return (
    <div className="w-full text-zinc-100 flex flex-col gap-8 max-w-4xl mx-auto pb-12 font-sans">
      
      {/* Back button */}
      <button
        onClick={onNavigateHome}
        className="self-start flex items-center gap-2 text-xs text-zinc-500 hover:text-white transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Return to Dashboard</span>
      </button>

      {/* Hero Graded Card */}
      <div className="border border-zinc-900 bg-zinc-950 p-6 md:p-8 rounded-lg flex flex-col md:flex-row justify-between items-center gap-6">
        <div className="flex flex-col md:items-start text-center md:text-left gap-1">
          <span className="text-[10px] font-bold font-mono tracking-wider uppercase text-zinc-500">Practice Score Report</span>
          <h2 className="text-2xl font-semibold tracking-tight text-white mt-1">
            {mock.title}
          </h2>
          <p className="text-xs text-zinc-400 mt-1">
            Exam taken on {mock.completedAt ? new Date(mock.completedAt).toLocaleDateString() : new Date().toLocaleDateString()}
          </p>
        </div>

        <div className="flex items-center gap-3 bg-zinc-900 px-6 py-4 rounded-lg border border-zinc-800 text-center">
          <div>
            <span className="text-sm font-mono text-zinc-500">Marks:</span>
            <div className="text-3xl font-semibold text-white font-mono tracking-tight mt-0.5">
              {mock.score}
            </div>
            <span className="text-[10px] text-zinc-500">out of {totalPossible} possible</span>
          </div>
        </div>
      </div>

      {/* Metrics breakdown */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="px-5 py-4 border border-zinc-900 bg-zinc-950 rounded-lg">
          <span className="text-[10px] uppercase font-mono font-bold text-zinc-500">Accuracy Rate</span>
          <div className="text-xl font-semibold text-white tracking-tight font-mono mt-1">{accuracy}%</div>
          <p className="text-[10px] text-zinc-500 mt-0.5">Correct over attempted</p>
        </div>

        <div className="px-5 py-4 border border-zinc-900 bg-zinc-950 rounded-lg flex gap-3.5 items-center">
          <CheckCircle className="w-5 h-5 text-emerald-500 shrink-0" />
          <div>
            <span className="text-[10px] uppercase font-mono font-bold text-zinc-500 block">Correct</span>
            <div className="text-xl font-semibold text-emerald-400 tracking-tight font-mono mt-0.5">{mock.correctCount} Qs</div>
          </div>
        </div>

        <div className="px-5 py-4 border border-zinc-900 bg-zinc-950 rounded-lg flex gap-3.5 items-center">
          <XCircle className="w-5 h-5 text-red-500 shrink-0" />
          <div>
            <span className="text-[10px] uppercase font-mono font-bold text-zinc-500 block">Incorrect</span>
            <div className="text-xl font-semibold text-red-400 tracking-tight font-mono mt-0.5">{mock.wrongCount} Qs</div>
          </div>
        </div>

        <div className="p-4 border border-zinc-900 bg-zinc-950 rounded-lg flex gap-3.5 items-center">
          <HelpCircle className="w-5 h-5 text-zinc-500 shrink-0" />
          <div>
            <span className="text-[10px] uppercase font-mono font-bold text-zinc-500 block">Unanswered</span>
            <div className="text-xl font-semibold text-zinc-400 tracking-tight font-mono mt-0.5">{mock.unansweredCount} Qs</div>
          </div>
        </div>
      </div>

      {/* Answer key breakdown worksheet */}
      <div className="flex flex-col gap-4">
        <h3 className="text-sm font-semibold text-white px-1">
          Detailed Question Diagnostic Review
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
          
          {/* Diagnostic Sidebar Selector */}
          <div className="flex flex-col gap-1.5 max-h-[500px] overflow-y-auto pr-1">
            {mock.questions.map((q, idx) => {
              const selectedOpt = mock.answers?.[idx];
              const isCorrect = selectedOpt === q.correctOptionIndex;
              const isUnanswered = selectedOpt === undefined || selectedOpt === -1;
              const isActive = selectedQuestionIdx === idx;

              return (
                <button
                  key={idx}
                  onClick={() => setSelectedQuestionIdx(idx)}
                  className={`w-full flex items-center gap-3 p-3 text-left border rounded transition-all
                    ${isActive 
                      ? "bg-zinc-90 w-full bg-zinc-900 border-zinc-700 text-white" 
                      : "bg-zinc-950 border-zinc-900 text-zinc-400 hover:border-zinc-800"
                    }
                  `}
                >
                  <span className="text-xs font-mono font-bold w-6 h-6 rounded bg-zinc-900/50 border border-zinc-800 flex items-center justify-center text-zinc-450 shrink-0">
                    {idx + 1}
                  </span>

                  <span className="text-xs truncate flex-1 block">
                    {q.questionText}
                  </span>

                  <span className="shrink-0 leading-none block">
                    {isUnanswered ? (
                      <HelpCircle className="w-4 h-4 text-zinc-500" />
                    ) : isCorrect ? (
                      <CheckCircle className="w-4 h-4 text-emerald-500" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-500" />
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Question Viewer Sheet */}
          <div className="md:col-span-2 border border-zinc-900 bg-zinc-950 p-6 rounded-lg min-h-[300px] flex flex-col gap-6">
            {selectedQuestionIdx !== null ? (
              (() => {
                const q = mock.questions[selectedQuestionIdx];
                const selectedOpt = mock.answers?.[selectedQuestionIdx];
                const isCorrect = selectedOpt === q.correctOptionIndex;
                const isUnanswered = selectedOpt === undefined || selectedOpt === -1;

                return (
                  <div className="flex flex-col gap-5 animate-fade-in">
                    
                    {/* Header bar indicator */}
                    <div className="flex justify-between items-center border-b border-zinc-900 pb-3">
                      <span className="text-xs font-mono font-bold text-zinc-500 uppercase">
                        Question {selectedQuestionIdx + 1} of {mock.questions.length} Diagnostic
                      </span>
                      <div className="flex items-center gap-1.5">
                        {isUnanswered ? (
                          <span className="text-[9px] font-mono font-bold text-zinc-400 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800">
                            Unanswered • 0 Marks
                          </span>
                        ) : isCorrect ? (
                          <span className="text-[9px] font-mono font-bold text-emerald-400 bg-emerald-950/20 px-2 py-0.5 rounded border border-emerald-900/40">
                            Correct • +{mock.markingScheme.positive}
                          </span>
                        ) : (
                          <span className="text-[9px] font-mono font-bold text-red-400 bg-red-950/20 px-2 py-0.5 rounded border border-red-900/40">
                            Incorrect • -{mock.markingScheme.negative}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Question text */}
                    <p className="text-sm md:text-base leading-relaxed text-zinc-200 font-medium">
                      {q.questionText}
                    </p>

                    {/* Colored options */}
                    <div className="flex flex-col gap-3.5">
                      {q.options.map((optionText, opIdx) => {
                        const isCorrectKey = opIdx === q.correctOptionIndex;
                        const isUserChoice = opIdx === selectedOpt;

                        let cardClass = "bg-zinc-950 border-zinc-900 text-zinc-400";
                        let ringClass = "border-zinc-800 bg-zinc-900 text-zinc-500";

                        if (isCorrectKey) {
                          // This option is the correct key
                          cardClass = "bg-emerald-950/10 border-emerald-900/60 text-emerald-100 font-semibold";
                          ringClass = "border-emerald-500 bg-emerald-500 text-black";
                        } else if (isUserChoice && !isCorrect) {
                          // User chose this option wrongly
                          cardClass = "bg-red-950/10 border-red-900/60 text-red-100";
                          ringClass = "border-red-500 bg-red-500 text-white";
                        }

                        return (
                          <div
                            key={opIdx}
                            className={`w-full flex items-center gap-4 p-4 border rounded-lg text-left text-xs md:text-sm font-medium ${cardClass}`}
                          >
                            <div className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 font-mono text-[9px] font-bold ${ringClass}`}>
                              {String.fromCharCode(65 + opIdx)}
                            </div>
                            <span className="flex-1">{optionText || "(No option text)"}</span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Explanation details */}
                    {q.explanation && (
                      <div className="border border-zinc-900 bg-zinc-900/40 p-4 rounded-md flex gap-3 items-start mt-2">
                        <Info className="w-4 h-4 text-zinc-500 shrink-0 mt-0.5" />
                        <div>
                          <p className="text-[10px] font-mono font-semibold text-zinc-400 uppercase">Answer Rationale / Explanation</p>
                          <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                            {q.explanation}
                          </p>
                        </div>
                      </div>
                    )}

                  </div>
                );
              })()
            ) : (
              <div className="w-full h-full flex flex-col justify-center items-center text-zinc-500 text-center gap-2">
                <Layers className="w-8 h-8 text-zinc-700" />
                <span className="text-xs font-medium">Select a question from the sidebar to begin diagnostics view.</span>
              </div>
            )}
          </div>

        </div>
      </div>

    </div>
  );
};
