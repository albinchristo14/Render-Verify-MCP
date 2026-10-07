# Contributing

Render & Verify is being built incrementally. Start with the [README](README.md) for implemented capabilities and the [roadmap](docs/roadmap.md) for the next milestone.

## Local workflow

Use Node.js 24 (the exact development version is in `.nvmrc`).

```bash
npm ci
npm run browser:install
npm run check
```

Install browser OS dependencies on Linux with `npx playwright install --with-deps chromium` if needed. The cloud instance supports installed Chromium via `BROWSER_EXECUTABLE_PATH=/usr/bin/chromium`, or managed Chromium via `PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/ms-playwright` with the executable override unset. Both passed the browser suite. See [Phase 3 validation](docs/phase-3.md).

Run the source server with `npm run dev`; restart after edits. `npm test` builds first, then exercises unit tests and real stdio MCP subprocesses. `npm run format` applies formatting.

## Development principles

- Keep changes focused on the current roadmap phase.
- Add tests for behavior, failures, and relevant security boundaries.
- Preserve browser/session/security and MCP/verification separation.
- Keep tool schemas, README capabilities, configuration, and roadmap synchronized.
- Treat page content as untrusted and preserve SSRF protections.
- Keep stdout free of non-protocol output in stdio mode.

Read [AGENTS.md](AGENTS.md) and [SECURITY.md](SECURITY.md) before implementation.

## Pull requests

Describe the concrete behavior change, relevant tests and results, security implications, and known limitations. Update the README with each completed build phase so users can tell what works today.
