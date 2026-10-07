import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { SessionManager } from '../../src/browser/sessionManager.js';
import { verifyPage } from '../../src/verification/verifyPage.js';
import { interact } from '../../src/tools/interactions.js';
import { startFixtureServer } from '../../fixtures/server.js';
import type { VerificationReport } from '../../src/verification/types.js';

let fixture: Awaited<ReturnType<typeof startFixtureServer>>;
const services: SessionManager[] = [];
beforeAll(async () => {
  fixture = await startFixtureServer();
});
afterAll(async () => {
  await fixture.close();
});
afterEach(async () => {
  await Promise.all(services.splice(0).map((manager) => manager.close()));
});
function service(env: NodeJS.ProcessEnv = {}) {
  const manager = new SessionManager(
    loadConfig({
      ...process.env,
      ALLOW_LOCAL: 'true',
      ALLOWED_DOMAINS: '127.0.0.1',
      ...env,
    }),
  );
  services.push(manager);
  return manager;
}
function check(report: VerificationReport, name: string) {
  return report.checks.find((value) => value.name === name)!;
}
function expectReferences(report: VerificationReport) {
  const ids = new Set(report.evidence.map((item) => item.id));
  for (const result of report.checks) {
    expect(result.evidence_ids.length).toBeGreaterThan(0);
    for (const id of result.evidence_ids) expect(ids.has(id)).toBe(true);
  }
  if (report.screenshot)
    expect(ids.has(report.screenshot.evidence_id)).toBe(true);
}
it('verifies a clean raw HTML document and attaches bounded PNG evidence', async () => {
  const manager = service();
  const opened = await manager.open({ html: '<!doctype html><h1>Clean</h1>' });
  const { report, image } = await verifyPage(manager, opened.session_id, {
    include_screenshot: true,
  });
  expect(report.status).toBe('passed');
  expect(report.score).toBe(100);
  expect(report.checks).toHaveLength(6);
  expect(report.checks.every((result) => result.status === 'passed')).toBe(
    true,
  );
  expect(report.screenshot?.status).toBe('captured');
  expect(Buffer.from(image!.data, 'base64').subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  expectReferences(report);
});
it('returns evidence for JS, console, HTTP and overflow failures, then verifies a fresh clean session', async () => {
  const manager = service();
  const opened = await manager.open({
    url: fixture.baseUrl + '/verification-broken',
    viewport: { width: 360, height: 800 },
  });
  await manager.use(opened.session_id, async ({ page }) => {
    await page.locator('#api-complete').waitFor();
  });
  const { report } = await verifyPage(manager, opened.session_id);
  expect(report.status).toBe('failed');
  expect(check(report, 'page_loads').status).toBe('passed');
  for (const name of [
    'no_page_errors',
    'no_console_errors',
    'no_network_failures',
    'no_http_5xx',
    'no_horizontal_overflow',
  ])
    expect(check(report, name).status).toBe('failed');
  expect(report.evidence).toContainEqual(
    expect.objectContaining({
      type: 'network',
      data: expect.objectContaining({
        status: 500,
        url: fixture.baseUrl + '/api-error',
      }),
    }),
  );
  expectReferences(report);
  const next = await manager.open({ url: fixture.baseUrl + '/clean' });
  expect((await verifyPage(manager, next.session_id)).report.status).toBe(
    'passed',
  );
});
it('retains stable diagnostic evidence identifiers across repeated reports', async () => {
  const manager = service();
  const opened = await manager.open({
    html: '<script>console.error("repeat");throw Error("repeat")</script>',
  });
  const first = (await verifyPage(manager, opened.session_id)).report;
  const second = (await verifyPage(manager, opened.session_id)).report;
  expect(first.report_id).not.toBe(second.report_id);
  for (const type of ['console', 'page_error'])
    expect(
      first.evidence
        .filter((item) => item.type === type)
        .map((item) => item.id),
    ).toEqual(
      second.evidence
        .filter((item) => item.type === type)
        .map((item) => item.id),
    );
});
it('keeps historical errors after navigation and skips cleared negative checks instead of claiming success', async () => {
  const manager = service();
  const { session_id: id } = await manager.open({
    url: fixture.baseUrl + '/broken',
  });
  await interact(manager, id, {
    action: 'navigate',
    url: fixture.baseUrl + '/clean',
  });
  expect(
    check((await verifyPage(manager, id)).report, 'no_page_errors').status,
  ).toBe('failed');
  await manager.use(id, async ({ events }) => {
    events.pageErrors.clear();
    events.console.clear();
    events.network.clear();
  });
  const { report } = await verifyPage(manager, id);
  expect(report.status).toBe('incomplete');
  expect(report.score).toBeNull();
  for (const name of [
    'no_page_errors',
    'no_console_errors',
    'no_network_failures',
    'no_http_5xx',
  ])
    expect(check(report, name).status).toBe('skipped');
  expectReferences(report);
});
it('handles eviction conservatively even when all retained console records are warnings', async () => {
  const manager = service();
  const { session_id: id } = await manager.open({ html: '<h1>History</h1>' });
  await manager.use(id, async ({ page }) => {
    await page.evaluate(() => {
      console.error('evicted error');
      for (let i = 0; i < 510; i++) console.warn('warning ' + i);
    });
  });
  const { report } = await verifyPage(manager, id, {
    checks: ['no_console_errors'],
  });
  expect(report.status).toBe('incomplete');
  expect(report.evidence[0]?.data.missing_records).toBe(11);
});
it('distinguishes 404 network policy exceptions from HTTP 5xx and supports severity-weighted scoring', async () => {
  const manager = service();
  const { session_id: id } = await manager.open({ html: '<h1>Policy</h1>' });
  await manager.use(id, async ({ events }) => {
    events.network.push({
      type: 'http_error',
      url: fixture.baseUrl + '/missing.png',
      method: 'GET',
      resource_type: 'image',
      status: 404,
      timestamp: new Date().toISOString(),
    });
  });
  const base = (
    await verifyPage(manager, id, {
      checks: ['page_loads', 'no_network_failures', 'no_http_5xx'],
      policy: {
        severities: { no_network_failures: 'warning' },
        score_weights: { critical: 8, warning: 2, error: 5 },
      },
    })
  ).report;
  expect(check(base, 'no_network_failures').status).toBe('failed');
  expect(check(base, 'no_http_5xx').status).toBe('passed');
  expect(base.score).toBe(87);
  const ignored = (
    await verifyPage(manager, id, {
      checks: ['no_network_failures'],
      policy: { ignore_http_statuses: [404] },
    })
  ).report;
  expect(ignored.status).toBe('passed');
  expect(ignored.policy.ignore_http_statuses).toEqual([404]);
  await manager.use(id, async ({ events }) => {
    events.blocked('http://169.254.169.254/', 'GET', 'fetch');
  });
  expect(
    (
      await verifyPage(manager, id, {
        checks: ['no_network_failures'],
        policy: { ignore_http_statuses: [403, 404] },
      })
    ).report.status,
  ).toBe('failed');
});
it('fails page_loads on an HTTP 500 main document', async () => {
  const manager = service();
  const { session_id: id } = await manager.open({
    url: fixture.baseUrl + '/api-error',
  });
  const { report } = await verifyPage(manager, id);
  expect(check(report, 'page_loads').status).toBe('failed');
  expect(check(report, 'no_http_5xx').status).toBe('failed');
});
it('checks overflow at the current viewport and respects an explicit tolerance', async () => {
  const manager = service();
  const { session_id: id } = await manager.open({
    html: '<style>body{margin:0}div{width:365px}</style><div>Wide</div>',
    viewport: { width: 360, height: 800 },
  });
  expect(
    (await verifyPage(manager, id, { checks: ['no_horizontal_overflow'] }))
      .report.status,
  ).toBe('failed');
  expect(
    (
      await verifyPage(manager, id, {
        checks: ['no_horizontal_overflow'],
        policy: { overflow_tolerance_px: 5 },
      })
    ).report.status,
  ).toBe('passed');
  await interact(manager, id, {
    action: 'set_viewport',
    width: 768,
    height: 800,
  });
  expect(
    (await verifyPage(manager, id, { checks: ['no_horizontal_overflow'] }))
      .report.status,
  ).toBe('passed');
});
it('re-redacts historical records using newly entered secrets', async () => {
  const manager = service();
  const { session_id: id } = await manager.open({
    html: '<input id="pw" type="password"><script>console.error("dummy.se+cret[1]")</script>',
  });
  await interact(manager, id, {
    action: 'type_text',
    selector: '#pw',
    text: 'dummy.se+cret[1]',
  });
  const { report } = await verifyPage(manager, id);
  expect(JSON.stringify(report)).not.toContain('dummy.se+cret[1]');
  expect(report.evidence).toContainEqual(
    expect.objectContaining({
      type: 'console',
      data: expect.objectContaining({ text: '[REDACTED]' }),
    }),
  );
});
it('returns errored document checks and closes a stalled inspection without losing collected errors', async () => {
  const manager = service({ ACTION_TIMEOUT_MS: '300' });
  const { session_id: id } = await manager.open({
    html: '<h1>Hang</h1><script>console.error("prior error");Object.defineProperty(document,"readyState",{get(){while(true){}}})</script>',
  });
  const { report } = await verifyPage(manager, id);
  expect(report.session_closed).toBe(true);
  expect(check(report, 'page_loads').status).toBe('error');
  expect(check(report, 'no_horizontal_overflow').status).toBe('error');
  expect(check(report, 'no_console_errors').status).toBe('failed');
  expect(report.score).toBeNull();
  expect(manager.size).toBe(0);
  const next = await manager.open({ html: '<h1>Healthy</h1>' });
  expect((await verifyPage(manager, next.session_id)).report.status).toBe(
    'passed',
  );
});
it('reports screenshot failure explicitly while preserving the check verdicts', async () => {
  const manager = service({ MAX_SCREENSHOT_BYTES: '1024' });
  const { session_id: id } = await manager.open({
    html: '<h1>Detailed screenshot text '.repeat(100),
  });
  const { report, image } = await verifyPage(manager, id, {
    include_screenshot: true,
  });
  expect(image).toBeUndefined();
  expect(report.screenshot?.status).toBe('error');
  expect(report.status).toBe('error');
  expect(report.evidence).toContainEqual(
    expect.objectContaining({
      type: 'operation',
      data: expect.objectContaining({ code: 'SCREENSHOT_LIMIT' }),
    }),
  );
  expectReferences(report);
});
it('bounds report evidence without dangling references, changing findings, or clearing diagnostics', async () => {
  const manager = service({ MAX_OUTPUT_BYTES: '8192' });
  const { session_id: id } = await manager.open({ html: '<h1>Flood</h1>' });
  await manager.use(id, async ({ page }) => {
    await page.evaluate(() => {
      for (let i = 0; i < 510; i++)
        console.error('record ' + i + ' ' + 'X'.repeat(1500));
    });
  });
  const { report } = await verifyPage(manager, id, { evidence_limit: 20 });
  expect(Buffer.byteLength(JSON.stringify(report))).toBeLessThanOrEqual(8192);
  expect(check(report, 'no_console_errors').observed_failures).toBe(500);
  expect(check(report, 'no_console_errors').omitted_evidence).toBeGreaterThan(
    480,
  );
  expect(report.status).toBe('failed');
  expectReferences(report);
  await manager.use(id, async ({ events }) => {
    expect(events.console.values()).toHaveLength(500);
  });
});
