import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export const buttonStyles = cva(
  "inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-ink text-white hover:bg-ink/90",
        caution: "bg-caution text-ink hover:brightness-95",
        outline: "border border-ink/25 bg-sheet text-ink hover:border-ink",
        ghost: "text-ink-soft hover:text-ink underline-offset-4 hover:underline",
      },
      size: { sm: "h-8 px-3 text-sm", md: "h-10 px-4 text-sm", lg: "h-12 px-6 text-base" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonStyles>;

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonStyles({ variant, size }), className)} {...props} />;
}
