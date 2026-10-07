import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Config } from '../config.js';

export async function connectStdio(
  server: McpServer,
  config: Config,
): Promise<void> {
  // Defense in depth if a caller bypasses the typed configuration loader.
  if (config.transport !== 'stdio') throw new Error('Unsupported transport.');
  await server.connect(new StdioServerTransport());
}
