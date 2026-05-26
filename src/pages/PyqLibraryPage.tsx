import React, { useEffect, useState } from "react";
import { useAuth } from "../firebase/context";
import { QuestionSet } from "../types";
import { collection, query, where, getDocs, doc, deleteDoc } from "firebase/firestore";
import { db } from "../firebase/config";
import { 
  FileText, 
  Trash2, 
  Upload, 
  Search, 
  FolderOpen, 
  CloudRain, 
  Play, 
  ExternalLink,
  Cpu,
  Bookmark,
  Sparkles
} from "lucide-react";

interface PyqLibraryPageProps {
  onNavigate: (view: any) => void;
  onLaunchMockDirectly?: (set: QuestionSet) => void;
}

export const PyqLibraryPage: React.FC<PyqLibraryPageProps> = ({ 
  onNavigate, 
  onLaunchMockDirectly 
}) => {
  const { user, dbOnline } = useAuth();
  const [questionSets, setQuestionSets] = useState<QuestionSet[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);

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
      } else {
        const local = JSON.parse(localStorage.getItem("mockgo_question_sets") || "[]");
        setQuestionSets(local);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSets();
  }, [user, dbOnline]);

  const handleDeleteSet = async (setId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm("Permanently remove this paper from your library?")) return;
    try {
      if (dbOnline) {
        await deleteDoc(doc(db, "questionSets", setId));
      } else {
        const local = JSON.parse(localStorage.getItem("mockgo_question_sets") || "[]");
        localStorage.setItem("mockgo_question_sets", JSON.stringify(local.filter((s: any) => s.id !== setId)));
      }
      setQuestionSets(prev => prev.filter(s => s.id !== setId));
    } catch (err) {
      console.error(err);
    }
  };

  // Filter list based on search bar
  const filteredSets = questionSets.filter(set => 
    set.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
    set.exam.toLowerCase().includes(searchQuery.toLowerCase()) ||
    set.year.includes(searchQuery)
  );

  // Academic folders
  const mockFolders = [
    { title: "Syllabus Core 2026", itemsCount: 3, lastUpdated: "Today", category: "Core Studies" },
    { title: "Advanced Calculus II", itemsCount: 5, lastUpdated: "Yesterday", category: "Mathematics" },
    { title: "Organic Syntheses", itemsCount: 2, lastUpdated: "3 days ago", category: "Chemistry" },
  ];

  return (
    <div className="w-full text-zinc-800 flex flex-col gap-8 max-w-6xl mx-auto pb-16 font-sans">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-zinc-200/60 pb-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-zinc-900">
            PYQ Library Shelf
          </h1>
          <p className="text-zinc-500 text-xs sm:text-xs.1 mt-0.5">
            Manage your uploaded previous year question PDFs, analyze document extraction states, and synchronize files securely.
          </p>
        </div>

        <button
          onClick={() => onNavigate("upload")}
          className="flex items-center gap-2 bg-zinc-905 text-white font-medium text-xs px-4.5 py-2.5 rounded-xl hover:bg-zinc-800 transition-all shadow-sm"
        >
          <Upload className="w-3.5 h-3.5 shrink-0" />
          <span>Upload PDF Paper</span>
        </button>
      </div>

      {/* Modern Filter Input */}
      <div className="relative max-w-md w-full">
        <span className="absolute inset-y-0 left-3.5 flex items-center text-zinc-400">
          <Search className="w-4 h-4" />
        </span>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Filter modules by subject, exam or year..."
          className="w-full bg-white border border-zinc-200/80 rounded-xl pl-10 pr-4 py-2 text-xs focus:outline-none focus:border-zinc-400 text-zinc-800"
        />
      </div>

      {/* Grid of Subjects and Folders */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        
        {/* Left Column: Uploaded Sets */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xs font-bold font-mono uppercase tracking-wider text-zinc-400">
              Uploaded Question Modules
            </h2>
            <span className="text-[10px] font-mono text-zinc-400">{filteredSets.length} Modules</span>
          </div>

          {loading ? (
            <div className="py-14 text-center flex flex-col items-center justify-center gap-2 bg-white border border-zinc-150 rounded-2xl">
              <div className="w-5 h-5 border-2 border-zinc-300 border-t-zinc-800 rounded-full animate-spin" />
              <p className="text-[10px] font-mono text-zinc-400">Syncing database documents...</p>
            </div>
          ) : filteredSets.length === 0 ? (
            <div className="border border-dashed border-zinc-200 bg-white p-12 rounded-2xl text-center flex flex-col items-center gap-3.5">
              <FileText className="w-7 h-7 text-zinc-300" />
              <div>
                <p className="text-xs font-semibold text-zinc-700">No question modules match.</p>
                <p className="text-[10px] text-zinc-450 mt-1 max-w-xs leading-relaxed">
                  Extract exams from PDFs using the top-right button to start populating your academic workspace.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {filteredSets.map((set) => (
                <div 
                  key={set.id}
                  className="bg-white border border-zinc-200/80 p-4.5 rounded-2xl hover:border-zinc-350 hover:shadow-sm transition-all flex items-center justify-between gap-4 group"
                >
                  <div className="flex items-center gap-3.5 truncate pr-2">
                    <div className="p-3 bg-zinc-50 border border-zinc-100 rounded-xl text-zinc-500 shrink-0">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div className="truncate">
                      <h4 className="text-xs font-semibold text-zinc-800 group-hover:text-zinc-900 truncate">
                        {set.subject}
                      </h4>
                      <p className="text-[10px] text-zinc-450 font-mono mt-0.5 truncate">
                        {set.exam} &bull; {set.year} &bull; {set.questionsCount} MCQs committed
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0">
                    {onLaunchMockDirectly && (
                      <button
                        onClick={() => onLaunchMockDirectly(set)}
                        className="bg-zinc-50 hover:bg-zinc-100 border border-zinc-200 text-zinc-700 px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-[10px] font-mono tracking-tight"
                      >
                        <Play className="w-2.5 h-2.5 text-zinc-500 fill-current" />
                        <span>Quick Mock</span>
                      </button>
                    )}
                    <button
                      onClick={(e) => handleDeleteSet(set.id, e)}
                      className="p-2 text-zinc-400 hover:text-red-500 hover:bg-rose-50/50 rounded-lg transition-colors"
                      title="Archive Module"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Column: Virtual folders and extraction telemetries */}
        <div className="flex flex-col gap-8">
          
          {/* Virtual Folders Grid */}
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-xs font-bold font-mono uppercase tracking-wider text-zinc-400">
                Connected Drive Folders
              </h2>
              <p className="text-[10px] text-zinc-400 mt-0.5">Mocked academic cloud organization</p>
            </div>

            <div className="flex flex-col gap-3">
              {mockFolders.map((folder, i) => (
                <div 
                  key={i}
                  className="bg-white border border-zinc-200/85 p-4 rounded-xl flex items-center justify-between hover:border-zinc-300 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-zinc-50 text-zinc-500 rounded-lg">
                      <FolderOpen className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-zinc-800">{folder.title}</p>
                      <p className="text-[9px] text-zinc-400 mt-0.5">{folder.itemsCount} elements &bull; {folder.category}</p>
                    </div>
                  </div>
                  <ExternalLink className="w-3 h-3 text-zinc-300" />
                </div>
              ))}
            </div>
          </div>

          {/* Secure Isolated Pipeline Diagnostics */}
          <div className="bg-white border border-zinc-200 p-5 rounded-2xl shadow-[0_4px_16px_rgba(0,0,0,0.01)]">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-zinc-150">
              <Cpu className="w-4 h-4 text-emerald-600 animate-pulse shrink-0" />
              <span className="text-[10px] font-bold font-mono tracking-wider uppercase text-zinc-400">OCR & Extraction Pipeline</span>
            </div>
            
            <p className="text-[10px] text-zinc-500 leading-relaxed font-sans">
              InstaMocks implements a secure local scanning process that preserves layout diagrams and scientific formulas during parsing. Giant base64 strings are stripped automatically before landing in Firestore, maintaining performance and complying with database limits.
            </p>

            <div className="mt-4 pt-1 flex justify-between text-[10px] font-semibold font-mono text-zinc-400 uppercase">
              <span>Status: Active</span>
              <span className="text-emerald-600 font-bold">✔ High Integrity</span>
            </div>
          </div>

        </div>

      </div>

    </div>
  );
};
