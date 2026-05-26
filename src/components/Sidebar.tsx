import React from "react";
import { useAuth } from "../firebase/context";
import { AppView } from "../types";
import { 
  BarChart2, 
  Upload, 
  Settings, 
  LogOut, 
  FileText, 
  CheckSquare, 
  Menu, 
  X,
  BookOpen
} from "lucide-react";

interface SidebarProps {
  currentView: AppView;
  onNavigate: (view: AppView) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentView, onNavigate }) => {
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = React.useState(false);

  const navItems = [
    { view: "dashboard" as AppView, label: "Dashboard", icon: BarChart2 },
    { view: "upload" as AppView, label: "Upload Answers & PYQ", icon: Upload },
    { view: "setup-mock" as AppView, label: "Generate Mock", icon: CheckSquare },
  ];

  return (
    <>
      {/* Mobile top bar */}
      <div className="md:hidden w-full bg-zinc-950 border-b border-zinc-900 px-4 py-3 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-white animate-pulse" />
          <span className="font-semibold text-sm tracking-widest uppercase">MockGo</span>
        </div>
        <button 
          onClick={() => setMobileOpen(!mobileOpen)}
          className="p-1 px-2 border border-zinc-950 bg-zinc-950 text-zinc-300 rounded hover:bg-zinc-900 border-zinc-900 text-sm flex items-center"
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Main sidebar container (hidden on mobile unless open) */}
      <aside 
        className={`fixed md:sticky top-0 left-0 h-screen w-64 border-r border-zinc-900 bg-zinc-950 shrink-0 z-40 transition-transform duration-200 flex flex-col justify-between p-5 
        ${mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}
      >
        <div className="flex flex-col gap-8">
          {/* Logo */}
          <div className="flex items-center gap-3 px-2">
            <div className="p-1.5 bg-zinc-900 border border-zinc-800 rounded">
              <BookOpen className="w-5 h-5 text-white" />
            </div>
            <div>
              <span className="font-semibold text-sm tracking-wide text-white font-sans block">MockGo</span>
              <span className="text-zinc-500 text-xs tracking-tight">PYQ Mock Platform</span>
            </div>
          </div>

          {/* Nav Items */}
          <nav className="flex flex-col gap-1.5">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentView === item.view;
              return (
                <button
                  key={item.view}
                  onClick={() => {
                    onNavigate(item.view);
                    setMobileOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded text-sm font-medium transition-all text-left group
                  ${isActive 
                    ? "bg-zinc-900 text-white border border-zinc-800" 
                    : "text-zinc-400 hover:text-white hover:bg-zinc-900/50 border border-transparent"
                  }`}
                >
                  <Icon className={`w-4 h-4 transition-transform group-hover:scale-105 ${isActive ? "text-white" : "text-zinc-500 group-hover:text-zinc-300"}`} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* User profile section at base */}
        <div className="border-t border-zinc-900 pt-4 flex flex-col gap-2">
          {user && (
            <div className="flex items-center gap-3 px-2 py-1 mb-2">
              {user.photoURL ? (
                <img 
                  src={user.photoURL} 
                  alt={user.displayName || "User Avatar"} 
                  referrerPolicy="no-referrer"
                  className="w-8 h-8 rounded-full border border-zinc-800"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-zinc-900 border border-zinc-800 text-xs font-semibold text-zinc-300 flex items-center justify-center uppercase">
                  {user.displayName?.substring(0, 2) || user.email?.substring(0, 2) || "U"}
                </div>
              )}
              <div className="overflow-hidden">
                <p className="text-xs font-medium text-white truncate break-words">
                  {user.displayName || "User Account"}
                </p>
                <p className="text-[10px] text-zinc-500 truncate">
                  {user.email}
                </p>
              </div>
            </div>
          )}

          <button
            onClick={() => {
              logout();
              onNavigate("auth");
            }}
            className="w-full flex items-center gap-3 px-3 py-2 rounded text-zinc-400 hover:text-red-400 hover:bg-zinc-900/40 text-xs font-medium transition-colors border border-transparent border-dashed hover:border-zinc-800/10"
          >
            <LogOut className="w-4 h-4 text-zinc-500" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Overlay for mobile only */}
      {mobileOpen && (
        <div 
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 bg-black/60 z-30 md:hidden"
        />
      )}
    </>
  );
};
