import type { AuditKind } from "@/lib/config/plans";
import type { AiAssessment, Category, Confidence, EvidenceTier, Evidence, FindingChange, Priority, Severity } from "@/lib/analysis/types";
import type { Scorecard } from "@/lib/analysis/scoring";
import type { Coverage } from "@/lib/analysis/types";

export interface EntitlementsRow {
  user_id: string;
  plan: "free" | "pro";
  free_scans_used: number;
  audit_credits: number;
  rechecks_used: number;
  period_start: string | null;
  period_end: string | null;
}

export interface RepositoryRow {
  id: string;
  user_id: string;
  installation_id: number;
  github_repo_id: number;
  full_name: string;
  default_branch: string;
  is_private: boolean;
  monitoring_enabled: boolean;
  last_monitor_scan_at: string | null;
  created_at: string;
}

export type AuditStatus = "queued" | "running" | "completed" | "failed";

export interface AuditRow {
  id: string;
  user_id: string;
  repository_id: string;
  previous_audit_id: string | null;
  kind: AuditKind;
  status: AuditStatus;
  commit_sha: string | null;
  rubric_version: string | null;
  overall_score: number | null;
  verdict: string | null;
  category_scores: Pick<Scorecard, "categories" | "readiness" | "counts" | "coverageNote"> | null;
  coverage: Coverage | null;
  summary: string | null;
  ai_cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  credit_consumed: string | null;
  trigger_run_id: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface FindingRow {
  id: string;
  audit_id: string;
  user_id: string;
  fingerprint: string;
  rule_id: string;
  source: string;
  category: Category;
  severity: Severity;
  priority: Priority;
  evidence_tier: EvidenceTier;
  confidence: Confidence;
  title: string;
  description: string;
  file_path: string | null;
  start_line: number | null;
  end_line: number | null;
  snippet: string | null;
  remediation: string;
  evidence: Evidence & { readinessArea?: string };
  ai_assessment: AiAssessment | null;
  change: FindingChange | null;
  created_at: string;
}

export interface TicketRow {
  id: string;
  audit_id: string;
  finding_id: string;
  priority: Priority;
  title: string;
  body_markdown: string;
}
