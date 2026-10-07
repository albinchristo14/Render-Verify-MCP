import { afterEach, beforeAll, afterAll, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { SessionManager } from '../../src/browser/sessionManager.js';
import { screenshot } from '../../src/tools/screenshot.js';
import { startFixtureServer } from '../../fixtures/server.js';
import { BrowserManager } from '../../src/browser/browserManager.js';
import { UrlGuard } from '../../src/security/urlGuard.js';

let fixture: Awaited<ReturnType<typeof startFixtureServer>>;
const managers: SessionManager[] = [];
beforeAll(async () => {
  fixture = await startFixtureServer();
});
afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.close()));
});
afterAll(async () => {
  await fixture.close();
});
function manager(overrides: NodeJS.ProcessEnv = {}, now?: () => number) {
  const config = loadConfig({
    ...process.env,
    ALLOW_LOCAL: 'true',
    ALLOWED_DOMAINS: '127.0.0.1',
    ...overrides,
  });
  const service = new SessionManager(config, undefined, now);
  managers.push(service);
  return service;
}
it('captures intentional JS/console/asset failures and returns a real PNG screenshot', async () => {
  const service = manager();
  const opened = await service.open({ url: fixture.baseUrl + '/broken' });
  expect(opened.http_status).toBe(200);
  expect(opened.page_error_count).toBe(1);
  await service.use(opened.session_id, async ({ page, events }) => {
    expect(await page.title()).toBe('Broken fixture');
    expect(events.pageErrors.values()[0]?.message).toBe(
      'fixture uncaught failure',
    );
    expect(events.console.values()).toContainEqual(
      expect.objectContaining({
        level: 'error',
        text: 'fixture console failure',
      }),
    );
    expect(events.network.values()).toContainEqual(
      expect.objectContaining({
        type: 'http_error',
        status: 404,
        url: fixture.baseUrl + '/missing.png',
      }),
    );
  });
  const image = await screenshot(service, { session_id: opened.session_id });
  expect(image.mimeType).toBe('image/png');
  const bytes = Buffer.from(image.data, 'base64');
  expect(bytes.subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  expect(bytes.readUInt32BE(16)).toBe(1280);
  expect(bytes.readUInt32BE(20)).toBe(800);
  await service.closeSession(opened.session_id);
  expect(service.size).toBe(0);
  await expect(
    screenshot(service, { session_id: opened.session_id }),
  ).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
});
it('keeps cookies, storage, and diagnostics isolated across contexts', async () => {
  const service = manager();
  const first = await service.open({ url: fixture.baseUrl + '/cookie' });
  await service.use(first.session_id, async ({ page, events }) => {
    await page.evaluate(() => localStorage.setItem('secret', 'context-one'));
    events.pageErrors.push({
      message: 'first session only',
      timestamp: 'test',
    });
  });
  const second = await service.open({ url: fixture.baseUrl + '/clean' });
  await service.use(second.session_id, async ({ context, page, events }) => {
    expect(await context.cookies()).toEqual([]);
    expect(
      await page.evaluate(() => localStorage.getItem('secret')),
    ).toBeNull();
    expect(events.pageErrors.values()).toEqual([]);
  });
});
it('renders raw HTML and captures HTTP 500 and failed request evidence', async () => {
  const service = manager();
  const opened = await service.open({
    html: `<!doctype html><h1>Raw HTML</h1><img src="${fixture.baseUrl}/reset"><script>fetch('${fixture.baseUrl}/api-error').catch(()=>{}).finally(()=>document.body.dataset.done='yes');</script>`,
  });
  await service.use(opened.session_id, async ({ page, events }) => {
    await page.waitForFunction(() => document.body.dataset.done === 'yes');
    expect(events.network.values()).toContainEqual(
      expect.objectContaining({ status: 500 }),
    );
    expect(events.network.values()).toContainEqual(
      expect.objectContaining({ type: 'request_failed' }),
    );
  });
  expect(opened.final_url).toBe('about:blank');
  expect(opened.http_status).toBeNull();
  const image = await screenshot(service, {
    session_id: opened.session_id,
    selector: 'h1',
    format: 'jpeg',
  });
  expect(Buffer.from(image.data, 'base64').subarray(0, 2)).toEqual(
    Buffer.from([255, 216]),
  );
});
it('rejects private navigation and blocks raw HTML subresources before they reach fixtures', async () => {
  const service = manager({ ALLOW_LOCAL: 'false', ALLOWED_DOMAINS: '' });
  await expect(
    service.open({ url: fixture.baseUrl + '/secret' }),
  ).rejects.toMatchObject({ code: 'URL_BLOCKED' });
  const before = fixture.hits.length;
  const opened = await service.open({
    html: `<!doctype html><script>fetch('${fixture.baseUrl}/secret').catch(()=>{}).finally(()=>document.body.dataset.done='yes');</script>`,
  });
  await service.use(opened.session_id, async ({ page, events }) => {
    await page.waitForFunction(() => document.body.dataset.done === 'yes');
    expect(events.network.values().length).toBeGreaterThan(0);
  });
  expect(fixture.hits.length).toBe(before);
});
it('revalidates redirect hosts and cannot reach a non-allowlisted private destination', async () => {
  const service = manager();
  const before = fixture.hits.filter((hit) => hit === '/secret').length;
  await expect(
    service.open({ url: fixture.baseUrl + '/redirect-private' }),
  ).rejects.toMatchObject({ code: 'URL_BLOCKED' });
  expect(fixture.hits.filter((hit) => hit === '/secret').length).toBe(before);
  expect(service.size).toBe(0);
});
it('pins the checked IP instead of resolving the browser hostname a second time', async () => {
  const config = loadConfig({
    ...process.env,
    ALLOW_LOCAL: 'true',
    ALLOWED_DOMAINS: 'fixture.invalid',
  });
  const guard = new UrlGuard(config, async () => [
    { address: '127.0.0.1', family: 4 },
  ]);
  const service = new SessionManager(config, new BrowserManager(config, guard));
  managers.push(service);
  const url =
    fixture.baseUrl.replace('127.0.0.1', 'fixture.invalid') + '/clean';
  const opened = await service.open({ url });
  await service.use(opened.session_id, async ({ page }) => {
    expect(await page.title()).toBe('Clean fixture');
  });
});
it('bounds session count even when opens race and frees slots after close', async () => {
  const service = manager({ MAX_SESSIONS: '1' });
  const results = await Promise.allSettled([
    service.open({ html: '<h1>First</h1>' }),
    service.open({ html: '<h1>Second</h1>' }),
  ]);
  expect(
    results.filter((result) => result.status === 'fulfilled'),
  ).toHaveLength(1);
  expect(results.find((result) => result.status === 'rejected')).toMatchObject({
    reason: { code: 'SESSION_LIMIT' },
  });
  const opened = results.find((result) => result.status === 'fulfilled')!;
  if (opened.status === 'fulfilled')
    await service.closeSession(opened.value.session_id);
  expect(
    (await service.open({ html: '<h1>Replacement</h1>' })).session_id,
  ).toBeTypeOf('string');
});
it('expires idle sessions and closes their browser contexts', async () => {
  let time = 1000;
  const service = manager({ SESSION_TTL_MS: '1000' }, () => time);
  const opened = await service.open({ html: '<h1>Expire me</h1>' });
  let pageRef: import('playwright').Page | undefined;
  await service.use(opened.session_id, async ({ page }) => {
    pageRef = page;
  });
  time += 1001;
  await service.sweepExpired();
  expect(service.size).toBe(0);
  expect(pageRef?.isClosed()).toBe(true);
  await expect(
    service.use(opened.session_id, async () => null),
  ).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
});
it('does not expire a session while an action is active', async () => {
  let time = 1000;
  const service = manager({ SESSION_TTL_MS: '1000' }, () => time);
  const opened = await service.open({ html: '<h1>Busy</h1>' });
  await service.use(opened.session_id, async () => {
    time += 1001;
    await service.sweepExpired();
    expect(service.size).toBe(1);
    await expect(
      service.use(opened.session_id, async () => null),
    ).rejects.toMatchObject({ code: 'SESSION_BUSY' });
  });
  await service.use(opened.session_id, async () => null);
});
it('cleans failed navigations and handles screenshot dimension and byte limits', async () => {
  const service = manager({ NAVIGATION_TIMEOUT_MS: '300' });
  await expect(
    service.open({ url: fixture.baseUrl + '/slow' }),
  ).rejects.toMatchObject({ code: 'NAVIGATION_TIMEOUT' });
  expect(service.size).toBe(0);
  const opened = await service.open({
    html: '<!doctype html><div style="height:20000px">Tall</div>',
  });
  await expect(
    screenshot(service, { session_id: opened.session_id, full_page: true }),
  ).rejects.toMatchObject({ code: 'SCREENSHOT_LIMIT' });
  const small = manager({ MAX_SCREENSHOT_BYTES: '1024' });
  const other = await small.open({ html: '<h1>Screenshot byte limit</h1>' });
  await expect(
    screenshot(small, { session_id: other.session_id }),
  ).rejects.toMatchObject({ code: 'SCREENSHOT_LIMIT' });
});
it('validates mutually exclusive inputs and byte bounds before creating a browser', async () => {
  const service = manager();
  await expect(service.open({})).rejects.toMatchObject({
    code: 'INVALID_INPUT',
  });
  await expect(
    service.open({ url: 'https://example.com', html: 'x' }),
  ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  await expect(
    service.open({ html: '😀'.repeat(70_000) }),
  ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  expect(service.size).toBe(0);
});

it('blocks DNS rebinding between preflight and the actual proxy connection', async () => {
  const config = loadConfig({
    ...process.env,
    ALLOW_LOCAL: 'false',
    ALLOWED_DOMAINS: 'rebind.invalid',
  });
  let calls = 0;
  const guard = new UrlGuard(config, async () => [
    { address: ++calls === 1 ? '1.1.1.1' : '127.0.0.1', family: 4 },
  ]);
  const service = new SessionManager(config, new BrowserManager(config, guard));
  managers.push(service);
  const before = fixture.hits.length;
  await expect(
    service.open({
      url: fixture.baseUrl.replace('127.0.0.1', 'rebind.invalid') + '/secret',
    }),
  ).rejects.toMatchObject({ code: 'URL_BLOCKED' });
  expect(calls).toBeGreaterThan(1);
  expect(fixture.hits.length).toBe(before);
  expect(service.size).toBe(0);
});

it('closes live pages, browser, and network proxy on service shutdown', async () => {
  const service = manager();
  const opened = await service.open({ html: '<h1>Shutdown</h1>' });
  const browser = await service.browsers.get();
  let pageRef: import('playwright').Page | undefined;
  await service.use(opened.session_id, async ({ page }) => {
    pageRef = page;
  });
  await service.close();
  expect(pageRef?.isClosed()).toBe(true);
  expect(browser.isConnected()).toBe(false);
  expect(service.size).toBe(0);
  await expect(service.open({ html: 'x' })).rejects.toMatchObject({
    code: 'BROWSER_ERROR',
  });
});
