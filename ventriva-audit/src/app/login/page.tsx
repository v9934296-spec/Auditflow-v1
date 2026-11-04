import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  const next = sp.next?.startsWith("/") && !sp.next.startsWith("//") ? sp.next : "/dashboard";
  if (await getUser()) redirect(next);
  return (
    <div className="mx-auto max-w-sm px-5 py-20">
      <h1 className="text-3xl font-extrabold">Sign in</h1>
      <p className="mt-2 text-ink-soft">Your free scan is waiting on the other side.</p>
      {sp.error ? <p role="alert" className="mt-4 text-sm text-blocked">That link is invalid or expired. Request a new one.</p> : null}
      <div className="mt-8 rounded-[var(--radius-md)] border border-rule bg-sheet p-6">
        <LoginForm next={next} />
      </div>
    </div>
  );
}
