import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const badge = cva("inline-flex items-center rounded-[var(--radius-sm)] px-1.5 py-0.5 text-xs font-semibold", {
  variants: {
    tone: {
      P0: "bg-blocked text-white",
      P1: "bg-caution text-ink",
      P2: "bg-notice/15 text-notice",
      P3: "bg-ink/8 text-ink-soft",
      verified: "bg-verified/12 text-verified",
      suspected: "bg-caution/25 text-ink",
      not_tested: "bg-ink/8 text-ink-soft",
      neutral: "bg-ink/8 text-ink-soft",
      good: "bg-verified text-white",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({ className, tone, ...props }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>) {
  return <span className={cn(badge({ tone }), className)} {...props} />;
}
