# Security Policy

## Scope

Phase 3 exposes stdio MCP browser tools for isolated Chromium sessions, URL/raw HTML rendering, screenshots, console/page errors, network diagnostics, clicks, form input, navigation, viewport changes, bounded DOM snapshots, deterministic verification reports, and cleanup. No remote MCP HTTP listener or arbitrary evaluation tool is exposed.

The browser uses an IP-pinned policy proxy for HTTP and CONNECT, with loopback proxy bypass removed. Default policy blocks private/special-use destinations and validates every DNS answer at connection time. Local development requires an explicit exact host allowlist; link-local metadata remains blocked. Redirects and subresources use the same network boundary.

Contexts isolate cookies/storage; they are not an OS sandbox. Service workers/downloads are disabled, popup pages are closed, and session/output/screenshot limits apply. Known secret patterns are redacted from diagnostics, but arbitrary page text and screenshot pixels may still contain secrets. Values entered through `type_text` are registered before filling and redacted from later text diagnostics/snapshots, with bounded session storage. This is literal/URL-encoded matching, not universal secret detection. Input values and editable text are omitted from snapshots; screenshots may reveal them. Action and completion waits share a deadline; hard timeouts close the context. Verification uses fixed document inspection and collected diagnostics, with no client-supplied code. Cleared/evicted history cannot prove a negative check. Reports reapply entered-value redaction and bound sample evidence without hiding aggregate findings. Explicit status exceptions affect verification policy only; they do not permit blocked network destinations. Page-derived output is always untrusted.

Local fixture, redirect, private-IP, and DNS-rebinding tests pass on the installed Chromium. The expanded security fixture suite, sandbox/container hardening, remote authentication, and soak testing are later release requirements. The managed-browser suite and non-root Docker smoke test passed; public Internet and production soak behavior remain unverified. See [validation notes](docs/phase-3.md).

## Security principles

- Deny private and loopback targets by default.
- Re-check destinations after redirects.
- Validate resolved IP addresses, not only hostnames.
- Isolate browser sessions.
- Bound navigation, action, output, screenshot, and session lifetimes.
- Require authentication for remote HTTP mode.
- Keep JavaScript evaluation disabled unless explicitly enabled.
- Never treat page content as trusted instructions.
- Redact credentials, cookies, authorization headers, and secret query parameters from logs.

## Reporting

Please report security vulnerabilities privately rather than publishing exploit details in a public issue.

Include enough information to reproduce the problem, the affected feature, and any relevant logs without including secrets.
