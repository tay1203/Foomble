import { useEffect, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Layout } from "@/components/ui/layout";
import GoogleIcon from "@/assets/google-icon-logo.svg";
import { firebaseIsConfigured } from "@/lib/firebase";
import { useAuth } from "@/auth/AuthContext";

const Login = () => {
  const { user, loading, signInWithGoogle, signOutUser, getIdToken } = useAuth();
  const [searchParams] = useSearchParams();
  const [code, setCode] = useState("");
  const [message, setMessage] = useState(searchParams.get("error") === "access" ? "We could not verify your testing access. Please try again." : "");
  const [busy, setBusy] = useState(false);
  const [approved, setApproved] = useState(false);

  useEffect(() => {
    if (!user) { setApproved(false); return; }
    let active = true;
    (async () => {
      try {
        const token = await getIdToken();
        const response = await fetch("/api/testAccessStatus", { headers: { Authorization: `Bearer ${token}` } });
        const body = await response.json().catch(() => null);
        if (active && response.ok) setApproved(body?.approved === true);
      } catch { /* The passcode form remains available if the check fails. */ }
    })();
    return () => { active = false; };
  }, [getIdToken, user]);

  const signIn = async () => {
    setBusy(true); setMessage("");
    try { await signInWithGoogle(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Google sign-in was not completed."); }
    finally { setBusy(false); }
  };
  const redeemCode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!code.trim()) return;
    setBusy(true); setMessage("");
    try {
      const token = await getIdToken();
      const response = await fetch("/api/redeemTestCode", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ code }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.message || "Invalid code.");
      window.location.assign("/chat");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to validate that code."); }
    finally { setBusy(false); }
  };

  if (approved) return <Navigate to="/chat" replace />;
  return <Layout className="bg-background text-foreground">
    <Card className="w-full max-w-sm border-border">
      <CardHeader><CardTitle className="text-xl">Foomble testing access</CardTitle><p className="text-sm text-muted-foreground">Sign in with Google, then enter the code shared with testers.</p></CardHeader>
      <CardContent>
        {!firebaseIsConfigured ? <p className="text-sm text-destructive">Authentication is not configured. Add the Firebase web-app values from <code>.env.example</code> to <code>.env.local</code>.</p>
          : !user ? <Button type="button" className="w-full gap-2" onClick={signIn} disabled={busy || loading}><img src={GoogleIcon} alt="" className="h-4 w-4" />{busy ? "Opening Google…" : "Continue with Google"}</Button>
          : <form className="space-y-4" onSubmit={redeemCode}><p className="text-sm">Signed in as <span className="font-medium">{user.email}</span></p><Input value={code} onChange={(event) => setCode(event.target.value)} placeholder="Testing passcode" autoComplete="one-time-code" /><Button type="submit" className="w-full" disabled={busy || !code.trim()}>{busy ? "Checking…" : "Unlock chat"}</Button><Button type="button" variant="ghost" className="w-full" onClick={() => signOutUser()}>Use a different account</Button></form>}
        {message && <p role="alert" className="mt-4 text-sm text-destructive text-center">{message}</p>}
      </CardContent>
      <CardFooter><p className="text-xs text-muted-foreground">Access is limited during the testing phase.</p></CardFooter>
    </Card>
  </Layout>;
};
export default Login;
