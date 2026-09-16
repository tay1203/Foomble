import { useEffect, useState } from "react";
import type { PropsWithChildren } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";

type AccessState = "checking" | "approved" | "denied" | "error";
export default function ProtectedRoute({ children }: PropsWithChildren) {
  const { user, loading, getIdToken } = useAuth();
  const [access, setAccess] = useState<AccessState>("checking");
  useEffect(() => {
    if (loading) return;
    if (!user) { setAccess("denied"); return; }
    let active = true;
    (async () => {
      try {
        const token = await getIdToken();
        const response = await fetch("/api/testAccessStatus", { headers: { Authorization: `Bearer ${token}` } });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.message || "Unable to check test access.");
        if (active) setAccess(body?.approved ? "approved" : "denied");
      } catch { if (active) setAccess("error"); }
    })();
    return () => { active = false; };
  }, [getIdToken, loading, user]);
  if (loading || access === "checking") return <div className="min-h-screen grid place-items-center text-sm text-muted-foreground">Checking access…</div>;
  if (access === "approved") return children;
  return <Navigate to={access === "error" ? "/?error=access" : "/"} replace />;
}
