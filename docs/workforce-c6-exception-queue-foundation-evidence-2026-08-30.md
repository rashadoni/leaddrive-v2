# Workforce C6 — exception-queue foundation evidence

**Status:** WF-C6-005 partial source contract.
**Date:** 2026-08-30

## Delivered safe projection

`src/lib/workforce/exception-queue.ts` projects a future exception queue from
an already authorized, tenant-scoped case read. Its output contains only the
display reference, employee display name, approved taxonomy/triage level, age,
derived lifecycle stage, evidence availability, employee-response state and
one explicit human next action.

- Raw location, QR, device material, evidence payload, decision reason and
  database identifiers are absent.
- The recommended lifecycle is evaluated from the complete supplied decision
  code sequence. Unknown/contradictory data is routed to
  `DATA_INTEGRITY_REVIEW`, never presented as resolved.
- A received employee response returns the case to HR acknowledgement/review;
  it cannot resolve, correct, pay or discipline automatically.
- Unknown type, invalid display data and a future-created case fail closed.

## Deliberate non-activation boundary

There is no case query, endpoint, queue page, role wrapper, persistence,
notification, employee-text disclosure or raw-evidence read. A later C6/C8
service must apply tenant/RLS and C7 grant scope before it provides inputs to
this projection. The model does not claim that a manager can yet resolve a
real case.

## Verification

    PASS  PATH=/home/codex-alt/.local/bin:$PATH npx vitest run \
          src/__tests__/lib-workforce-exception-queue.test.ts \
          src/__tests__/lib-workforce-exception-policy-draft.test.ts \
          src/__tests__/lib-workforce-exception-case-ledger.test.ts --reporter=dot
          (3 files, 14 tests)

    PASS  targeted ESLint and `git diff --check` in this worktree.

    NOT RUN  migration apply, query/endpoint/UI/browser, RLS/live grant,
             notification, Android, physical pilot and full typecheck/build.
             The source-only contract cannot make those claims.
