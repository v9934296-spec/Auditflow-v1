"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

const field = "rounded-md border border-rule bg-white px-3 py-2";

export function WorkspaceValidationForm() {
  const router = useRouter();
  const requestId = useRef<string | null>(null);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <form className="my-6 grid gap-4" onSubmit={async (event) => {
      event.preventDefault();
      if (submitting.current) return;
      submitting.current = true;
      requestId.current ??= crypto.randomUUID();
      const values = Object.fromEntries(new FormData(event.currentTarget));
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/validation/start", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...values, requestId: requestId.current }),
        });
        if (!response.ok) {
          setError(await response.text());
          return;
        }
        const { id } = await response.json() as { id: string };
        router.push("/validate/reports/" + encodeURIComponent(id));
      } catch {
        setError("The request could not be confirmed. Retry without changing the form to reuse the same request.");
      } finally {
        submitting.current = false;
        setBusy(false);
      }
    }} onChange={() => { requestId.current = null; }}>
      <label className="grid gap-1">Idea name
        <input className={field} name="name" maxLength={150} required disabled={busy} />
      </label>
      <label className="grid gap-1">What are you building?
        <textarea className={field} name="concept" maxLength={4000} required rows={5} disabled={busy} />
      </label>
      <label className="grid gap-1">Who is it for? <span className="text-sm text-ink-soft">Optional</span>
        <input className={field} name="target_customer" maxLength={2000} disabled={busy} />
      </label>
      <label className="grid gap-1">Report type
        <select className={field} name="kind" disabled={busy}>
          <option value="preview">Preview</option>
          <option value="full">Full validation</option>
        </select>
      </label>
      <p className="text-sm text-ink-soft">Uses a credit from your linked validation account.</p>
      <Button className="w-fit" disabled={busy}>{busy ? "Starting…" : "Start validation"}</Button>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}
