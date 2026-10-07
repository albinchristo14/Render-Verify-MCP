import { expect, it } from 'vitest';
import {
  diagnosticStatus,
  summarizeReport,
} from '../../src/verification/checks.js';
import {
  DEFAULT_WEIGHTS,
  type CheckResult,
} from '../../src/verification/types.js';
it('keeps incomplete and errored reports unscored and prioritizes observed failures', () => {
  const result = (status: CheckResult['status']): CheckResult => ({
    name: 'no_page_errors',
    status,
    severity: 'error',
    summary: '',
    evidence_ids: [],
    observed_failures: 0,
    omitted_evidence: 0,
  });
  expect(summarizeReport([result('skipped')], DEFAULT_WEIGHTS)).toMatchObject({
    status: 'incomplete',
    score: null,
  });
  expect(summarizeReport([result('error')], DEFAULT_WEIGHTS)).toMatchObject({
    status: 'error',
    score: null,
  });
  expect(
    summarizeReport([result('failed'), result('error')], DEFAULT_WEIGHTS),
  ).toMatchObject({ status: 'failed', score: null });
  expect(summarizeReport([result('failed')], DEFAULT_WEIGHTS)).toMatchObject({
    status: 'failed',
    score: 0,
  });
  expect(diagnosticStatus(0, 1)).toBe('skipped');
  expect(diagnosticStatus(1, 1)).toBe('failed');
});
