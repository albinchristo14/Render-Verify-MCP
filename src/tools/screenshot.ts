import { ToolError } from '../errors.js';
import type { Config } from '../config.js';
import type { Session, SessionManager } from '../browser/sessionManager.js';

export async function screenshot(
  sessions: SessionManager,
  input: {
    session_id: string;
    full_page?: boolean;
    selector?: string;
    format?: 'png' | 'jpeg';
  },
): Promise<{ type: 'image'; mimeType: string; data: string }> {
  return sessions.use(input.session_id, async (session) => {
    return captureScreenshot(session, sessions.config, input);
  });
}

/** Caller must hold the session lock. Used by verification without nested locking. */
export async function captureScreenshot(
  session: Session,
  config: Config,
  input: { full_page?: boolean; selector?: string; format?: 'png' | 'jpeg' },
  timeout = config.actionTimeoutMs,
): Promise<{ type: 'image'; mimeType: string; data: string }> {
  const page = session.page;
  let clip = { x: 0, y: 0, ...page.viewportSize()! };
  if (input.selector) {
    const locator = page.locator(input.selector);
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    if (!box)
      throw new ToolError(
        'INVALID_INPUT',
        'Screenshot element is not visible.',
      );
    const scroll = await page.evaluate(() => ({
      x: window.scrollX,
      y: window.scrollY,
    }));
    clip = { ...box, x: box.x + scroll.x, y: box.y + scroll.y };
  } else if (input.full_page) {
    const size = await page.evaluate(() => ({
      width: Math.max(
        document.documentElement.scrollWidth,
        document.body?.scrollWidth ?? 0,
      ),
      height: Math.max(
        document.documentElement.scrollHeight,
        document.body?.scrollHeight ?? 0,
      ),
    }));
    clip = { x: 0, y: 0, ...size };
  }
  if (
    Object.values(clip).some((value) => !Number.isFinite(value)) ||
    clip.x < 0 ||
    clip.y < 0 ||
    clip.width <= 0 ||
    clip.height <= 0 ||
    clip.width > 4096 ||
    clip.height > 8192 ||
    clip.width * clip.height > 16_000_000
  ) {
    throw new ToolError(
      'SCREENSHOT_LIMIT',
      'Screenshot dimensions exceed the configured safety bounds.',
    );
  }
  // Use a fixed clip so page growth cannot inflate allocation after measurement.
  const format = input.format ?? 'png';
  const data = await page.screenshot({
    type: format,
    clip,
    timeout,
  });
  if (data.byteLength > config.maxScreenshotBytes)
    throw new ToolError(
      'SCREENSHOT_LIMIT',
      'Screenshot exceeds the configured byte limit.',
    );
  return {
    type: 'image',
    mimeType: format === 'png' ? 'image/png' : 'image/jpeg',
    data: data.toString('base64'),
  };
}
