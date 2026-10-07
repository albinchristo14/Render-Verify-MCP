import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startFixtureServer } from '../../fixtures/server.js';

it('uses every Browser Core tool through the compiled stdio MCP server', async () => {
  const fixture = await startFixtureServer();
  const client = new Client({ name: 'browser-mcp-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['dist/index.js'],
    stderr: 'pipe',
    env: {
      TRANSPORT: 'stdio',
      ALLOW_LOCAL: 'true',
      ALLOWED_DOMAINS: '127.0.0.1',
      ...(process.env.BROWSER_EXECUTABLE_PATH
        ? { BROWSER_EXECUTABLE_PATH: process.env.BROWSER_EXECUTABLE_PATH }
        : {}),
      ...(process.env.PLAYWRIGHT_BROWSERS_PATH
        ? { PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH }
        : {}),
    },
  });
  try {
    await client.connect(transport);
    const opened = await client.callTool({
      name: 'open_url',
      arguments: { url: fixture.baseUrl + '/broken' },
    });
    expect(opened.isError).not.toBe(true);
    const sessionId = (
      opened.structuredContent as Record<string, unknown> | undefined
    )?.session_id;
    expect(sessionId).toBeTypeOf('string');
    const console = await client.callTool({
      name: 'get_console_errors',
      arguments: { session_id: sessionId, clear: true },
    });
    expect(
      (console.structuredContent as Record<string, unknown> | undefined)
        ?.page_errors,
    ).toEqual([
      expect.objectContaining({ message: 'fixture uncaught failure' }),
    ]);
    const cleared = await client.callTool({
      name: 'get_console_errors',
      arguments: { session_id: sessionId },
    });
    expect(
      (cleared.structuredContent as Record<string, unknown> | undefined)
        ?.page_errors,
    ).toEqual([]);
    const network = await client.callTool({
      name: 'get_network_failures',
      arguments: { session_id: sessionId },
    });
    expect(
      (network.structuredContent as Record<string, unknown> | undefined)
        ?.records,
    ).toContainEqual(expect.objectContaining({ status: 404 }));
    const shot = await client.callTool({
      name: 'screenshot',
      arguments: { session_id: sessionId },
    });
    expect(shot.content).toEqual([
      expect.objectContaining({ type: 'image', mimeType: 'image/png' }),
    ]);
    const closed = await client.callTool({
      name: 'close_session',
      arguments: { session_id: sessionId },
    });
    expect(closed.structuredContent).toEqual({ success: true });
    const missing = await client.callTool({
      name: 'get_console_errors',
      arguments: { session_id: sessionId },
    });
    expect(missing.isError).toBe(true);
    expect(JSON.stringify(missing.content)).toContain('SESSION_NOT_FOUND');
    const logs = await client.callTool({
      name: 'open_url',
      arguments: {
        html: '<script>console.error(1);console.error(2);console.error(3)</script>',
      },
    });
    const logsId = (logs.structuredContent as Record<string, unknown>)
      .session_id;
    const partial = await client.callTool({
      name: 'get_console_errors',
      arguments: { session_id: logsId, limit: 1, clear: true },
    });
    expect(
      (partial.structuredContent as Record<string, unknown>).remaining_console,
    ).toBe(2);
    const remaining = await client.callTool({
      name: 'get_console_errors',
      arguments: { session_id: logsId },
    });
    expect(
      (remaining.structuredContent as Record<string, unknown>).console,
    ).toHaveLength(2);
    await client.callTool({
      name: 'close_session',
      arguments: { session_id: logsId },
    });
    const invalid = await client.callTool({
      name: 'open_url',
      arguments: { html: 'x', url: fixture.baseUrl },
    });
    expect(invalid.isError).toBe(true);
    expect(JSON.stringify(invalid.content)).toContain('INVALID_INPUT');
  } finally {
    await client.close();
    await fixture.close();
  }
});
