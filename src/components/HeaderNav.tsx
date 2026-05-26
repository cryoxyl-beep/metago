import React, { useState, useRef, useEffect } from "react";
import { useAuth } from "../firebase/context";
import { AppView } from "../types";
import { 
  Flame, 
  Bell, 
  ChevronDown, 
  LogOut, 
  BookOpen, 
  CheckSquare, 
  FileText, 
  Sparkles, 
  BarChart2, 
  Menu, 
  X,
  Compass,
  User
} from "lucide-react";

interface HeaderNavProps {
  currentView: AppView;
  onNavigate: (view: AppView) => void;
  streakCount?: number;
}

export const HeaderNav: React.FC<HeaderNavProps> = ({ 
  currentView, 
  onNavigate,
  streakCount = 5 
}) => {
  const { user, logout } = useAuth();
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const profileRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setProfileOpen(false);
      }
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setNotifOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const navItems = [
    { view: "dashboard" as AppView, label: "Home", icon: Compass },
    { view: "mock-tests" as AppView, label: "Mock Tests", icon: CheckSquare },
    { view: "pyq-library" as AppView, label: "PYQ Library", icon: FileText },
    { view: "practice" as AppView, label: "Practice", icon: BookOpen },
    { view: "analytics" as AppView, label: "Analytics", icon: BarChart2 },
  ];

  const mockNotifications = [
    { id: "1", text: "Physics Mock Test compiled successfully", time: "2 hours ago", read: false },
    { id: "2", text: "New weak topic 'Thermodynamics' identified & logged", time: "1 day ago", read: true },
    { id: "3", text: "Chemistry Worksheet image parsed cleanly with high resolution", time: "3 days ago", read: true },
  ];

  return (
    <header className="sticky top-0 z-50 w-full px-4 pt-4 pb-2 bg-gradient-to-b from-[#fafaf8] via-[#fafaf8]/95 to-transparent">
      {/* Centered Floating Container */}
      <div className="max-w-6xl mx-auto bg-white/80 backdrop-blur-md border border-zinc-200/80 rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.02)] px-4 sm:px-6 py-2.5 flex items-center justify-between transition-all">
        {/* Brand / Logo */}
        <div 
          onClick={() => onNavigate("dashboard")}
          className="flex items-center gap-2.5 cursor-pointer group"
        >
          <div className="p-1.5 bg-zinc-50 border border-zinc-200 rounded-lg group-hover:bg-zinc-100 transition-colors">
            <BookOpen className="w-5 h-5 text-zinc-800" />
          </div>
          <span className="font-semibold text-base tracking-tight text-zinc-900 font-sans">
            InstaMocks
          </span>
        </div>

        {/* Desktop Web Navigation Links */}
        <nav className="hidden md:flex items-center gap-1.5">
          {navItems.map((item) => {
            const isActive = currentView === item.view || 
              (item.view === "mock-tests" && (currentView === "setup-mock" || currentView === "results")) ||
              (item.view === "pyq-library" && currentView === "upload");
            
            return (
              <button
                key={item.view}
                onClick={() => onNavigate(item.view)}
                className={`relative px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 flex items-center gap-1.5
                  ${isActive 
                    ? "bg-zinc-100 text-zinc-900 font-semibold" 
                    : "text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50"
                  }`}
              >
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Custom Actions Block (Right side) */}
        <div className="flex items-center gap-3">
          {/* Study streak indicator */}
          <div className="flex items-center gap-1 bg-amber-50 border border-amber-200/60 px-2.5 py-1 rounded-lg text-amber-700 font-medium text-xs font-mono" title="Continuous study streak">
            <Flame className="w-4 h-4 text-orange-500 fill-orange-500 animate-pulse shrink-0" />
            <span>{streakCount}d streak</span>
          </div>

          {/* Interactive Notifications Bell */}
          <div className="relative" ref={notifRef}>
            <button
              onClick={() => {
                setNotifOpen(!notifOpen);
                setProfileOpen(false);
              }}
              className="p-1.5 rounded-lg border border-zinc-200 bg-white text-zinc-500 hover:text-zinc-800 hover:bg-zinc-50 transition-colors relative"
            >
              <Bell className="w-4 h-4" />
              <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-rose-500 border border-white" />
            </button>
            
            {notifOpen && (
              <div className="absolute right-0 mt-2.5 w-72 bg-white border border-zinc-200 shadow-xl rounded-xl p-3 z-50 text-xs animate-fade-in animate-duration-150">
                <div className="flex justify-between items-center pb-2 border-b border-zinc-150 mb-2">
                  <span className="font-semibold text-zinc-800">Inbox Notifications</span>
                  <span className="text-[10px] font-mono text-zinc-400 font-semibold uppercase">Real-time stats</span>
                </div>
                <div className="flex flex-col gap-2 max-h-60 overflow-y-auto">
                  {mockNotifications.map(n => (
                    <div key={n.id} className="p-2 hover:bg-zinc-50 rounded-lg transition-colors border border-transparent hover:border-zinc-100">
                      <div className="flex justify-between items-start gap-1">
                        <p className={`leading-relaxed text-zinc-700 ${!n.read ? "font-medium" : ""}`}>{n.text}</p>
                        {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0 mt-1" />}
                      </div>
                      <span className="text-[9px] font-mono text-zinc-400 mt-1 block">{n.time}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* User profile details with Sign Out */}
          <div className="relative" ref={profileRef}>
            <button
              onClick={() => {
                setProfileOpen(!profileOpen);
                setNotifOpen(false);
              }}
              className="flex items-center gap-1.5 p-1 px-1.5 sm:px-2 rounded-xl border border-zinc-200 hover:border-zinc-350 transition-colors bg-white hover:bg-zinc-50"
            >
              {user?.photoURL ? (
                <img 
                  src={user.photoURL} 
                  alt={user.displayName || "Avatar"} 
                  referrerPolicy="no-referrer"
                  className="w-5 h-5 rounded-full border border-zinc-200 shrink-0 object-cover"
                />
              ) : (
                <div className="w-5 h-5 rounded-full bg-zinc-100 border border-zinc-200 text-[10px] font-bold text-zinc-700 flex items-center justify-center uppercase shrink-0">
                  {user?.displayName?.substring(0, 2) || "US"}
                </div>
              )}
              <ChevronDown className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
            </button>

            {profileOpen && (
              <div className="absolute right-0 mt-2.5 w-60 bg-white border border-zinc-200 shadow-xl rounded-xl p-3.5 z-50 animate-fade-in text-xs">
                <div className="flex items-center gap-3 mb-3 pb-3 border-b border-zinc-150">
                  {user?.photoURL ? (
                    <img 
                      src={user.photoURL} 
                      alt="User Avatar" 
                      referrerPolicy="no-referrer"
                      className="w-8 h-8 rounded-full border border-zinc-200 object-cover"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-zinc-100 border border-zinc-200 text-xs font-semibold text-zinc-700 flex items-center justify-center uppercase">
                      {user?.displayName?.substring(0, 2) || "U"}
                    </div>
                  )}
                  <div className="overflow-hidden">
                    <p className="font-semibold text-zinc-800 truncate leading-tight">
                      {user?.displayName || "Student Account"}
                    </p>
                    <p className="text-[10px] text-zinc-400 truncate mt-0.5">
                      {user?.email}
                    </p>
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => {
                      setProfileOpen(false);
                      onNavigate("dashboard");
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50 transition-colors font-sans"
                  >
                    Control Center
                  </button>
                  <button
                    onClick={() => {
                      logout();
                      onNavigate("auth");
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg text-rose-600 hover:bg-rose-50 transition-colors font-medium flex items-center gap-2 mt-1"
                  >
                    <LogOut className="w-3.5 h-3.5 shrink-0" />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Hamburger Mobile Menu toggle Button */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden p-1.5 rounded-lg border border-zinc-200 bg-white text-zinc-500 hover:text-zinc-800 hover:bg-zinc-50 transition-colors"
          >
            {mobileOpen ? <X className="w-4.5 h-4.5" /> : <Menu className="w-4.5 h-4.5" />}
          </button>
        </div>
      </div>

      {/* Expanded Mobile Navigation drawer */}
      {mobileOpen && (
        <div className="mt-2.5 mx-auto max-w-6xl md:hidden bg-white border border-zinc-200 rounded-xl shadow-lg p-3 flex flex-col gap-1 animate-fade-in relative z-50">
          {navItems.map((item) => {
            const isActive = currentView === item.view || 
              (item.view === "mock-tests" && (currentView === "setup-mock" || currentView === "results")) ||
              (item.view === "pyq-library" && currentView === "upload");
            
            return (
              <button
                key={item.view}
                onClick={() => {
                  onNavigate(item.view);
                  setMobileOpen(false);
                }}
                className={`w-full text-left px-3.5 py-2.5 rounded-lg text-xs font-medium transition-all flex items-center gap-2.5
                  ${isActive 
                    ? "bg-zinc-100 text-zinc-900 font-semibold" 
                    : "text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50"
                  }`}
              >
                <item.icon className="w-4 h-4" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </header>
  );
};
