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
    <Card className="relative z-10 w-full max-w-md gap-7 rounded-[2rem] border-border bg-card py-8 shadow-lg shadow-primary/5">
      <CardHeader className="gap-3 px-7">
        <div className="w-fit rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">Private research preview</div>
        <CardTitle className="text-balance text-3xl leading-tight">Read food labels with confidence.</CardTitle>
        <p className="text-pretty text-sm leading-6 text-muted-foreground">Foomble turns dense ingredient lists and nutrition panels into clear, useful answers grounded in Malaysian food regulations.</p>
      </CardHeader>
      <CardContent>
        {!firebaseIsConfigured ? <p className="text-sm text-destructive">Authentication is not configured. Add the Firebase web-app values from <code>.env.example</code> to <code>.env.local</code>.</p>
          : !user ? <Button type="button" className="w-full gap-2" onClick={signIn} disabled={busy || loading}><img src={GoogleIcon} alt="" className="h-4 w-4" />{busy ? "Opening Google…" : "Continue with Google"}</Button>
          : <form className="space-y-4" onSubmit={redeemCode}><p className="text-sm">Signed in as <span className="font-medium">{user.email}</span></p><div className="space-y-2"><label htmlFor="testing-code" className="text-sm font-medium">Testing access code</label><Input id="testing-code" value={code} onChange={(event) => setCode(event.target.value)} placeholder="Enter your code" autoComplete="one-time-code" /></div><Button type="submit" size="lg" className="w-full rounded-xl" disabled={busy || !code.trim()}>{busy ? "Checking…" : "Unlock Foomble"}</Button><Button type="button" variant="ghost" className="w-full" onClick={() => signOutUser()}>Use a different account</Button></form>}
        {message && <p role="alert" className="mt-4 text-sm text-destructive text-center">{message}</p>}
      </CardContent>
      <CardFooter className="px-7"><p className="text-xs leading-5 text-muted-foreground">Access is limited during testing. Foomble supports informed choices, not medical diagnosis.</p></CardFooter>
    </Card>
  </Layout>;
};
export default Login;
