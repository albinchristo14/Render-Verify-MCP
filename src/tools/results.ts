import { errors } from 'playwright';
import { ToolError } from '../errors.js';
export function jsonResult(value: Record<string, unknown>, limit: number) {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > limit)
    throw new ToolError(
      'OUTPUT_LIMIT',
      'Diagnostic output exceeds the configured byte limit. Request fewer records.',
    );
  return {
    content: [{ type: 'text' as const, text }],
    structuredContent: value,
  };
}
export function toToolError(error: unknown): ToolError {
  return error instanceof ToolError
    ? error
    : error instanceof errors.TimeoutError
      ? new ToolError(
          'ACTION_TIMEOUT',
          'Browser action exceeded its configured timeout.',
          true,
        )
      : new ToolError(
          'BROWSER_ERROR',
          'Browser action failed. Check the session and tool inputs.',
          true,
        );
}
export function errorResult(error: unknown) {
  const known = toToolError(error);
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          error: {
            code: known.code,
            message: known.message,
            retryable: known.retryable,
          },
        }),
      },
    ],
  };
}
