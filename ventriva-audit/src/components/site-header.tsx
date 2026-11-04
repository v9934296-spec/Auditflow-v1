import Link from "next/link";
import { getUser } from "@/lib/supabase/server";
import { buttonStyles } from "./ui/button";

export async function SiteHeader() {
  const user = await getUser();
  return (
    <header className="border-b border-rule bg-sheet">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5">
        <Link href="/" className="font-[family-name:var(--font-display)] text-lg font-extrabold [font-stretch:115%]">
          Ventriva <span className="font-medium text-ink-soft">Audit</span>
        </Link>
        <nav className="flex items-center gap-5 text-sm">
          <Link href="/pricing" className="text-ink-soft hover:text-ink">Pricing</Link>
          <Link href="/security" className="text-ink-soft hover:text-ink">Security</Link>
          {user ? (
            <>
              <Link href="/dashboard" className={buttonStyles({ variant: "outline", size: "sm" })}>Dashboard</Link>
              <form action="/auth/signout" method="post">
                <button className="text-ink-soft hover:text-ink">Sign out</button>
              </form>
            </>
          ) : (
            <Link href="/login" className={buttonStyles({ size: "sm" })}>Sign in</Link>
          )}
        </nav>
      </div>
    </header>
  );
}
