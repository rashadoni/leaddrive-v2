# Workforce C6 employee-response foundation evidence

**Status:** WF-C6-006 partial
**Date:** 2026-08-31

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

The source now also contains an additive, inactive
`WorkforceExceptionEmployeeResponse` ledger and migration. It accepts only an
employee acknowledgement or a link to an existing `TIME_CORRECTION` request,
never a free-text explanation or raw proof. Its database trigger requires the
same tenant employee, exact exception case, exact workday and exact segment;
the correction request must be the employee's request for that exact workday.
The linked CRM user is also verified so another signed-in tenant user cannot
submit an employee response under a caller-supplied agent id.

The canonical writer authorizes before any advisory lock or database call,
records only metadata-only audit fields, accepts an exact client-response retry
and rejects a changed retry. This is still source-only: no migration has been
applied and no employee-scoped case API or UI uses the ledger. Therefore the
UI cannot claim a case was resolved, edit an accepted fact, suppress an
exception, or expose another employee's evidence.

The later C6 lifecycle must expose this only through a self-scoped case API,
apply the migration and disposable-DB/RLS evidence, and connect a requested
correction through configured bounds and an accountable decision. It must not
turn the existing protected request reason into raw evidence or payroll input.

## Verification

    PASS  CI=true npx vitest run \
          src/__tests__/lib-workforce-exception-employee-response.test.ts \
          src/__tests__/lib-workforce-exception-employee-response-writer.test.ts \
          src/__tests__/migration-workforce-exception-employee-responses.test.ts
          (3 files, 9 tests)

    PASS  DATABASE_URL=<nonconnecting validation URL> npx prisma validate
    PASS  targeted ESLint and git diff --check

    NOT RUN  migration apply/disposable-DB RLS, employee case/appeal endpoint,
             browser accessibility evidence, mobile UI, notification delivery,
             full typecheck/build, staging and production tests.
