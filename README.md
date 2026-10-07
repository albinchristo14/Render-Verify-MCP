# Render & Verify MCP

**Agent-first browser verification for AI coding agents.**

Render & Verify MCP is an [MCP](https://modelcontextprotocol.io/) server that gives AI coding agents a real browser they can use to **render, interact with, inspect, diagnose, and verify web applications**.

Instead of an AI saying:

> "The page should work."

Render & Verify is designed to help it produce evidence.

```text
BUILD → RENDER → INTERACT → VERIFY → EVIDENCE → FIX → VERIFY AGAIN
```

> **Let AI agents prove that a web application actually works instead of guessing from source code.**

## Why?

AI coding agents are increasingly good at writing frontend code, but writing code and verifying a browser application are different problems.

A page can return HTTP 200 and still have JavaScript exceptions, failed API calls, CORS problems, broken assets, layout overflow, clipped content, invisible controls, broken navigation, failed form submissions, or responsive/mobile problems.

Render & Verify exposes browser-level evidence to the agent so it can reason about what actually happened.

## What it does

- Playwright + Chromium
- MCP interface
- Isolated browser sessions
- Console and page-error collection
- Network diagnostics
- Screenshots
- Accessibility / DOM snapshots
- Browser interactions
- Responsive viewport testing
- Layout diagnostics
- Deterministic verification checks
- Evidence-based verification reports

The project separates low-level browser capabilities from a higher-level **Verification Engine**.

## Architecture

```text
AI Coding Agent
      │
      ▼
MCP Server
      │
      ▼
Verification Engine
      │
      ▼
Session Manager
      │
      ▼
Event Collectors
      │
      ▼
Playwright → Chromium
```

## MCP tools

### Browser

| Tool | Purpose |
|---|---|
| `open_url` | Open a URL or raw HTML in an isolated session |
| `screenshot` | Capture a browser or element screenshot |
| `navigate` | Navigate an existing session |
| `click` | Click an element |
| `type_text` | Type into an input |
| `set_viewport` | Change viewport dimensions |
| `get_page_snapshot` | Return a compact page/accessibility structure |
| `close_session` | Close a browser session |

### Diagnostics

| Tool | Purpose |
|---|---|
| `get_console_errors` | Retrieve console warnings/errors |
| `get_network_failures` | Retrieve failed requests and relevant HTTP failures |
| `check_layout` | Detect common layout problems |
| `evaluate` | Optional JavaScript evaluation, disabled by default |

### Verification

| Tool | Purpose |
|---|---|
| `verify_page` | Run deterministic checks against a page |
| `verify_flow` | Execute a multi-step user flow with assertions |

## Verification Engine

Example checks:

```text
page_loads
no_page_errors
no_console_errors
no_network_failures
no_http_5xx
no_horizontal_overflow
element_visible
element_exists
text_present
url_matches
title_matches
```

Checks return:

```text
passed
failed
skipped
error
```

with optional severity:

```text
info
warning
error
critical
```

A score is convenience only. The source of truth is the individual result and its evidence.

## Evidence

Failed checks should carry supporting evidence whenever possible.

Evidence can include:

- screenshots
- console errors
- page errors
- network failures
- HTTP responses
- navigation events
- DOM/accessibility information
- layout findings
- assertion results
- timing information

Example:

```json
{
  "id": "ev_13",
  "type": "network",
  "summary": "POST /api/login returned HTTP 500",
  "source": "http://localhost:3000/api/login"
}
```

Large browser outputs are bounded so diagnostics remain useful inside an AI context window.

## Verification flows

Flows allow an agent to verify real user journeys.

```json
{
  "name": "login",
  "steps": [
    { "action": "goto", "url": "http://localhost:3000/login" },
    { "action": "type", "selector": "#email", "text": "demo@example.com" },
    { "action": "type", "selector": "#password", "text": "password" },
    { "action": "click", "selector": "button[type=submit]" },
    { "assert": "url_matches", "pattern": "/dashboard" }
  ]
}
```

## Responsive verification

Useful viewport presets:

```text
360 × 800
380 × 800
768 × 1024
1280 × 800
1440 × 900
```

Designed to catch overflow, clipping, elements outside the viewport, mobile navigation problems, fixed-element overlap, and broken images.

## Security

A browser that can navigate to arbitrary URLs can become an SSRF and browser-control risk.

Render & Verify treats security as a core architectural concern.

Planned protections include:

- SSRF protection
- private/loopback IP blocking
- DNS resolution checks
- redirect re-validation
- optional domain allowlists
- isolated browser contexts
- session/resource limits
- navigation/action timeouts
- screenshot/output limits
- bearer authentication for remote HTTP mode
- secret redaction
- disabled `evaluate` by default
- page content treated as untrusted data

See [SECURITY.md](SECURITY.md).

## Raw HTML mode

Generated HTML can be rendered before deployment:

```text
Generate HTML
      ↓
Render
      ↓
Screenshot
      ↓
Inspect console/network
      ↓
Check layout
      ↓
Return evidence
```

## Technology

- TypeScript
- Node.js 20+
- Playwright
- Chromium
- Model Context Protocol SDK
- Zod
- Docker

## Project status

🚧 **Early development**

The project is being built incrementally around the verification loop.

## Roadmap

### Phase 0 — Setup
- TypeScript project
- tests and linting
- Docker
- MCP hello-world

### Phase 1 — Browser Core
- isolated sessions
- `open_url`
- `screenshot`
- console/network diagnostics
- cleanup

### Phase 2 — Interaction
- `click`
- `type_text`
- `navigate`
- viewport changes
- page snapshots

### Phase 3 — Verification Engine
- evidence model
- deterministic checks
- `verify_page`
- severity
- scoring
- concise agent results

### Phase 4 — Verification Flows
- flow schema
- flow runner
- assertions
- `verify_flow`

### Phase 5 — Layout
- overflow detection
- clipping
- overlap detection
- responsive diagnostics

### Phase 6 — Security
- SSRF protection
- DNS validation
- redirect protection
- authentication
- limits
- redaction

### Phase 7 — Remote / Production
- Streamable HTTP
- structured logging
- metrics
- Docker release
- soak testing

### Future
- visual regression
- Playwright traces
- HAR export
- video/GIF recording
- performance diagnostics
- accessibility auditing
- HLS/video verification
- Firefox
- WebKit

## Testing philosophy

The repository will include deterministic fixture pages with intentional failures such as:

```text
JavaScript errors
broken assets
HTTP 500 responses
network failures
CORS issues
mixed content
overflow
clipped content
slow loading
redirect problems
login flow failures
popup/layout issues
```

Target metrics:

| Metric | Target |
|---|---:|
| Bug detection rate | ≥ 90% |
| Evidence accuracy | ≥ 95% |
| Typical first report | < 5 seconds |
| Leaked sessions | 0 |
| Clone → working setup | < 10 minutes |

## Repository structure

```text
render-verify-mcp/
├─ src/
│  ├─ mcp/
│  ├─ browser/
│  ├─ collectors/
│  ├─ verification/
│  ├─ security/
│  ├─ tools/
│  └─ logging/
├─ fixtures/
├─ test/
├─ docs/
├─ Dockerfile
├─ docker-compose.yml
├─ package.json
├─ tsconfig.json
├─ AGENTS.md
├─ SECURITY.md
├─ CONTRIBUTING.md
├─ CODE_OF_CONDUCT.md
├─ LICENSE
└─ README.md
```

## Contributing

Contributions are welcome.

Before significant changes:

1. Read [AGENTS.md](AGENTS.md).
2. Read [CONTRIBUTING.md](CONTRIBUTING.md).
3. Add tests for new behavior.
4. Keep schemas and documentation synchronized.
5. Consider security implications for browser navigation and state.

## License

MIT License. See [LICENSE](LICENSE).

## Vision

Modern coding agents can already generate large amounts of code.

The next step is making them better at **proving their work**.

Render & Verify MCP aims to become a reusable browser-verification layer for AI agents whenever they need to answer:

> **Does this actually work?**

Not from source-code assumptions.

Not from a successful HTTP request.

**From the browser.**

**Render. Interact. Verify. Prove.**
