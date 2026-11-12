import Link from "next/link";
import { getUser } from "@/lib/supabase/server";
import { buttonStyles } from "./ui/button";

const MODULE_LINKS = [
  { href: "/validate", label: "Validate" },
  { href: "/dashboard", label: "Audit" },
  { href: "/monitor", label: "Monitor" },
] as const;

export async function SiteHeader() {
  const user = await getUser();
  return (
    <header className="border-b border-rule bg-sheet">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-3">
        <Link href="/" className="font-[family-name:var(--font-display)] text-lg font-extrabold [font-stretch:115%]" aria-label="Ventriva home">
          Ventriva <span className="font-medium text-ink-soft">/ Founder workspace</span>
        </Link>
        <nav aria-label="Primary" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          {MODULE_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="font-semibold text-ink-soft hover:text-ink">{link.label}</Link>
          ))}
          <Link href="/pricing" className="text-ink-soft hover:text-ink">Audit pricing</Link>
          {user ? (
            <>
              <Link href="/dashboard" className={buttonStyles({ variant: "outline", size: "sm" })}>Dashboard</Link>
              <form action="/auth/signout" method="post">
                <button className="text-ink-soft hover:text-ink">Sign out</button>
              </form>
            </>
          ) : (
            <Link href="/login" className={buttonStyles({ size: "sm" })}>Audit sign in</Link>
          )}
        </nav>
      </div>
    </header>
  );
}
