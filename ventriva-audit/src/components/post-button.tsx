"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, type ButtonProps } from "./ui/button";

/**
 * POSTs JSON to an API route. If the response contains `url`, navigates there (Stripe);
 * if it contains `id` and `redirectTo` is set, navigates to `${redirectTo}/${id}`; otherwise refreshes.
 */
export function PostButton({
  endpoint,
  body,
  redirectTo,
  children,
  pendingLabel,
  ...rest
}: Omit<ButtonProps, "onClick"> & { endpoint: string; body?: unknown; redirectTo?: string; pendingLabel?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        {...rest}
        disabled={pending || rest.disabled}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
            const json = (await res.json().catch(() => ({}))) as { url?: string; id?: string; error?: string };
            if (!res.ok) {
              setError(json.error ?? "Something went wrong. Try again.");
              return;
            }
            if (json.url) window.location.assign(json.url);
            else if (json.id && redirectTo) router.push(`${redirectTo}/${json.id}`);
            else router.refresh();
          })
        }
      >
        {pending ? (pendingLabel ?? "Working…") : children}
      </Button>
      {error ? <span role="alert" className="max-w-xs text-xs text-blocked">{error}</span> : null}
    </span>
  );
}
