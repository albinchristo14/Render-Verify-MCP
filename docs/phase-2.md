# Phase 2 — Interaction

The Phase 2 milestone (version 0.3.0, `phase_2`) added bounded interactions and visible DOM snapshots to the stdio Browser Core. These tools remain available in the current version 0.4.0, `phase_3`. Verification verdicts and `verify_page` are documented in [Phase 3](phase-3.md).

## Tool reference

All tools require an existing `session_id` UUID. Actions share optional `timeout_ms` and `wait_for: { selector, state? }`; state defaults to `visible` and also accepts `hidden`, `attached`, or `detached`.

| Tool                | Additional inputs                          | Behavior                                                     |
| ------------------- | ------------------------------------------ | ------------------------------------------------------------ |
| `click`             | `selector`                                 | Click an actionable target using Playwright locator checks   |
| `type_text`         | `selector`, `text`, optional `press_enter` | Replace the field contents; optionally press Enter           |
| `navigate`          | `url`, optional `wait_until`               | Navigate in the same context; retain cookies/storage         |
| `set_viewport`      | `width`, `height`                          | Resize the current page                                      |
| `get_page_snapshot` | Optional `max_items`                       | Return bounded visible DOM categories and CSS selector hints |

Selectors contain 1–512 characters. Text is at most 16,384 UTF-16 code units and may be empty to clear a field. Viewports are 320–1920 by 200–1080. Navigation supports `load` (default) or `domcontentloaded`; it applies the existing URL/DNS/IP policy to the destination, redirects, and subresources. Schema validation rejects invalid inputs before execution.

Requested timeouts are 100–60,000 ms and are capped by `ACTION_TIMEOUT_MS` (default 5,000) or, for navigation, `NAVIGATION_TIMEOUT_MS` (default 30,000). The action and optional completion selector share a single deadline. No network-idle wait or arbitrary sleep is exposed. A hard deadline closes the context to cancel unfinished work; open a new session when `session_closed` is true. Native Playwright timeouts can return before that deadline and retain the context.

## Action results and evidence

Actions return `success`, `action`, `session_id`, redacted `final_url`, main-document `http_status`, `url_changed`, `duration_ms`, `session_closed`, `viewport`, `new_errors`, and `content_trust: "untrusted"`. Failures include `error.code`, `error.message`, and `error.retryable`, and MCP sets `isError: true`. Examples include `ACTION_TIMEOUT`, `NAVIGATION_TIMEOUT`, `URL_BLOCKED`, and `INPUT_LIMIT`. Session-level errors use the existing error envelope.

`new_errors` contains `console`, `page_errors`, and `network_failures` arrays, plus `remaining` and `dropped` counts for each category. Monotonic collector cursors separate prior evidence from records observed during an action, even after diagnostic clearing or buffer eviction. Each category returns at most 20 new records; JSON-budget trimming may reduce that count further and increases `remaining`. Persistent diagnostics remain available through the Browser Core tools.

`success: true` means the action ran and its requested wait completed. It is not an application verification verdict. Evidence covers the interval from action start to result collection; asynchronous errors arriving later must be retrieved separately. Main-document status is distinct from API/subresource failures in `new_errors.network_failures`.

The `/login` fixture deliberately emits console/page errors and an HTTP 500 from `/api/login`. Waiting for `#login-status` makes the failing request part of the submit action's evidence. See the [README walkthrough](../README.md#try-a-login-flow).

## Snapshot limits and privacy

Snapshots contain title, current URL, viewport, headings, buttons, links, forms, inputs, landmarks, and visible text. Items include semantic names and CSS selector hints; controls may include type, placeholder, and disabled state. `max_items` defaults to 20 per category and accepts 1–100.

The snapshot inspects at most 5,000 main-document elements, limits text/name lengths to 200 characters, bounds text traversal and selector construction, and reports `scanned_elements`, `scan_limit_reached`, and `truncated_categories`. Complex paths can return a null selector. A result exceeding the configured JSON budget returns `OUTPUT_LIMIT`; request fewer items. Selector hints are only valid for the current DOM.

This fixed DOM inspection is an approximation of visible semantic content, not a full accessibility tree or audit. It does not traverse frames or shadow roots. Hidden content, field values, and text inside textarea/select/contenteditable areas are omitted. Known secret patterns and entered values are redacted from returned semantic text and URLs. A page can manipulate its DOM APIs; the inspection deadline bounds stalled execution. Clients cannot supply evaluation code.

Before filling, the session registers each distinct nonempty entered value for literal and URL-encoded redaction from subsequent text evidence. Storage is limited to 128 distinct values and 65,536 UTF-16 code units per session; exceeding either fails before filling with `INPUT_LIMIT`. Transformed secrets, earlier evidence, arbitrary page text, and screenshot pixels are not guaranteed to be redacted. Page content remains untrusted data.

## Validation at the Phase 2 milestone

Validated with Node.js 24.19.0 and Playwright 1.63.0:

- 83 tests across 10 files passed using installed Chromium 151.
- The same 83 tests passed using Playwright-managed Chromium 153 after a successful managed browser installation.
- Type checking, linting, formatting, and compilation passed.
- The Docker image built and passed real stdio MCP initialization, Chromium rendering, snapshot, form fill/click, new console evidence, viewport resize, PNG signature/dimensions, and session cleanup with container networking disabled.
- The container runs as UID 1001 with Node.js 24.19.0.

Tests include the failing login API, Enter submission, click navigation, state retention, viewport change, private navigation/redirect denial, collector eviction, entered-value redaction including regex-special characters, hidden/editable snapshot exclusions, large-DOM bounds, stalled snapshot cancellation, navigation/action timeouts, and bounded compiled MCP responses. Earlier Browser Core and security tests remain in the suite.

Reproduce managed-browser checks in this cloud checkout:

```bash
PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/ms-playwright npm run browser:install
env -u BROWSER_EXECUTABLE_PATH PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/ms-playwright npm run check
docker build -t render-verify-mcp:phase2 .
npm run test:docker -- render-verify-mcp:phase2
```

The download and Docker CDN blockers recorded during Phase 1 are resolved. Public Internet navigation and production soak behavior remain unverified. Deterministic verification, flow assertions, layout verdicts, and authenticated remote HTTP remain later phases.
