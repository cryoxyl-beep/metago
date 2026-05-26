import React from "react";
import { useAuth } from "../firebase/context";
import { LogIn, BookOpen, AlertTriangle } from "lucide-react";

export const AuthPage: React.FC = () => {
  const { signInWithGoogle, dbOnline } = useAuth();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (e: any) {
      setError(e.message || "Failed to sign in. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-zinc-100 flex flex-col justify-center items-center px-4">
      <div className="w-full max-w-md p-8 border border-zinc-900 bg-zinc-950 rounded-lg shadow-2xl flex flex-col items-center">
        {/* Flat minimal logo branding */}
        <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg mb-6">
          <BookOpen className="w-8 h-8 text-white" />
        </div>

        <h1 className="text-2xl font-semibold tracking-tight text-white mb-2 font-sans">
          Mock Test Generator
        </h1>
        <p className="text-zinc-400 text-sm mb-8 text-center max-w-sm">
          Convert uploaded PYQ PDFs into highly structured interactive practice sessions helper. Offline-first parsing and instant local grading.
        </p>

        {!dbOnline && (
          <div className="w-full h-auto p-3 mb-6 bg-amber-950/20 border border-amber-900 text-amber-500 text-xs rounded-lg flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Firebase Project Offline</p>
              <p className="text-amber-500/80 mt-0.5">
                Using local state for development mode. Data will persist in memory.
              </p>
            </div>
          </div>
        )}

        {error && (
          <div className="w-full bg-red-950/30 border border-red-900 text-red-400 p-3 rounded-lg text-xs mb-6 text-center">
            {error}
          </div>
        )}

        <button
          onClick={handleSignIn}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 bg-white text-black font-medium text-sm py-3 px-5 rounded-md hover:bg-zinc-200 focus:outline-none transition-colors border border-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <div className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin" />
          ) : (
            <>
              <LogIn className="w-4 h-4" />
              <span>Continue with Google</span>
            </>
          )}
        </button>

        <span className="text-xs text-zinc-600 mt-8 text-center">
          Secured with Firebase Auth. No document storage on servers.
        </span>
      </div>
    </div>
  );
};
