import { chromium, type Browser } from 'playwright';
import type { Config } from '../config.js';
import { ToolError } from '../errors.js';
import { EgressProxy } from '../security/egressProxy.js';
import { UrlGuard } from '../security/urlGuard.js';

export class BrowserManager {
  private starting: Promise<Browser> | undefined;
  private proxy: EgressProxy | undefined;
  private closed = false;
  constructor(
    private readonly config: Config,
    readonly guard = new UrlGuard(config),
  ) {}

  get(): Promise<Browser> {
    if (this.closed)
      return Promise.reject(
        new ToolError('BROWSER_ERROR', 'Browser manager is closed.'),
      );
    this.starting ??= this.launch().catch((error: unknown) => {
      this.starting = undefined;
      throw error;
    });
    return this.starting;
  }
  private async launch(): Promise<Browser> {
    const proxy = new EgressProxy(this.guard);
    this.proxy = proxy;
    try {
      const proxyServer = await proxy.start();
      const browser = await chromium.launch({
        headless: true,
        ...(this.config.browserExecutablePath
          ? { executablePath: this.config.browserExecutablePath }
          : {}),
        proxy: { server: proxyServer, bypass: '<-loopback>' },
        args: [
          '--disable-quic',
          '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
        ],
      });
      browser.once('disconnected', () => {
        if (!this.closed) {
          this.starting = undefined;
          void proxy.close().catch(() => undefined);
        }
      });
      return browser;
    } catch {
      await proxy.close();
      throw new ToolError(
        'BROWSER_ERROR',
        'Chromium could not start. Install the browser and OS dependencies or check BROWSER_EXECUTABLE_PATH.',
        true,
      );
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    const browser = await this.starting?.catch(() => undefined);
    try {
      await browser?.close();
    } finally {
      await this.proxy?.close();
    }
  }
}
