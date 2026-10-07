import type { CheckStatus, CheckResult, VerificationReport } from './types.js';

/** Missing diagnostics cannot prove a negative; retained violations still prove failure. */
export function diagnosticStatus(
  failures: number,
  missing: number,
): CheckStatus {
  return failures ? 'failed' : missing ? 'skipped' : 'passed';
}
export function summarizeReport(
  checks: CheckResult[],
  weights: VerificationReport['policy']['score_weights'],
  attachmentError = false,
) {
  const failed = checks.filter((check) => check.status === 'failed').length;
  const errors = checks.filter((check) => check.status === 'error').length;
  const skipped = checks.filter((check) => check.status === 'skipped').length;
  const passed = checks.filter((check) => check.status === 'passed').length;
  const totalWeight = checks.reduce(
    (total, check) => total + weights[check.severity],
    0,
  );
  return {
    status: (failed
      ? 'failed'
      : errors || attachmentError
        ? 'error'
        : skipped
          ? 'incomplete'
          : 'passed') as VerificationReport['status'],
    score:
      errors || skipped
        ? null
        : Math.round(
            (100 *
              checks
                .filter((check) => check.status === 'passed')
                .reduce((total, check) => total + weights[check.severity], 0)) /
              totalWeight,
          ),
    summary: `${passed} passed, ${failed} failed, ${skipped} skipped, ${errors} errored.${attachmentError ? ' Screenshot capture failed.' : ''}`,
  };
}
