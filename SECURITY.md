# Security Policy

## Scope

Render & Verify can navigate web pages and perform browser actions. URL validation, browser isolation, resource limits, and untrusted page content are therefore critical security boundaries.

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
