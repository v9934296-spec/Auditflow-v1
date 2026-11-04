"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-fetches server data while an audit is queued or running. */
export function AutoRefresh({ everyMs = 4000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(t);
  }, [router, everyMs]);
  return null;
}
