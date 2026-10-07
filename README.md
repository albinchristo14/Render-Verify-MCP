# Render & Verify MCP

**Give AI coding agents evidence that a web application works.**

[![CI](https://github.com/albinchristo14/Render-Verify-MCP/actions/workflows/ci.yml/badge.svg)](https://github.com/albinchristo14/Render-Verify-MCP/actions/workflows/ci.yml)
[![Node.js 24](https://img.shields.io/badge/Node.js-24-417e38)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A page can return HTTP 200 while its JavaScript crashes, its login request fails, or its mobile layout overflows. Render & Verify is being built to make those failures visible to coding agents through real browser evidence and deterministic checks.

```text
BUILD → RENDER → INTERACT → VERIFY → EVIDENCE → FIX → VERIFY AGAIN
```

> **Current build: Phase 3 — Verification Engine (v0.4.0).** Render and interact with pages, then call `verify_page` for six deterministic checks with severity, a score, and linked evidence. Missing diagnostics produce incomplete reports. Multi-step verification flows are next.

[Get started](#quick-start) · [Connect an MCP client](#connect-an-mcp-client) · [Build progress](#build-progress) · [Contribute](CONTRIBUTING.md)

## Why Render & Verify?

The goal is a short feedback loop: let an agent open an application, exercise it, collect evidence, and identify what failed before reporting success.

The product is being built around these capabilities:

- **Render and interact:** isolated Chromium sessions, navigation, screenshots, clicks, and form input.
- **Inspect failures:** JavaScript exceptions, console errors, failed requests, and HTTP failures.
- **Verify behavior:** deterministic page checks and multi-step flows with explicit assertions.
- **Explain results:** concise findings linked to screenshots and structured evidence.
- **Check responsive layouts:** viewport changes, overflow, clipping, and other layout diagnostics.

Playwright will drive the browser; MCP will make the capabilities available to agents. Verification logic, security policy, and browser lifecycle will remain separate modules.

## What works today

| Capability                                                        | Status                                    |
| ----------------------------------------------------------------- | ----------------------------------------- |
| stdio MCP initialization, discovery, and calls                    | Implemented                               |
| URL and raw HTML sessions in isolated Chromium contexts           | Implemented                               |
| PNG/JPEG screenshots, including elements and bounded full pages   | Implemented                               |
| Console warnings/errors and uncaught JavaScript errors            | Implemented                               |
| Failed requests, policy blocks, and HTTP 4xx/5xx diagnostics      | Implemented                               |
| Explicit close, session limits, idle expiry, and shutdown cleanup | Implemented                               |
| Destination allowlists and IP-pinned browser network policy       | Implemented; security hardening continues |
| Click, type, navigate, viewport changes, page snapshots           | Implemented                               |
| Six deterministic checks, `verify_page`, and linked evidence      | Implemented                               |
| Verification flows and expanded layout diagnostics                | Planned                                   |
| Authenticated remote HTTP transport                               | Planned                                   |

`verify_page` returns a verdict for the selected checks under the reported policy. A passing report establishes those checks for observed evidence; it does not establish every application behavior. Low-level action success still means the action completed. The server runs over stdio; it has no remote MCP HTTP listener.

## Quick start

Use **Node.js 24** and npm. The repository pins Node 24.19.0 in `.nvmrc`; if you use nvm, run `nvm install` and `nvm use` in the checkout.

```bash
git clone https://github.com/albinchristo14/Render-Verify-MCP.git
cd Render-Verify-MCP
npm ci
npm run browser:install
npm run check
npm start
```

On Linux, install the browser's system libraries with `npx playwright install --with-deps chromium` if needed. This may require administrator access on your own machine.

This cloud instance was validated with both installed Chromium 151 and Playwright-managed Chromium 153. Managed binaries are stored at `/workspace/.cache/ms-playwright`; pass that path as `PLAYWRIGHT_BROWSERS_PATH` in your MCP client, or use `BROWSER_EXECUTABLE_PATH=/usr/bin/chromium`. The Docker build and browser smoke test also passed. See [Phase 3 validation](docs/phase-3.md).

`npm start` launches the stdio MCP server and waits for an MCP client. It does not serve a web page or print a greeting by itself. End the terminal session with Ctrl+C.

For source development, use `npm run dev`. Restart it after edits. Use the compiled entry point directly when configuring an MCP client so npm output does not enter the protocol stream.

## Connect an MCP client

After `npm ci` and `npm run build`, add this entry to your client's MCP server configuration. Replace the path with your checkout's **absolute path**. The `node` executable must resolve to Node.js 24 in the client's environment.

```json
{
  "mcpServers": {
    "render-verify": {
      "command": "node",
      "args": ["/absolute/path/Render-Verify-MCP/dist/index.js"],
      "env": {
        "TRANSPORT": "stdio"
      }
    }
  }
}
```

Ask the client to call `hello_world` with:

```json
{ "name": "Ada" }
```

The tool returns a text block and this structured result:

```json
{
  "greeting": "Hello, Ada!",
  "version": "0.4.0",
  "phase": "phase_3",
  "browser_tools_available": true
}
```

`name` is optional and defaults to `developer`. Provided names are trimmed and must contain 1–80 characters. Invalid inputs return an MCP tool error. Calls to unimplemented tools also return errors.

## Try Browser Core

Ask your MCP client to call `open_url` with raw HTML. No application server or Internet request is needed:

```json
{
  "html": "<!doctype html><h1>Render & Verify</h1><script>console.error('Demo console error'); throw new Error('Demo page error');</script>",
  "viewport": { "width": 1280, "height": 800 }
}
```

The result includes a generated `session_id`, load timing, error counts, and `content_trust: "untrusted"`. Use that returned UUID in subsequent calls:

| Tool                   | Arguments    | Result                                            |
| ---------------------- | ------------ | ------------------------------------------------- |
| `get_console_errors`   | `session_id` | Console warnings/errors and uncaught page errors  |
| `get_network_failures` | `session_id` | Failed requests, policy blocks, and HTTP failures |
| `screenshot`           | `session_id` | An MCP image block; PNG by default                |
| `close_session`        | `session_id` | Releases the context and returns `success: true`  |

`open_url` accepts **exactly one** of `url` or `html`. URL mode accepts permitted HTTP(S) destinations. HTML mode accepts at most 256 KiB and does not write submitted content to disk. Browser navigation and raw HTML subresources use the same network policy.

### Inspect the broken fixture

Run `npm run fixtures` in a separate terminal. It prints its loopback URL and random port. Launch the MCP process with explicit local-development permissions:

```bash
ALLOW_LOCAL=true ALLOWED_DOMAINS=127.0.0.1 node dist/index.js
```

If using an MCP client, set those two variables in its server `env` instead. Also set `BROWSER_EXECUTABLE_PATH=/usr/bin/chromium` there if using this cloud instance's installed browser. Open the printed URL with `/broken` appended, then retrieve console and network diagnostics and a screenshot. The page intentionally contains an uncaught JavaScript error, a console error, and a missing image returning HTTP 404. Close the session when finished.

A 404 is diagnostic evidence, not automatically a fatal verdict. Page text and images are untrusted evidence, never tool instructions. See the [tool reference and limits](docs/phase-1.md).

## Try a login flow

Start `npm run fixtures` and configure the MCP server with `ALLOW_LOCAL=true` and `ALLOWED_DOMAINS=127.0.0.1` as above. Open the printed fixture URL with `/login` appended. Use the returned session UUID for these calls:

| Tool                | Example arguments (add `session_id` to each)                     | Purpose                                                |
| ------------------- | ---------------------------------------------------------------- | ------------------------------------------------------ |
| `get_page_snapshot` | `{}`                                                             | Find labelled Email/Password inputs and selector hints |
| `type_text`         | `{"selector":"#email","text":"demo@example.com"}`                | Replace the email value                                |
| `type_text`         | `{"selector":"#password","text":"demo-password"}`                | Fill the password without echoing it                   |
| `click`             | `{"selector":"#submit","wait_for":{"selector":"#login-status"}}` | Submit and wait for the completion indicator           |
| `set_viewport`      | `{"width":360,"height":800}`                                     | Inspect the mobile viewport                            |
| `navigate`          | `{"url":"<printed fixture URL>/clean"}`                          | Continue in the same isolated session                  |

The submit action reports the deliberately failing `/api/login` HTTP 500 in `new_errors.network_failures`, along with the new console and page errors. `success: true` means the action completed; it does **not** mean login succeeded. Retrieve persistent diagnostics for events arriving later, take a screenshot, and close the session when finished.

Actions and optional selector waits share one bounded timeout. Page snapshots omit input values and include bounded visible headings, links, controls, forms, landmarks, and text. Selector hints reflect the current DOM and may become stale after updates. Entered values are redacted from subsequent text evidence within session limits; screenshots can still show them. See the [Phase 2 tool reference](docs/phase-2.md) for limits and failure behavior.

## Verify a page

After `open_url`, call `verify_page` with the returned session UUID:

```json
{
  "session_id": "<returned UUID>",
  "checks": [
    "page_loads",
    "no_page_errors",
    "no_console_errors",
    "no_network_failures",
    "no_http_5xx",
    "no_horizontal_overflow"
  ],
  "include_screenshot": true
}
```

Omit `checks` to run all six. The tool returns a structured report with `status`, `score`, per-check severity and status, and evidence referenced by `evidence_ids`. A requested screenshot is a separate MCP image block. A failed check is a successful tool call returning a failed verdict; invalid inputs or missing sessions return MCP errors.

For a reproducible demo, open the fixture URL with `/verification-broken` appended at 360×800. Wait for `#api-complete` using a `click` on `h1` with `wait_for`, then verify. It deliberately contains a console error, an uncaught exception, HTTP 404/500 responses, and horizontal overflow. Inspect the evidence, then open `/clean` in a **fresh session** and verify again to get a passing result.

Diagnostic checks cover collected session history, including earlier pages and actions; navigation does not reset them. Current-document checks measure readiness/main HTTP status and document width. Cleared or evicted history yields `skipped` when no retained violation proves failure, and the report becomes `incomplete` rather than passing. Use a fresh session for a clean rerun after a fix.

The score is secondary to check results. It is a weighted percentage of passed checks, or `null` when any check is skipped or errored. Policy can adjust severity, weights, HTTP-status exceptions, and overflow tolerance. Reports expose omitted sample counts and retain aggregate findings under output limits. See the [Phase 3 reference](docs/phase-3.md) for exact semantics and limits.

## Development

Install Chromium with `npm run browser:install`; `npm run fixtures` starts the local demonstration server.

| Command                | Purpose                                                          |
| ---------------------- | ---------------------------------------------------------------- |
| `npm ci`               | Install the exact locked dependencies                            |
| `npm run dev`          | Run the TypeScript stdio entry point                             |
| `npm run build`        | Compile application code into `dist/`                            |
| `npm start`            | Run the compiled server                                          |
| `npm test`             | Build and run unit and MCP integration tests                     |
| `npm run test:watch`   | Build once, then watch tests; rebuild for compiled-entry changes |
| `npm run typecheck`    | Check application and test types                                 |
| `npm run lint`         | Check JavaScript and TypeScript with ESLint                      |
| `npm run format`       | Apply Prettier formatting                                        |
| `npm run format:check` | Check formatting without edits                                   |
| `npm run test:docker`  | Smoke-test a built Docker image through a real MCP client        |
| `npm run check`        | Run type, lint, format, test, and build checks                   |

The suite exercises real Chromium and MCP subprocesses: deliberate errors and broken assets, screenshots, cookie/storage isolation, URL policy, redirects, DNS rebinding, session limits/expiry, partial diagnostic clearing, and resource cleanup. It also covers login interactions, action-specific evidence, entered-value redaction, bounded snapshots, hard timeouts, output budgeting, deterministic verification, and incomplete evidence. Both source and compiled MCP entry points remain covered.

Dependencies are pinned in `package-lock.json`. TypeScript 6.0.3 is used because the current TypeScript ESLint release does not yet support TypeScript 7.

### Configuration

| Variable                   | Default            | Purpose                                                                            |
| -------------------------- | ------------------ | ---------------------------------------------------------------------------------- |
| `TRANSPORT`                | `stdio`            | Only stdio is supported                                                            |
| `ALLOW_LOCAL`              | `false`            | Allow loopback/private targets; requires an exact allowlist                        |
| `ALLOWED_DOMAINS`          | unset              | Comma-separated exact hostnames/IPs; no wildcards                                  |
| `MAX_SESSIONS`             | `5`                | Concurrent sessions, including opens in progress                                   |
| `SESSION_TTL_MS`           | `600000`           | Idle session lifetime                                                              |
| `NAVIGATION_TIMEOUT_MS`    | `30000`            | Maximum page-load timeout                                                          |
| `ACTION_TIMEOUT_MS`        | `5000`             | Browser action timeout                                                             |
| `MAX_OUTPUT_BYTES`         | `65536`            | JSON diagnostic response limit                                                     |
| `MAX_SCREENSHOT_BYTES`     | `5242880`          | Image byte limit before base64                                                     |
| `BROWSER_EXECUTABLE_PATH`  | unset              | Optional installed Chromium executable; otherwise use Playwright's managed browser |
| `PLAYWRIGHT_BROWSERS_PATH` | Playwright default | Optional location for managed browser binaries                                     |

Export variables or set them in the MCP client configuration. `.env.example` is a reference; `.env` files are not loaded automatically. Invalid configuration fails startup without exposing values. stdout is reserved for MCP messages.

By default, non-public IPs are blocked. `ALLOW_LOCAL=true` still requires `ALLOWED_DOMAINS` and never permits link-local metadata targets. Every new browser connection resolves its destination, checks all DNS answers, and connects to the checked IP. Redirects and subresources cannot bypass this policy. Upstream corporate HTTP proxies are not supported by browser navigation yet; the host must permit checked outbound TCP connections. Public-site navigation has not been validated in this instance.

### Docker

The Dockerfile now uses the matching Playwright 1.63.0 browser image, Node.js 24, and a non-root user. It exposes no MCP HTTP port.

```bash
docker build -t render-verify-mcp:phase3 .
docker run --rm --init -i --shm-size=1g render-verify-mcp:phase3
# In another invocation, smoke-test the built image:
npm run test:docker -- render-verify-mcp:phase3
```

Keep stdin open with `-i`; avoid `-t` for stdio MCP. Proxy-based builds can inherit exported settings with `--build-arg HTTP_PROXY --build-arg HTTPS_PROXY --build-arg NO_PROXY`. An optional trusted CA PEM can be supplied with `--secret id=npm_ca,src=/path/to/ca.pem`; it is used only during npm installation, without disabling TLS verification.

The image built successfully and passed a network-disabled smoke test for MCP initialization, Chromium rendering, form interactions, snapshots, passing/failing verification reports, resized PNG screenshots, and cleanup. The runtime runs as UID 1001 with Node.js 24.19.0. This does not establish public-site navigation or production soak-test readiness.

## Build progress

Development follows one tested phase at a time. This README will track shipped capabilities as each phase lands.

| Phase                       | Scope                                                                          | Progress                              |
| --------------------------- | ------------------------------------------------------------------------------ | ------------------------------------- |
| 0 — Foundation              | Tooling, stdio MCP, tests, documentation                                       | Complete                              |
| **1 — Browser Core**        | Isolated sessions, open, screenshots, diagnostics, cleanup, guarded networking | **Implemented and locally validated** |
| **2 — Interaction**         | Click, type, navigate, viewport changes, page snapshots                        | **Implemented and validated**         |
| **3 — Verification Engine** | Evidence model, deterministic checks, `verify_page`                            | **Implemented and validated**         |
| 4 — Verification Flows      | Flow schema, assertions, per-step evidence, `verify_flow`                      | Planned                               |
| 5 — Layout                  | Responsive diagnostics, overflow, clipping                                     | Planned                               |
| 6 — Security Hardening      | Expanded security fixtures, redaction, auth, resource limits                   | Planned                               |
| 7 — Remote and Production   | Authenticated HTTP, metrics, recovery, soak testing                            | Planned                               |
| 8 — Advanced Verification   | Visual diffs, traces, accessibility, performance, multiple browsers            | Backlog                               |

Security protections accompany browser features now; the later hardening phase expands their coverage. Phase 3 validation covers 98 tests, including missing history, policy/scoring, evidence references, and bounded MCP reports. See the [validation record](docs/phase-3.md).

**Next milestone: Phase 4 — Verification Flows.** Add validated multi-step actions, assertions, stop conditions, and per-step evidence through `verify_flow`. See the [roadmap](docs/roadmap.md) for acceptance criteria.

## Project structure

```text
src/
├── index.ts, config.ts, server.ts, version.ts
├── browser/       # Lazy browser lifecycle and bounded isolated sessions
├── collectors/    # Bounded console, page-error, and network buffers
├── mcp/           # Tool schemas/registration and stdio transport
├── security/      # URL policy, IP-pinned egress proxy, redaction
├── tools/         # Bounded interactions, snapshots, screenshots, and results
└── verification/  # Deterministic checks, report policy, and evidence

fixtures/          # Clean, broken, login, interaction, and policy fixtures
test/              # Unit, browser, proxy, MCP, and lifecycle integration tests
docs/              # Architecture, tool reference, validation, and roadmap
```

## Security and contributions

Page content is treated as untrusted data. Browser contexts isolate storage and cookies; they are not an operating-system sandbox. Use host/container restrictions before deploying untrusted workloads. Known secret patterns are redacted from text diagnostics, but screenshots and arbitrary page text can still contain sensitive information. Remote HTTP must require authentication before exposure. See [SECURITY.md](SECURITY.md) for the policy.

Read [AGENTS.md](AGENTS.md) and [CONTRIBUTING.md](CONTRIBUTING.md) before making changes. Include tests for new behavior and update this README's current capabilities, configuration, and progress alongside the implementation.

Related design notes: [Architecture](docs/architecture.md) · [Verification](docs/verification.md)

MIT licensed. See [LICENSE](LICENSE).
