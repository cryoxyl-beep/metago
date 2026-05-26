import React, { useEffect, useState } from "react";
import { useAuth } from "../firebase/context";
import { QuestionSet, MockTest } from "../types";
import { collection, query, where, getDocs, doc, deleteDoc } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../firebase/config";
import { 
  FileText, 
  Layers, 
  Clock, 
  Award, 
  Trash2, 
  ChevronRight, 
  PlusCircle, 
  AlertCircle, 
  Play,
  RotateCcw
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
  const [activities, setActivities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDashboardData = async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      if (dbOnline) {
        // Query user's exact QuestionSets (conforms to security rules!)
        const qSetsPath = "questionSets";
        const qSetsQuery = query(collection(db, qSetsPath), where("userId", "==", user.uid));
        const qSetsSnapshot = await getDocs(qSetsQuery).catch((err) => {
          handleFirestoreError(err, OperationType.LIST, qSetsPath);
        });
        
        const qSetsList: QuestionSet[] = [];
        qSetsSnapshot.forEach((doc) => {
          const data = doc.data();
          qSetsList.push({
            ...data,
            id: doc.id,
            createdAt: data.createdAt?.toDate() || new Date()
          } as QuestionSet);
        });
        setQuestionSets(qSetsList.sort((a,b) => b.createdAt - a.createdAt));

        // Query user's exact MockTests (conforms to security rules!)
        const mocksPath = "mockTests";
        const mocksQuery = query(collection(db, mocksPath), where("userId", "==", user.uid));
        const mocksSnapshot = await getDocs(mocksQuery).catch((err) => {
          handleFirestoreError(err, OperationType.LIST, mocksPath);
        });

        const mocksList: MockTest[] = [];
        mocksSnapshot.forEach((doc) => {
          const data = doc.data();
          mocksList.push({
            ...data,
            id: doc.id,
            createdAt: data.createdAt?.toDate() || new Date()
          } as MockTest);
        });
        setMockHistory(mocksList.sort((a,b) => b.createdAt - a.createdAt));
      } else {
        // Localstorage fallback sandbox
        const localSets = JSON.parse(localStorage.getItem("mockgo_question_sets") || "[]");
        const formattedSets = localSets.map((s: any) => ({
          ...s,
          createdAt: new Date(s.createdAt)
        }));
        setQuestionSets(formattedSets.sort((a: any, b: any) => b.createdAt - a.createdAt));

        const localMocks = JSON.parse(localStorage.getItem("mockgo_mocks") || "[]");
        const formattedMocks = localMocks.map((m: any) => ({
          ...m,
          createdAt: new Date(m.createdAt)
        }));
        setMockHistory(formattedMocks.sort((a: any, b: any) => b.createdAt - a.createdAt));
      }

      // Load activities
      const localAct = JSON.parse(localStorage.getItem("mockgo_activity") || "[]");
      setActivities(localAct);
    } catch (e: any) {
      console.error(e);
      setError("Failed to fetch dashboard records. Verify connection.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboardData();
  }, [user, dbOnline]);

  // Handle deletions cleanly
  const handleDeleteSet = async (setId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm("Are you sure you want to delete this question set?")) return;
    try {
      if (dbOnline) {
        await deleteDoc(doc(db, "questionSets", setId));
      } else {
        const localSets = JSON.parse(localStorage.getItem("mockgo_question_sets") || "[]");
        const updated = localSets.filter((s: any) => s.id !== setId);
        localStorage.setItem("mockgo_question_sets", JSON.stringify(updated));
      }
      setQuestionSets(prev => prev.filter(s => s.id !== setId));

      // Append activity log
      logActivity("delete_set", `Deleted question set: ${setId}`);
    } catch (err: any) {
      handleFirestoreError(err, OperationType.DELETE, `questionSets/${setId}`);
    }
  };

  const handleDeleteMock = async (mockId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm("Are you sure you want to delete this mock log?")) return;
    try {
      if (dbOnline) {
        await deleteDoc(doc(db, "mockTests", mockId));
      } else {
        const localMocks = JSON.parse(localStorage.getItem("mockgo_mocks") || "[]");
        const updated = localMocks.filter((m: any) => m.id !== mockId);
        localStorage.setItem("mockgo_mocks", JSON.stringify(updated));
      }
      setMockHistory(prev => prev.filter(m => m.id !== mockId));
      
      logActivity("delete_mock", `Deleted mock test record: ${mockId}`);
    } catch (err: any) {
      handleFirestoreError(err, OperationType.DELETE, `mockTests/${mockId}`);
    }
  };

  const logActivity = (type: string, title: string) => {
    const localActivity = JSON.parse(localStorage.getItem("mockgo_activity") || "[]");
    localActivity.unshift({
      type,
      title,
      meta: new Date().toLocaleTimeString(),
      date: new Date().toISOString()
    });
    localStorage.setItem("mockgo_activity", JSON.stringify(localActivity.slice(0, 15)));
    setActivities(localActivity);
  };

  // Helper Stats compilers
  const totalQuestionsPool = questionSets.reduce((sum, set) => sum + set.questionsCount, 0);
  const completedMocksCount = mockHistory.filter(m => m.status === "completed").length;
  const pendingMocksCount = mockHistory.filter(m => m.status === "pending").length;

  return (
    <div className="w-full text-zinc-100 flex flex-col gap-8 max-w-5xl mx-auto pb-12 font-sans">
      
      {/* Welcome Banner */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-white mb-1">
            Exam Dashboard
          </h1>
          <p className="text-zinc-500 text-xs">
            Review your question modules, evaluate test records, or generate immediate mock drills.
          </p>
        </div>
        
        <button
          onClick={() => onNavigate("upload")}
          className="flex items-center gap-2 bg-white text-black font-semibold text-xs px-4 py-2 rounded hover:bg-zinc-200 transition-colors"
        >
          <PlusCircle className="w-4 h-4" />
          <span>Upload New PYQ PDF</span>
        </button>
      </div>

      {error && (
        <div className="bg-red-950/20 border border-red-900 text-red-400 p-4 rounded-md text-xs flex gap-3 items-center">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* Stats Board */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 bg-zinc-950 border border-zinc-900 rounded-lg">
          <div className="flex justify-between items-center mb-2">
            <span className="text-[10px] uppercase font-mono font-bold tracking-tight text-zinc-500">PYQ Modules</span>
            <FileText className="w-4 h-4 text-zinc-600" />
          </div>
          <span className="text-2xl font-semibold text-white tracking-tight">{questionSets.length}</span>
          <p className="text-[10px] text-zinc-500 mt-1">Uploaded PDF papers</p>
        </div>

        <div className="p-4 bg-zinc-950 border border-zinc-900 rounded-lg">
          <div className="flex justify-between items-center mb-2">
            <span className="text-[10px] uppercase font-mono font-bold tracking-tight text-zinc-500">Question Pool</span>
            <Layers className="w-4 h-4 text-zinc-600" />
          </div>
          <span className="text-2xl font-semibold text-white tracking-tight">{totalQuestionsPool}</span>
          <p className="text-[10px] text-zinc-500 mt-1">Extracted MCQs available</p>
        </div>

        <div className="p-4 bg-zinc-950 border border-zinc-900 rounded-lg">
          <div className="flex justify-between items-center mb-2">
            <span className="text-[10px] uppercase font-mono font-bold tracking-tight text-zinc-500">Mocks Session Completed</span>
            <Award className="w-4 h-4 text-zinc-600" />
          </div>
          <span className="text-2xl font-semibold text-white tracking-tight">{completedMocksCount}</span>
          <p className="text-[10px] text-zinc-500 mt-1">Successfully submitted</p>
        </div>

        <div className="p-4 bg-zinc-950 border border-zinc-900 rounded-lg">
          <div className="flex justify-between items-center mb-2">
            <span className="text-[10px] uppercase font-mono font-bold tracking-tight text-zinc-500">Pending Tests</span>
            <Clock className="w-4 h-4 text-zinc-600" />
          </div>
          <span className="text-2xl font-semibold text-white tracking-tight">{pendingMocksCount}</span>
          <p className="text-[10px] text-zinc-500 mt-1">Active sessions in list</p>
        </div>
      </div>

      {loading ? (
        <div className="py-20 text-center flex flex-col items-center gap-3">
          <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
          <span className="text-xs text-zinc-500">Fetching records...</span>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          
          {/* Left / Center Grid (Tables) */}
          <div className="flex flex-col gap-8 w-full">
            
            {/* Uploaded PDF Question Sets Module */}
            <div className="flex flex-col gap-3">
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-semibold tracking-wide text-zinc-200">
                  Uploaded PYQ Question Sets
                </h3>
                <span className="text-[10px] font-mono text-zinc-500 font-semibold uppercase">
                  {questionSets.length} Modules
                </span>
              </div>

              {questionSets.length === 0 ? (
                <div className="border border-dashed border-zinc-900 bg-zinc-950/40 p-10 rounded-lg text-center">
                  <p className="text-xs text-zinc-500">No question modules available yet.</p>
                  <button 
                    onClick={() => onNavigate("upload")}
                    className="text-white hover:underline text-xs mt-2 font-medium"
                  >
                    Upload your first PYQ PDF &rarr;
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {questionSets.map((set) => (
                    <div 
                      key={set.id}
                      className="group border border-zinc-900 bg-zinc-950 hover:bg-zinc-900/30 p-4 rounded-lg flex justify-between items-center transition-colors"
                    >
                      <div className="flex items-center gap-3 overflow-hidden pr-4">
                        <div className="p-2 bg-zinc-900 border border-zinc-800 rounded text-zinc-400 shrink-0">
                          <FileText className="w-4 h-4" />
                        </div>
                        <div className="truncate">
                          <h4 className="text-xs font-semibold text-white truncate max-w-sm">
                            {set.subject}
                          </h4>
                          <span className="text-[10px] text-zinc-500 font-mono mt-0.5 block truncate">
                            {set.exam} &bull; {set.year} &bull; {set.questionsCount} MCQs
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2.5 shrink-0">
                        {onLaunchMockDirectly && (
                          <button
                            onClick={() => onLaunchMockDirectly(set)}
                            className="bg-zinc-900 hover:bg-zinc-800 border border-zinc-850 px-2 rounded py-1 flex items-center gap-1 hover:border-zinc-700 text-[10px] font-mono"
                            title="Generate a Mock directly using these questions"
                          >
                            <Play className="w-2.5 h-2.5 text-zinc-400" />
                            <span>Quick Mock</span>
                          </button>
                        )}
                        <button
                          onClick={(e) => handleDeleteSet(set.id, e)}
                          className="text-zinc-600 hover:text-red-400 p-1.5 rounded hover:bg-zinc-900 transition-colors"
                          title="Delete Module"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Created Mocks History list */}
            <div className="flex flex-col gap-3">
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-semibold tracking-wide text-zinc-200">
                  Mock Sessions History
                </h3>
                <span className="text-[10px] font-mono text-zinc-500 font-semibold uppercase">
                  {mockHistory.length} Sessions
                </span>
              </div>

              {mockHistory.length === 0 ? (
                <div className="border border-dashed border-zinc-900 bg-zinc-950/40 p-10 rounded-lg text-center">
                  <p className="text-xs text-zinc-500">No mock tests configured yet.</p>
                  <button 
                    onClick={() => onNavigate("setup-mock")}
                    className="text-white hover:underline text-xs mt-2 font-medium bg-transparent border border-transparent cursor-pointer"
                  >
                    Configure randomized Mock &rarr;
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {mockHistory.map((mock) => {
                    const isDone = mock.status === "completed";
                    return (
                      <div 
                        key={mock.id}
                        onClick={() => {
                          setSelectedMock(mock);
                          onNavigate(isDone ? "results" : "mock-test");
                        }}
                        className="group border border-zinc-900 bg-zinc-950 hover:border-zinc-800 p-4 rounded-lg flex justify-between items-center transition-colors cursor-pointer"
                      >
                        <div className="flex items-center gap-3 overflow-hidden pr-4">
                          <div className={`p-2 rounded border shrink-0 text-zinc-300
                            ${isDone ? "bg-emerald-950/20 border-emerald-900/60" : "bg-cyan-950/20 border-cyan-900/60"}
                          `}>
                            <Award className="w-4 h-4" />
                          </div>
                          <div className="truncate">
                            <h4 className="text-xs font-semibold text-white group-hover:text-zinc-200 truncate">
                              {mock.title}
                            </h4>
                            <span className="text-[10px] text-zinc-500 font-mono mt-0.5 block">
                              {mock.numQuestions} Qs &bull; Limit {mock.timeLimit} Mins &bull; {mock.markingScheme.positive}/-{mock.markingScheme.negative} scheme
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-4 shrink-0">
                          {isDone ? (
                            <div className="flex flex-col items-end shrink-0">
                              <span className="text-xs font-semibold text-emerald-400 font-mono">
                                Score: {mock.score}
                              </span>
                              <span className="text-[10px] text-zinc-500">
                                {mock.correctCount} Correct
                              </span>
                            </div>
                          ) : (
                            <span className="text-[9px] font-bold font-mono uppercase bg-cyan-950 text-cyan-400 px-2 py-0.5 rounded border border-cyan-900">
                              Pending
                            </span>
                          )}

                          <div className="flex items-center gap-1">
                            <button
                              onClick={(e) => handleDeleteMock(mock.id, e)}
                              className="text-zinc-600 hover:text-red-400 p-1.5 rounded hover:bg-zinc-900 opacity-60 hover:opacity-100 transition-all"
                              title="Delete Session"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                            <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-zinc-400 group-hover:translate-x-0.5 transition-transform" />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          </div>

        </div>
      )}
    </div>
  );
};
