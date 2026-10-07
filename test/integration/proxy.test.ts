import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { expect, it } from 'vitest';
import { EgressProxy } from '../../src/security/egressProxy.js';
import { UrlGuard } from '../../src/security/urlGuard.js';
import { loadConfig } from '../../src/config.js';
import { startFixtureServer } from '../../fixtures/server.js';

it('denies private destinations through the HTTP proxy without contacting them', async () => {
  const fixture = await startFixtureServer();
  const proxy = new EgressProxy(new UrlGuard(loadConfig({})));
  try {
    const proxyUrl = new URL(await proxy.start());
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = http.get(
        {
          hostname: proxyUrl.hostname,
          port: proxyUrl.port,
          path: fixture.baseUrl + '/secret',
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        },
      );
      req.on('error', reject);
    });
    expect(status).toBe(403);
    expect(fixture.hits).toEqual([]);
  } finally {
    await proxy.close();
    await fixture.close();
  }
});
it('pins CONNECT tunnels to the policy resolver address', async () => {
  const fixture = await startFixtureServer();
  const guard = new UrlGuard(
    loadConfig({ ALLOW_LOCAL: 'true', ALLOWED_DOMAINS: 'fixture.invalid' }),
    async () => [{ address: '127.0.0.1', family: 4 }],
  );
  const proxy = new EgressProxy(guard);
  let socket: net.Socket | undefined;
  try {
    const proxyUrl = new URL(await proxy.start());
    socket = net.connect(Number(proxyUrl.port), proxyUrl.hostname);
    await once(socket, 'connect', { signal: AbortSignal.timeout(5000) });
    const connected = once(socket, 'data', {
      signal: AbortSignal.timeout(5000),
    });
    socket.write(
      `CONNECT fixture.invalid:${new URL(fixture.baseUrl).port} HTTP/1.1\r\nHost: fixture.invalid\r\n\r\n`,
    );
    const [head] = await connected;
    expect((head as Buffer).toString()).toContain('200 Connection Established');
    let body = '';
    socket.on('data', (data: Buffer) => {
      body += data.toString();
    });
    const closed = once(socket, 'close', { signal: AbortSignal.timeout(5000) });
    socket.write(
      'GET /clean HTTP/1.1\r\nHost: fixture.invalid\r\nConnection: close\r\n\r\n',
    );
    await closed;
    expect(body).toContain('Clean fixture');
    expect(fixture.hits).toContain('/clean');
  } finally {
    socket?.destroy();
    await proxy.close();
    await fixture.close();
  }
});
it('refuses private CONNECT targets before creating an outbound tunnel', async () => {
  const proxy = new EgressProxy(new UrlGuard(loadConfig({})));
  let socket: net.Socket | undefined;
  try {
    const proxyUrl = new URL(await proxy.start());
    socket = net.connect(Number(proxyUrl.port), proxyUrl.hostname);
    await once(socket, 'connect', { signal: AbortSignal.timeout(5000) });
    const response = once(socket, 'data', {
      signal: AbortSignal.timeout(5000),
    });
    socket.write(
      'CONNECT 169.254.169.254:80 HTTP/1.1\r\nHost: metadata\r\n\r\n',
    );
    const [data] = await response;
    expect((data as Buffer).toString()).toContain('403 Forbidden');
  } finally {
    socket?.destroy();
    await proxy.close();
  }
});

it('blocks CONNECT back to the proxy through an IPv4-mapped IPv6 address', async () => {
  const proxy = new EgressProxy(
    new UrlGuard(
      loadConfig({ ALLOW_LOCAL: 'true', ALLOWED_DOMAINS: '::ffff:7f00:1' }),
    ),
  );
  let socket: net.Socket | undefined;
  try {
    const proxyUrl = new URL(await proxy.start());
    socket = net.connect(Number(proxyUrl.port), proxyUrl.hostname);
    await once(socket, 'connect', { signal: AbortSignal.timeout(5000) });
    const response = once(socket, 'data', {
      signal: AbortSignal.timeout(5000),
    });
    socket.write(
      `CONNECT [::ffff:127.0.0.1]:${proxyUrl.port} HTTP/1.1\r\nHost: proxy\r\n\r\n`,
    );
    const [data] = await response;
    expect((data as Buffer).toString()).toContain('403 Forbidden');
  } finally {
    socket?.destroy();
    await proxy.close();
  }
});
