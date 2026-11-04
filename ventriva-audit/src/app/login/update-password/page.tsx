"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function UpdatePassword() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mx-auto max-w-sm px-5 py-20">
      <h1 className="text-3xl font-extrabold">Choose a new password</h1>
      <form
        className="mt-8 space-y-4 rounded-[var(--radius-md)] border border-rule bg-sheet p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          const { error: err } = await supabaseBrowser().auth.updateUser({ password });
          if (err) setError(err.message);
          else router.push("/dashboard");
        }}
      >
        <label className="block text-sm font-semibold">
          New password
          <input type="password" required minLength={10} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 block h-10 w-full rounded-[var(--radius-sm)] border border-rule px-3 font-normal" />
        </label>
        {error ? <p role="alert" className="text-sm text-blocked">{error}</p> : null}
        <Button type="submit" className="w-full">Save password</Button>
      </form>
    </div>
  );
}
