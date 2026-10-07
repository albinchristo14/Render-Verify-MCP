import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startFixtureServer } from '../../fixtures/server.js';

function clientTransport() {
  return new StdioClientTransport({
    command: process.execPath,
    args: ['dist/index.js'],
    stderr: 'pipe',
    env: {
      ALLOW_LOCAL: 'true',
      ALLOWED_DOMAINS: '127.0.0.1',
      MAX_OUTPUT_BYTES: '8192',
      ACTION_TIMEOUT_MS: '2000',
      ...(process.env.BROWSER_EXECUTABLE_PATH
        ? { BROWSER_EXECUTABLE_PATH: process.env.BROWSER_EXECUTABLE_PATH }
        : {}),
      ...(process.env.PLAYWRIGHT_BROWSERS_PATH
        ? { PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH }
        : {}),
    },
  });
}
it('executes the Phase 2 login flow through MCP and returns API failure evidence', async () => {
  const fixture = await startFixtureServer();
  const client = new Client({ name: 'phase-two-test', version: '1.0.0' });
  const call = async (name: string, args: Record<string, unknown>) =>
    client.callTool({ name, arguments: args });
  try {
    await client.connect(clientTransport());
    const opened = await call('open_url', { url: fixture.baseUrl + '/login' });
    const id = (opened.structuredContent as Record<string, unknown>).session_id;
    const snapshot = await call('get_page_snapshot', { session_id: id });
    const inputs = (snapshot.structuredContent as Record<string, unknown>)
      .inputs as { name: string; selector: string }[];
    const filled = await call('type_text', {
      session_id: id,
      selector: inputs.find((input) => input.name === 'Email')!.selector,
      text: 'mcp@example.test',
    });
    expect(filled.isError).not.toBe(true);
    await call('type_text', {
      session_id: id,
      selector: inputs.find((input) => input.name === 'Password')!.selector,
      text: 'dummy.mcp+password[1]',
    });
    const submitted = await call('click', {
      session_id: id,
      selector: '#submit',
      wait_for: { selector: '#login-status' },
    });
    expect(submitted.isError).not.toBe(true);
    const data = submitted.structuredContent as {
      success: boolean;
      new_errors: { network_failures: { status: number; method: string }[] };
    };
    expect(data.success).toBe(true);
    expect(data.new_errors.network_failures).toContainEqual(
      expect.objectContaining({ status: 500, method: 'POST' }),
    );
    expect(JSON.stringify(submitted)).not.toContain('dummy.mcp+password[1]');
    const resized = await call('set_viewport', {
      session_id: id,
      width: 360,
      height: 800,
    });
    expect(
      (resized.structuredContent as Record<string, unknown>).viewport,
    ).toEqual({ width: 360, height: 800 });
    const invalid = await call('set_viewport', {
      session_id: id,
      width: 99999,
      height: 800,
    });
    expect(invalid.isError).toBe(true);
    const navigated = await call('navigate', {
      session_id: id,
      url: fixture.baseUrl + '/clean',
    });
    expect(navigated.isError).not.toBe(true);
    expect(
      (navigated.structuredContent as Record<string, unknown>).http_status,
    ).toBe(200);
    const missing = await call('click', {
      session_id: id,
      selector: '#missing',
      timeout_ms: 100,
    });
    expect(missing.isError).toBe(true);
    expect(
      (missing.structuredContent as { error: { code: string } }).error.code,
    ).toBe('ACTION_TIMEOUT');
  } finally {
    await client.close();
    await fixture.close();
  }
});
it('fits action evidence into the byte budget and retains overflow for diagnostic retrieval', async () => {
  const client = new Client({
    name: 'phase-two-budget-test',
    version: '1.0.0',
  });
  try {
    await client.connect(clientTransport());
    const opened = await client.callTool({
      name: 'open_url',
      arguments: {
        html: `<button id="flood" onclick="for(let i=0;i<510;i++)console.error('long diagnostic '+i+' '+'X'.repeat(1500));document.querySelector('p').hidden=false">Flood</button><p hidden>Done</p>`,
      },
    });
    const id = (opened.structuredContent as Record<string, unknown>).session_id;
    const result = await client.callTool({
      name: 'click',
      arguments: {
        session_id: id,
        selector: '#flood',
        wait_for: { selector: 'p' },
      },
    });
    expect(result.isError).not.toBe(true);
    expect(
      Buffer.byteLength(JSON.stringify(result.structuredContent)),
    ).toBeLessThanOrEqual(8192);
    const data = result.structuredContent as {
      success: boolean;
      new_errors: {
        console: unknown[];
        remaining: { console: number };
        dropped: { console: number };
      };
    };
    expect(data.success).toBe(true);
    expect(data.new_errors.console.length).toBeGreaterThan(0);
    expect(data.new_errors.remaining.console).toBe(
      500 - data.new_errors.console.length,
    );
    expect(data.new_errors.dropped.console).toBe(10);
    const retained = await client.callTool({
      name: 'get_console_errors',
      arguments: { session_id: id, limit: 1 },
    });
    expect(
      (retained.structuredContent as { remaining_console: number })
        .remaining_console,
    ).toBe(499);
  } finally {
    await client.close();
  }
});
