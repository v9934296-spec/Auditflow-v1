import { CATEGORY_LABELS, type Finding, type Priority } from "./types";

export interface Ticket {
  priority: Priority;
  title: string;
  findingFingerprints: string[];
  bodyMarkdown: string;
}

const PRIORITY_LABEL: Record<Priority, string> = {
  P0: "P0 — Critical launch or security blocker",
  P1: "P1 — High-priority defect or risk",
  P2: "P2 — Important improvement",
  P3: "P3 — Optional optimization",
};

function impact(f: Finding): { business: string; engineering: string } {
  const sev = f.severity;
  switch (f.category) {
    case "security":
      return {
        business: sev === "critical" ? "Direct risk of data breach, account takeover or financial loss; a single incident at launch can end customer trust." : "Exploitable weakness that increases the chance and blast radius of a security incident.",
        engineering: "Attackers can reach this without special access. Fixing after launch requires incident response, key rotation and possibly customer notification.",
      };
    case "launch_readiness":
      return {
        business: "Blocks or degrades your ability to onboard, charge, or support paying customers.",
        engineering: "Missing production capability that becomes much harder to retrofit once real users and data exist.",
      };
    case "reliability":
      return { business: "Causes failed requests, broken deploys or lost payments that customers notice before you do.", engineering: "Reduces confidence that what passes locally behaves the same in production." };
    case "testing":
      return { business: "Raises the cost and risk of every future change, slowing down iteration after launch.", engineering: "Regressions in critical paths (auth, billing, data access) are not caught automatically." };
    default:
      return { business: "Slows down future development and increases the chance AI-assisted edits introduce regressions.", engineering: "Code is harder to read, review and change safely." };
  }
}

function requiredTests(f: Finding): string[] {
  if (f.ruleId.startsWith("osv.")) return ["Existing test suite passes after the upgrade.", "Smoke-test the features that use this package."];
  if (f.ruleId.startsWith("secrets.")) return ["Application still starts and reads the credential from the environment.", "A grep for the old credential prefix in the repository returns nothing."];
  if (f.ruleId.includes("rls")) return ["Integration test: using the anon key, a user cannot select, update or delete another user's rows.", "Integration test: a user can still access their own rows."];
  if (f.ruleId.includes("stripe-webhook")) return ["Unit test: a request with an invalid `stripe-signature` returns 400 and changes nothing.", "Unit test: a valid signed event grants access exactly once, even when delivered twice."];
  if (f.ruleId.includes("api-route-no-auth")) return ["Route test: unauthenticated request returns 401.", "Route test: authenticated user cannot modify a resource owned by another user (403/404)."];
  if (f.category === "security") return ["Add a regression test that exercises the vulnerable input and asserts it is rejected or neutralized."];
  if (f.category === "testing") return ["New tests run in CI and fail when the covered behavior is broken."];
  return ["Existing tests pass.", "Add a focused test for the changed behavior where practical."];
}

function acceptance(f: Finding): string[] {
  const base = [`The issue described above no longer occurs${f.filePath ? ` in \`${f.filePath}\`` : ""}.`];
  if (f.ruleId.startsWith("secrets.")) base.unshift("The exposed credential has been revoked and rotated with the provider.");
  if (f.ruleId.startsWith("osv.") && typeof f.evidence.facts?.fixed === "string" && f.evidence.facts.fixed !== "none")
    base.push(`Lockfile resolves \`${String(f.evidence.facts.package)}\` to ${f.evidence.facts.fixed} or later.`);
  base.push("No unrelated files or behavior changed.", "Required tests below are added and passing.");
  return base;
}

function codeFence(snippet: string): string {
  const fence = snippet.includes("```") ? "````" : "```";
  return `${fence}\n${snippet}\n${fence}`;
}

