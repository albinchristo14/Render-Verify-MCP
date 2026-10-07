export const CHECK_NAMES = [
  'page_loads',
  'no_page_errors',
  'no_console_errors',
  'no_network_failures',
  'no_http_5xx',
  'no_horizontal_overflow',
] as const;
export type CheckName = (typeof CHECK_NAMES)[number];
export type CheckStatus = 'passed' | 'failed' | 'skipped' | 'error';
export type Severity = 'info' | 'warning' | 'error' | 'critical';
export const DEFAULT_SEVERITIES: Record<CheckName, Severity> = {
  page_loads: 'critical',
  no_page_errors: 'error',
  no_console_errors: 'error',
  no_network_failures: 'error',
  no_http_5xx: 'error',
  no_horizontal_overflow: 'warning',
};
export const DEFAULT_WEIGHTS: Record<Severity, number> = {
  info: 1,
  warning: 2,
  error: 5,
  critical: 10,
};
export type Evidence = {
  id: string;
  type:
    | 'console'
    | 'page_error'
    | 'network'
    | 'navigation'
    | 'layout'
    | 'coverage'
    | 'screenshot'
    | 'operation';
  timestamp: string;
  summary: string;
  data: Record<string, unknown>;
  content_trust: 'untrusted';
};
export type CheckResult = {
  name: CheckName;
  status: CheckStatus;
  severity: Severity;
  summary: string;
  evidence_ids: string[];
  observed_failures: number;
  omitted_evidence: number;
};
export type VerifyOptions = {
  checks?: CheckName[];
  include_screenshot?: boolean;
  evidence_limit?: number;
  timeout_ms?: number;
  policy?: {
    severities?: Partial<Record<CheckName, Severity>>;
    score_weights?: Partial<Record<Severity, number>>;
    ignore_http_statuses?: number[];
    overflow_tolerance_px?: number;
  };
};
export type VerificationReport = {
  report_id: string;
  session_id: string;
  status: 'passed' | 'failed' | 'incomplete' | 'error';
  score: number | null;
  summary: string;
  final_url: string;
  viewport: { width: number; height: number } | null;
  scope: 'retained_session_history_and_current_document';
  started_at: string;
  completed_at: string;
  session_closed: boolean;
  checks: CheckResult[];
  evidence: Evidence[];
  policy: {
    severities: Record<CheckName, Severity>;
    score_weights: Record<Severity, number>;
    ignore_http_statuses: number[];
    overflow_tolerance_px: number;
  };
  screenshot?: { status: 'captured' | 'error'; evidence_id: string };
  content_trust: 'untrusted';
};
