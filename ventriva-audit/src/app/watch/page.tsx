import Link from "next/link";
import { buttonStyles } from "@/components/ui/button";
import { requireUser, supabaseServer } from "@/lib/supabase/server";

type Change = { at: string; added: string[]; removed: string[] };

export const metadata = { title: "Watch" };

export default async function WatchPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const user = await requireUser("/watch");
  const { notice } = await searchParams;
  const db = await supabaseServer();
  const { data, error } = await db.from("page_watches")
    .select("id,url,title,last_checked_at,last_error,history")
    .eq("user_id", user.id).order("url");

  return (
    <div className="mx-auto max-w-4xl px-5 py-10">
      <Link href="/dashboard" className="underline">Workspace</Link>
      <h1 className="mt-4 text-3xl font-extrabold">Watch</h1>
      <p className="mt-2 text-ink-soft">Track visible text changes on public web pages.</p>
      <form action="/api/watches" method="post" className="my-6 flex flex-wrap items-end gap-3">
        <input type="hidden" name="action" value="add" />
        <label className="grid flex-1 gap-1">
          <span className="font-semibold">Public HTTPS URL</span>
          <input name="url" type="url" required maxLength={2048} placeholder="https://example.com/pricing"
            className="min-w-0 rounded-md border border-rule bg-sheet px-3 py-2" />
        </label>
        <button className={buttonStyles()}>Add watch</button>
      </form>
      {notice === "invalid" ? <p role="alert">Enter a valid public HTTPS URL.</p> : null}
      {error || notice === "failed" ? <p role="alert">Watch data is unavailable. Try again shortly.</p> : null}
      {!error && !data?.length ? <p className="text-ink-soft">Add a page to start tracking changes.</p> : null}
      <ul className="space-y-4">
        {data?.map((watch) => (
          <li key={watch.id} className="rounded-md border border-rule bg-sheet p-5">
            <h2 className="break-all text-lg font-bold">{watch.title || watch.url}</h2>
            <p className="break-all text-sm text-ink-soft">{watch.url}</p>
            <p className="my-2 text-sm">{watch.last_error || (watch.last_checked_at
              ? "Last checked " + new Date(watch.last_checked_at).toISOString().slice(0, 16).replace("T", " ") + " UTC"
              : "Waiting for first check")}</p>
            {(watch.history as Change[]).map((change) => (
              <details key={change.at} className="mb-2">
                <summary className="cursor-pointer">Change detected {new Date(change.at).toISOString().slice(0, 16).replace("T", " ")} UTC</summary>
                {change.added.length || change.removed.length ? (
                  <ul className="my-2 space-y-1 break-words text-sm">
                    {change.added.map((text, index) => <li key={"added-" + index}>Added: {text}</li>)}
                    {change.removed.map((text, index) => <li key={"removed-" + index}>Removed: {text}</li>)}
                  </ul>
                ) : <p className="my-2 text-sm">The page text was reordered or repeated.</p>}
              </details>
            ))}
            <form action="/api/watches" method="post">
              <input type="hidden" name="action" value="remove" />
              <input type="hidden" name="id" value={watch.id} />
              <button className={buttonStyles({ variant: "ghost", size: "sm" })}>Remove watch</button>
            </form>
          </li>
        ))}
      </ul>
      <Link href="/monitor" className="mt-6 inline-block underline">GitHub repository monitoring</Link>
    </div>
  );
}
