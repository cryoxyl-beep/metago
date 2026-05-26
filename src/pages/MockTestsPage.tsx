import React, { useEffect, useState } from "react";
import { useAuth } from "../firebase/context";
import { QuestionSet, MockTest, MarkingScheme } from "../types";
import { generateMockTest } from "../mockEngine/generator";
import { collection, query, where, getDocs, doc, setDoc, deleteDoc, Timestamp } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../firebase/config";
import { 
  Play, 
  Trash2, 
  Clock, 
  HelpCircle, 
  Hash, 
  Sliders, 
  AlertCircle,
  TrendingUp,
  CheckCircle,
  BookOpen,
  ChevronRight
} from "lucide-react";

interface MockTestsPageProps {
  onStartMock: (mock: MockTest) => void;
  onNavigate: (view: any) => void;
  setSelectedMock: (mock: MockTest) => void;
  preSelectedSet?: QuestionSet | null;
}

export const MockTestsPage: React.FC<MockTestsPageProps> = ({ 
  onStartMock, 
  onNavigate,
  setSelectedMock,
  preSelectedSet = null
}) => {
  const { user, dbOnline } = useAuth();

  const [questionSets, setQuestionSets] = useState<QuestionSet[]>([]);
  const [mockHistory, setMockHistory] = useState<MockTest[]>([]);
  const [selectedSetIds, setSelectedSetIds] = useState<string[]>([]);
  
  // Custom mock parameters
  const [title, setTitle] = useState("");
  const [numQuestions, setNumQuestions] = useState(15);
  const [timeLimit, setTimeLimit] = useState(45); // in minutes
  const [positiveMark, setPositiveMark] = useState(4);
  const [negativeMark, setNegativeMark] = useState(1);
  const [showConfig, setShowConfig] = useState(false);

  const [loading, setLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPageData = async () => {
    if (!user) return;
    setLoading(true);
    try {
      if (dbOnline) {
        // Fetch QuestionSets
        const qSetsQuery = query(collection(db, "questionSets"), where("userId", "==", user.uid));
        const qSetsSnapshot = await getDocs(qSetsQuery);
        const qSetsList: QuestionSet[] = [];
        qSetsSnapshot.forEach((doc) => {
          qSetsList.push({ ...doc.data(), id: doc.id } as QuestionSet);
        });
        setQuestionSets(qSetsList);

        if (preSelectedSet) {
          setSelectedSetIds([preSelectedSet.id]);
          setShowConfig(true);
        } else if (qSetsList.length > 0) {
          setSelectedSetIds([qSetsList[0].id]);
        }

        // Fetch MockHistory
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
      } else {
        const localSets = JSON.parse(localStorage.getItem("mockgo_question_sets") || "[]");
        setQuestionSets(localSets);
        if (preSelectedSet) {
          setSelectedSetIds([preSelectedSet.id]);
          setShowConfig(true);
        } else if (localSets.length > 0) {
          setSelectedSetIds([localSets[0].id]);
        }

        const localMocks = JSON.parse(localStorage.getItem("mockgo_mocks") || "[]");
        setMockHistory(localMocks.map((m: any) => ({
          ...m,
          createdAt: new Date(m.createdAt)
        })).sort((a: any, b: any) => b.createdAt - a.createdAt));
      }
    } catch (err) {
      console.error(err);
      setError("Unable to compile mock exam logs.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPageData();
  }, [user, dbOnline, preSelectedSet]);

  const handleToggleSet = (id: string) => {
    if (selectedSetIds.includes(id)) {
      if (selectedSetIds.length > 1) {
        setSelectedSetIds(selectedSetIds.filter(sid => sid !== id));
      }
    } else {
      setSelectedSetIds([...selectedSetIds, id]);
    }
  };

  const selectedSets = questionSets.filter(s => selectedSetIds.includes(s.id));
  const maxAvailableQs = selectedSets.reduce((sum, s) => sum + s.questions.length, 0);

  useEffect(() => {
    if (numQuestions > maxAvailableQs && maxAvailableQs > 0) {
      setNumQuestions(maxAvailableQs);
    }
  }, [maxAvailableQs, numQuestions]);

  const handleLaunchMock = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!user) return;
    if (selectedSetIds.length === 0) {
      setError("Choose at least 1 Question Set to extract answers");
      return;
    }

    setIsGenerating(true);
    const markingScheme: MarkingScheme = {
      positive: positiveMark,
      negative: Math.abs(negativeMark),
    };

    const chosenSets = selectedSets.map(s => ({
      id: s.id,
      questions: s.questions
    }));

    try {
      const generatedMock = generateMockTest({
        userId: user.uid,
        title: title.trim() || `Mock Session - ${new Date().toLocaleDateString()}`,
        questionSets: chosenSets,
        numQuestions,
        timeLimit,
        markingScheme,
      });

      if (dbOnline) {
        await setDoc(doc(db, "mockTests", generatedMock.id), {
          ...generatedMock,
          createdAt: Timestamp.now()
        });
      } else {
        const localMocks = JSON.parse(localStorage.getItem("mockgo_mocks") || "[]");
        localMocks.push({
          ...generatedMock,
          createdAt: new Date().toISOString()
        });
        localStorage.setItem("mockgo_mocks", JSON.stringify(localMocks));
      }

      onStartMock(generatedMock);
    } catch (err: any) {
      console.error(err);
      setError("Failed to compile custom mock test: " + err.message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDeleteMock = async (mockId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm("Permanently archive this mock record?")) return;
    try {
      if (dbOnline) {
        await deleteDoc(doc(db, "mockTests", mockId));
      } else {
        const local = JSON.parse(localStorage.getItem("mockgo_mocks") || "[]");
        localStorage.setItem("mockgo_mocks", JSON.stringify(local.filter((m: any) => m.id !== mockId)));
      }
      setMockHistory(prev => prev.filter(m => m.id !== mockId));
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="w-full text-zinc-800 flex flex-col gap-8 max-w-6xl mx-auto pb-16 font-sans">
      
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-zinc-200/60 pb-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-zinc-900 font-sans">
            Mock Test Simulations
          </h1>
          <p className="text-zinc-500 text-xs sm:text-xs.1 mt-0.5">
            Construct time-bound chapter examinations, view historical scoring trends, or review incorrect responses.
          </p>
        </div>

        <button
          onClick={() => setShowConfig(!showConfig)}
          className="bg-zinc-900 text-white font-medium text-xs px-4.5 py-2.5 rounded-xl hover:bg-zinc-800 transition-all shadow-sm"
        >
          {showConfig ? "Hide Generator Panel" : "Create New Custom Mock"}
        </button>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 p-4 rounded-xl text-xs flex gap-3 items-center">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* Mock Config Panel Accordion */}
      {showConfig && (
        <div className="bg-white border border-zinc-200/80 p-6 rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.01)] animate-fade-in max-w-3xl">
          <div className="mb-5 pb-3 border-b border-zinc-150">
            <h3 className="text-xs font-bold font-mono uppercase tracking-wider text-zinc-400">
              Exam Parameter Setup
            </h3>
            <p className="text-[11px] text-zinc-400 mt-0.5">Tweak exam variables. Questions are auto-pulled and randomly shuffled.</p>
          </div>

          {questionSets.length === 0 ? (
            <div className="p-6 text-center border border-dashed border-zinc-200 rounded-xl bg-zinc-50/50">
              <p className="text-xs text-zinc-500 font-medium">No question source files available.</p>
              <button
                onClick={() => onNavigate("pyq-library")}
                className="text-xs font-semibold text-zinc-900 hover:underline mt-2 inline-block"
              >
                Go upload visual PYQ PDF &rarr;
              </button>
            </div>
          ) : (
            <form onSubmit={handleLaunchMock} className="flex flex-col gap-5">
              
              {/* Question Sources Grid */}
              <div className="flex flex-col gap-2">
                <label className="text-[10px] text-zinc-400 font-semibold font-mono uppercase">1. Select Subject Sources</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-40 overflow-y-auto pr-1">
                  {questionSets.map((set) => {
                    const isSelected = selectedSetIds.includes(set.id);
                    return (
                      <div
                        key={set.id}
                        onClick={() => handleToggleSet(set.id)}
                        className={`flex items-center justify-between p-3 border rounded-xl cursor-pointer transition-all
                          ${isSelected 
                            ? "bg-zinc-50 border-zinc-800 text-zinc-950 font-medium" 
                            : "bg-white border-zinc-200/85 hover:border-zinc-300 text-zinc-600"
                          }`}
                      >
                        <div className="truncate pr-3">
                          <p className="text-xs font-semibold truncate leading-tight">{set.subject}</p>
                          <p className="text-[9px] text-zinc-400 font-mono mt-0.5 truncate">{set.exam} &bull; {set.questions.length} MCQs</p>
                        </div>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}} // Done via div click
                          className="w-4 h-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Slider variables */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mt-2">
                {/* Num questions */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between items-center text-[10px] font-semibold font-mono text-zinc-400 uppercase">
                    <span>Questions Pool size</span>
                    <span className="text-zinc-800 font-bold">{numQuestions} / {maxAvailableQs || 10} Qs</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max={maxAvailableQs || 10}
                    value={numQuestions}
                    onChange={(e) => setNumQuestions(Number(e.target.value))}
                    disabled={maxAvailableQs === 0}
                    className="w-full accent-zinc-800 h-1 bg-zinc-150 rounded-lg appearance-none cursor-pointer"
                  />
                </div>

                {/* Duration */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between items-center text-[10px] font-semibold font-mono text-zinc-400 uppercase">
                    <span>Mock Duration</span>
                    <span className="text-zinc-800 font-bold">{timeLimit} minutes</span>
                  </div>
                  <input
                    type="range"
                    min="5"
                    max="180"
                    step="5"
                    value={timeLimit}
                    onChange={(e) => setTimeLimit(Number(e.target.value))}
                    className="w-full accent-zinc-800 h-1 bg-zinc-150 rounded-lg appearance-none cursor-pointer"
                  />
                </div>
              </div>

              {/* Title input */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-zinc-400 font-semibold font-mono uppercase">Mock Title Name</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={`Standard Practice Mock - ${new Date().toLocaleDateString()}`}
                  className="bg-zinc-50 border border-zinc-200/80 rounded-xl px-3.5 py-2 text-xs focus:outline-none focus:border-zinc-500 font-sans text-zinc-800"
                />
              </div>

              {/* Marking schemes select fields */}
              <div className="grid grid-cols-2 gap-4 border-t border-zinc-100 pt-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] text-zinc-400 font-semibold font-mono uppercase">Positive Score</label>
                  <select
                    value={positiveMark}
                    onChange={(e) => setPositiveMark(Number(e.target.value))}
                    className="bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-xs text-zinc-800 focus:outline-none focus:ring-1 focus:ring-zinc-400"
                  >
                    <option value={1}>+1 (Standard)</option>
                    <option value={2}>+2 Marks (Board/IB)</option>
                    <option value={4}>+4 Marks (JEE/NEET Exams)</option>
                    <option value={5}>+5 Marks</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] text-zinc-400 font-semibold font-mono uppercase">Negative Penalty</label>
                  <select
                    value={negativeMark}
                    onChange={(e) => setNegativeMark(Number(e.target.value))}
                    className="bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-xs text-zinc-800 focus:outline-none focus:ring-1 focus:ring-zinc-400"
                  >
                    <option value={0}>0 (No Penalty)</option>
                    <option value={0.25}>-0.25 Marks</option>
                    <option value={0.33}>-0.33 Marks</option>
                    <option value={1}>-1 Marks (JEE/NEET Exams)</option>
                  </select>
                </div>
              </div>

              {/* Submit triggers */}
              <button
                type="submit"
                disabled={isGenerating || maxAvailableQs === 0}
                className="w-full mt-2 flex items-center justify-center gap-2 bg-zinc-905 text-white font-medium text-xs sm:text-sm py-3.5 rounded-xl hover:bg-zinc-800 transition-colors disabled:opacity-50"
              >
                {isGenerating ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current shrink-0" />
                    <span>Compile Randomized Test Paper</span>
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      )}

      {/* Mocks List Block */}
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-xs font-bold font-mono uppercase tracking-wider text-zinc-400">
            Past Attempts & Completed Mocks
          </h2>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            Compare scorecard metrics across randomized chapters.
          </p>
        </div>

        {loading ? (
          <div className="py-20 text-center flex flex-col items-center justify-center gap-2">
            <div className="w-6 h-6 border-2 border-zinc-300 border-t-zinc-800 rounded-full animate-spin" />
            <span className="text-xs text-zinc-500 font-mono">Loading students records...</span>
          </div>
        ) : mockHistory.length === 0 ? (
          <div className="border border-dashed border-zinc-200 bg-white p-12 rounded-2xl text-center flex flex-col items-center gap-3">
            <HelpCircle className="w-7 h-7 text-zinc-300" />
            <p className="text-xs text-zinc-500 font-medium">No diagnostic mock attempts logged yet.</p>
            <p className="text-[10px] text-zinc-400 leading-relaxed max-w-sm">
              Use the New Custom Mock panel to extract and randomize worksheets for focused retention.
            </p>
            <button
              onClick={() => setShowConfig(true)}
              className="text-xs font-semibold text-zinc-900 hover:underline mt-1"
            >
              Configure model settings &rarr;
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {mockHistory.map((mock) => {
              const isDone = mock.status === "completed";
              return (
                <div
                  key={mock.id}
                  onClick={() => {
                    setSelectedMock(mock);
                    onNavigate(isDone ? "results" : "mock-test");
                  }}
                  className="bg-white border border-zinc-200 p-5 rounded-2xl hover:border-zinc-350 hover:shadow-sm transition-all cursor-pointer flex justify-between items-start group relative"
                >
                  <div className="truncate pr-4 flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${isDone ? "bg-emerald-500" : "bg-amber-500 animate-pulse"}`} />
                      <h4 className="text-xs font-semibold text-zinc-800 group-hover:text-zinc-900 truncate font-mono">
                        {mock.title}
                      </h4>
                    </div>
                    <span className="text-[10px] text-zinc-400 font-sans block leading-normal">
                      {mock.numQuestions} Qs &bull; {mock.timeLimit} Mins Duration &bull; Scheme: +{mock.markingScheme.positive}/-{mock.markingScheme.negative}
                    </span>
                    <span className="text-[9px] text-zinc-400 font-mono mt-2 block">
                      Saved: {mock.createdAt ? new Date(mock.createdAt).toLocaleDateString() : ""}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {isDone ? (
                      <div className="flex flex-col items-end">
                        <span className="text-xs font-bold text-emerald-600 font-mono">
                          Score: {mock.score}
                        </span>
                        <span className="text-[9px] text-zinc-400">
                          {mock.correctCount} correct
                        </span>
                      </div>
                    ) : (
                      <span className="text-[9px] font-bold font-mono tracking-wide uppercase px-2 py-0.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-600">
                        In progress
                      </span>
                    )}

                    <div className="flex items-center gap-0.5 ml-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteMock(mock.id, e);
                        }}
                        className="p-1 px-1.5 text-zinc-400 hover:text-red-500 rounded hover:bg-zinc-50 transition-colors"
                        title="Delete Session"
                      >
                        <Trash2 className="w-3.5 h-3.5 shrink-0" />
                      </button>
                      <ChevronRight className="w-4 h-4 text-zinc-300 group-hover:text-zinc-500 group-hover:translate-x-0.5 transition-transform" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
};
