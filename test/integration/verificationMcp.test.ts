import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { VerificationReport } from '../../src/verification/types.js';

async function connect() {
  const client = new Client({
    name: 'verification-mcp-test',
    version: '1.0.0',
  });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ['dist/index.js'],
      stderr: 'pipe',
      env: {
        MAX_OUTPUT_BYTES: '8192',
        ...(process.env.BROWSER_EXECUTABLE_PATH
          ? { BROWSER_EXECUTABLE_PATH: process.env.BROWSER_EXECUTABLE_PATH }
          : {}),
        ...(process.env.PLAYWRIGHT_BROWSERS_PATH
          ? { PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH }
          : {}),
      },
    }),
  );
  return client;
}
it('returns a failed verification verdict as a successful MCP report with references and a separate image', async () => {
  const client = await connect();
  try {
    const opened = await client.callTool({
      name: 'open_url',
      arguments: {
        html: '<style>body{margin:0}div{width:2000px}</style><div>Wide</div><script>console.error("MCP verification error")</script>',
      },
    });
    const session_id = (opened.structuredContent as Record<string, unknown>)
      .session_id;
    const result = await client.callTool({
      name: 'verify_page',
      arguments: { session_id, include_screenshot: true },
    });
    expect(result.isError).not.toBe(true);
    const report = result.structuredContent as unknown as VerificationReport;
    expect(report.status).toBe('failed');
    expect(
      report.checks.find((check) => check.name === 'no_console_errors')?.status,
    ).toBe('failed');
    expect(
      report.checks.find((check) => check.name === 'no_horizontal_overflow')
        ?.severity,
    ).toBe('warning');
    expect((result.content as unknown[])[0]).toEqual({
      type: 'text',
      text: JSON.stringify(report),
    });
    expect((result.content as unknown[])[1]).toMatchObject({
      type: 'image',
      mimeType: 'image/png',
    });
    const screenshot = report.evidence.find(
      (item) => item.id === report.screenshot?.evidence_id,
    )!;
    expect(screenshot.data.content_index).toBe(1);
    expect(Buffer.byteLength(JSON.stringify(report))).toBeLessThanOrEqual(8192);
    for (const check of report.checks)
      for (const id of check.evidence_ids)
        expect(report.evidence.some((item) => item.id === id)).toBe(true);
    const subset = await client.callTool({
      name: 'verify_page',
      arguments: { session_id, checks: ['page_loads'] },
    });
    expect(subset.structuredContent).toMatchObject({
      status: 'passed',
      score: 100,
    });
  } finally {
    await client.close();
  }
});
it('rejects malformed verification inputs, missing sessions, and future tools without breaking valid reports', async () => {
  const client = await connect();
  try {
    const opened = await client.callTool({
      name: 'open_url',
      arguments: { html: '<h1>Valid</h1>' },
    });
    const session_id = (opened.structuredContent as Record<string, unknown>)
      .session_id;
    for (const invalid of [
      { checks: [] },
      { checks: ['unknown'] },
      { checks: ['page_loads', 'page_loads'] },
      { evidence_limit: 21 },
      { timeout_ms: 0 },
      { policy: { ignore_http_statuses: [200] } },
      { policy: { severities: { no_page_errors: 'urgent' } } },
      { policy: { severities: { unknown: 'error' } } },
      { policy: { score_weights: { error: 0 } } },
      { policy: { overflow_tolerance_px: -1 } },
    ])
      expect(
        (
          await client.callTool({
            name: 'verify_page',
            arguments: { session_id, ...invalid },
          })
        ).isError,
      ).toBe(true);
    const missing = await client.callTool({
      name: 'verify_page',
      arguments: { session_id: randomUUID() },
    });
    expect(missing.isError).toBe(true);
    expect((missing.content as unknown[])[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('SESSION_NOT_FOUND'),
    });
    const valid = await client.callTool({
      name: 'verify_page',
      arguments: { session_id },
    });
    expect(valid.structuredContent).toMatchObject({
      status: 'passed',
      score: 100,
    });
    await client.callTool({ name: 'close_session', arguments: { session_id } });
  } finally {
    await client.close();
  }
});
