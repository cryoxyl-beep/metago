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
    <div className="min-h-screen bg-[#fafaf8] text-zinc-800 flex flex-col justify-center items-center px-4 font-sans selection:bg-zinc-200">
      <div className="w-full max-w-md p-8 border border-zinc-200 bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.02)] flex flex-col items-center">
        {/* Flat minimal logo branding */}
        <div className="p-3 bg-zinc-50 border border-zinc-200 rounded-xl mb-6">
          <BookOpen className="w-8 h-8 text-zinc-700" />
        </div>

        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 mb-2 font-sans">
          InstaMocks
        </h1>
        <p className="text-zinc-500 text-sm mb-8 text-center max-w-sm leading-relaxed">
          Your personal academic companion. Convert class notes, papers, and PDFs into customized, distraction-free mock tests instantly.
        </p>

        {!dbOnline && (
          <div className="w-full h-auto p-3 mb-6 bg-amber-50/50 border border-amber-200 text-amber-700 text-xs rounded-lg flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Firebase Project Saved Locally</p>
              <p className="text-amber-600/90 mt-0.5">
                Now operating securely using local sandboxed storage. Your worksheets remain local to your computer.
              </p>
            </div>
          </div>
        )}

        {error && (
          <div className="w-full bg-rose-50 border border-rose-200 text-rose-700 p-3 rounded-lg text-xs mb-6 text-center">
            {error}
          </div>
        )}

        <button
          onClick={handleSignIn}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 bg-zinc-900 text-white font-medium text-sm py-3 px-5 rounded-xl hover:bg-zinc-800 focus:outline-none transition-all shadow-sm active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <>
              <LogIn className="w-4 h-4" />
              <span>Continue with Google</span>
            </>
          )}
        </button>

        <span className="text-xs text-zinc-400 mt-8 text-center block">
          Secured with Firebase Auth & Cloud Storage.
        </span>
      </div>
    </div>
  );
};
