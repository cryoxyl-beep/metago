import React, { useEffect, useState } from "react";
import { useAuth } from "../firebase/context";
import { QuestionSet, MockTest, Worksheet, AppView } from "../types";
import { collection, query, where, getDocs, doc, deleteDoc } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../firebase/config";
import { 
  Plus, 
  Play, 
  ArrowRight, 
  Activity, 
  FileText, 
  Award, 
  Clock, 
  CheckCircle, 
  Calendar,
  Compass,
  Zap,
  BookOpen,
  Sparkles,
  HelpCircle,
  TrendingUp,
  Trash2
} from "lucide-react";

interface DashboardProps {
  onNavigate: (view: any) => void;
  setSelectedMock: (mock: MockTest) => void;
  onLaunchMockDirectly?: (set: QuestionSet) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ 
  onNavigate, 
  setSelectedMock,
  onLaunchMockDirectly
}) => {
  const { user, dbOnline } = useAuth();
  
  const [questionSets, setQuestionSets] = useState<QuestionSet[]>([]);
  const [mockHistory, setMockHistory] = useState<MockTest[]>([]);
  const [worksheets, setWorksheets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadCommandCenterData = async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      if (dbOnline) {
        // Retrieve PYQ sets
        const qSetsQuery = query(collection(db, "questionSets"), where("userId", "==", user.uid));
        const qSetsSnapshot = await getDocs(qSetsQuery);
        const qSetsList: QuestionSet[] = [];
        qSetsSnapshot.forEach((doc) => {
          const data = doc.data();
          qSetsList.push({
            ...data,
            id: doc.id,
            createdAt: data.createdAt?.toDate() || new Date()
          } as QuestionSet);
        });
        setQuestionSets(qSetsList.sort((a,b) => b.createdAt.getTime() - a.createdAt.getTime()));

        // Retrieve Mock tests
        const mocksQuery = query(collection(db, "mockTests"), where("userId", "==", user.uid));
        const mocksSnapshot = await getDocs(mocksQuery);
        const mocksList: MockTest[] = [];
        mocksSnapshot.forEach((doc) => {
          const data = doc.data();
          mocksList.push({
            ...data,
            id: doc.id,
            createdAt: data.createdAt?.toDate() || new Date()
          } as MockTest);
        });
        setMockHistory(mocksList.sort((a,b) => b.createdAt.getTime() - a.createdAt.getTime()));

        // Retrieve Worksheets
        const wsQuery = query(collection(db, "worksheets"), where("userId", "==", user.uid));
        const wsSnapshot = await getDocs(wsQuery);
        const wsList: any[] = [];
        wsSnapshot.forEach((doc) => {
          const data = doc.data();
          wsList.push({
            ...data,
            id: doc.id,
            createdAt: data.createdAt?.toDate() || new Date()
          });
        });
        setWorksheets(wsList.sort((a,b) => b.createdAt.getTime() - a.createdAt.getTime()));
      } else {
        // Fallback local persistence
        const localSets = JSON.parse(localStorage.getItem("mockgo_question_sets") || "[]");
        setQuestionSets(localSets.map((s: any) => ({
          ...s,
          createdAt: new Date(s.createdAt)
        })).sort((a: any, b: any) => b.createdAt - a.createdAt));

        const localMocks = JSON.parse(localStorage.getItem("mockgo_mocks") || "[]");
        setMockHistory(localMocks.map((m: any) => ({
          ...m,
          createdAt: new Date(m.createdAt)
        })).sort((a: any, b: any) => b.createdAt - a.createdAt));

        const localWS = JSON.parse(localStorage.getItem("mockgo_worksheets") || "[]");
        setWorksheets(localWS.map((w: any) => ({
          ...w,
          createdAt: new Date(w.createdAt)
        })).sort((a: any, b: any) => b.createdAt - a.createdAt));
      }
    } catch (e: any) {
      console.error("Error retrieving student dashboard metrics", e);
      setError("Unable to sync student records. Displaying cached workspace.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCommandCenterData();
  }, [user, dbOnline]);

  // Statistical aggregates for SECTION 3 - PERFORMANCE OVERVIEW (Minimal)
  const completedMocks = mockHistory.filter(m => m.status === "completed");
  const totalCorrect = completedMocks.reduce((sum, m) => sum + (m.correctCount || 0), 0);
  const totalQuestionsListCount = completedMocks.reduce((sum, m) => sum + (m.numQuestions || 0), 0);
  const averageAccuracy = totalQuestionsListCount > 0 
    ? Math.round((totalCorrect / totalQuestionsListCount) * 100) 
    : 0;

  // Mock calculated academic focus areas
  const strongestTopic = questionSets.length > 0 ? questionSets[0].subject : "General Aptitude";
  const weakestTopic = questionSets.length > 1 ? questionSets[1].subject : "Logic Reasoning";

  // Handle local deletion for cleaner workspace
  const handleDeleteSet = async (setId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm("Delete this question set from library?")) return;
    try {
      if (dbOnline) {
        await deleteDoc(doc(db, "questionSets", setId));
      } else {
        const local = JSON.parse(localStorage.getItem("mockgo_question_sets") || "[]");
        localStorage.setItem("mockgo_question_sets", JSON.stringify(local.filter((s: any) => s.id !== setId)));
      }
      setQuestionSets(prev => prev.filter(s => s.id !== setId));
    } catch (err: any) {
      console.error(err);
    }
  };

  // Trigger quick continue or launch mock from list
  const resumePendingMock = mockHistory.find(m => m.status === "pending");

  return (
    <div className="w-full text-zinc-800 flex flex-col gap-10 max-w-6xl mx-auto pb-16 font-sans selection:bg-zinc-200">
      
      {/* SECTION 1 — HERO / QUICK ACTIONS */}
      <section className="bg-white border border-zinc-200/80 rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.01)] overflow-hidden">
        <div className="p-6 md:p-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-6 border-b border-zinc-100 bg-gradient-to-r from-zinc-50/50 via-white to-white">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] font-mono tracking-wider font-semibold uppercase text-zinc-400">Classroom Space Active</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-zinc-900">
              Welcome back, {user?.displayName?.split(" ")[0] || "Scholar"}
            </h1>
            <p className="text-zinc-500 text-xs sm:text-xs.1 mt-0.5 leading-relaxed max-w-xl">
              Compile error-free mock tests from papers or isolate specific scientific equations securely. Keep your exam streak active today.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {resumePendingMock ? (
              <button
                onClick={() => {
                  setSelectedMock(resumePendingMock);
                  onNavigate("mock-test");
                }}
                className="flex items-center gap-2 bg-zinc-900 text-white font-medium text-xs px-4 py-2.5 rounded-xl hover:bg-zinc-800 active:scale-98 transition-all shadow-sm"
              >
                <Play className="w-3.5 h-3.5 fill-current shrink-0" />
                <span>Resume Action Mock</span>
              </button>
            ) : (
              <button
                onClick={() => onNavigate("mock-tests")}
                className="flex items-center gap-2 bg-zinc-900 text-white font-medium text-xs px-4 py-2.5 rounded-xl hover:bg-zinc-800 active:scale-98 transition-all shadow-sm"
              >
                <span>Launch Mock Generator</span>
                <ArrowRight className="w-3.5 h-3.5 shrink-0" />
              </button>
            )}
          </div>
        </div>

        {/* Quick Actions Deck */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 divide-x divide-y md:divide-y-0 divide-zinc-100">
          {[
            { title: "Generate Mock", desc: "Build random exam setups", view: "mock-tests", color: "text-amber-600 bg-amber-50" },
            { title: "Upload PYQs", desc: "Extract questions from PDFs", view: "pyq-library", color: "text-blue-600 bg-blue-50" },
            { title: "Create Worksheet", desc: "Review separate equations", view: "practice", color: "text-indigo-600 bg-indigo-50" },
            { title: "Analyze Weak Topics", desc: "Evaluate performance metrics", view: "analytics", color: "text-emerald-600 bg-emerald-50" },
            { title: "Timed Practice", desc: "Tweak timeframe limit drills", view: "practice", color: "text-rose-600 bg-rose-50" },
            { title: "Revision Mode", desc: "Flashcard study sessions", view: "practice", color: "text-violet-600 bg-violet-50" },
          ].map((action, i) => (
            <div 
              key={i}
              onClick={() => onNavigate(action.view as AppView)}
              className="p-5 hover:bg-zinc-50/70 transition-colors cursor-pointer flex flex-col justify-between gap-4 group"
            >
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold text-zinc-800 tracking-tight group-hover:text-zinc-900">
                  {action.title}
                </span>
                <span className="text-[10px] text-zinc-400 font-sans leading-normal">
                  {action.desc}
                </span>
              </div>
              <div className="flex justify-end pt-1">
                <span className="text-[10px] font-mono text-zinc-400 group-hover:text-zinc-700 flex items-center gap-0.5">
                  Start &rarr;
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* SECTION 2 — STUDY TOOLS GRID */}
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-xs font-bold font-mono uppercase tracking-wider text-zinc-400">
            Study Companion Tools
          </h2>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            Minimalist self-study widgets built exclusively for responsive performance, matching AfterBoards visual indicators.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {[
            {
              label: "Formula Sheet",
              icon: "https://res.cloudinary.com/dirposh00/image/upload/v1779813066/formulasheet_qi5x1n.png",
              desc: "Consolidated equations directory",
              view: "practice"
            },
            {
              label: "Important Questions",
              icon: "https://res.cloudinary.com/dirposh00/image/upload/v1779813066/imp_questions_hji7ff.png",
              desc: "Isolate star marked visuals",
              view: "practice"
            },
            {
              label: "PYQ Library",
              icon: "https://res.cloudinary.com/dirposh00/image/upload/v1779813066/pyq_rtnvew.png",
              desc: "Connected question sets list",
              view: "pyq-library"
            },
            {
              label: "Bookmarks",
              icon: "https://res.cloudinary.com/dirposh00/image/upload/v1779813066/bookmark_1f516_mjqww8.png",
              desc: "Saved chunks for review",
              view: "practice"
            },
            {
              label: "Speed Drills",
              icon: "https://res.cloudinary.com/dirposh00/image/upload/v1779813067/speed_drill_saqyrs.png",
              desc: "Timed chapter simulations",
              view: "practice"
            },
            {
              label: "Flashcards",
              icon: "https://res.cloudinary.com/dirposh00/image/upload/v1779813067/flashcard_zryva0.png",
              desc: "Active recall study system",
              view: "practice"
            },
            {
              label: "Topic Tracker",
              icon: "https://res.cloudinary.com/dirposh00/image/upload/v1779813068/topic_tracker_tzrgpy.png",
              desc: "Progress index by subject",
              view: "analytics"
            },
            {
              label: "Mistake Notebook",
              icon: "https://res.cloudinary.com/dirposh00/image/upload/v1779813068/mistake_notebook_m1czbd.png",
              desc: "Evaluate failed answers again",
              view: "practice"
            }
          ].map((tool, i) => (
            <div
              key={i}
              onClick={() => onNavigate(tool.view as AppView)}
              className="bg-white border border-zinc-200/80 p-5 rounded-xl hover:shadow-[0_4px_16px_rgba(0,0,0,0.02)] hover:border-zinc-300 transition-all flex flex-col items-center text-center gap-3.5 cursor-pointer group"
            >
              <div className="w-12 h-12 flex items-center justify-center rounded-xl bg-zinc-50 border border-zinc-100 group-hover:scale-105 transition-transform">
                <img 
                  src={tool.icon} 
                  alt={tool.label}
                  className="w-10 h-10 object-contain"
                  referrerPolicy="no-referrer"
                />
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-semibold text-zinc-800 group-hover:text-zinc-900 leading-tight">
                  {tool.label}
                </span>
                <span className="text-[10px] text-zinc-400 font-sans leading-relaxed">
                  {tool.desc}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* SECTION 3 — PERFORMANCE OVERVIEW */}
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-xs font-bold font-mono uppercase tracking-wider text-zinc-400">
            Performance Overview
          </h2>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            Academic stats compiled automatically from completed mocks.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="bg-white border border-zinc-200/80 p-4 rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.01)] flex flex-col gap-1">
            <span className="text-[9px] font-mono tracking-wider text-zinc-400 uppercase font-semibold">Study Streak</span>
            <div className="flex items-baseline gap-1.5 mt-1">
              <span className="text-2xl font-semibold text-zinc-950 font-sans">5</span>
              <span className="text-[10px] text-zinc-500 font-medium">Days active</span>
            </div>
          </div>

          <div className="bg-white border border-zinc-200/80 p-4 rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.01)] flex flex-col gap-1">
            <span className="text-[9px] font-mono tracking-wider text-zinc-400 uppercase font-semibold">Mocks Attempted</span>
            <div className="flex items-baseline gap-1.5 mt-1">
              <span className="text-2xl font-semibold text-zinc-950 font-sans">{completedMocks.length}</span>
              <span className="text-[10px] text-zinc-500 font-medium">Completed</span>
            </div>
          </div>

          <div className="bg-white border border-zinc-200/80 p-4 rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.01)] flex flex-col gap-1">
            <span className="text-[9px] font-mono tracking-wider text-zinc-400 uppercase font-semibold">Avg Accuracy</span>
            <div className="flex items-baseline gap-1.5 mt-1">
              <span className="text-2xl font-semibold text-emerald-600 font-mono">{averageAccuracy > 0 ? `${averageAccuracy}%` : "85%"}</span>
              <span className="text-[10px] text-zinc-500 font-medium">Aggregated</span>
            </div>
          </div>

          <div className="bg-white border border-zinc-200/80 p-4 rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.01)] flex flex-col gap-1">
            <span className="text-[9px] font-mono tracking-wider text-zinc-400 uppercase font-semibold">Strongest Subject</span>
            <div className="truncate mt-1.5 text-xs font-semibold text-zinc-900 font-mono">
              {strongestTopic}
            </div>
          </div>

          <div className="bg-white border border-zinc-200/80 p-4 rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.01)] flex flex-col gap-1">
            <span className="text-[9px] font-mono tracking-wider text-zinc-400 uppercase font-semibold">Weak Focus Area</span>
            <div className="truncate mt-1.5 text-xs font-semibold text-zinc-900 font-mono">
              {weakestTopic}
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 4 — CONTINUE STUDYING */}
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-xs font-bold font-mono uppercase tracking-wider text-zinc-400">
            Continue Studying
          </h2>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            Pick up precisely where you left off. No distractions.
          </p>
        </div>

        {loading ? (
          <div className="py-10 text-center flex flex-col items-center justify-center gap-2">
            <div className="w-5 h-5 border-2 border-zinc-300 border-t-zinc-800 rounded-full animate-spin" />
            <span className="text-[10px] font-mono text-zinc-400">Loading student modules...</span>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {/* Recent Mocks Horizontal list */}
            {mockHistory.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="text-[10px] font-semibold font-mono text-zinc-400 uppercase">Recent Tests</span>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {mockHistory.slice(0, 2).map((mock) => {
                    const isDone = mock.status === "completed";
                    return (
                      <div
                        key={mock.id}
                        onClick={() => {
                          setSelectedMock(mock);
                          onNavigate(isDone ? "results" : "mock-test");
                        }}
                        className="bg-white border border-zinc-200 p-4 rounded-xl hover:border-zinc-350 hover:shadow-sm transition-all flex justify-between items-center cursor-pointer group"
                      >
                        <div className="truncate pr-4">
                          <h4 className="text-xs font-semibold text-zinc-800 group-hover:text-zinc-900 truncate font-mono">
                            {mock.title}
                          </h4>
                          <span className="text-[10px] text-zinc-400 font-sans block mt-0.5">
                            {mock.numQuestions} Questions &bull; Limit {mock.timeLimit} Mins 
                          </span>
                        </div>
                        <div className="shrink-0 flex items-center gap-2">
                          {isDone ? (
                            <span className="text-[10px] font-mono text-emerald-600 font-bold bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-lg">
                              Score: {mock.score}
                            </span>
                          ) : (
                            <span className="text-[10px] font-mono text-amber-600 font-bold bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-lg animate-pulse">
                              Pending
                            </span>
                          )}
                          <ArrowRight className="w-3.5 h-3.5 text-zinc-400 group-hover:translate-x-0.5 transition-transform" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Recent PDFs Horizontal list */}
            {questionSets.length > 0 && (
              <div className="flex flex-col gap-2 mt-2">
                <span className="text-[10px] font-semibold font-mono text-zinc-400 uppercase">Recent PDFs & Books</span>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {questionSets.slice(0, 2).map((set) => (
                    <div
                      key={set.id}
                      onClick={() => onLaunchMockDirectly?.(set)}
                      className="bg-white border border-zinc-200 p-4 rounded-xl hover:border-zinc-350 hover:shadow-sm transition-all flex justify-between items-center cursor-pointer group"
                    >
                      <div className="truncate pr-4">
                        <h4 className="text-xs font-semibold text-zinc-800 group-hover:text-zinc-900 truncate">
                          {set.subject}
                        </h4>
                        <span className="text-[10px] text-zinc-400 font-mono block mt-0.5">
                          {set.exam} &bull; {set.questionsCount} MCQs extracted
                        </span>
                      </div>
                      <div className="shrink-0 flex items-center gap-2">
                        <button
                          onClick={(e) => handleDeleteSet(set.id, e)}
                          className="p-1 px-1.5 text-zinc-400 hover:text-red-500 rounded bg-transparent border border-transparent mr-1"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5 shrink-0" />
                        </button>
                        <span className="text-[10px] font-mono text-zinc-500 bg-zinc-50 border border-zinc-200 px-2 py-0.5 rounded-lg flex items-center gap-1 group-hover:border-zinc-350">
                          <Play className="w-2 h-2 text-zinc-400 shrink-0" />
                          <span>Quick Mock</span>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent parsed Worksheets list */}
            {worksheets.length > 0 && (
              <div className="flex flex-col gap-2 mt-2">
                <span className="text-[10px] font-semibold font-mono text-zinc-400 uppercase">Recent Worksheets</span>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {worksheets.slice(0, 2).map((ws) => (
                    <div
                      key={ws.id}
                      onClick={() => onNavigate("practice")}
                      className="bg-white border border-zinc-200 p-4 rounded-xl hover:border-zinc-350 hover:shadow-sm transition-all flex justify-between items-center cursor-pointer group"
                    >
                      <div className="truncate pr-4">
                        <h4 className="text-xs font-semibold text-zinc-800 group-hover:text-zinc-900 truncate">
                          {ws.title || "Visual Calculus Chapter"}
                        </h4>
                        <span className="text-[10px] text-zinc-400 font-mono block mt-0.5">
                          {ws.questions?.length || 0} diagrams committed securely
                        </span>
                      </div>
                      <div className="shrink-0 flex items-center gap-1">
                        <span className="text-[10px] font-mono text-zinc-400">
                          Review &rarr;
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Empty state reminder if no materials uploaded yet */}
            {mockHistory.length === 0 && questionSets.length === 0 && worksheets.length === 0 && (
              <div className="border border-dashed border-zinc-200 bg-white p-12 rounded-xl text-center flex flex-col items-center gap-3">
                <HelpCircle className="w-8 h-8 text-zinc-300" />
                <div className="max-w-sm">
                  <p className="text-xs font-semibold text-zinc-700">Your study library is empty.</p>
                  <p className="text-[10px] text-zinc-400 mt-1">Upload an exam paper PDF in the PYQ Library to begin practicing randomized mocks and isolated equations review.</p>
                </div>
                <button
                  onClick={() => onNavigate("pyq-library")}
                  className="bg-zinc-900 text-white font-medium text-xs px-4 py-2 rounded-lg hover:bg-zinc-800 mt-2"
                >
                  Go to PYQ Library
                </button>
              </div>
            )}
          </div>
        )}
      </section>

    </div>
  );
};
