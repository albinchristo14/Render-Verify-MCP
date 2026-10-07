import { z } from 'zod';
import { isIP } from 'node:net';

export function normalizeHost(host: string): string {
  return host
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
}

const integer = (fallback: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(fallback);
const hosts = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((host) => normalizeHost(host.trim()))
      .filter(Boolean),
  )
  .refine(
    (values) =>
      values.length <= 50 &&
      values.every(
        (host) =>
          isIP(host) ||
          (host.length <= 253 &&
            host
              .split('.')
              .every((part) =>
                /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part),
              )),
      ),
  );
const configSchema = z
  .object({
    TRANSPORT: z.literal('stdio').default('stdio'),
    BROWSER_EXECUTABLE_PATH: z.string().min(1).optional(),
    ALLOW_LOCAL: z.enum(['true', 'false']).default('false'),
    ALLOWED_DOMAINS: hosts,
    MAX_SESSIONS: integer(5, 1, 20),
    SESSION_TTL_MS: integer(600_000, 100, 86_400_000),
    NAVIGATION_TIMEOUT_MS: integer(30_000, 100, 60_000),
    ACTION_TIMEOUT_MS: integer(5_000, 100, 30_000),
    MAX_OUTPUT_BYTES: integer(65_536, 8192, 1_048_576),
    MAX_SCREENSHOT_BYTES: integer(5_242_880, 1024, 10_485_760),
  })
  .refine(
    (config) =>
      config.ALLOW_LOCAL !== 'true' || config.ALLOWED_DOMAINS.length > 0,
  );

export type Config = Readonly<{
  browserExecutablePath?: string;
  transport: 'stdio';
  allowLocal: boolean;
  allowedDomains: readonly string[];
  maxSessions: number;
  sessionTtlMs: number;
  navigationTimeoutMs: number;
  actionTimeoutMs: number;
  maxOutputBytes: number;
  maxScreenshotBytes: number;
}>;
export class ConfigurationError extends Error {
  constructor() {
    super(
      'Invalid configuration. Only TRANSPORT=stdio is supported; check documented settings and local host allowlists.',
    );
    this.name = 'ConfigurationError';
  }
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) throw new ConfigurationError();
  const c = parsed.data;
  return Object.freeze({
    ...(c.BROWSER_EXECUTABLE_PATH
      ? { browserExecutablePath: c.BROWSER_EXECUTABLE_PATH }
      : {}),
    transport: c.TRANSPORT,
    allowLocal: c.ALLOW_LOCAL === 'true',
    allowedDomains: Object.freeze(c.ALLOWED_DOMAINS),
    maxSessions: c.MAX_SESSIONS,
    sessionTtlMs: c.SESSION_TTL_MS,
    navigationTimeoutMs: c.NAVIGATION_TIMEOUT_MS,
    actionTimeoutMs: c.ACTION_TIMEOUT_MS,
    maxOutputBytes: c.MAX_OUTPUT_BYTES,
    maxScreenshotBytes: c.MAX_SCREENSHOT_BYTES,
  });
}
