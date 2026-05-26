import React, { useEffect, useState } from "react";
import { useAuth } from "../firebase/context";
import { QuestionSet, MockTest, MarkingScheme } from "../types";
import { generateMockTest } from "../mockEngine/generator";
import { collection, query, where, getDocs, doc, setDoc, Timestamp } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../firebase/config";
import { 
  CheckSquare, 
  Settings, 
  Sliders, 
  Play, 
  AlertCircle, 
  Clock, 
  HelpCircle,
  Hash,
  Square
} from "lucide-react";

interface MockSetupPageProps {
  onStartMock: (mock: MockTest) => void;
  onNavigate: (view: any) => void;
  preSelectedSet?: QuestionSet | null;
}

export const MockSetupPage: React.FC<MockSetupPageProps> = ({ 
  onStartMock, 
  onNavigate,
  preSelectedSet
}) => {
  const { user, dbOnline } = useAuth();

  const [questionSets, setQuestionSets] = useState<QuestionSet[]>([]);
  const [selectedSetIds, setSelectedSetIds] = useState<string[]>([]);
  
  // Form fields
  const [title, setTitle] = useState("");
  const [numQuestions, setNumQuestions] = useState(10);
  const [timeLimit, setTimeLimit] = useState(30); // in minutes
  const [positiveMark, setPositiveMark] = useState(4);
  const [negativeMark, setNegativeMark] = useState(1);

  const [loading, setLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSets = async () => {
      if (!user) return;
      setLoading(true);
      try {
        if (dbOnline) {
          const q = query(collection(db, "questionSets"), where("userId", "==", user.uid));
          const snapshot = await getDocs(q);
          const list: QuestionSet[] = [];
          snapshot.forEach((doc) => {
            list.push({ ...doc.data(), id: doc.id } as QuestionSet);
          });
          setQuestionSets(list);
          
          if (preSelectedSet) {
            setSelectedSetIds([preSelectedSet.id]);
          } else if (list.length > 0) {
            setSelectedSetIds([list[0].id]);
          }
        } else {
          const localSets = JSON.parse(localStorage.getItem("mockgo_question_sets") || "[]");
          setQuestionSets(localSets);
          if (preSelectedSet) {
            setSelectedSetIds([preSelectedSet.id]);
          } else if (localSets.length > 0) {
            setSelectedSetIds([localSets[0].id]);
          }
        }
      } catch (err) {
        console.error(err);
        setError("Could not retrieve Question Sets to setup mock. Please ensure Firebase is initialized.");
      } finally {
        setLoading(false);
      }
    };
    fetchSets();
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

  // Compute maximum questions available in selected pool
  const selectedSets = questionSets.filter(s => selectedSetIds.includes(s.id));
  const maxAvailableQs = selectedSets.reduce((sum, s) => sum + s.questions.length, 0);

  // Auto-adjust num questions if exceeding pool size
  useEffect(() => {
    if (numQuestions > maxAvailableQs && maxAvailableQs > 0) {
      setNumQuestions(maxAvailableQs);
    }
  }, [maxAvailableQs, numQuestions]);

  const handleLaunch = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!user) return;
    if (selectedSetIds.length === 0) {
      setError("Please select at least 1 Question Set");
      return;
    }
    if (numQuestions <= 0) {
      setError("Please request at least 1 question");
      return;
    }

    setIsGenerating(true);

    const markingScheme: MarkingScheme = {
      positive: positiveMark,
      negative: Math.abs(negativeMark),
    };

    // Prepare content structure
    const chosenSets = selectedSets.map(s => ({
      id: s.id,
      questions: s.questions
    }));

    try {
      const generatedMock = generateMockTest({
        userId: user.uid,
        title: title.trim() || `Mock Test - ${new Date().toLocaleDateString()}`,
        questionSets: chosenSets,
        numQuestions,
        timeLimit,
        markingScheme,
      });

      // Save Mock test to pending state
      if (dbOnline) {
        const firestorePath = `mockTests/${generatedMock.id}`;
        await setDoc(doc(db, "mockTests", generatedMock.id), {
          ...generatedMock,
          createdAt: Timestamp.now()
        }).catch((err) => {
          handleFirestoreError(err, OperationType.CREATE, firestorePath);
        });
      } else {
        // Localstorage fallback
        const localMocks = JSON.parse(localStorage.getItem("mockgo_mocks") || "[]");
        const storedMock = {
          ...generatedMock,
          createdAt: new Date().toISOString()
        };
        localMocks.push(storedMock);
        localStorage.setItem("mockgo_mocks", JSON.stringify(localMocks));
      }

      // activity tracking
      const localActivity = JSON.parse(localStorage.getItem("mockgo_activity") || "[]");
      localActivity.unshift({
        type: "mock_create",
        title: `Generated Test: ${generatedMock.title}`,
        meta: `${numQuestions} questions selected`,
        date: new Date().toISOString()
      });
      localStorage.setItem("mockgo_activity", JSON.stringify(localActivity.slice(0, 15)));

      // Trigger callback with fresh mock
      onStartMock(generatedMock);
    } catch (err: any) {
      console.error(err);
      setError("Failed to compile custom mock test: " + err.message);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="w-full text-zinc-100 flex flex-col gap-6 max-w-2xl mx-auto pb-12 font-sans">
      
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-white mb-1">
          Generate Customized Mock Test
        </h2>
        <p className="text-zinc-500 text-xs">
          Select imported papers and tweak details. Our engine shuffles and picks questions randomly.
        </p>
      </div>

      {error && (
        <div className="bg-red-950/20 border border-red-900 text-red-400 p-3.5 rounded-md text-xs flex gap-3 items-start">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <p>{error}</p>
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center flex flex-col items-center gap-3">
          <div className="w-6 h-6 border-2 border-white border-t-transparent opacity-80 rounded-full animate-spin" />
          <span className="text-xs text-zinc-500">Checking question databases...</span>
        </div>
      ) : questionSets.length === 0 ? (
        <div className="border border-dashed border-zinc-900 bg-zinc-950/30 p-12 rounded-lg text-center flex flex-col items-center gap-4">
          <HelpCircle className="w-8 h-8 text-zinc-600" />
          <div>
            <p className="text-xs text-zinc-400 font-medium">No question pools found.</p>
            <p className="text-[10px] text-zinc-500 mt-1">Please upload at least 1 PYQ PDF before generating mock exam sets.</p>
          </div>
          <button 
            onClick={() => onNavigate("upload")}
            className="text-black bg-white hover:bg-zinc-200 text-xs px-3.5 py-1.5 font-semibold rounded"
          >
            Go Upload Answers & PYQ
          </button>
        </div>
      ) : (
        <form onSubmit={handleLaunch} className="flex flex-col gap-6">
          
          {/* Section 1: Question Pool Selection */}
          <div className="border border-zinc-900 bg-zinc-950 p-5 rounded-lg flex flex-col gap-3.5">
            <h3 className="text-[11px] font-bold font-mono tracking-wider text-zinc-500 uppercase">
              1. Choose Questions Sources
            </h3>

            <div className="flex flex-col gap-2 max-h-48 overflow-y-auto pr-1">
              {questionSets.map((set) => {
                const isSelected = selectedSetIds.includes(set.id);
                return (
                  <div
                    key={set.id}
                    onClick={() => handleToggleSet(set.id)}
                    className={`flex items-center gap-3 p-3 border rounded-md cursor-pointer transition-colors
                      ${isSelected 
                        ? "bg-zinc-900/50 border-zinc-700 text-white" 
                        : "bg-zinc-950 border-zinc-900 hover:border-zinc-800 text-zinc-450"}
                    `}
                  >
                    <div className="shrink-0">
                      {isSelected ? (
                        <CheckSquare className="w-4 h-4 text-white" />
                      ) : (
                        <Square className="w-4 h-4 text-zinc-600" />
                      )}
                    </div>
                    <div className="overflow-hidden">
                      <p className="text-xs font-semibold truncate leading-tight">
                        {set.subject}
                      </p>
                      <p className="text-[10px] text-zinc-500 truncate font-mono mt-0.5">
                        {set.exam} &bull; {set.year} &bull; {set.questions.length} questions
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
            {selectedSetIds.length > 0 && (
              <span className="text-[10px] font-mono text-zinc-400 mt-0.5">
                Aggregate pool: <strong className="text-white">{maxAvailableQs}</strong> total MCQs selected.
              </span>
            )}
          </div>

          {/* Section 2: Mock parameters */}
          <div className="border border-zinc-900 bg-zinc-950 p-5 rounded-lg flex flex-col gap-4">
            <h3 className="text-[11px] font-bold font-mono tracking-wider text-zinc-500 uppercase">
              2. Custom Mock Design
            </h3>

            {/* Test name input */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] text-zinc-500 font-mono uppercase">Mock Test Title</label>
              <input 
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={`Mock Session - ${new Date().toLocaleDateString()}`}
                className="bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-xs focus:outline-none focus:border-zinc-600 font-medium text-white"
              />
            </div>

            {/* Questions count & timeframe layout */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] text-zinc-500 font-mono uppercase">Number of Questions</label>
                  <span className="text-xs text-zinc-400 font-semibold font-mono">
                    {numQuestions} Qs
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <Hash className="w-4 h-4 text-zinc-600 shrink-0" />
                  <input 
                    type="range"
                    min="1"
                    max={maxAvailableQs || 10}
                    value={numQuestions}
                    onChange={(e) => setNumQuestions(Number(e.target.value))}
                    disabled={maxAvailableQs === 0}
                    className="w-full accent-white h-1 bg-zinc-905 rounded-lg appearance-none cursor-pointer"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] text-zinc-500 font-mono uppercase">Time Limit</label>
                  <span className="text-xs text-zinc-400 font-semibold font-mono">
                    {timeLimit} minutes
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <Clock className="w-4 h-4 text-zinc-600 shrink-0" />
                  <input 
                    type="range"
                    min="5"
                    max="180"
                    step="5"
                    value={timeLimit}
                    onChange={(e) => setTimeLimit(Number(e.target.value))}
                    className="w-full h-1 bg-zinc-905 rounded-lg appearance-none cursor-pointer accent-white"
                  />
                </div>
              </div>
            </div>

            {/* Marking Rules */}
            <div className="grid grid-cols-2 gap-4 border-t border-zinc-900 pt-4 mt-1">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-zinc-500 font-mono uppercase">Positive Marks (+)</label>
                <select
                  value={positiveMark}
                  onChange={(e) => setPositiveMark(Number(e.target.value))}
                  className="bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-xs text-white focus:outline-none"
                >
                  <option value={1}>+1 (Standard)</option>
                  <option value={2}>+2 Marks</option>
                  <option value={3}>+3 Marks</option>
                  <option value={4}>+4 Marks (JEE/NEET)</option>
                  <option value={10}>+10 Marks</option>
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-zinc-500 font-mono uppercase">Negative Penalty (-)</label>
                <select
                  value={negativeMark}
                  onChange={(e) => setNegativeMark(Number(e.target.value))}
                  className="bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-xs text-white focus:outline-none"
                >
                  <option value={0}>0 (No Penalty)</option>
                  <option value={0.25}>-0.25 Marks</option>
                  <option value={0.33}>-0.33 Marks</option>
                  <option value={0.5}>-0.5 Marks</option>
                  <option value={1}>-1 Mark (JEE/NEET)</option>
                  <option value={2}>-2 Marks</option>
                </select>
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={isGenerating || maxAvailableQs === 0}
            className="w-full flex items-center justify-center gap-2.5 bg-white text-black font-semibold text-sm py-3.5 rounded-md hover:bg-zinc-200 transition-colors disabled:opacity-50"
          >
            {isGenerating ? (
              <div className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <Play className="w-4 h-4 text-black shrink-0" />
                <span>Compile & Launch Mock Exam</span>
              </>
            )}
          </button>
        </form>
      )}
    </div>
  );
};
