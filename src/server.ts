import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools } from './mcp/registerTools.js';
import { loadConfig, type Config } from './config.js';
import { SessionManager } from './browser/sessionManager.js';
import { registerInteractionTools } from './mcp/interactionTools.js';
import { registerBrowserTools } from './mcp/browserTools.js';
import { registerVerificationTools } from './mcp/verificationTools.js';
import { SERVER_VERSION } from './version.js';

/** A fresh server per connection; browser state will live in separate modules. */
export function createServer(config: Config = loadConfig()): McpServer {
  const server = new McpServer({
    name: 'render-verify-mcp',
    version: SERVER_VERSION,
  });
  const sessions = new SessionManager(config);
  registerTools(server);
  registerBrowserTools(server, sessions);
  registerInteractionTools(server, sessions);
  registerVerificationTools(server, sessions);
  const close = server.close.bind(server);
  server.close = async () => {
    try {
      await sessions.close();
    } finally {
      await close();
    }
  };
  return server;
}
