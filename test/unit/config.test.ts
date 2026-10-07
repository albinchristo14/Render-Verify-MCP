import { describe, expect, it } from 'vitest';
import { ConfigurationError, loadConfig } from '../../src/config.js';

describe('configuration', () => {
  it('defaults to a frozen stdio configuration', () => {
    const config = loadConfig({});
    expect(config).toMatchObject({
      transport: 'stdio',
      allowLocal: false,
      allowedDomains: [],
      maxSessions: 5,
    });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('accepts explicit stdio and ignores unrelated environment variables', () => {
    expect(
      loadConfig({ TRANSPORT: 'stdio', UNRELATED: 'value' }),
    ).toMatchObject({
      transport: 'stdio',
    });
  });

  it.each(['http', '', 'STDIO', 'secret-value'])(
    'rejects unsupported transport %s',
    (transport) => {
      expect(() => loadConfig({ TRANSPORT: transport })).toThrow(
        ConfigurationError,
      );
      try {
        loadConfig({ TRANSPORT: transport });
      } catch (error) {
        expect(String(error)).not.toContain(
          transport === '' ? 'ZodError' : transport,
        );
      }
    },
  );
});
