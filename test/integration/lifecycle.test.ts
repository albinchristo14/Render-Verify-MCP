import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { expect, it } from 'vitest';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';

it('fails closed for HTTP mode without printing secrets or protocol noise', async () => {
  const child = spawn(process.execPath, ['dist/index.js'], {
    env: { ...process.env, TRANSPORT: 'http-with-secret-value' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (data: Buffer) => {
    stdout += data.toString();
  });
  child.stderr.on('data', (data: Buffer) => {
    stderr += data.toString();
  });
  try {
    const [code] = await once(child, 'close', {
      signal: AbortSignal.timeout(5000),
    });
    expect(code).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toContain('Only TRANSPORT=stdio is supported');
    expect(stderr).not.toContain('http-with-secret-value');
    expect(stderr).not.toContain(' at ');
  } finally {
    child.kill('SIGKILL');
  }
});

it.each(['SIGINT', 'SIGTERM'] as const)(
  'exits cleanly after initialization on %s',
  async (signal) => {
    const child = spawn(process.execPath, ['dist/index.js'], {
      env: { ...process.env, TRANSPORT: 'stdio' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    try {
      const initialized = once(child.stdout, 'data', {
        signal: AbortSignal.timeout(5000),
      });
      child.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: LATEST_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: 'shutdown-test', version: '1.0.0' },
          },
        }) + '\n',
      );
      const [data] = await initialized;
      const response = JSON.parse((data as Buffer).toString()) as {
        id: number;
        result: { serverInfo: { name: string } };
      };
      expect(response.id).toBe(1);
      expect(response.result.serverInfo.name).toBe('render-verify-mcp');
      const exited = once(child, 'close', {
        signal: AbortSignal.timeout(5000),
      });
      child.kill(signal);
      const [code, exitSignal] = await exited;
      expect(code).toBe(0);
      expect(exitSignal).toBeNull();
      expect(stderr).toBe('');
    } finally {
      child.kill('SIGKILL');
    }
  },
);
