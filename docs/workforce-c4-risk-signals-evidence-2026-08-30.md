# Workforce C4 — attendance risk signals

> **Checkpoint:** `WF-C4-007` — 2026-08-30

`workforce-attendance-risk-v1` emits deterministic **review-only** hints from
already authorized derived facts: extreme site-transition speed, material
future clock skew and capture materially after a claimed action. It accepts no
raw coordinate, creates no case and has no accept/reject, payroll or
disciplinary output. A later reviewer must account for travel mode, outage,
clock/device context and recovery path.

Verification: `workforce-attendance-risk-signals.test.ts` — 1 file, 3 tests
PASS; targeted ESLint and `git diff --check` PASS.

**NOT RUN:** full TypeScript/build/browser/Android/load and a physical travel
matrix; these require CI/approved worker or a controlled pilot.
