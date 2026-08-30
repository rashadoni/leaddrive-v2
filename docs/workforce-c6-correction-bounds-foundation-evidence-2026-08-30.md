# Workforce C6 correction-bounds foundation evidence

**Status:** WF-C6-007 partial
**Date:** 2026-08-30

## Delivered policy-only evaluator

`src/lib/workforce/correction-bounds.ts` defines a versioned, immutable-input
assessment for a direct manager correction. It needs an explicit
tenant-approved policy that supplies its effective date range, direct-edit
window, maximum corrected duration and maximum boundary movement. The result
includes a deterministic policy hash so a future immutable correction ledger
can retain the exact rule set that allowed or escalated a request.

The evaluator accepts only an open period and a policy effective on the stored
work date. It routes a missing policy, unknown/closed period, expired policy,
future/aged edit, excessive duration or excessive start/finish movement to
`REVIEW_REQUIRED`. It has no hard-coded tenant threshold and therefore does
not silently convert an owner/legal/HR decision into a global default.

## Explicitly not activated

This is a pure pre-write policy contract. It does not yet select an effective
tenant policy, alter the existing correction endpoint, persist a case,
overwrite a workday, decide an appeal, calculate payroll or close a period.
The existing immutable correction revision and audit remain their own
contracts. Wiring may occur only after HR owns the date/duration/range policy,
period source and escalation authority.

## Verification

    PASS  PATH=/home/codex-alt/.local/bin:$PATH npx vitest run \
          src/__tests__/lib-workforce-correction-bounds.test.ts \
          src/__tests__/workforce-direct-time-correction.test.ts --reporter=dot
    PASS  targeted ESLint and git diff --check

    NOT RUN  policy persistence/selection, endpoint integration, Prisma
             migration/generate/apply, browser workflow, pay-period system
             integration, full typecheck/build, staging and production tests.