export function ticketForFinding(f: Finding): Ticket {
  const { business, engineering } = impact(f);
  const location = f.filePath ? `\`${f.filePath}${f.startLine ? `:${f.startLine}${f.endLine && f.endLine !== f.startLine ? `-${f.endLine}` : ""}` : ""}\`` : "Repository-wide (no single file)";
  const facts = f.evidence.facts
    ? Object.entries(f.evidence.facts)
        .map(([k, v]) => `  - ${k}: ${Array.isArray(v) ? v.slice(0, 15).join(", ") : String(v)}`)
        .join("\n")
    : "";
  const remediation = f.remediation;

  const body = [
    `**Priority:** ${PRIORITY_LABEL[f.priority]}  `,
    `**Category:** ${CATEGORY_LABELS[f.category]} · **Evidence:** ${f.tier} · **Confidence:** ${f.confidence} · **Rule:** \`${f.ruleId}\`  `,
    `**Fingerprint:** \`${f.fingerprint}\``,
    "",
    "## Problem",
    f.description,
    "",
    "## Evidence",
    `- Location: ${location}`,
    `- How it was found: ${f.evidence.method}`,
    ...(f.evidence.searchedFor?.length ? [`- Searched for: ${f.evidence.searchedFor.slice(0, 12).join(", ")}`] : []),
    ...(facts ? ["- Facts:", facts] : []),
    ...(f.ai ? [`- AI review (${f.ai.model}): ${f.ai.verdict.replace(/_/g, " ")} (${f.ai.confidence}) — ${f.ai.explanation}`] : []),
    ...(f.snippet ? ["", codeFence(f.snippet)] : []),
    "",
    "## Impact",
    `- **Business:** ${business}`,
    `- **Engineering:** ${engineering}`,
    "",
    "## Relevant files",
    f.filePath ? `- \`${f.filePath}\`` : "- Determine the correct location; keep changes in as few files as possible.",
    "",
    "## Recommended implementation",
    remediation,
    "",
    "## Acceptance criteria",
    ...acceptance(f).map((a) => `- [ ] ${a}`),
    "",
    "## Required tests",
    ...requiredTests(f).map((t) => `- [ ] ${t}`),
    "",
    "## Verification",
    "1. Run the test suite locally and in CI.",
    "2. Push the fix and run a targeted recheck in the dashboard.",
    `3. Confirm finding \`${f.fingerprint}\` is reported as **fixed**.`,
    "",
    "## Scope restrictions",
    "- Fix only this issue. Do not refactor, rename or reformat unrelated code.",
    "- Do not change the application's architecture, framework, or folder structure.",
    "- Do not add new dependencies unless the recommended implementation names one.",
    "- If the fix appears to require broader changes, stop and describe them instead of making them.",
  ].join("\n");

  return { priority: f.priority, title: `[${f.priority}] ${f.title}`, findingFingerprints: [f.fingerprint], bodyMarkdown: body };
}

/** Builds tickets for actionable findings, sorted P0 → P3. Dependency advisories are grouped per package. */
export function buildTickets(findings: Finding[]): Ticket[] {
  const actionable = findings.filter((f) => f.change !== "fixed" && (f.severity !== "info" || f.evidence.facts?.severityUncertain === true));
  const osvByPkg = new Map<string, Finding[]>();
  const others: Finding[] = [];
  for (const f of actionable) {
    if (f.source === "osv") {
      const key = `${f.filePath}|${String(f.evidence.facts?.package)}`;
      osvByPkg.set(key, [...(osvByPkg.get(key) ?? []), f]);
    } else others.push(f);
  }
  const tickets = others.map(ticketForFinding);
  const rank: Record<Priority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
  for (const group of osvByPkg.values()) {
    const worst = [...group].sort((a, b) => rank[a.priority] - rank[b.priority])[0]!;
    const t = ticketForFinding(worst);
    if (group.length > 1) {
      t.title = `[${worst.priority}] Upgrade ${String(worst.evidence.facts?.package)} (${group.length} known vulnerabilities)`;
      t.bodyMarkdown += `\n\n## All advisories for this package\n${group.map((g) => `- ${String(g.evidence.facts?.advisory)} (${g.severity}) — fixed in ${String(g.evidence.facts?.fixed)}`).join("\n")}`;
      t.findingFingerprints = group.map((g) => g.fingerprint);
    }
    tickets.push(t);
  }
  return tickets.sort((a, b) => rank[a.priority] - rank[b.priority] || a.title.localeCompare(b.title));
}

export function ticketsToMarkdown(repoName: string, commitSha: string, tickets: Ticket[]): string {
  const header = [
    `# Engineering tickets — ${repoName}`,
    "",
    `Commit \`${commitSha.slice(0, 12)}\` · ${tickets.length} ticket(s). Work top to bottom. Paste one ticket at a time into Cursor, Claude Code or Codex.`,
    "",
    "---",
    "",
  ].join("\n");
  return header + tickets.map((t) => `# ${t.title}\n\n${t.bodyMarkdown}`).join("\n\n---\n\n") + "\n";
}
