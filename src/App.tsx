import React, { useState } from "react";
import { AuthProvider, useAuth } from "./firebase/context";
import { AppView, MockTest, QuestionSet } from "./types";
import { Sidebar } from "./components/Sidebar";
import { AuthPage } from "./pages/AuthPage";
import { Dashboard } from "./pages/Dashboard";
import { PdfUploadPage } from "./pages/PdfUploadPage";
import { MockSetupPage } from "./pages/MockSetupPage";
import { MockInterfacePage } from "./pages/MockInterfacePage";
import { ResultsPage } from "./pages/ResultsPage";
import { motion, AnimatePresence } from "motion/react";

function AppContent() {
  const { user, loading } = useAuth();
  
  // High-level navigation router state
  const [view, setView] = useState<AppView>("dashboard");
  const [selectedMock, setSelectedMock] = useState<MockTest | null>(null);
  
  // Handle launching a mock directly from a specific QuestionSet
  const [preSelectedSet, setPreSelectedSet] = useState<QuestionSet | null>(null);

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-zinc-100 flex flex-col justify-center items-center gap-3">
        <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
        <span className="text-xs text-zinc-500 font-mono tracking-wide uppercase">Initializing mock environments...</span>
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  // Handle start test trigger
  const handleStartMock = (mock: MockTest) => {
    setSelectedMock(mock);
    setView("mock-test");
    setPreSelectedSet(null);
  };

  // Handle submit mock trigger
  const handleFinishMock = (completedMock: MockTest) => {
    setSelectedMock(completedMock);
    setView("results");
  };

  const handleLaunchMockDirectly = (set: QuestionSet) => {
    setPreSelectedSet(set);
    setView("setup-mock");
  };

  // If in fullscreen test taking mode, hide standard layout margins and sidebar
  if (view === "mock-test" && selectedMock) {
    return (
      <MockInterfacePage 
        mock={selectedMock} 
        onFinishMock={handleFinishMock} 
      />
    );
  }

  return (
    <div className="min-h-screen bg-black text-zinc-100 flex flex-col md:flex-row relative">
      {/* Structural Sidebar Navigation */}
      <Sidebar 
        currentView={view} 
        onNavigate={(newView) => {
          setView(newView);
          if (newView !== "setup-mock") {
            setPreSelectedSet(null);
          }
        }} 
      />

      {/* Main viewport area */}
      <main className="flex-1 p-6 md:p-10 overflow-y-auto h-screen">
        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="w-full h-full"
          >
            {view === "dashboard" && (
              <Dashboard 
                onNavigate={setView} 
                setSelectedMock={setSelectedMock}
                onLaunchMockDirectly={handleLaunchMockDirectly}
              />
            )}

            {view === "upload" && (
              <PdfUploadPage 
                onUploadSuccess={() => setView("dashboard")} 
              />
            )}

            {view === "setup-mock" && (
              <MockSetupPage 
                onStartMock={handleStartMock} 
                onNavigate={setView}
                preSelectedSet={preSelectedSet}
              />
            )}

            {view === "results" && selectedMock && (
              <ResultsPage 
                mock={selectedMock} 
                onNavigateHome={() => {
                  setSelectedMock(null);
                  setView("dashboard");
                }} 
              />
            )}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
