import type { Page } from 'playwright';
import { ToolError } from '../errors.js';
import { RingBuffer } from './ringBuffer.js';
import { redactText, redactUrl } from '../security/redaction.js';

export type ConsoleRecord = {
  level: 'error' | 'warning';
  text: string;
  timestamp: string;
};
export type PageErrorRecord = { message: string; timestamp: string };
export type NetworkRecord = {
  type: 'request_failed' | 'http_error' | 'policy_blocked';
  url: string;
  method: string;
  resource_type: string;
  status?: number;
  message?: string;
  timestamp: string;
};
export class EventCollectors {
  readonly console = new RingBuffer<ConsoleRecord>(500);
  readonly pageErrors = new RingBuffer<PageErrorRecord>(200);
  readonly network = new RingBuffer<NetworkRecord>(1000);
  private readonly enteredValues = new Set<string>();
  private enteredCharacters = 0;
  private enteredPattern: RegExp | undefined;
  protectEnteredValue(value: string): void {
    if (!value || this.enteredValues.has(value)) return;
    if (
      this.enteredValues.size >= 128 ||
      this.enteredCharacters + value.length > 65_536
    )
      throw new ToolError(
        'INPUT_LIMIT',
        'Session input-redaction capacity reached. Open a new session.',
      );
    this.enteredValues.add(value);
    this.enteredCharacters += value.length;
    const variants = [...this.enteredValues].flatMap((entered) => {
      try {
        return [entered, encodeURIComponent(entered)];
      } catch {
        return [entered];
      }
    });
    this.enteredPattern = new RegExp(
      [...new Set(variants)]
        .sort((a, b) => b.length - a.length)
        .map((entered) => entered.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|'),
      'g',
    );
  }
  private hideEnteredValues(value: string): string {
    return this.enteredPattern
      ? value.replace(this.enteredPattern, '[REDACTED]')
      : value;
  }
  sanitize(value: string): string {
    return redactText(this.hideEnteredValues(value));
  }
  sanitizeUrl(value: string): string {
    return redactUrl(this.hideEnteredValues(value));
  }
  constructor(page: Page) {
    page.on('console', (event) => {
      const level = event.type();
      if (level === 'error' || level === 'warning')
        this.console.push({
          level,
          text: this.sanitize(event.text()),
          timestamp: new Date().toISOString(),
        });
    });
    page.on('pageerror', (error) =>
      this.pageErrors.push({
        message: this.sanitize(error.message),
        timestamp: new Date().toISOString(),
      }),
    );
    page.on('requestfailed', (request) =>
      this.network.push({
        type: 'request_failed',
        url: this.sanitizeUrl(request.url()),
        method: request.method(),
        resource_type: request.resourceType(),
        message: this.sanitize(
          request.failure()?.errorText ?? 'Request failed',
        ),
        timestamp: new Date().toISOString(),
      }),
    );
    page.on('response', (response) => {
      if (response.status() >= 400)
        this.network.push({
          type: 'http_error',
          url: this.sanitizeUrl(response.url()),
          method: response.request().method(),
          resource_type: response.request().resourceType(),
          status: response.status(),
          timestamp: new Date().toISOString(),
        });
    });
  }
  checkpoint() {
    return {
      console: this.console.cursor,
      pageErrors: this.pageErrors.cursor,
      network: this.network.cursor,
    };
  }
  changes(cursor: ReturnType<EventCollectors['checkpoint']>, limit = 20) {
    const console = this.console.since(cursor.console);
    const pageErrors = this.pageErrors.since(cursor.pageErrors);
    const network = this.network.since(cursor.network);
    return {
      console: console.records.slice(0, limit),
      page_errors: pageErrors.records.slice(0, limit),
      network_failures: network.records.slice(0, limit),
      remaining: {
        console: Math.max(0, console.records.length - limit),
        page_errors: Math.max(0, pageErrors.records.length - limit),
        network_failures: Math.max(0, network.records.length - limit),
      },
      dropped: {
        console: console.dropped,
        page_errors: pageErrors.dropped,
        network_failures: network.dropped,
      },
    };
  }
  blocked(url: string, method: string, resourceType: string): void {
    this.network.push({
      type: 'policy_blocked',
      url: this.sanitizeUrl(url),
      method,
      resource_type: resourceType,
      message: 'Destination blocked by URL policy.',
      timestamp: new Date().toISOString(),
    });
  }
}
