import Link from "next/link";
import { buttonStyles } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-5 py-24">
      <h1 className="text-4xl font-extrabold">Nothing here</h1>
      <p className="mt-3 text-ink-soft">That page doesn&rsquo;t exist, or it belongs to another account.</p>
      <Link href="/dashboard" className={`${buttonStyles()} mt-6`}>Go to dashboard</Link>
    </div>
  );
}
