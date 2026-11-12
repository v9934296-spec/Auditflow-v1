import Link from "next/link";
import { productModules } from "@/lib/product/modules";

export function ProductModuleCards({ compact = false }: { compact?: boolean }) {
  return (
    <div className="grid gap-4 md:grid-cols-3" aria-label="Ventriva product modules">
      {productModules.map((module) => (
        <section key={module.id} className="flex h-full flex-col rounded-[var(--radius-md)] border border-rule bg-sheet p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-ink-soft">{module.eyebrow}</p>
          <h3 className="mt-2 text-xl font-bold">{module.title}</h3>
          <p className="mt-3 flex-1 text-sm text-ink-soft">{module.summary}</p>
          {module.status === "separate_app" ? (
            <p className="mt-4 text-xs font-semibold text-ink-soft">Separate application and sign-in</p>
          ) : module.status === "audit_pro" ? (
            <p className="mt-4 text-xs font-semibold text-ink-soft">Available with eligible Audit Pro access</p>
          ) : null}
          <Link className="mt-4 inline-flex w-fit font-semibold underline decoration-2 underline-offset-4 hover:text-notice focus-visible:rounded-sm" href={module.href}>
            {module.id === "validate" ? "Explore validation" : module.id === "monitor" ? "View monitoring" : compact ? "View repositories" : "Audit my app"}
            <span aria-hidden="true" className="ml-2">→</span>
          </Link>
        </section>
      ))}
    </div>
  );
}
