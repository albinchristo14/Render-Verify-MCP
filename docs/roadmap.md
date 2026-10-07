# Development roadmap

This roadmap adapts the supplied **Agentic Dev Plan — Render & Verify MCP** into incremental repository milestones. It describes intended work, not available APIs. The README's current capabilities table is the entry point for what is implemented.

## Phase 0 — Foundation

Implemented:

- Node.js 24 and npm lockfile; strict TypeScript compilation.
- ESLint, Prettier, Vitest, and CI checks.
- Modular MCP server and stdio transport using the MCP SDK.
- `hello_world` with bounded, validated inputs and structured output.
- Typed configuration that rejects HTTP and other unsupported transports.
- Tests against actual stdio subprocesses, including the compiled entry point.
- SIGINT/SIGTERM cleanup and stderr-only startup errors.
- A non-root Docker skeleton without a browser or HTTP listener.

Acceptance: `npm ci`, `npm test`, and `npm run build` succeed; `npm run check` covers all local quality checks. Docker validation is reported separately when the environment permits image pulls and builds.

## Phase 1 — Browser Core (implemented locally)

Implemented separate browser lifecycle, session, collector, tool, and security modules using Playwright 1.63.0 and Chromium. See [Phase 1](phase-1.md) for tool limits and validation.

Implemented isolated contexts, bounded session lifetimes, cleanup, `open_url`, `screenshot`, `get_console_errors`, `get_network_failures`, and `close_session`.

Before exposing URL navigation, enforce supported schemes and destination policy for navigations, redirects, and browser resource requests. Permit fixture/local targets only through an explicit development policy. Raw HTML must remain untrusted, bounded, and subject to network policy. Tests must not bypass protections to succeed.

Acceptance met locally: a fixture page with a deliberate JavaScript error and broken resource produces correct diagnostics, screenshots work, and sessions close without shared cookies or leaked resources. Negative security and failure-path checks accompany the functional tests. The original download/container blockers were resolved during Phase 2: managed Chromium installation and the Docker build/browser smoke test passed. Public-site behavior remains unverified in this instance.

## Phases 2–5 — Complete the verification loop

Phase 2 is implemented: the login fixture reports its HTTP 500 and new console/page errors; navigation preserves session state, viewport changes and bounded snapshots work, and action timeouts and entered-value redaction are covered. See [Phase 2](phase-2.md). Phase 3 is implemented with all six priority checks, bounded linked evidence, configurable severity/scoring/policy, and optional screenshots. See [Phase 3](phase-3.md). Phase 4 is the next milestone.

| Phase                   | Deliverables                                                             | Acceptance                                                                        |
| ----------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| 2 — Interaction         | Click, type, navigation, viewport changes, compact page snapshots        | A fixture login flow exposes its failing API request and new errors after actions |
| 3 — Verification Engine | Evidence model, deterministic checks, statuses/severity, `verify_page`   | One call returns a bounded report with evidence references for failures           |
| 4 — Verification Flows  | Validated flow steps, actions/assertions, stop conditions, `verify_flow` | A complete fixture user journey returns per-step results and evidence             |
| 5 — Layout              | Overflow/clipping checks, viewport presets, bounding-box evidence        | Intentional responsive fixture bugs are detected reliably                         |

Prioritize `page_loads`, `no_page_errors`, `no_console_errors`, `no_network_failures`, `no_http_5xx`, and `no_horizontal_overflow`. Individual check results and evidence are the source of truth; any score is a convenience.

## Phases 6–7 — Harden and expose remotely

Complete SSRF/DNS/redirect fixtures, domain policy, resource/output limits, and secret redaction. Only introduce HTTP with bearer authentication and equivalent browser security policy.

Production work includes health checks for HTTP, structured logs, metrics, graceful browser recovery, a browser-compatible Docker image, and a 24-hour resource/session soak test. None of these are claimed by the Phase 0 skeleton.

## Phase 8 — Advanced backlog

Visual regression, traces/HAR, video, performance, accessibility audits, media diagnostics, multi-browser support, and persistent verification profiles follow a stable core. Do not use them to expand early milestones.

## At each milestone

1. Implement a coherent feature within the module boundaries.
2. Exercise success, invalid input, failure handling, and relevant security paths.
3. Run tests and quality checks; investigate failures.
4. Update README capabilities, setup, configuration, and phase status.
5. Report verified outcomes and outstanding limitations separately.

Publishing, deployment, and release readiness are separate from completing a build phase.
