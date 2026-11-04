/**
 * Secret redaction. Applied to every snippet before it is stored or sent to an AI provider.
 * Redaction is best-effort: the pipeline also minimizes how much source leaves the worker.
 */

export interface SecretPattern {
  id: string;
  label: string;
  re: RegExp;
  severity: "critical" | "high" | "medium";
  /** Live/production credential (critical) vs test/low-impact. */
  live: boolean;
}

export const SECRET_PATTERNS: SecretPattern[] = [
  { id: "aws-access-key", label: "AWS access key ID", re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, severity: "critical", live: true },
  { id: "stripe-live-secret", label: "Stripe live secret key", re: /\b(sk|rk)_live_[0-9a-zA-Z]{20,}\b/g, severity: "critical", live: true },
  { id: "stripe-test-secret", label: "Stripe test secret key", re: /\b(sk|rk)_test_[0-9a-zA-Z]{20,}\b/g, severity: "medium", live: false },
  { id: "stripe-webhook-secret", label: "Stripe webhook signing secret", re: /\bwhsec_[0-9a-zA-Z]{24,}\b/g, severity: "high", live: true },
  { id: "github-token", label: "GitHub token", re: /\b(ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{36,}\b|\bgithub_pat_[0-9A-Za-z_]{60,}\b/g, severity: "critical", live: true },
  { id: "anthropic-key", label: "Anthropic API key", re: /\bsk-ant-[0-9A-Za-z\-_]{30,}\b/g, severity: "critical", live: true },
  { id: "openai-key", label: "OpenAI API key", re: /\bsk-(proj-)?[A-Za-z0-9_-]{32,}\b/g, severity: "critical", live: true },
  { id: "google-api-key", label: "Google API key", re: /\bAIza[0-9A-Za-z\-_]{35}\b/g, severity: "high", live: true },
  { id: "slack-token", label: "Slack token", re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g, severity: "high", live: true },
  { id: "sendgrid-key", label: "SendGrid API key", re: /\bSG\.[0-9A-Za-z\-_]{22}\.[0-9A-Za-z\-_]{43}\b/g, severity: "high", live: true },
  { id: "resend-key", label: "Resend API key", re: /\bre_[0-9A-Za-z]{8,}_[0-9A-Za-z]{16,}\b/g, severity: "high", live: true },
  { id: "twilio-key", label: "Twilio API key", re: /\bSK[0-9a-fA-F]{32}\b/g, severity: "high", live: true },
  { id: "private-key", label: "Private key block", re: /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY( BLOCK)?-----/g, severity: "critical", live: true },
  { id: "db-url-with-password", label: "Database URL with embedded password", re: /\b(postgres(ql)?|mysql|mongodb(\+srv)?|redis):\/\/[^:\s"'/]+:[^@\s"']{6,}@[^\s"']+/g, severity: "critical", live: true },
];

const JWT_RE = /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;

/** Decodes a JWT payload without verifying; used only to detect Supabase service-role keys. */
export function jwtRole(token: string): string | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const json = JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as { role?: unknown };
    return typeof json.role === "string" ? json.role : null;
  } catch {
    return null;
  }
}

export function maskValue(value: string): string {
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}…[REDACTED ${value.length} chars]`;
}

const GENERIC_ASSIGNMENT =
  /\b([A-Z0-9_]*(SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*)\s*[:=]\s*["'`]?([^\s"'`]{8,})["'`]?/gi;

/** Redacts every known secret format, JWTs and generic `*_SECRET=value` assignments. */
export function redact(text: string): string {
  let out = text;
  for (const p of SECRET_PATTERNS) out = out.replace(new RegExp(p.re.source, p.re.flags), (m) => maskValue(m));
  out = out.replace(new RegExp(JWT_RE.source, JWT_RE.flags), (m) => maskValue(m));
  out = out.replace(new RegExp(GENERIC_ASSIGNMENT.source, GENERIC_ASSIGNMENT.flags), (_m, name: string, _k: string, value: string) => {
    if (/^(process\.env|import\.meta\.env|env\.|\$\{)/.test(value)) return `${name}=${value}`;
    return `${name}=${maskValue(value)}`;
  });
  return out;
}

export { JWT_RE, GENERIC_ASSIGNMENT };
