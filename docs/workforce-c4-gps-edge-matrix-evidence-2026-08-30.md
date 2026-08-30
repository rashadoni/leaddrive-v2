# Workforce C4 — GPS edge matrix

> **Checkpoint:** `WF-C4-010` — 2026-08-30

The consolidated matrix proves that valid `(0,0)` is not treated as missing;
boundary uncertainty is `UNKNOWN`; stale/future, weak, mocked and non-preferred
provider signals require review; and permission denial becomes `UNAVAILABLE`,
not `OUTSIDE` or a silent pass.

Verification: 3 targeted files, 12 tests PASS; targeted ESLint and
`git diff --check` PASS. **NOT RUN:** physical Android permission/mock/provider
matrix, browser build and load; they require CI/approved worker or pilot.
