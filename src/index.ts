import { ConfigurationError, loadConfig } from './config.js';
import { connectStdio } from './mcp/transport.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const server = createServer(config);
  let closing = false;

  const shutdown = (): void => {
    if (closing) return;
    closing = true;
    void server.close().catch(() => {
      process.stderr.write('Render & Verify shutdown failed.\n');
      process.exitCode = 1;
    });
  };

  process.stdin.once('end', shutdown);
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  await connectStdio(server, config);
}

void main().catch((error: unknown) => {
  // Keep stdout exclusively for MCP messages; do not leak environment values.
  process.stderr.write(
    error instanceof ConfigurationError
      ? `${error.message}\n`
      : 'Render & Verify startup failed.\n',
  );
  process.exitCode = 1;
});
