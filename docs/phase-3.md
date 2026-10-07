# Phase 3 — Verification Engine

Version 0.4.0 adds `verify_page`. `hello_world` reports `phase_3`. The engine performs deterministic checks, returns linked evidence, and distinguishes failed assertions from missing observations and inspection errors. Verification flows remain Phase 4.

## Input

```json
{
  "session_id": "<existing session UUID>",
  "checks": [
    "page_loads",
    "no_page_errors",
    "no_console_errors",
    "no_network_failures",
    "no_http_5xx",
    "no_horizontal_overflow"
  ],
  "include_screenshot": false,
  "evidence_limit": 5,
  "timeout_ms": 5000,
  "policy": {
    "severities": { "no_horizontal_overflow": "warning" },
    "score_weights": { "info": 1, "warning": 2, "error": 5, "critical": 10 },
    "ignore_http_statuses": [],
    "overflow_tolerance_px": 1
  }
}
```

Only `session_id` is required. Omitted `checks` runs all six; explicit lists contain 1–6 unique supported names. Policy objects reject unknown fields. `evidence_limit` accepts 1–20 diagnostic samples per check, default 5. `include_screenshot` defaults to false.

Timeouts accept 100–60,000 ms and are capped by `ACTION_TIMEOUT_MS` (default 5,000). Inspection and optional screenshot share one deadline. A hard timeout discards the context to cancel unfinished browser work and sets `session_closed`; open a new session afterward. Collected diagnostic checks can still produce findings when document inspection fails.

## Check semantics

| Check                    | Pass condition                                                                               | Default severity |
| ------------------------ | -------------------------------------------------------------------------------------------- | ---------------- |
| `page_loads`             | Current document exists and is interactive/complete, with main HTTP 200–399 or raw HTML mode | critical         |
| `no_page_errors`         | No uncaught page exceptions in complete collected history                                    | error            |
| `no_console_errors`      | No console records at error level in complete collected history; warnings do not fail        | error            |
| `no_network_failures`    | No failed requests, policy blocks, or non-exempt HTTP 4xx/5xx in complete collected history  | error            |
| `no_http_5xx`            | No non-exempt HTTP 500–599 records in complete collected history                             | error            |
| `no_horizontal_overflow` | Main document scroll width minus document client width is within tolerance                   | warning          |

The overflow check measures root/body scroll widths. It does not identify offending elements, inspect frames or shadow roots, or prove an absence of clipping and other layout problems. Expanded layout diagnostics arrive in Phase 5. DOM properties remain untrusted observations that pages can manipulate; fixed inspection is deadline-bounded and cannot accept client-supplied JavaScript.

Document checks reflect current measurements. Diagnostic checks cover **session history across pages and actions**, captured since collectors were installed before initial navigation. Navigation and verification never clear history. Verification does not wait for future background events or application completion; use an explicit action completion selector first. Measurements and screenshots of a dynamic page are not an atomic snapshot.

Every retained violation proves a failed check even when history is incomplete. Without a retained violation, missing records from buffer eviction or diagnostic clearing produce `skipped`, because absence cannot be established. Missing counts include explicit clear/removal even when legacy eviction counters reset. Console/network coverage is conservative: missing warning-only or non-5xx records also prevent the corresponding negative checks from passing because their original types are no longer available.

A fresh session is the supported clean rerun after a fix. A selected subset only establishes that subset; omitting a check is not a pass for that check.

## Policy and scoring

Policy is local to each call and is returned with the report. Severity accepts `info`, `warning`, `error`, or `critical`. Score weights are positive integers 1–100. Overrides affect score weights and metadata; they do not turn failed checks into passes.

`ignore_http_statuses` accepts up to 50 codes from 400–599 and affects both network and HTTP-5xx checks. Main-document loading still requires an accepted main response. Policy-block and transport-failure records cannot be ignored by status. Exceptions never relax URL, DNS, redirect, or IP restrictions. Overflow tolerance accepts 0–100 pixels, default 1.

Check statuses are `passed`, `failed`, `skipped`, and `error`. The report status is:

1. `failed` when any selected check fails.
2. Otherwise `error` when a check errors or a requested screenshot fails.
3. Otherwise `incomplete` when a check is skipped.
4. Otherwise `passed`.

