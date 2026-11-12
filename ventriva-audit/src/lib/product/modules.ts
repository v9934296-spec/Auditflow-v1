/** M2 is presentation-only. The validation engine remains a separate app. */
export const VALIDATION_APP_URL = "https://venturelens-l2q2.onrender.com";

export const productModules = [
  {
    id: "validate",
    title: "Validate",
    eyebrow: "Business opportunity",
    summary: "Investigate customer demand, competition, assumptions, and risks before investing more time in an idea.",
    href: "/validate",
    status: "separate_app",
  },
  {
    id: "audit",
    title: "Audit",
    eyebrow: "Technical launch readiness",
    summary: "Inspect a GitHub repository for security and launch blockers, backed by file-level evidence and fix tickets.",
    href: "/dashboard",
    status: "available",
  },
  {
    id: "monitor",
    title: "Monitor",
    eyebrow: "Post-audit verification",
    summary: "Track rechecks and regression alerts for audited repositories. Monitoring requires the eligible audit subscription.",
    href: "/monitor",
    status: "audit_pro",
  },
] as const;
