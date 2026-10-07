import { createHash, randomUUID } from 'node:crypto';
import type { SessionManager } from '../browser/sessionManager.js';
import type {
  ConsoleRecord,
  NetworkRecord,
  PageErrorRecord,
} from '../collectors/events.js';
import { withDeadline } from '../tools/deadline.js';
import { captureScreenshot } from '../tools/screenshot.js';
import { toToolError } from '../tools/results.js';
import { diagnosticStatus, summarizeReport } from './checks.js';
import {
  CHECK_NAMES,
  DEFAULT_SEVERITIES,
  DEFAULT_WEIGHTS,
  type Evidence,
  type VerificationReport,
  type VerifyOptions,
} from './types.js';

export async function verifyPage(
  sessions: SessionManager,
  id: string,
  options: VerifyOptions = {},
) {
  return sessions.use(id, async (session) => {
    const startedAt = new Date().toISOString();
    const policy: VerificationReport['policy'] = {
      severities: { ...DEFAULT_SEVERITIES, ...options.policy?.severities },
      score_weights: { ...DEFAULT_WEIGHTS, ...options.policy?.score_weights },
      ignore_http_statuses: [
        ...new Set(options.policy?.ignore_http_statuses ?? []),
      ],
      overflow_tolerance_px: options.policy?.overflow_tolerance_px ?? 1,
    };
    const names = options.checks ?? [...CHECK_NAMES];
    const evidence: Evidence[] = [];
    const addEvidence = (
      type: Evidence['type'],
      summary: string,
      data: Record<string, unknown>,
      key?: string,
      timestamp = startedAt,
    ) => {
      const evidenceId = `${id}:${type}:${key ?? createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 24)}`;
      if (!evidence.some((item) => item.id === evidenceId))
        evidence.push({
          id: evidenceId,
          type,
          summary,
          data,
          timestamp,
          content_trust: 'untrusted',
        });
      return evidenceId;
    };
    const needsDocument =
      names.includes('page_loads') || names.includes('no_horizontal_overflow');
    let documentState:
      | {
          ready_state: string;
          has_document: boolean;
          viewport_width: number;
          content_width: number;
        }
      | undefined;
    let operationError: ReturnType<typeof toToolError> | undefined;
    let image: Awaited<ReturnType<typeof captureScreenshot>> | undefined;
    let screenshotError: ReturnType<typeof toToolError> | undefined;
    try {
      await withDeadline(
        sessions,
        id,
        Math.min(
          options.timeout_ms ?? sessions.config.actionTimeoutMs,
          sessions.config.actionTimeoutMs,
        ),
        async (remaining) => {
          if (needsDocument) {
            try {
              documentState = await session.page.evaluate(() => ({
                ready_state: document.readyState,
                has_document: Boolean(document.documentElement),
                viewport_width: document.documentElement?.clientWidth ?? 0,
                content_width: Math.max(
                  document.documentElement?.scrollWidth ?? 0,
                  document.body?.scrollWidth ?? 0,
                ),
              }));
              if (
                !documentState ||
                typeof documentState.ready_state !== 'string' ||
                typeof documentState.has_document !== 'boolean' ||
                !Number.isFinite(documentState.viewport_width) ||
                !Number.isFinite(documentState.content_width) ||
                documentState.viewport_width < 0 ||
                documentState.content_width < 0
              )
                throw new Error('Invalid document measurement');
            } catch (error) {
              operationError = toToolError(error);
            }
          }
          if (options.include_screenshot) {
            try {
              image = await captureScreenshot(
                session,
                sessions.config,
                {},
                remaining(),
              );
            } catch (error) {
              screenshotError = toToolError(error);
            }
          }
        },
      );
    } catch (error) {
      const failure = toToolError(error);
      if (needsDocument && !documentState) operationError = failure;
      if (options.include_screenshot && !image) screenshotError = failure;
    }
    // Freeze collector views after document inspection/capture, before constructing the report.
    const console = session.events.console.snapshot();
    const pageErrors = session.events.pageErrors.snapshot();
    const network = session.events.network.snapshot();
    const sanitizeRecord = (
      record: ConsoleRecord | PageErrorRecord | NetworkRecord,
    ): Record<string, unknown> =>
      Object.fromEntries(
        Object.entries(record).map(([key, value]) => [
          key,
          typeof value === 'string'
            ? key === 'url'
              ? session.events.sanitizeUrl(value)
              : session.events.sanitize(value)
            : value,
        ]),
      );
    const report: VerificationReport = {
      report_id: randomUUID(),
      session_id: id,
      status: 'error',
      score: null,
      summary: '',
      final_url: session.events.sanitizeUrl(session.page.url()),
      viewport: session.page.viewportSize(),
      scope: 'retained_session_history_and_current_document',
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      session_closed: session.page.isClosed(),
      checks: [],
      evidence,
      policy,
      content_trust: 'untrusted',
    };
    const errorData = (error: ReturnType<typeof toToolError>) => ({
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    });
    for (const name of names) {
      const check: VerificationReport['checks'][number] = {
        name,
        status: 'error',
        severity: policy.severities[name],
        summary: '',
        evidence_ids: [],
        observed_failures: 0,
        omitted_evidence: 0,
      };
      if (name === 'page_loads' || name === 'no_horizontal_overflow') {
        if (!documentState || operationError) {
          check.summary = 'Current document could not be inspected.';
          check.evidence_ids.push(
            addEvidence(
              'operation',
              check.summary,
              errorData(operationError ?? toToolError(undefined)),
            ),
          );
        } else if (name === 'page_loads') {
          const loaded =
            documentState.has_document &&
            ['interactive', 'complete'].includes(documentState.ready_state) &&
            (session.rawHtml ||
              (session.httpStatus !== null &&
                session.httpStatus >= 200 &&
                session.httpStatus < 400));
          check.status = loaded ? 'passed' : 'failed';
          check.observed_failures = loaded ? 0 : 1;
          check.summary = loaded
            ? 'Current document is ready with an accepted main response or raw HTML.'
            : 'Current document readiness or main response does not satisfy page loading.';
          check.evidence_ids.push(
            addEvidence('navigation', check.summary, {
              ready_state: documentState.ready_state,
              has_document: documentState.has_document,
              raw_html: session.rawHtml,
              http_status: session.httpStatus,
              url: report.final_url,
            }),
          );
        } else {
          const overflow = Math.max(
            0,
            documentState.content_width - documentState.viewport_width,
          );
          if (
            !documentState.has_document ||
            documentState.viewport_width <= 0
          ) {
            check.summary = 'No measurable document viewport is available.';
          } else {
            check.status =
              overflow > policy.overflow_tolerance_px ? 'failed' : 'passed';
            check.observed_failures = check.status === 'failed' ? 1 : 0;
            check.summary = `Document horizontal overflow is ${overflow}px (tolerance ${policy.overflow_tolerance_px}px).`;
          }
          check.evidence_ids.push(
            addEvidence('layout', check.summary, {
              viewport_width: documentState.viewport_width,
              content_width: documentState.content_width,
              overflow_px: overflow,
              tolerance_px: policy.overflow_tolerance_px,
            }),
          );
        }
      } else {
        const source =
          name === 'no_console_errors'
            ? console
            : name === 'no_page_errors'
              ? pageErrors
              : network;
        const matches = (
          record: ConsoleRecord | PageErrorRecord | NetworkRecord,
        ) => {
          if (name === 'no_console_errors')
            return 'level' in record && record.level === 'error';
          if (name === 'no_page_errors') return true;
          const entry = record as NetworkRecord;
          if (
            entry.type === 'http_error' &&
            entry.status !== undefined &&
            policy.ignore_http_statuses.includes(entry.status)
          )
            return false;
          return name === 'no_http_5xx'
            ? entry.type === 'http_error' &&
                entry.status !== undefined &&
                entry.status >= 500 &&
                entry.status <= 599
            : true;
        };
        const failures = source.entries.filter(({ entry }) => matches(entry));
        check.status = diagnosticStatus(failures.length, source.missing);
        check.observed_failures = failures.length;
        check.omitted_evidence = Math.max(
          0,
          failures.length - (options.evidence_limit ?? 5),
        );
        check.summary = failures.length
          ? `${failures.length} retained diagnostic record(s) violate this check.`
          : source.missing
            ? 'Relevant history was cleared or evicted; absence of failures cannot be established.'
            : 'No violating records in complete collected session history.';
        check.evidence_ids.push(
          addEvidence('coverage', check.summary, {
            check: name,
            retained_records: source.entries.length,
            missing_records: source.missing,
            violating_records: failures.length,
            ignored_http_statuses: policy.ignore_http_statuses,
          }),
        );
        for (const { entry, sequence } of failures.slice(
          0,
          options.evidence_limit ?? 5,
        )) {
          const type =
            name === 'no_console_errors'
              ? 'console'
              : name === 'no_page_errors'
                ? 'page_error'
                : 'network';
          check.evidence_ids.push(
            addEvidence(
              type,
              `Collected ${type} diagnostic.`,
              sanitizeRecord(entry),
              String(sequence),
              entry.timestamp,
            ),
          );
        }
      }
      report.checks.push(check);
    }
    if (options.include_screenshot) {
      const evidenceId = image
        ? addEvidence(
            'screenshot',
            'Viewport screenshot attached as MCP image content index 1.',
            {
              content_index: 1,
              mime_type: image.mimeType,
              viewport: report.viewport,
            },
            randomUUID(),
          )
        : addEvidence(
            'operation',
            'Requested screenshot capture failed.',
            errorData(screenshotError ?? toToolError(undefined)),
            'screenshot-' + report.report_id,
          );
      report.screenshot = {
        status: image ? 'captured' : 'error',
        evidence_id: evidenceId,
      };
    }
    Object.assign(
      report,
      summarizeReport(
        report.checks,
        policy.score_weights,
        report.screenshot?.status === 'error',
      ),
    );
    // Keep each check's aggregate evidence. Trim sample payloads and references together.
    while (
      Buffer.byteLength(JSON.stringify(report)) > sessions.config.maxOutputBytes
    ) {
      const sample = [...report.evidence]
        .reverse()
        .find((item) =>
          ['console', 'page_error', 'network'].includes(item.type),
        );
      if (!sample) break;
      report.evidence.splice(report.evidence.indexOf(sample), 1);
      for (const check of report.checks)
        if (check.evidence_ids.includes(sample.id)) {
          check.evidence_ids = check.evidence_ids.filter(
            (value) => value !== sample.id,
          );
          check.omitted_evidence++;
        }
    }
    return { report, image };
  });
}
