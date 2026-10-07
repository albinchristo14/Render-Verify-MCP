import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { permittedAddress, UrlGuard } from '../../src/security/urlGuard.js';
import { redactText, redactUrl } from '../../src/security/redaction.js';
import { RingBuffer } from '../../src/collectors/ringBuffer.js';
import { jsonResult } from '../../src/tools/results.js';

it.each([
  '127.0.0.1',
  '10.0.0.1',
  '172.16.0.1',
  '192.168.0.1',
  '169.254.169.254',
  '100.64.0.1',
  '0.0.0.0',
  '255.255.255.255',
  '::1',
  'fe80::1',
  'fc00::1',
  '::ffff:127.0.0.1',
  '64:ff9b::a00:1',
])('blocks non-public address %s', (address) => {
  expect(permittedAddress(address, false)).toBe(false);
});
it.each(['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111'])(
  'allows public address %s',
  (address) => {
    expect(permittedAddress(address, false)).toBe(true);
  },
);
it('keeps link-local metadata blocked even in local development mode', () => {
  expect(permittedAddress('169.254.169.254', true)).toBe(false);
  expect(permittedAddress('fe80::1', true)).toBe(false);
  expect(permittedAddress('127.0.0.1', true)).toBe(true);
});
it.each([
  'file:///etc/passwd',
  'javascript:alert(1)',
  'data:text/html,hello',
  'ftp://example.com',
  'http://user:secret@example.com',
])('rejects unsafe URL %s', (url) => {
  expect(() => new UrlGuard(loadConfig({})).parse(url)).toThrow();
});
it.each([
  'http://2130706433',
  'http://0x7f000001',
  'http://[::ffff:127.0.0.1]',
])('rejects normalized private URL %s', async (url) => {
  await expect(new UrlGuard(loadConfig({})).resolve(url)).rejects.toMatchObject(
    { code: 'URL_BLOCKED' },
  );
});
it('rejects mixed DNS answers and rechecks changed answers on every connection', async () => {
  let answers = [{ address: '1.1.1.1', family: 4 }];
  const guard = new UrlGuard(loadConfig({}), async () => answers);
  expect((await guard.resolve('https://public.example')).address).toBe(
    '1.1.1.1',
  );
  answers = [{ address: '127.0.0.1', family: 4 }];
  await expect(guard.resolve('https://public.example')).rejects.toMatchObject({
    code: 'URL_BLOCKED',
  });
  answers = [
    { address: '1.1.1.1', family: 4 },
    { address: '10.0.0.1', family: 4 },
  ];
  await expect(guard.resolve('https://public.example')).rejects.toMatchObject({
    code: 'URL_BLOCKED',
  });
});
it('uses exact allowlists, not domain suffixes', async () => {
  const guard = new UrlGuard(
    loadConfig({ ALLOW_LOCAL: 'true', ALLOWED_DOMAINS: 'localhost,127.0.0.1' }),
    async () => [{ address: '127.0.0.1', family: 4 }],
  );
  expect((await guard.resolve('http://LOCALHOST./')).address).toBe('127.0.0.1');
  await expect(
    guard.resolve('http://localhost.evil.example'),
  ).rejects.toMatchObject({ code: 'URL_BLOCKED' });
});
it.each([
  { ALLOW_LOCAL: 'true' },
  { ALLOW_LOCAL: '1' },
  { MAX_SESSIONS: '0' },
  { NAVIGATION_TIMEOUT_MS: 'NaN' },
  { ALLOWED_DOMAINS: '*.example.com' },
])('rejects invalid configuration %j', (env) => {
  expect(() => loadConfig(env)).toThrow();
});
describe('bounded evidence', () => {
  it('retains recent records and reports dropped evidence', () => {
    const buffer = new RingBuffer<number>(2);
    buffer.push(1);
    buffer.push(2);
    buffer.push(3);
    expect(buffer.values()).toEqual([2, 3]);
    expect(buffer.dropped).toBe(1);
    buffer.remove((item) => item === 2);
    expect(buffer.values()).toEqual([3]);
    buffer.clear();
    expect(buffer.values()).toEqual([]);
    expect(buffer.dropped).toBe(0);
  });
  it('redacts known URL credentials and secret patterns', () => {
    expect(
      redactUrl('https://u:p@example.com/path?token=secret&view=ok#password'),
    ).not.toMatch(/secret|u:p|password/);
    expect(
      redactText(
        'Authorization: Bearer abc123 password=hidden https://example.com/?api_key=hidden',
      ),
    ).not.toMatch(/abc123|hidden/);
    expect(redactText('x'.repeat(2000))).toHaveLength(1024);
  });
  it('rejects oversized JSON output rather than losing evidence silently', () => {
    expect(() => jsonResult({ message: 'x'.repeat(100) }, 32)).toThrow();
  });
});
