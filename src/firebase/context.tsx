import React, { createContext, useContext, useEffect, useState } from "react";
import { 
  User, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  onAuthStateChanged 
} from "firebase/auth";
import { doc, getDocFromServer } from "firebase/firestore";
import { auth, db } from "./config";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  dbOnline: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [dbOnline, setDbOnline] = useState(true);

  // Validate connection to Firestore on initialization (Critical Requirement)
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, "test", "connection"));
      } catch (error) {
        if (error instanceof Error && error.message.includes("the client is offline")) {
          console.error("Please check your Firebase configuration. Client is offline.");
          setDbOnline(false);
        }
      }
    }
    testConnection();
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({
      prompt: "select_account"
    });
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Google Sign-In Error: ", error);
      throw error;
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Sign-Out Error: ", error);
      throw error;
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, signInWithGoogle, logout, dbOnline }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
