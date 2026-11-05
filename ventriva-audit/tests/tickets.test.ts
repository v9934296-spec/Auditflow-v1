import { describe, expect, it } from "vitest";
import { buildTickets } from "@/lib/analysis/tickets";
import { finalize, type AiAssessment, type RawFinding } from "@/lib/analysis/types";

const raw: RawFinding = {
  ruleId: "secrets.env-file-committed",
  source: "secrets",
  category: "security",
  severity: "critical",
  tier: "verified",
  confidence: "high",
  title: "Env file committed",
  description: "A secret is in the repo.",
  remediation: "Remove the file and rotate the credential.",
  filePath: ".env",
  evidence: { method: "pattern" },
};

function label(verdict: AiAssessment["verdict"], remediation: string): AiAssessment {
  return { verdict, confidence: "high", explanation: "model note", remediation, model: "claude" };
}

describe("buildTickets", () => {
  it("keeps the same P0 ticket when AI labels disagree", () => {
    const finding = finalize(raw);
    const dismissed = { ...finding, ai: label("likely_false_positive", "Ignore this.") };
    const confirmed = { ...finding, ai: label("likely_true_positive", "Do something the model invented.") };
    const plain = buildTickets([finding]);
    const fp = buildTickets([dismissed]);
    const tp = buildTickets([confirmed]);

    expect(fp).toHaveLength(1);
    expect(fp[0]!.priority).toBe("P0");
    expect(fp[0]!.findingFingerprints).toEqual(plain[0]!.findingFingerprints);
    expect(fp[0]!.title).toBe(plain[0]!.title);
    expect(fp[0]!.bodyMarkdown).toContain("Remove the file and rotate the credential.");
    expect(tp[0]!.bodyMarkdown).toContain("Remove the file and rotate the credential.");
    expect(tp[0]!.bodyMarkdown).not.toContain("Do something the model invented.");
    expect(fp[0]!.bodyMarkdown).toContain("likely false positive");
  });

  it("opens a ticket for an advisory whose severity could not be classified", () => {
    const uncertain = finalize({
      ruleId: "osv.GHSA-v4",
      source: "osv",
      category: "security",
      severity: "info",
      tier: "suspected",
      confidence: "low",
      title: "leftpad has a known vulnerability",
      description: "Severity was not classified from the advisory and was not recorded as medium.",
      remediation: "Review the advisory before launch.",
      filePath: "package-lock.json",
      evidence: { method: "osv", facts: { severityUncertain: true, advisory: "GHSA-v4", package: "leftpad" } },
    });
    const informational = finalize({ ...raw, severity: "info", ruleId: "readiness.note", title: "Note" });
    expect(buildTickets([uncertain])).toHaveLength(1);
    expect(buildTickets([uncertain])[0]!.bodyMarkdown).toContain("GHSA-v4");
    expect(buildTickets([informational])).toHaveLength(0);
  });
});
