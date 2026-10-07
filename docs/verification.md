# Verification

Verification results are evidence-based. Phase 3 implements six deterministic page checks through `verify_page`; see the [tool reference](phase-3.md) for exact conditions, policy, limits, and evidence scope.

A check reports its name, status, severity, concise summary, observed failure count, omitted sample count, and evidence identifiers. The score is secondary to individual results and evidence. Missing history cannot establish an absence of failures.

The core loop is:

```text
BUILD → VERIFY → EVIDENCE → FIX → VERIFY AGAIN
```

Start a fresh browser session when verifying an application after a fix: historical diagnostics remain part of a session's evidence even after navigation. Use explicit completion waits before verifying asynchronous application behavior.
