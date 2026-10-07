# Phase 1 — Browser Core

Version 0.2.0 adds isolated Chromium sessions to the stdio MCP server. Higher-level verification and interactions are not implemented in this phase.

## Tool reference

| Tool                   | Inputs                                                                          | Output                                                                               |
| ---------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `hello_world`          | Optional `name`, trimmed 1–80 characters                                        | Greeting, version, `phase_1`, browser availability                                   |
| `open_url`             | Exactly one of `url` or `html`; optional `viewport`, `wait_until`, `timeout_ms` | Session UUID, redacted final URL, main HTTP status, timing, diagnostic counts        |
| `screenshot`           | `session_id`; optional `full_page`, `selector`, `format`                        | PNG/JPEG MCP image block                                                             |
| `get_console_errors`   | `session_id`; optional `levels`, `limit`, `clear`                               | Console records, page-error records, remaining and dropped counts                    |
| `get_network_failures` | `session_id`; optional `limit`, `clear`                                         | Failed-request, policy-block, and HTTP 4xx/5xx records, remaining and dropped counts |
| `close_session`        | `session_id`                                                                    | `success: true` after context cleanup                                                |

`open_url` defaults to 1280×800 and `wait_until: "load"`. `domcontentloaded` is also supported; network-idle waiting is not exposed. Viewports are constrained to 320–1920 pixels wide and 200–1080 pixels high. A requested timeout cannot exceed the configured navigation maximum.

Raw HTML is limited to 256 KiB of UTF-8 and is passed to Playwright without writing it to disk. Sessions created this way report `about:blank` and no main HTTP status. Inline data content can render, but network requests must pass the same destination policy as URL sessions.

Screenshots default to viewport PNG; JPEG, element clips, and full-page clips are supported. When a selector is provided it takes precedence over full-page mode. Clips are measured and fixed before capture to bound allocation, with maximum width 4096, height 8192, and area 16 million CSS pixels. Large documents return `SCREENSHOT_LIMIT`; the service does not silently return a truncated full-page image. Image bytes are bounded before base64 encoding.

Diagnostics default to 20 records, with an allowed limit of 1–100. Console diagnostics include uncaught page errors separately. `levels` filters console warnings/errors. `clear: true` removes only records actually returned, allowing bounded pagination without silently deleting remaining evidence. Buffer capacities are 500 console records, 200 page errors, and 1000 network records; eviction counters disclose older dropped evidence.

Console/error text is capped at 1024 characters and recorded URLs at 512 characters. Known credential/query patterns are redacted. Arbitrary secrets in page text and screenshot pixels cannot be reliably redacted. All page-derived output is untrusted data.

## Lifecycle and errors

A browser starts lazily. Each session gets a fresh context, one page, separate cookies/storage, and its own collectors. Service workers and downloads are disabled; extra popup pages are closed. Sessions have a configurable count limit and idle TTL, and an active action is protected from idle expiry. Overlapping actions on a session fail with `SESSION_BUSY` rather than racing page state.

Failed opens close their contexts and release capacity. Explicit close, idle sweeping, stdin EOF, SIGINT, and SIGTERM release browser resources. Tool errors do not return server stack traces or submitted HTML.

Runtime errors return `isError: true` and a text JSON payload containing `error.code`, `error.message`, and `error.retryable`. Codes include `INVALID_INPUT`, `URL_BLOCKED`, `SESSION_LIMIT`, `SESSION_NOT_FOUND`, `SESSION_EXPIRED`, `SESSION_BUSY`, `NAVIGATION_TIMEOUT`, `ACTION_TIMEOUT`, `SCREENSHOT_LIMIT`, `OUTPUT_LIMIT`, and `BROWSER_ERROR`. Schema-level errors are rejected by the MCP SDK before handlers run.

## Network boundary

The browser uses a loopback HTTP/CONNECT proxy. The proxy resolves each destination, rejects any disallowed DNS answer, and opens TCP to the checked numeric IP. TLS stays end-to-end through CONNECT and browser certificate verification remains enabled. Chromium's implicit loopback proxy bypass is removed; QUIC and non-proxied WebRTC UDP are disabled. HTTP redirects and subresources use this boundary, including requests from raw HTML.

The default permits only public unicast addresses and HTTP(S) tool URLs. Exact host allowlists can narrow it further. Local development requires both `ALLOW_LOCAL=true` and an exact `ALLOWED_DOMAINS` list. This permits named loopback/private targets but continues to deny link-local/cloud metadata, multicast, carrier-grade NAT, and other special-use ranges. Mixed public/private DNS answers are rejected. The proxy refuses connections back to itself.

Browser contexts isolate state, not hostile code at an OS boundary. Container/host network policy and browser sandbox hardening remain important release requirements. Upstream corporate HTTP proxies are not supported; browser connections require direct outbound TCP to checked IPs. The MCP interface remains stdio-only.

## Validation and pending checks

Validated in the cloud instance with Node.js 24.19.0, Playwright 1.63.0, and the installed Chromium 151.0.7922.173:

```bash
BROWSER_EXECUTABLE_PATH=/usr/bin/chromium npm run check
```

The suites exercise real fixture pages and real MCP subprocesses: deliberate console/page errors, missing assets, HTTP 500 and failed requests, PNG/JPEG bytes, cookies/storage isolation, URL normalization and private ranges, redirects, DNS rebinding, IP pinning (including CONNECT), raw HTML network policy, session counts, idle expiry, failed-navigation cleanup, screenshot limits, diagnostic pagination, and shutdown. Passed test totals are reported in the development task result.

At the Phase 1 milestone, managed-browser installation and Docker pulls were blocked by CDN access. These blockers were resolved and both workflows passed during [Phase 2 validation](phase-2.md). The current server reports version 0.4.0 and `phase_3`; the tools above remain available.

Public Internet page navigation, remote HTTP, and soak testing remain unverified or unimplemented. Deterministic page verification is implemented in [Phase 3](phase-3.md). Phase 2 adds interactions without claiming those later milestones.
