# Architecture

Render & Verify separates MCP transport/registration, browser lifecycle, event collectors, security policy, verification logic, and result formatting.

## Implemented through Phase 3

`src/index.ts` validates configuration, constructs a fresh server, connects stdio, and handles EOF and termination signals. `src/server.ts` owns the session service and closes it before disconnecting the protocol transport. stdout carries only MCP messages; startup failures use stderr without environment values or stack traces.

`src/browser/browserManager.ts` lazily starts Chromium and the policy proxy. `sessionManager.ts` reserves capacity before asynchronous opens, creates isolated contexts, registers collectors before navigation, bounds idle lifetimes, prevents overlapping actions, and releases failed/expired/closed contexts.

`src/security/urlGuard.ts` parses URLs, applies exact host allowlists, checks all DNS answers, and rejects special-use addresses by default. `egressProxy.ts` handles HTTP and CONNECT by connecting to the checked numeric IP. Each new connection rechecks DNS, so the browser cannot resolve a different destination after preflight. Chromium's loopback proxy bypass is disabled. Service workers and extra pages are blocked/closed.

`src/collectors/` keeps separate bounded buffers for console records, page errors, and network failures. Dropped counts expose eviction. Diagnostic clear operations remove returned records only. `src/tools/` bounds screenshots and JSON results and produces predictable error output. Known secret patterns are redacted by `src/security/redaction.ts`; page content remains untrusted.

`src/mcp/registerTools.ts` registers the connectivity tool. `browserTools.ts` owns Browser Core tool schemas and adapts service results to MCP content. Tool definitions do not own browser lifecycle or network policy.

`src/mcp/interactionTools.ts` registers the Phase 2 action and snapshot schemas. `src/tools/interactions.ts` executes actions under the session lock, checkpoints collector sequence cursors, and returns only evidence observed since each action began. Output trimming exposes remaining counts without deleting persistent evidence.

`src/tools/deadline.ts` enforces a shared deadline for actions and completion waits. A hard deadline discards the context to cancel outstanding browser work. `pageSnapshot.ts` executes a fixed, bounded DOM inspection; clients cannot submit evaluation code. Collectors register entered values before filling and redact them from subsequent text evidence. Main-frame request/response listeners track HTTP status across click and Enter navigation.

## Verification layer

`src/verification/types.ts` defines evidence, check statuses, severity, policy, and reports. `checks.ts` provides deterministic coverage and scoring rules; `verifyPage.ts` executes the six checks under the session lock. `src/mcp/verificationTools.ts` validates inputs and returns a JSON report plus an optional bounded MCP image.

Ring-buffer snapshots preserve sequence IDs and lifetime missing counts, including explicit clearing. Verification reads retained diagnostic history without mutating it. Known failures dominate incomplete coverage; absence of a violation only passes with complete relevant history. Page load and document horizontal overflow use fixed, deadline-bounded inspection of the current document. Configurable HTTP-status exceptions never hide policy-block records.

Each check has aggregate evidence. Diagnostic samples use session/category/sequence IDs, shared between checks that reference the same event. Report budgeting removes samples and their references together, increments omission counts, and preserves aggregate findings. Entered-value redaction is reapplied before returning historical evidence. Screenshots use the existing bounded capture helper while holding the same session lock.

Individual check results and evidence remain the source of truth; scores are secondary. Flows, expanded layout diagnostics, and remote HTTP are later milestones.

See the [roadmap](roadmap.md), [Phase 1 tool reference](phase-1.md), [Phase 2 interactions](phase-2.md), [Phase 3 verification](phase-3.md), and [verification principles](verification.md).
