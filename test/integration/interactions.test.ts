import { beforeAll, afterAll, afterEach, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { SessionManager } from '../../src/browser/sessionManager.js';
import { interact } from '../../src/tools/interactions.js';
import { getPageSnapshot } from '../../src/tools/pageSnapshot.js';
import { startFixtureServer } from '../../fixtures/server.js';

let fixture: Awaited<ReturnType<typeof startFixtureServer>>;
const services: SessionManager[] = [];
beforeAll(async () => {
  fixture = await startFixtureServer();
});
afterAll(async () => {
  await fixture.close();
});
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
});
function service(overrides: NodeJS.ProcessEnv = {}) {
  const manager = new SessionManager(
    loadConfig({
      ...process.env,
      ALLOW_LOCAL: 'true',
      ALLOWED_DOMAINS: '127.0.0.1',
      ...overrides,
    }),
  );
  services.push(manager);
  return manager;
}
it('finds labelled login controls, fills them, and exposes a failing login API as new evidence', async () => {
  const manager = service();
  const opened = await manager.open({ url: fixture.baseUrl + '/login' });
  const id = opened.session_id;
  const snapshot = await getPageSnapshot(manager, id);
  expect(snapshot.title).toBe('Fixture login');
  expect(snapshot.headings).toContainEqual(
    expect.objectContaining({ name: 'Sign in', level: 1 }),
  );
  const email = snapshot.inputs.find((input) => input.name === 'Email')!;
  const password = snapshot.inputs.find((input) => input.name === 'Password')!;
  const submit = snapshot.buttons.find((button) => button.name === 'Sign in')!;
  expect(email.selector).toBeTypeOf('string');
  expect(password.type).toBe('password');
  await manager.use(id, async ({ page }) => {
    await page.evaluate(() => console.error('older unrelated error'));
  });
  const filled = await interact(manager, id, {
    action: 'type_text',
    selector: email.selector!,
    text: 'demo@example.test',
  });
  expect(filled.success).toBe(true);
  expect(filled.new_errors.console).toEqual([]);
  expect(JSON.stringify(filled)).not.toContain('demo@example.test');
  await interact(manager, id, {
    action: 'type_text',
    selector: password.selector!,
    text: 'dummy.private+password[1]',
  });
  const result = await interact(manager, id, {
    action: 'click',
    selector: submit.selector!,
    wait_for: { selector: '#login-status' },
  });
  expect(result.success).toBe(true);
  expect(result.new_errors.console).toContainEqual(
    expect.objectContaining({ text: 'fixture submit console error' }),
  );
  expect(
    result.new_errors.console.some((entry) =>
      entry.text.includes('older unrelated'),
    ),
  ).toBe(false);
  expect(result.new_errors.page_errors).toContainEqual(
    expect.objectContaining({ message: 'fixture submit page error' }),
  );
  expect(result.new_errors.network_failures).toContainEqual(
    expect.objectContaining({
      status: 500,
      method: 'POST',
      url: fixture.baseUrl + '/api/login',
    }),
  );
  expect((await getPageSnapshot(manager, id)).visible_text).toContain(
    'Login failed: HTTP 500',
  );
  const next = await interact(manager, id, {
    action: 'type_text',
    selector: '#email',
    text: 'next@example.test',
  });
  expect(next.new_errors.network_failures).toEqual([]);
  await manager.use(id, async ({ events }) => {
    expect(events.network.values().some((entry) => entry.status === 500)).toBe(
      true,
    );
  });
});
it('supports Enter, responsive viewport waits, and click-triggered navigation with status tracking', async () => {
  const manager = service();
  const opened = await manager.open({ url: fixture.baseUrl + '/interactions' });
  const id = opened.session_id;
  const entered = await interact(manager, id, {
    action: 'type_text',
    selector: '#entry',
    text: 'Hello',
    press_enter: true,
    wait_for: { selector: '#entered' },
  });
  expect(entered.success).toBe(true);
  const resized = await interact(manager, id, {
    action: 'set_viewport',
    width: 360,
    height: 800,
    wait_for: { selector: '#resized' },
  });
  expect(resized.viewport).toEqual({ width: 360, height: 800 });
  expect(resized.new_errors.console).toContainEqual(
    expect.objectContaining({ text: 'fixture resize warning' }),
  );
  const clicked = await interact(manager, id, {
    action: 'click',
    selector: '#navigate',
    wait_for: { selector: 'h1' },
  });
  expect(clicked.success).toBe(true);
  expect(clicked.url_changed).toBe(true);
  expect(clicked.final_url).toBe(fixture.baseUrl + '/clean');
  expect(clicked.http_status).toBe(200);
});
it('navigates the same context and reports new errors without replaying prior errors', async () => {
  const manager = service();
  const { session_id: id } = await manager.open({
    url: fixture.baseUrl + '/cookie',
  });
  const result = await interact(manager, id, {
    action: 'navigate',
    url: fixture.baseUrl + '/broken',
  });
  expect(result.success).toBe(true);
  expect(result.http_status).toBe(200);
  expect(result.new_errors.page_errors).toHaveLength(1);
  expect(result.new_errors.network_failures).toContainEqual(
    expect.objectContaining({ status: 404 }),
  );
  await manager.use(id, async ({ context }) => {
    expect(
      (await context.cookies()).some((cookie) => cookie.name === 'fixture'),
    ).toBe(true);
  });
  const clean = await interact(manager, id, {
    action: 'navigate',
    url: fixture.baseUrl + '/clean',
  });
  expect(clean.new_errors.page_errors).toEqual([]);
  expect(clean.new_errors.network_failures).toEqual([]);
});
it('rejects blocked direct navigation without changing the document or reaching the server', async () => {
  const manager = service({ ALLOW_LOCAL: 'false', ALLOWED_DOMAINS: '' });
  const { session_id: id } = await manager.open({
    html: '<title>Keep me</title><h1>Keep me</h1>',
  });
  const before = fixture.hits.length;
  const blocked = await interact(manager, id, {
    action: 'navigate',
    url: fixture.baseUrl + '/secret',
  });
  expect(blocked.success).toBe(false);
  expect(blocked.error?.code).toBe('URL_BLOCKED');
  expect(blocked.url_changed).toBe(false);
  expect(fixture.hits.length).toBe(before);
  expect((await getPageSnapshot(manager, id)).title).toBe('Keep me');
});
it('blocks redirects during navigate and preserves the session for later allowed navigation', async () => {
  const manager = service();
  const { session_id: id } = await manager.open({
    url: fixture.baseUrl + '/clean',
  });
  const before = fixture.hits.filter((hit) => hit === '/secret').length;
  const blocked = await interact(manager, id, {
    action: 'navigate',
    url: fixture.baseUrl + '/redirect-private',
  });
  expect(blocked.success).toBe(false);
  expect(blocked.error?.code).toBe('URL_BLOCKED');
  expect(fixture.hits.filter((hit) => hit === '/secret').length).toBe(before);
  expect(
    (
      await interact(manager, id, {
        action: 'navigate',
        url: fixture.baseUrl + '/clean',
      })
    ).success,
  ).toBe(true);
});
it('reports capped delta records and evidence lost to ring-buffer eviction', async () => {
  const manager = service();
  const { session_id: id } = await manager.open({
    url: fixture.baseUrl + '/interactions',
  });
  const result = await interact(manager, id, {
    action: 'click',
    selector: '#flood',
    wait_for: { selector: '#done' },
  });
  expect(result.success).toBe(true);
  expect(result.new_errors.console).toHaveLength(20);
  expect(result.new_errors.dropped.console).toBe(10);
  expect(result.new_errors.remaining.console).toBe(480);
});
it('redacts literal and URL-encoded filled values, including regex characters, from diagnostics and snapshots', async () => {
  const manager = service();
  const { session_id: id } = await manager.open({
    html: `<input type="password" aria-label="Password" id="password"><button id="echo" onclick="console.error(document.querySelector('input').value);document.querySelector('p').textContent=document.querySelector('input').value">Echo</button><p></p>`,
  });
  const value = 'dummy.private+a[1]?secret';
  expect(
    (
      await interact(manager, id, {
        action: 'type_text',
        selector: '#password',
        text: value,
      })
    ).success,
  ).toBe(true);
  const echoed = await interact(manager, id, {
    action: 'click',
    selector: '#echo',
  });
  expect(echoed.new_errors.console[0]?.text).toBe('[REDACTED]');
  const snapshot = await getPageSnapshot(manager, id);
  expect(JSON.stringify(snapshot)).not.toContain(value);
  expect(snapshot.visible_text).toContain('[REDACTED]');
  await manager.use(id, async ({ events }) => {
    expect(events.sanitize(encodeURIComponent(value))).toBe('[REDACTED]');
    expect(events.sanitize('dummyXprivate+a[1]?secret')).not.toBe('[REDACTED]');
  });
});
it('bounds snapshots and excludes hidden, editable, and password contents', async () => {
  const manager = service();
  const { session_id: id } = await manager.open({
    html: `<!doctype html><title>Compact</title><main aria-label="Workspace"><h1>Visible</h1><h2 hidden>Hidden heading</h2><div style="opacity:0"><button>Invisible</button></div><label for="pw">Password</label><input id="pw" type="password" value="do-not-return"><textarea>do-not-return-textarea</textarea><div contenteditable>do-not-return-editor</div><a href="https://example.com/?token=hidden-token">Go</a>${Array.from({ length: 30 }, (_, i) => '<button>Button ' + i + '</button>').join('')}</main>`,
  });
  const snapshot = await getPageSnapshot(manager, id, 2);
  expect(snapshot.buttons).toHaveLength(2);
  expect(snapshot.truncated_categories).toContain('buttons');
  expect(snapshot.headings).toHaveLength(1);
  expect(snapshot.landmarks[0]?.name).toBe('Workspace');
  expect(JSON.stringify(snapshot)).not.toMatch(
    /do-not-return|Hidden heading|Invisible|hidden-token/,
  );
  expect(snapshot.content_trust).toBe('untrusted');
  expect(snapshot.scan_limit_reached).toBe(false);
});
it('limits DOM scanning and discloses truncated snapshots for huge documents', async () => {
  const manager = service();
  const { session_id: id } = await manager.open({
    html: '<main>' + '<span>x</span>'.repeat(6000) + '</main>',
  });
  const snapshot = await getPageSnapshot(manager, id);
  expect(snapshot.scanned_elements).toBe(5000);
  expect(snapshot.scan_limit_reached).toBe(true);
});
it('cancels a hung snapshot by closing its context without breaking subsequent sessions', async () => {
  const manager = service({ ACTION_TIMEOUT_MS: '300' });
  const { session_id: id } = await manager.open({
    html: '<h1>Hang</h1><script>document.createTreeWalker=()=>{while(true){}}</script>',
  });
  await expect(getPageSnapshot(manager, id)).rejects.toMatchObject({
    code: 'ACTION_TIMEOUT',
  });
  expect(manager.size).toBe(0);
  const next = await manager.open({ html: '<h1>Healthy</h1>' });
  expect(
    (await getPageSnapshot(manager, next.session_id)).headings[0]?.name,
  ).toBe('Healthy');
});
it('returns actionable timeout evidence and does not leave overlapping pending work', async () => {
  const manager = service({
    ACTION_TIMEOUT_MS: '200',
    NAVIGATION_TIMEOUT_MS: '300',
  });
  const { session_id: id } = await manager.open({ html: '<h1>Wait</h1>' });
  const failed = await interact(manager, id, {
    action: 'click',
    selector: '#missing',
  });
  expect(failed.success).toBe(false);
  expect(failed.error?.code).toBe('ACTION_TIMEOUT');
  const { session_id: other } = await manager.open({
    html: '<h1>Navigation timeout</h1>',
  });
  const slow = await interact(manager, other, {
    action: 'navigate',
    url: fixture.baseUrl + '/slow',
  });
  expect(slow.success).toBe(false);
  expect(slow.error?.code).toBe('NAVIGATION_TIMEOUT');
});
