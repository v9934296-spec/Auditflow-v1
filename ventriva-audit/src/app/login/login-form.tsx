"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabaseBrowser } from "@/lib/supabase/client";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const supabase = supabaseBrowser();
    const redirect = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    if (mode === "signup") {
      const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirect } });
      setMessage(error ? { tone: "error", text: error.message } : { tone: "info", text: "Check your inbox to confirm your email, then come back here." });
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMessage({ tone: "error", text: error.message });
      else {
        router.push(next);
        router.refresh();
      }
    }
    setBusy(false);
  }

  async function reset() {
    if (!email) {
      setMessage({ tone: "error", text: "Enter your email first, then choose Reset password." });
      return;
    }
    const { error } = await supabaseBrowser().auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth/callback?next=/login/update-password` });
    setMessage(error ? { tone: "error", text: error.message } : { tone: "info", text: "If that account exists, a reset link is on its way." });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex gap-1 rounded-[var(--radius-sm)] bg-paper p-1 text-sm" role="tablist">
        {(["signin", "signup"] as const).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={`flex-1 rounded-[var(--radius-sm)] py-1.5 font-semibold ${mode === m ? "bg-sheet shadow-sm" : "text-ink-soft"}`}>
            {m === "signin" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>
      <label className="block text-sm font-semibold">
        Email
        <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 block h-10 w-full rounded-[var(--radius-sm)] border border-rule bg-sheet px-3 font-normal" />
      </label>
      <label className="block text-sm font-semibold">
        Password
        <input type="password" required minLength={10} autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 block h-10 w-full rounded-[var(--radius-sm)] border border-rule bg-sheet px-3 font-normal" />
        {mode === "signup" ? <span className="mt-1 block text-xs font-normal text-ink-soft">At least 10 characters.</span> : null}
      </label>
      {message ? <p role="alert" className={`text-sm ${message.tone === "error" ? "text-blocked" : "text-verified"}`}>{message.text}</p> : null}
      <Button type="submit" className="w-full" disabled={busy}>{busy ? "Working…" : mode === "signin" ? "Sign in" : "Create account"}</Button>
      {mode === "signin" ? <button type="button" onClick={reset} className="text-sm text-ink-soft underline-offset-4 hover:underline">Reset password</button> : null}
    </form>
  );
}
