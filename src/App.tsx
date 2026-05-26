import React, { useState } from "react";
import { AuthProvider, useAuth } from "./firebase/context";
import { AppView, MockTest, QuestionSet } from "./types";
import { HeaderNav } from "./components/HeaderNav";
import { AuthPage } from "./pages/AuthPage";
import { Dashboard } from "./pages/Dashboard";
import { PdfUploadPage } from "./pages/PdfUploadPage";
import { MockSetupPage } from "./pages/MockSetupPage";
import { MockInterfacePage } from "./pages/MockInterfacePage";
import { ResultsPage } from "./pages/ResultsPage";

// New Academic Command Center Views
import { MockTestsPage } from "./pages/MockTestsPage";
import { PyqLibraryPage } from "./pages/PyqLibraryPage";
import { PracticePage } from "./pages/PracticePage";
import { AnalyticsPage } from "./pages/AnalyticsPage";

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
      <div className="min-h-screen bg-[#fafaf8] text-zinc-850 flex flex-col justify-center items-center gap-3 font-sans selection:bg-zinc-200">
        <div className="w-8 h-8 border-2 border-zinc-850 border-t-transparent rounded-full animate-spin" />
        <span className="text-xs text-zinc-400 font-mono tracking-wide uppercase">Initializing scholar workspace...</span>
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
    setView("mock-tests"); // Router routes to the consolidated Mock Tests tab, opening config panel automatically
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
    <div className="min-h-screen bg-[#fafaf8] text-zinc-800 flex flex-col relative font-sans antialiased selection:bg-zinc-200">
      
      {/* Structural horizontal Header Navigation bar */}
      <HeaderNav 
        currentView={view} 
        onNavigate={(newView) => {
          setView(newView);
          if (newView !== "mock-tests" && newView !== "setup-mock") {
            setPreSelectedSet(null);
          }
        }} 
      />

      {/* Main viewport area within a clean centered container */}
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-6 overflow-y-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -3 }}
            transition={{ duration: 0.12 }}
            className="w-full h-full"
          >
            {view === "dashboard" && (
              <Dashboard 
                onNavigate={setView} 
                setSelectedMock={setSelectedMock}
                onLaunchMockDirectly={handleLaunchMockDirectly}
              />
            )}

            {view === "mock-tests" && (
              <MockTestsPage 
                onStartMock={handleStartMock}
                onNavigate={setView}
                setSelectedMock={setSelectedMock}
                preSelectedSet={preSelectedSet}
              />
            )}

            {view === "pyq-library" && (
              <PyqLibraryPage 
                onNavigate={setView}
                onLaunchMockDirectly={handleLaunchMockDirectly}
              />
            )}

            {view === "practice" && (
              <PracticePage />
            )}

            {view === "analytics" && (
              <AnalyticsPage />
            )}

            {view === "upload" && (
              <PdfUploadPage 
                onUploadSuccess={() => setView("pyq-library")} 
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