The score is `round(100 × passed check weights / all selected check weights)`. It is `null` if any check is skipped or errored. A failed screenshot can coexist with a numeric score, because the score describes checks; `screenshot.status` and the report status expose the capture failure. Individual statuses and evidence are the source of truth.

## Report and evidence

The structured report includes report/session UUIDs, status, score, summary, redacted URL, viewport, observation interval, session closure, selected checks, evidence, effective policy, and `scope: "retained_session_history_and_current_document"`. Each check includes status, severity, summary, `evidence_ids`, `observed_failures`, and `omitted_evidence`.

Evidence has an ID, type, timestamp, bounded summary/data, and `content_trust: "untrusted"`. Types are console, page error, network, navigation, layout, coverage, screenshot, and operation. Aggregate coverage evidence reports retained, missing, and violating records even when diagnostic samples are omitted. Diagnostic event IDs use session/category/monotonic sequence and remain stable in repeated reports; the same network event can support multiple checks. Measurement IDs are derived from their sanitized data; each screenshot is a separate capture with its own ID. IDs link payloads in the returned report, not an external persistence or evidence-fetch API.

Reports reapply entered-value and known-pattern redaction to historical records before returning them. They do not include entire DOMs, submitted HTML, input values, response bodies, or request headers. Screenshot pixels may contain sensitive information and cannot be reliably redacted.

The JSON budget is `MAX_OUTPUT_BYTES`. Samples are trimmed with their references, and omission counts increase; aggregate findings, statuses, and severity remain. No diagnostic history is deleted. If the aggregate report itself cannot fit, MCP returns `OUTPUT_LIMIT`. Request fewer checks/samples or increase the configured budget within supported bounds. Omission counts exclude records already lost from history; those are disclosed separately as missing counts.

A requested screenshot uses the existing viewport and image byte/dimension limits. It is returned as MCP content index 1 after the report text. Screenshot evidence references that block and records its MIME type and viewport. Capture failure is explicit evidence, not silently omitted.

A failed verification verdict remains a successful MCP tool invocation: inspect `structuredContent.status`. Invalid schema input, unavailable/expired/busy sessions, and envelope failures return MCP `isError: true`. Report check errors include safe error codes/messages without server stacks.

## Demonstration and validation

Run `npm run fixtures`, then enable only the required local destination with `ALLOW_LOCAL=true` and `ALLOWED_DOMAINS=127.0.0.1`. Open `/verification-broken` at 360×800. Wait for `#api-complete` through an action's `wait_for`, then verify. The page deliberately produces JavaScript/console errors, HTTP 404 and 500 responses, and horizontal overflow. Open `/clean` in a new session to verify a clean result. Close both sessions afterward.

The full suite contains 98 tests across 13 files. It covers the six checks, fresh clean reruns, stable/shared references, historical navigation scope, cleared/evicted coverage, policy exceptions and scoring, main HTTP 500, viewport/tolerance changes, redaction, stalled inspection cancellation, explicit screenshot failure, JSON budgeting, and real compiled MCP report/image responses. Earlier browser, interaction, lifecycle, and security tests remain enabled.

Validated in this cloud checkout with Node.js 24.19.0 and Playwright 1.63.0:

- `npm run check` passed type checking, lint, formatting, compilation, and all 98 tests with the configured browser.
- `env -u BROWSER_EXECUTABLE_PATH PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/ms-playwright npm test` passed the same 98 tests with managed Chromium 153.
- `render-verify-mcp:phase3` built successfully, and `npm run test:docker -- render-verify-mcp:phase3` passed real MCP initialization, browser rendering, interactions, snapshot, clean and failed verification reports, resized PNG screenshot, and cleanup with container networking disabled.
- Final lint, formatting, and whitespace checks passed after the smoke-test script and documentation updates.

Docker initially exhausted disk space under this environment's `vfs` storage driver. Runtime artifacts now copy into the browser base in one filesystem layer. Clearing unused build cache and archiving the prior generated Phase 2 image resolved the blocker; the archive is `/tmp/render-verify-mcp-phase2-image.tar.gz` and can be restored with `docker load` when sufficient space is available.

Public Internet navigation, authenticated HTTP transport, production soak testing, flow assertions, and expanded layout analysis remain outside this milestone.
