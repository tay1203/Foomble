import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { PropsWithChildren } from "react";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import type { User } from "firebase/auth";
import { auth, firebaseIsConfigured, googleProvider } from "@/lib/firebase";

type AuthContextValue = { user: User | null; loading: boolean; signInWithGoogle: () => Promise<void>; signOutUser: () => Promise<void>; getIdToken: () => Promise<string>; };
const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!auth) { setLoading(false); return; }
    return onAuthStateChanged(auth, (nextUser) => { setUser(nextUser); setLoading(false); });
  }, []);
  const value = useMemo<AuthContextValue>(() => ({
    user, loading,
    signInWithGoogle: async () => { if (!auth || !firebaseIsConfigured) throw new Error("Firebase authentication has not been configured."); await signInWithPopup(auth, googleProvider); },
    signOutUser: async () => { if (auth) await signOut(auth); },
    getIdToken: async () => { if (!user) throw new Error("Sign in is required."); return user.getIdToken(); },
  }), [loading, user]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider.");
  return context;
}
