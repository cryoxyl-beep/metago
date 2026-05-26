import React, { useEffect, useState } from "react";
import { useAuth } from "../firebase/context";
import { MockTest, QuestionSet } from "../types";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../firebase/config";
import { 
  TrendingUp, 
  Target, 
  Layers, 
  Award, 
  CheckCircle, 
  HelpCircle,
  AlertCircle
} from "lucide-react";

export const AnalyticsPage: React.FC = () => {
  const { user, dbOnline } = useAuth();
  const [mockTests, setMockTests] = useState<MockTest[]>([]);
  const [questionSets, setQuestionSets] = useState<QuestionSet[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      if (!user) return;
      try {
        if (dbOnline) {
          const mQ = query(collection(db, "mockTests"), where("userId", "==", user.uid));
          const mSnapshot = await getDocs(mQ);
          const mList: MockTest[] = [];
          mSnapshot.forEach(doc => {
            mList.push({ ...doc.data(), id: doc.id } as MockTest);
          });
          setMockTests(mList);

          const qQ = query(collection(db, "questionSets"), where("userId", "==", user.uid));
          const qSnapshot = await getDocs(qQ);
          const qList: QuestionSet[] = [];
          qSnapshot.forEach(doc => {
            qList.push({ ...doc.data(), id: doc.id } as QuestionSet);
          });
          setQuestionSets(qList);
        } else {
          const localMocks = JSON.parse(localStorage.getItem("mockgo_mocks") || "[]");
          setMockTests(localMocks);

          const localSets = JSON.parse(localStorage.getItem("mockgo_question_sets") || "[]");
          setQuestionSets(localSets);
        }
      } catch (err) {
        console.error("Error retrieving analytics", err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [user, dbOnline]);

  const completedMocks = mockTests.filter(m => m.status === "completed");

  return (
    <div className="w-full text-zinc-800 flex flex-col gap-8 max-w-6xl mx-auto pb-16 font-sans">
      
      {/* Header */}
      <div className="border-b border-zinc-200/60 pb-5">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-zinc-900">
          Academic Index & Progress
        </h1>
        <p className="text-zinc-500 text-xs sm:text-xs.1 mt-0.5">
          Review minimal trends, target subject accuracy ratings, and identified focus modules.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Column: Progress trends and Subject Accuracy */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          
          {/* Trends visual overview */}
          <div className="bg-white border border-zinc-200 p-6 rounded-2xl shadow-[0_4px_16px_rgba(0,0,0,0.01)]">
            <div className="flex justify-between items-center mb-5">
              <span className="text-[10px] font-bold font-mono tracking-wider text-zinc-400 uppercase">Interactive Trends (Score History)</span>
              <span className="text-[9px] bg-emerald-50 text-emerald-600 font-mono px-2 py-0.5 rounded-lg font-bold">Consistently Active</span>
            </div>

            {loading ? (
              <div className="py-14 text-center">
                <p className="text-xs text-zinc-400 font-mono">Calculating score curves...</p>
              </div>
            ) : completedMocks.length === 0 ? (
              <div className="py-12 border border-dashed border-zinc-200 rounded-xl text-center bg-zinc-50/20">
                <TrendingUp className="w-6 h-6 text-zinc-300 mx-auto mb-2" />
                <p className="text-xs text-zinc-500 font-semibold">No performance trends recorded.</p>
                <p className="text-[10px] text-zinc-400 mt-0.5">Scoring graphs populate automatically once mock tests are completed.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {/* Horizontal simple trending bar graph */}
                <div className="flex flex-col gap-3.5">
                  {completedMocks.slice(-4).map((mock, idx) => {
                    const score = mock.score || 0;
                    const maxScore = mock.questions.length * mock.markingScheme.positive;
                    const pct = maxScore > 0 ? Math.round((score / maxScore) * 100) : 50;
                    return (
                      <div key={mock.id} className="flex flex-col gap-1.5">
                        <div className="flex justify-between items-center text-[10px] font-semibold font-mono">
                          <span className="text-zinc-650 truncate max-w-xs">{mock.title}</span>
                          <span className="text-zinc-900">{score} pts ({pct}%)</span>
                        </div>
                        <div className="h-2 w-full bg-zinc-100 rounded-full overflow-hidden">
                          <div 
                            style={{ width: `${Math.max(10, Math.min(100, pct))}%` }} 
                            className="bg-zinc-800 h-full rounded-full transition-all duration-500"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Subject Level Tracking Cards */}
          <div className="flex flex-col gap-4">
            <h2 className="text-xs font-bold font-mono uppercase tracking-wider text-zinc-400">Subject Strength Index</h2>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                { subject: "Mathematics / Calculus", accuracy: "88%", questionsCount: 45, status: "Excellent" },
                { subject: "Analytical Physics", accuracy: "82%", questionsCount: 22, status: "Secure Copy" },
                { subject: "Organic Chemistry", accuracy: "65%", questionsCount: 15, status: "In Progress" },
                { subject: "Linear Induction Logic", accuracy: "74%", questionsCount: 10, status: "Review Recommended" },
              ].map((sub, i) => (
                <div key={i} className="bg-white border border-zinc-200/80 p-5 rounded-2xl flex flex-col justify-between gap-3 shadow-[0_2px_8px_rgba(0,0,0,0.01)]">
                  <div>
                    <span className="text-[9px] font-mono tracking-wider font-semibold text-zinc-400 uppercase">{sub.status}</span>
                    <h4 className="text-xs font-bold text-zinc-800 mt-1 leading-normal">{sub.subject}</h4>
                  </div>
                  <div className="flex justify-between items-baseline pt-2 border-t border-zinc-100/60 mt-2">
                    <span className="text-lg font-bold font-mono text-zinc-950">{sub.accuracy}</span>
                    <span className="text-[9px] text-zinc-400 font-mono font-semibold uppercase">{sub.questionsCount} answered</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>

        {/* Right Column: Weak focus modules list */}
        <div className="flex flex-col gap-6">
          
          <div className="bg-white border border-zinc-200 p-5 rounded-2xl shadow-[0_4px_16px_rgba(0,0,0,0.01)] flex flex-col gap-4">
            <div className="flex items-center gap-2 pb-2 border-b border-zinc-150">
              <Target className="w-4 h-4 text-zinc-500" />
              <span className="text-[10px] font-bold font-mono tracking-wider text-zinc-400 uppercase">Identified Target Areas</span>
            </div>

            <p className="text-[10px] text-zinc-500 leading-relaxed font-sans">
              Subject modules with lower relative correct answer weights trigger instant review recommend cards in your Practice Hall automatically.
            </p>

            <div className="flex flex-col gap-3 mt-1">
              {[
                { topic: "Thermodynamics & Isobaric Systems", scope: "Theoretical Physics", action: "Review Flashcards" },
                { topic: "Integration via Parts Method", scope: "Mathematics", action: "Resume Quick mock" },
                { topic: "Symmetric Molecular Orbital Structures", scope: "Organic Chemistry", action: "Launch worksheet" },
              ].map((focus, i) => (
                <div key={i} className="p-3 border border-zinc-150 rounded-xl bg-zinc-50/50 flex flex-col gap-1.5">
                  <div className="flex justify-between items-start gap-1">
                    <span className="text-[9px] text-zinc-400 font-mono tracking-tight">{focus.scope}</span>
                    <span className="text-[8px] bg-neutral-100 text-neutral-600 font-semibold font-mono rounded px-1.5 py-0.5">{focus.action}</span>
                  </div>
                  <p className="text-[11px] font-bold text-zinc-800 leading-snug">{focus.topic}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Study Progress metrics checklists */}
          <div className="bg-white border border-zinc-200 p-5 rounded-2xl shadow-[0_4px_16px_rgba(0,0,0,0.01)] flex flex-col gap-3">
            <span className="text-[9px] font-mono tracking-wider text-zinc-400 uppercase font-semibold">Scholar Milestone checklist</span>
            
            <div className="flex flex-col gap-2 mt-1">
              {[
                { text: "Connect first PYQ PDF paper copy", done: true },
                { text: "Answer dynamic mock setup module", done: true },
                { text: "Isolate chemical diagrams to worksheet", done: true },
                { text: "Complete 5 day continuous streak", done: true },
                { text: "Achieve 85% average correct answer weight", done: false },
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-2.5 text-xs text-zinc-700 leading-relaxed">
                  <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0
                    ${item.done 
                      ? "bg-zinc-800 border-zinc-800 text-white" 
                      : "border-zinc-350 bg-white"
                    }`}>
                    {item.done && <span className="text-[8px]">&bull;</span>}
                  </span>
                  <span className={item.done ? "line-through text-zinc-400" : "font-sans font-medium"}>{item.text}</span>
                </div>
              ))}
            </div>
          </div>

        </div>

      </div>

    </div>
  );
};
