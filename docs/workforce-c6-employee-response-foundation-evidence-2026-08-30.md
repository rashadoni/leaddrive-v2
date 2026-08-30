# Workforce C6 employee-response foundation evidence

**Status:** WF-C6-006 partial
**Date:** 2026-08-30

## Available employee correction path

The existing Workforce web fallback lets an authenticated employee create a
typed `TIME_CORRECTION` request only for their own selected workday and its
single organization-local date. They can request a corrected start and/or
finish boundary with a bounded explanation, see the request lifecycle and
cancel only a still-pending request. A request is idempotent, rejects a
different employee's workday and does not mutate an accepted fact itself.

The manager decision and immutable correction-ledger workflows remain separate
from employee submission. The employee-facing audit record intentionally
contains only request metadata, not their free-text explanation.

## Explicit C6 boundary

This gives the employee a safe correction route from an exact day, but it is
not yet a formal response or appeal for `WorkforceExceptionCase`: the additive
C6 case/decision schema has not been applied, has no transaction writer or
employee-scoped case API, and has no segment-linked response field. Therefore
the UI cannot claim a case was resolved, edit an accepted fact, suppress an
exception, or expose another employee's evidence.

The later C6 lifecycle must bind an employee response to the exact authorized
case/workday/segment, preserve immutable status history, and route a requested
correction through the configured-bounds and accountable-decision path. It
must not turn the request reason into a raw-evidence or payroll input.

## Verification

    PASS  targeted self-request/API/UI Vitest suite (3 files, 12 tests)
    PASS  git diff --check

    NOT RUN  applied C6 lifecycle migration, employee case/appeal endpoint and
             browser accessibility evidence, mobile UI, notification delivery,
             full typecheck/build, staging and production tests.
