import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SERVER_VERSION } from '../version.js';

export function registerTools(server: McpServer): void {
  server.registerTool(
    'hello_world',
    {
      title: 'Check Render & Verify connection',
      description:
        'Confirm the MCP connection and report the current build phase. Browser Core, interactions, and deterministic page verification are available.',
      inputSchema: {
        name: z.string().trim().min(1).max(80).optional(),
      },
      outputSchema: {
        greeting: z.string(),
        version: z.string(),
        phase: z.literal('phase_3'),
        browser_tools_available: z.literal(true),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ name }) => {
      const result = {
        greeting: `Hello, ${name ?? 'developer'}!`,
        version: SERVER_VERSION,
        phase: 'phase_3' as const,
        browser_tools_available: true as const,
      };
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );
}
