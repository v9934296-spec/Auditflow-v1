"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { VALIDATION_APP_URL } from "@/lib/product/modules";

type Summary = { id: string; name: string; status: string; kind: "preview" | "full"; created_at: string };
type Status = "loading" | "signed_out" | "unlinked" | "linked" | "unavailable";

export function AccountLinkPanel() {
  const [status, setStatus] = useState<Status>("loading");
  const [items, setItems] = useState<Summary[]>([]);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const refresh = async () => {
    try {
      const response = await fetch("/api/validation/analyses", { cache: "no-store" });
      if (response.status === 401) { setStatus("signed_out"); return; }
      if (response.status === 409) { setStatus("unlinked"); setItems([]); return; }
      if (!response.ok) { setStatus("unavailable"); return; }
      const value = await response.json();
      setItems(Array.isArray(value.analyses) ? value.analyses : []);
      setStatus("linked");
    } catch {
      setStatus("unavailable");
    }
  };

  useEffect(() => { void refresh(); }, []);

  const redeem = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/validation/link", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      if (response.ok) {
        setCode("");
        setNotice("Accounts linked for read-only validation summaries. Billing and sign-in remain separate.");
        await refresh();
      } else if (response.status === 409) {
        setCode("");
        setNotice("This code cannot be used. Generate a new code from your Ventriva account if needed.");
        await refresh();
      } else if (response.status === 401) {
        setStatus("signed_out");
      } else {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        setNotice(payload.error ?? "Account linking is unavailable. No subscriptions or saved reports have been changed.");
      }
    } catch {
      setNotice("Connection failed. Check account status before generating another code.");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!window.confirm("Disconnect Ventriva from this AuditFlow account? Your reports and subscriptions remain in their original applications.")) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/validation/link", { method: "DELETE" });
      if (!response.ok) { setNotice("Unable to disconnect. Try again."); return; }
      setNotice("Account link revoked. Existing reports and purchases remain unchanged.");
      await refresh();
    } catch {
      setNotice("Unable to disconnect. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-8 rounded-[var(--radius-md)] border border-rule bg-sheet p-6" aria-labelledby="link-accounts-heading">
      <h2 id="link-accounts-heading" className="text-xl font-bold">Connect your Ventriva accounts</h2>
      <p className="mt-2 text-sm text-ink-soft">
        Account linking requires access to both sign-ins. It enables read-only validation report summaries,
        not shared payment credits or automatic account migration.
      </p>
      {status === "loading" ? <p role="status" className="mt-4 text-sm">Checking account link…</p> : null}
      {status === "signed_out" ? (
        <p className="mt-4 text-sm">To connect accounts, <Link href="/login?next=/validate" className="underline">sign in to AuditFlow</Link> first.</p>
      ) : null}
      {status === "unavailable" ? (
        <p role="status" className="mt-4 text-sm text-ink-soft">The validation connection is not configured or currently unavailable. Your existing accounts remain separate.</p>
      ) : null}
      {status === "unlinked" ? (
        <form onSubmit={redeem} className="mt-5 flex max-w-xl flex-col gap-3">
          <label htmlFor="legacy-link-code" className="text-sm font-semibold">One-time code from the signed-in Ventriva dashboard</label>
          <input id="legacy-link-code" name="code" type="text" autoComplete="off" autoCapitalize="none" spellCheck={false}
            maxLength={32} minLength={32} required pattern="[A-Za-z0-9_-]{32}"
            value={code} onChange={(e) => setCode(e.target.value)}
            className="w-full rounded-[var(--radius-sm)] border border-rule bg-paper px-3 py-2 font-mono text-sm focus:border-ink"
            placeholder="Enter your 32-character code"/>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={busy || code.trim().length !== 32} className="rounded-[var(--radius-sm)] bg-ink px-5 py-2 font-semibold text-white disabled:opacity-50">Connect accounts</button>
            <a href={VALIDATION_APP_URL} className="text-sm font-semibold underline underline-offset-4">Open Ventriva to generate code ↗</a>
          </div>
          <p className="text-xs text-ink-soft">The code expires in 10 minutes and works once. Never share it with another person.</p>
        </form>
      ) : null}
      {status === "linked" ? (
        <div className="mt-5">
          <p className="text-sm font-semibold text-verified">Validation account linked for read-only summaries.</p>
          {items.length ? (
            <ul className="mt-3 divide-y divide-rule rounded-[var(--radius-sm)] border border-rule">
              {items.map((item) => (
                <li key={item.id} className="flex flex-wrap justify-between gap-2 p-3 text-sm">
                  <span className="font-semibold">{item.name}</span>
                  <span className="text-ink-soft">{item.kind} / {item.status}</span>
                </li>
              ))}
            </ul>
          ) : <p className="mt-2 text-sm text-ink-soft">No saved validation summaries yet.</p>}
          <button type="button" disabled={busy} onClick={revoke} className="mt-4 text-sm font-semibold underline underline-offset-4 disabled:opacity-50">Disconnect Ventriva account</button>
        </div>
      ) : null}
      {notice ? <p role="status" className="mt-4 text-sm text-ink-soft">{notice}</p> : null}
    </section>
  );
}
