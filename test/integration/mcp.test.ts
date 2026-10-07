import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { SERVER_VERSION } from '../../src/version.js';

const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

async function connect(args: string[]): Promise<Client> {
  const client = new Client({ name: 'phase-zero-test', version: '1.0.0' });
  clients.push(client);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args,
    cwd: process.cwd(),
    env: { TRANSPORT: 'stdio' },
    stderr: 'pipe',
  });
  await client.connect(transport);
  return client;
}

describe.each([
  ['source entry point', ['--import', 'tsx', 'src/index.ts']],
  ['compiled entry point', ['dist/index.js']],
])('%s', (_name, args) => {
  it('initializes, advertises only implemented tools, and returns structured results', async () => {
    const client = await connect(args as string[]);
    expect(client.getServerVersion()).toEqual({
      name: 'render-verify-mcp',
      version: SERVER_VERSION,
    });
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      'hello_world',
      'open_url',
      'screenshot',
      'get_console_errors',
      'get_network_failures',
      'close_session',
      'click',
      'type_text',
      'navigate',
      'set_viewport',
      'get_page_snapshot',
      'verify_page',
    ]);
    expect(tools.tools[0]?.annotations?.readOnlyHint).toBe(true);

    const result = await client.callTool({
      name: 'hello_world',
      arguments: {},
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      greeting: 'Hello, developer!',
      version: SERVER_VERSION,
      phase: 'phase_3',
      browser_tools_available: true,
    });
    expect(result.content).toEqual([
      { type: 'text', text: JSON.stringify(result.structuredContent) },
    ]);
  });

  it('validates tool inputs and remains usable after an invalid request', async () => {
    const client = await connect(args as string[]);
    for (const name of ['', 'x'.repeat(81), 42]) {
      const result = await client.callTool({
        name: 'hello_world',
        arguments: { name },
      });
      expect(result.isError).toBe(true);
    }
    const valid = await client.callTool({
      name: 'hello_world',
      arguments: { name: '  Ada  ' },
    });
    expect(valid.structuredContent).toMatchObject({ greeting: 'Hello, Ada!' });
  });

  it('rejects tools from future phases', async () => {
    const client = await connect(args as string[]);
    const result = await client.callTool({
      name: 'verify_flow',
      arguments: { url: 'https://example.com' },
    });
    expect(result.isError).toBe(true);
  });
});

it('keeps the server version consistent with package metadata', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
    version: string;
  };
  expect(SERVER_VERSION).toBe(pkg.version);
});
