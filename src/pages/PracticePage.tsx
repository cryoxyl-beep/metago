import React, { useState } from "react";
import { 
  Flame, 
  HelpCircle, 
  Layers, 
  Cpu, 
  Bookmark, 
  Play, 
  Clock, 
  ChevronRight, 
  Award,
  BookOpen
} from "lucide-react";

export const PracticePage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<"flashcards" | "formulas" | "speed" | "notebook">("flashcards");

  // Mock Premium Science Flashcards
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);

  const flashcards = [
    { question: "What is the physical meaning of the divergence of a magnetic field (∇ · B = 0)?", answer: "It indicates that magnetic monopoles do not exist; magnetic lines of force always complete closed loops." },
    { question: "State the First Law of Thermodynamics in equation form.", answer: "dU = dQ - dW (Change in internal energy equals heat added minus work done by the system)." },
    { question: "Explain the Heisenberg Uncertainty Principle.", answer: "It is physically impossible to simultaneously know both the precise position and exact momentum of a subatomic particle (Δx · Δp ≥ ℏ/2)." },
    { question: "What is the role of a catalyst in a chemical synthesis?", answer: "It lowers the activation energy of a chemical reaction, increasing reaction speed without being consumed itself." }
  ];

  const formulas = [
    { name: "Einstein's Mass-Energy Relation", equation: "E = mc²", field: "Relativistic Physics" },
    { name: "Schrödinger Wave Equation (Time Independent)", equation: "Ĥψ = Eψ", field: "Quantum Mechanics" },
    { name: "Euler's Identity", equation: "e^(iπ) + 1 = 0", field: "Pure Mathematics" },
    { name: "Ideal Gas Law Equation", equation: "PV = nRT", field: "Thermodynamics" },
    { name: "Maxwell's Ampere Law", equation: "∇ × B = μ₀J + μ₀ε₀(∂E/∂t)", field: "Electromagnetism" }
  ];

  // Interactive Speed Drill States
  const [quizState, setQuizState] = useState<"ready" | "running" | "ended">("ready");
  const [drillScore, setDrillScore] = useState(0);
  const [currentQuizIdx, setCurrentQuizIdx] = useState(0);
  const [drillTime, setDrillTime] = useState(15); // s

  const quickQuestions = [
    { q: "What is the speed of light in vacuum?", options: ["3 x 10^8 m/s", "3 x 10^6 m/s", "1.5 x 10^8 m/s"], correct: 0 },
    { q: "In physics, what is the derivative of velocity relative to time?", options: ["Displacement", "Acceleration", "Jerk"], correct: 1 },
    { q: "Which chemical element contains atomic number 1?", options: ["Helium", "Lithium", "Hydrogen"], correct: 2 },
  ];

  const handleSelectDrillOption = (idx: number) => {
    if (idx === quickQuestions[currentQuizIdx].correct) {
      setDrillScore(prev => prev + 1);
    }
    if (currentQuizIdx < quickQuestions.length - 1) {
      setCurrentQuizIdx(prev => prev + 1);
    } else {
      setQuizState("ended");
    }
  };

  const startDrill = () => {
    setDrillScore(0);
    setCurrentQuizIdx(0);
    setQuizState("running");
  };

  const mistakeNotes = [
    { id: "1", qText: "A stone is thrown vertically upwards. At the highest point, what is its velocity and acceleration?", correct: "Velocity is zero, acceleration is downwards at 9.8 m/s².", wrongChoice: "Both are zero (common physics misconception)." },
    { id: "2", qText: "State the hybridisation of carbon in methane.", correct: "sp³ hybridization.", wrongChoice: "sp² hybridization due to molecular symmetric distortion." }
  ];

  return (
    <div className="w-full text-zinc-800 flex flex-col gap-8 max-w-6xl mx-auto pb-16 font-sans">
      
      {/* Header */}
      <div className="border-b border-zinc-200/60 pb-5">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-zinc-900">
          Intellectual Practice Hall
        </h1>
        <p className="text-zinc-500 text-xs sm:text-xs.1 mt-0.5">
          Reinforce your academic retention using active recall drills, formula flash registries, or mistake logs.
        </p>
      </div>

      {/* Navigation tabs */}
      <div className="flex border-b border-zinc-200/80 gap-3">
        {[
          { key: "flashcards" as const, label: "Active Flashcards", icon: Layers },
          { key: "formulas" as const, label: "Formula Directories", icon: BookOpen },
          { key: "speed" as const, label: "Interactive Speed Drills", icon: Clock },
          { key: "notebook" as const, label: "Mistake Notebook", icon: Bookmark },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => {
              setActiveTab(tab.key);
              setIsFlipped(false);
            }}
            className={`px-3 py-2 text-xs font-medium border-b-2 -mb-0.5 transition-all flex items-center gap-1.5
              ${activeTab === tab.key
                ? "border-zinc-850 text-zinc-900 font-bold"
                : "border-transparent text-zinc-400 hover:text-zinc-800"
              }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Active Tab Contents */}
      <div className="max-w-3xl">
        
        {/* Flashcards View */}
        {activeTab === "flashcards" && (
          <div className="flex flex-col gap-6 animate-fade-in">
            <div className="bg-white border border-zinc-200/80 p-5 rounded-2xl shadow-[0_4px_16px_rgba(0,0,0,0.01)]">
              <span className="text-[9px] font-mono tracking-wider text-zinc-400 uppercase font-semibold">Self-correction flashcard {currentCardIndex + 1} of {flashcards.length}</span>
              
              {/* Flippable card body */}
              <div 
                onClick={() => setIsFlipped(!isFlipped)}
                className="my-6 min-h-48 border border-zinc-150 rounded-2xl bg-zinc-50 hover:bg-zinc-100/40 p-6 flex flex-col justify-center items-center text-center cursor-pointer transition-all duration-300 relative select-none"
              >
                {!isFlipped ? (
                  <div className="animate-fade-in flex flex-col items-center gap-3">
                    <p className="text-sm font-semibold text-zinc-800 font-mono tracking-tight max-w-xl">
                      {flashcards[currentCardIndex].question}
                    </p>
                    <span className="text-[10px] font-mono text-zinc-400 block mt-2">Click card to reveal standard explanation</span>
                  </div>
                ) : (
                  <div className="animate-fade-in flex flex-col items-center gap-2">
                    <span className="text-[9px] font-mono text-emerald-600 font-semibold uppercase">Explanatory Note Correct</span>
                    <p className="text-xs text-zinc-650 max-w-xl leading-relaxed mt-2">
                      {flashcards[currentCardIndex].answer}
                    </p>
                    <span className="text-[10px] font-mono text-zinc-400 block mt-3">Click card to flip back</span>
                  </div>
                )}
              </div>

              {/* Slider Controls */}
              <div className="flex justify-between items-center bg-zinc-50/50 p-2.5 rounded-xl border border-zinc-100">
                <button
                  disabled={currentCardIndex === 0}
                  onClick={() => {
                    setCurrentCardIndex(prev => prev - 1);
                    setIsFlipped(false);
                  }}
                  className="px-3 py-1.5 rounded-lg border border-zinc-200 bg-white text-xs text-zinc-650 hover:bg-zinc-50 disabled:opacity-50"
                >
                  &larr; Previous Card
                </button>

                <button
                  disabled={currentCardIndex === flashcards.length - 1}
                  onClick={() => {
                    setCurrentCardIndex(prev => prev + 1);
                    setIsFlipped(false);
                  }}
                  className="px-3 py-1.5 rounded-lg border border-zinc-200 bg-white text-xs text-zinc-650 hover:bg-zinc-50 disabled:opacity-50"
                >
                  Next Card &rarr;
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Formulas Cheat sheet View */}
        {activeTab === "formulas" && (
          <div className="flex flex-col gap-4 animate-fade-in">
            <div className="bg-white border border-zinc-200/80 p-5 rounded-2xl shadow-[0_4px_16px_rgba(0,0,0,0.01)] flex flex-col gap-4">
              <span className="text-[9px] font-mono tracking-wider text-zinc-400 uppercase font-semibold">Standard Reference equations</span>
              
              <div className="flex flex-col gap-3">
                {formulas.map((formula, i) => (
                  <div key={i} className="p-4 border border-zinc-150 rounded-xl bg-zinc-50/50 flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                    <div>
                      <span className="text-[9px] bg-zinc-200 text-zinc-600 font-mono px-2 py-0.5 rounded-lg uppercase tracking-tight">{formula.field}</span>
                      <h4 className="text-xs font-semibold text-zinc-800 mt-1.5">{formula.name}</h4>
                    </div>
                    <div className="text-sm font-mono text-zinc-950 bg-white border border-zinc-150 px-3.5 py-2 rounded-xl text-center self-start sm:self-center">
                      {formula.equation}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Interactive Speed Drills View */}
        {activeTab === "speed" && (
          <div className="flex flex-col gap-5 animate-fade-in">
            <div className="bg-white border border-zinc-200/80 p-5 rounded-2xl shadow-[0_4px_16px_rgba(0,0,0,0.01)]">
              <span className="text-[9px] font-mono tracking-wider text-zinc-400 uppercase font-semibold">Simulated speed countdown game</span>
              
              {quizState === "ready" && (
                <div className="py-8 text-center flex flex-col items-center gap-4">
                  <Clock className="w-8 h-8 text-zinc-300 animate-pulse" />
                  <div>
                    <h3 className="text-xs font-bold text-zinc-800">Ready to test response speeds?</h3>
                    <p className="text-[10px] text-zinc-400 mt-1 max-w-sm mx-auto">Analyze multiple choice chemistry and physics concepts rapidly under constraints. No scoring penalties applied.</p>
                  </div>
                  <button
                    onClick={startDrill}
                    className="bg-zinc-900 hover:bg-zinc-800 text-white font-medium text-xs px-4 py-2 rounded-lg"
                  >
                    Launch Speed Drills
                  </button>
                </div>
              )}

              {quizState === "running" && (
                <div className="py-4 animate-fade-in">
                  <div className="flex justify-between text-[10px] text-zinc-400 font-mono mb-3">
                    <span>QUIZ QUESTION {currentQuizIdx + 1} OF {quickQuestions.length}</span>
                    <span className="text-zinc-700 font-bold">ACCURACY TRACKER</span>
                  </div>

                  <p className="text-xs font-bold font-mono text-zinc-800 mb-5 leading-normal">
                    {quickQuestions[currentQuizIdx].q}
                  </p>

                  <div className="flex flex-col gap-2">
                    {quickQuestions[currentQuizIdx].options.map((opt, oIdx) => (
                      <button
                        key={oIdx}
                        onClick={() => handleSelectDrillOption(oIdx)}
                        className="w-full text-left p-3 border border-zinc-150 bg-zinc-50 hover:bg-zinc-100 text-xs text-zinc-700 hover:text-zinc-950 transition-all rounded-lg"
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {quizState === "ended" && (
                <div className="py-6 text-center flex flex-col items-center gap-3">
                  <Award className="w-8 h-8 text-emerald-600 animate-bounce" />
                  <p className="text-xs font-bold text-zinc-800">Speed Drill Complete</p>
                  <p className="text-[10px] text-zinc-400">Total accuracy score calculated: <strong className="text-zinc-800">{drillScore} / {quickQuestions.length}</strong> correct responses!</p>
                  <button
                    onClick={startDrill}
                    className="text-xs font-semibold text-zinc-900 hover:underline mt-2"
                  >
                    Retry Simulator &rarr;
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Mistake Notebook View */}
        {activeTab === "notebook" && (
          <div className="flex flex-col gap-4 animate-fade-in">
            <div className="bg-white border border-zinc-200/80 p-5 rounded-2xl shadow-[0_4px_16px_rgba(0,0,0,0.01)] flex flex-col gap-4">
              <span className="text-[9px] font-mono tracking-wider text-zinc-400 uppercase font-semibold">Active Self-assessment log</span>
              
              <div className="flex flex-col gap-3">
                {mistakeNotes.map((note) => (
                  <div key={note.id} className="p-4 border border-rose-100 rounded-xl bg-rose-50/20">
                    <h4 className="text-xs font-bold text-zinc-800 leading-normal">{note.qText}</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3 pt-3 border-t border-rose-100/40">
                      <div>
                        <span className="text-[9px] font-mono uppercase tracking-wider text-rose-600 font-semibold">Incorrect response logged</span>
                        <p className="text-[10px] text-zinc-500 mt-1">{note.wrongChoice}</p>
                      </div>
                      <div>
                        <span className="text-[9px] font-mono uppercase tracking-wider text-emerald-600 font-semibold">Verified correct copy</span>
                        <p className="text-[10px] text-zinc-700 font-medium mt-1">{note.correct}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

      </div>

    </div>
  );
};
