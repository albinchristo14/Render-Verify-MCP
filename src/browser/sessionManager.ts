import { randomUUID } from 'node:crypto';
import { errors, type BrowserContext, type Page } from 'playwright';
import type { Config } from '../config.js';
import { ToolError } from '../errors.js';
import { EventCollectors } from '../collectors/events.js';
import { BrowserManager } from './browserManager.js';
import { redactUrl } from '../security/redaction.js';

export type Session = {
  id: string;
  context: BrowserContext;
  page: Page;
  events: EventCollectors;
  lastUsed: number;
  busy: boolean;
  httpStatus: number | null;
  rawHtml: boolean;
};
export type OpenInput = {
  url?: string;
  html?: string;
  viewport?: { width: number; height: number };
  wait_until?: 'load' | 'domcontentloaded';
  timeout_ms?: number;
};
export class SessionManager {
  private readonly sessions = new Map<string, Session>();
  private pending = 0;
  private closed = false;
  private readonly timer: NodeJS.Timeout;
  constructor(
    readonly config: Config,
    readonly browsers = new BrowserManager(config),
    private readonly now = Date.now,
  ) {
    this.timer = setInterval(
      () => {
        void this.sweepExpired().catch(() => undefined);
      },
      Math.min(30_000, config.sessionTtlMs / 2),
    );
    this.timer.unref();
  }
  get size(): number {
    return this.sessions.size;
  }

  async open(input: OpenInput) {
    if ((input.url === undefined) === (input.html === undefined))
      throw new ToolError(
        'INVALID_INPUT',
        'Provide exactly one of url or html.',
      );
    if (input.html !== undefined && Buffer.byteLength(input.html) > 262_144)
      throw new ToolError(
        'INVALID_INPUT',
        'HTML exceeds the 256 KiB input limit.',
      );
    if (this.closed)
      throw new ToolError('BROWSER_ERROR', 'Browser service is closed.');
    await this.sweepExpired();
    if (this.size + this.pending >= this.config.maxSessions)
      throw new ToolError(
        'SESSION_LIMIT',
        'Maximum session count reached. Close a session before opening another.',
        true,
      );
    this.pending++;
    let context: BrowserContext | undefined;
    let session: Session | undefined;
    const start = this.now();
    try {
      if (input.url) await this.browsers.guard.resolve(input.url);
      const browser = await this.browsers.get();
      if (this.closed)
        throw new ToolError('BROWSER_ERROR', 'Browser service is closed.');
      context = await browser.newContext({
        viewport: input.viewport ?? { width: 1280, height: 800 },
        serviceWorkers: 'block',
        acceptDownloads: false,
        javaScriptEnabled: true,
      });
      context.setDefaultTimeout(this.config.actionTimeoutMs);
      context.setDefaultNavigationTimeout(this.config.navigationTimeoutMs);
      const page = await context.newPage();
      const events = new EventCollectors(page);
      session = {
        id: randomUUID(),
        context,
        page,
        events,
        lastUsed: this.now(),
        busy: true,
        httpStatus: null,
        rawHtml: input.html !== undefined,
      };
      page.on('request', (request) => {
        if (
          request.isNavigationRequest() &&
          request.frame() === page.mainFrame()
        ) {
          session!.httpStatus = null;
          session!.rawHtml = false;
        }
      });
      page.on('response', (response) => {
        if (
          response.request().isNavigationRequest() &&
          response.frame() === page.mainFrame()
        ) {
          session!.httpStatus = response.status();
        }
      });
      // A session owns one page. Prevent popups and their uncollected state.
      context.on('page', (newPage) => {
        if (newPage !== page) void newPage.close().catch(() => undefined);
      });
      await context.route('**/*', async (route) => {
        const request = route.request();
        try {
          this.browsers.guard.parse(request.url());
          await route.continue();
        } catch {
          events.blocked(
            request.url(),
            request.method(),
            request.resourceType(),
          );
          await route.abort('blockedbyclient').catch(() => undefined);
        }
      });
      const options = {
        waitUntil: input.wait_until ?? 'load',
        timeout: Math.min(
          input.timeout_ms ?? this.config.navigationTimeoutMs,
          this.config.navigationTimeoutMs,
        ),
      };
      if (input.url) {
        const response = await page.goto(input.url, options);
        session.httpStatus = response?.status() ?? null;
        if (
          session.httpStatus === 403 &&
          response?.headers()['x-render-verify-policy'] === 'blocked'
        ) {
          throw new ToolError(
            'URL_BLOCKED',
            'Destination blocked by browser network policy.',
          );
        }
      } else {
        await page.setContent(input.html!, options);
      }
      if (this.closed)
        throw new ToolError('BROWSER_ERROR', 'Browser service is closed.');
      session.busy = false;
      session.lastUsed = this.now();
      this.sessions.set(session.id, session);
      return {
        session_id: session.id,
        final_url:
          input.html !== undefined ? 'about:blank' : redactUrl(page.url()),
        http_status: session.httpStatus,
        load_time_ms: Math.max(0, this.now() - start),
        console_error_count: events.console
          .values()
          .filter((entry) => entry.level === 'error').length,
        page_error_count: events.pageErrors.values().length,
        network_failure_count: events.network.values().length,
        content_trust: 'untrusted' as const,
      };
    } catch (error) {
      await context?.close().catch(() => undefined);
      if (error instanceof ToolError) throw error;
      if (error instanceof errors.TimeoutError)
        throw new ToolError(
          'NAVIGATION_TIMEOUT',
          'Page loading exceeded the configured timeout.',
          true,
        );
      throw new ToolError(
        'BROWSER_ERROR',
        'The page could not be loaded. Check the destination and browser network policy.',
        true,
      );
    } finally {
      this.pending--;
    }
  }

