import { ToolError } from '../errors.js';
import type { SessionManager } from '../browser/sessionManager.js';

/** Close on a hard timeout so abandoned protocol calls cannot mutate a reused session. */
export async function withDeadline<T>(
  sessions: SessionManager,
  id: string,
  timeout: number,
  work: (remaining: () => number) => Promise<T>,
  code = 'ACTION_TIMEOUT',
): Promise<T> {
  const end = Date.now() + timeout;
  const hardTimeout = new ToolError(
    code,
    'Operation deadline exceeded; the session was closed to cancel pending browser work.',
  );
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(hardTimeout), timeout);
  });
  try {
    return await Promise.race([
      work(() => Math.max(1, end - Date.now())),
      expired,
    ]);
  } catch (error) {
    if (error === hardTimeout) await sessions.discardSession(id);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
