import http from 'node:http';
import ipaddr from 'ipaddr.js';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { UrlGuard } from './urlGuard.js';

/** Resolve at connection time, then connect to the checked IP, never a hostname. */
export class EgressProxy {
  private readonly sockets = new Set<net.Socket>();
  private readonly server = http.createServer((req, res) => {
    void this.forward(req, res);
  });
  private port = 0;
  private closing = false;

  constructor(private readonly guard: UrlGuard) {
    this.server.maxConnections = 256;
    this.server.headersTimeout = 10_000;
    this.server.requestTimeout = 60_000;
    this.server.on('connection', (socket) => this.track(socket));
    this.server.on('connect', (req, client, head) => {
      void this.tunnel(req, client, head);
    });
    this.server.on('clientError', (_error, socket) => socket.destroy());
  }

  private track(socket: net.Socket): void {
    this.sockets.add(socket);
    socket.on('error', () => socket.destroy());
    socket.once('close', () => this.sockets.delete(socket));
    socket.setTimeout(30_000, () => socket.destroy());
    if (this.closing) socket.destroy();
  }

  async start(): Promise<string> {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => {
        this.server.off('error', reject);
        resolve();
      });
    });
    this.port = (this.server.address() as AddressInfo).port;
    return `http://127.0.0.1:${this.port}`;
  }

  private async destination(value: string) {
    const target = await this.guard.resolve(value);
    if (
      this.closing ||
      (target.port === this.port &&
        ipaddr.process(target.address).range() === 'loopback')
    ) {
      throw new Error('Proxy destination blocked');
    }
    return target;
  }

  private async forward(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    try {
      const target = await this.destination(req.url ?? '');
      if (res.destroyed || this.closing) return;
      if (target.url.protocol !== 'http:') throw new Error();
      const headers: http.OutgoingHttpHeaders = {
        ...req.headers,
        host: target.url.host,
        connection: 'close',
      };
      delete headers['proxy-authorization'];
      delete headers['proxy-connection'];
      const upstream = http.request(
        {
          hostname: target.address,
          family: target.family,
          port: target.port,
          method: req.method,
          path: target.url.pathname + target.url.search,
          headers,
        },
        (response) => {
          res.writeHead(response.statusCode ?? 502, response.headers);
          response.on('error', () => res.destroy());
          response.pipe(res);
        },
      );
      upstream.on('socket', (socket) => this.track(socket));
      upstream.on('error', () => {
        res.destroy();
      });
      res.once('close', () => upstream.destroy());
      req.on('error', () => upstream.destroy());
      req.pipe(upstream);
    } catch {
      res.writeHead(403, {
        'content-type': 'text/plain',
        'x-render-verify-policy': 'blocked',
      });
      res.end('Destination blocked by browser network policy.');
    }
  }

  private async tunnel(
    req: http.IncomingMessage,
    client: Duplex,
    head: Buffer,
  ): Promise<void> {
    try {
      const authority = req.url ?? '';
      const parsed = new URL(`https://${authority}`);
      if (parsed.pathname !== '/' || parsed.search || parsed.hash)
        throw new Error();
      const target = await this.destination(parsed.href);
      if (client.destroyed || this.closing) return;
      const upstream = net.connect({
        host: target.address,
        family: target.family,
        port: target.port,
      });
      this.track(upstream);
      upstream.once('connect', () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        upstream.pipe(client);
        client.pipe(upstream);
      });
      upstream.once('error', () => client.destroy());
      client.once('close', () => upstream.destroy());
      upstream.once('close', () => client.destroy());
    } catch {
      client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    }
  }

  async close(): Promise<void> {
    this.closing = true;
    for (const socket of this.sockets) socket.destroy();
    if (!this.server.listening) return;
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}
