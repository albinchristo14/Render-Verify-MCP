import { errors } from 'playwright';
import type { SessionManager } from '../browser/sessionManager.js';
import { ToolError } from '../errors.js';
import { toToolError } from './results.js';
import { withDeadline } from './deadline.js';

export type WaitFor = {
  selector: string;
  state?: 'visible' | 'hidden' | 'attached' | 'detached';
};
export type Interaction =
  | {
      action: 'click';
      selector: string;
      timeout_ms?: number;
      wait_for?: WaitFor;
    }
  | {
      action: 'type_text';
      selector: string;
      text: string;
      press_enter?: boolean;
      timeout_ms?: number;
      wait_for?: WaitFor;
    }
  | {
      action: 'navigate';
      url: string;
      wait_until?: 'load' | 'domcontentloaded';
      timeout_ms?: number;
      wait_for?: WaitFor;
    }
  | {
      action: 'set_viewport';
      width: number;
      height: number;
      timeout_ms?: number;
      wait_for?: WaitFor;
    };

export async function interact(
  sessions: SessionManager,
  id: string,
  input: Interaction,
) {
  return sessions.use(id, async (session) => {
    const checkpoint = session.events.checkpoint();
    const beforeUrl = session.page.url();
    const started = Date.now();
    const maxTimeout =
      input.action === 'navigate'
        ? sessions.config.navigationTimeoutMs
        : sessions.config.actionTimeoutMs;
    const timeout = Math.min(input.timeout_ms ?? maxTimeout, maxTimeout);
    let failure: ToolError | undefined;
    try {
      await withDeadline(
        sessions,
        id,
        timeout,
        async (remaining) => {
          if (input.action === 'navigate') {
            await sessions.browsers.guard.resolve(input.url);
            const response = await session.page.goto(input.url, {
              waitUntil: input.wait_until ?? 'load',
              timeout: remaining(),
            });
            session.httpStatus = response?.status() ?? null;
            session.rawHtml = false;
            if (response?.headers()['x-render-verify-policy'] === 'blocked')
              throw new ToolError(
                'URL_BLOCKED',
                'Destination blocked by browser network policy.',
              );
          } else if (input.action === 'click') {
            await session.page
              .locator(input.selector)
              .click({ timeout: remaining() });
          } else if (input.action === 'type_text') {
            session.events.protectEnteredValue(input.text);
            const field = session.page.locator(input.selector);
            await field.fill(input.text, { timeout: remaining() });
            if (input.press_enter)
              await field.press('Enter', { timeout: remaining() });
          } else {
            await session.page.setViewportSize({
              width: input.width,
              height: input.height,
            });
          }
          if (input.wait_for) {
            await session.page.locator(input.wait_for.selector).waitFor({
              state: input.wait_for.state ?? 'visible',
              timeout: remaining(),
            });
          }
        },
        input.action === 'navigate' ? 'NAVIGATION_TIMEOUT' : 'ACTION_TIMEOUT',
      );
    } catch (error) {
      failure =
        error instanceof errors.TimeoutError && input.action === 'navigate'
          ? new ToolError(
              'NAVIGATION_TIMEOUT',
              'Navigation exceeded its configured timeout.',
              true,
            )
          : toToolError(error);
    }
    return {
      success: !failure,
      action: input.action,
      session_id: id,
      final_url: session.events.sanitizeUrl(session.page.url()),
      http_status: session.httpStatus,
      url_changed: beforeUrl !== session.page.url(),
      duration_ms: Date.now() - started,
      session_closed: session.page.isClosed(),
      viewport: session.page.viewportSize(),
      new_errors: session.events.changes(checkpoint),
      content_trust: 'untrusted' as const,
      ...(failure
        ? {
            error: {
              code: failure.code,
              message: failure.message,
              retryable: failure.retryable,
            },
          }
        : {}),
    };
  });
}