  async use<T>(
    id: string,
    action: (session: Session) => Promise<T>,
  ): Promise<T> {
    const session = this.sessions.get(id);
    if (!session)
      throw new ToolError(
        'SESSION_NOT_FOUND',
        'Session does not exist or has been closed.',
      );
    if (session.page.isClosed()) {
      this.sessions.delete(id);
      await session.context.close().catch(() => undefined);
      throw new ToolError(
        'SESSION_NOT_FOUND',
        'Session browser page is no longer available.',
      );
    }
    if (
      !session.busy &&
      this.now() - session.lastUsed >= this.config.sessionTtlMs
    ) {
      this.sessions.delete(id);
      await session.context.close();
      throw new ToolError('SESSION_EXPIRED', 'Session has expired.');
    }
    if (session.busy)
      throw new ToolError(
        'SESSION_BUSY',
        'Another action is using this session.',
        true,
      );
    session.busy = true;
    try {
      return await action(session);
    } finally {
      session.busy = false;
      session.lastUsed = this.now();
    }
  }
  /** Cancel an operation whose browser protocol call exceeded its hard deadline. */
  async discardSession(id: string): Promise<void> {
    const session = this.sessions.get(id);
    this.sessions.delete(id);
    await session?.context.close().catch(() => undefined);
  }
  async closeSession(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session)
      throw new ToolError(
        'SESSION_NOT_FOUND',
        'Session does not exist or has been closed.',
      );
    if (session.busy)
      throw new ToolError(
        'SESSION_BUSY',
        'Another action is using this session.',
        true,
      );
    this.sessions.delete(id);
    await session.context.close();
  }
  async sweepExpired(): Promise<void> {
    const expired = [...this.sessions.values()].filter(
      (session) =>
        !session.busy &&
        this.now() - session.lastUsed >= this.config.sessionTtlMs,
    );
    await Promise.all(
      expired.map(async (session) => {
        this.sessions.delete(session.id);
        await session.context.close();
      }),
    );
  }
  async close(): Promise<void> {
    this.closed = true;
    clearInterval(this.timer);
    await Promise.allSettled(
      [...this.sessions.values()].map((session) => session.context.close()),
    );
    this.sessions.clear();
    await this.browsers.close();
  }
}
