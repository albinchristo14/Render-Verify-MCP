# Architecture

Render & Verify is organized around six boundaries:

1. MCP transport and tool registration
2. Browser/session management
3. Event collectors
4. Verification engine
5. Security policy
6. Agent-friendly evidence formatting

The Verification Engine is intentionally separated from the low-level browser tools so future checks and verification flows can evolve without turning the MCP interface into a monolith.

See the main README and project implementation plan for the full architecture.
