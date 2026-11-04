"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function MonitoringToggle({ repoId, enabled, allowed }: { repoId: string; enabled: boolean; allowed: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  return (
    <label className={`inline-flex items-center gap-2 text-sm ${allowed ? "" : "opacity-60"}`} title={allowed ? undefined : "Monitoring requires Pro"}>
      <input
        type="checkbox"
        className="size-4 accent-[var(--color-ink)]"
        checked={on}
        disabled={!allowed && !on}
        onChange={async (e) => {
          const next = e.target.checked;
          setOn(next);
          setError(null);
          const res = await fetch(`/api/repos/${repoId}/monitoring`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: next }) });
          if (!res.ok) {
            setOn(!next);
            setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Could not update.");
          } else router.refresh();
        }}
      />
      Watch pushes
      {error ? <span role="alert" className="text-xs text-blocked">{error}</span> : null}
    </label>
  );
}
