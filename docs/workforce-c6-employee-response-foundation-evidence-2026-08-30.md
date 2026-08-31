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
and rejects a changed retry. `POST /api/v1/workforce/exceptions/:id/response`
is a session-only self-service source path: it resolves the current employee,
reads only a case matching that employee and tenant, derives the case's exact
workday/segment server-side, and then calls the writer. A missing or another
employee's case has one identical unavailable result, so it cannot serve as an
ID oracle. The endpoint accepts neither explanation/proof nor a direct time
change. No migration has been applied, so the UI cannot offer that acknowledgement
write, claim a case was resolved, edit an accepted fact, suppress an exception,
or expose another employee's evidence.

`GET /api/v1/workforce/exceptions/mine` and `/workforce/exceptions/mine` now
provide the corresponding self-scoped discovery surface. It reads only the
current employee's tenant-local case, generic type and owned workday date; it
never reads decision reasons, location, QR/device proof, response-ledger rows
or another employee's case. Its correction link carries opaque owned workday
and case selections into the existing protected request form. The browser may
change the workday or request type, which deliberately removes the case source
hint; when it retains the prefill, the server proves the exact own case and
workday before it records the optional immutable source link on the correction
request. The database migration is still unapplied, so the trigger is not yet
live.

The later C6 lifecycle must apply the migrations with disposable-DB/RLS
evidence, connect the separate employee response ledger to an explicit
employee action, and add accountable resolution. It must not turn the existing
protected request reason into raw evidence or payroll input.

## Verification

    PASS  CI=true npx vitest run \
          src/__tests__/lib-workforce-exception-employee-response.test.ts \
          src/__tests__/lib-workforce-exception-employee-response-writer.test.ts \
          src/__tests__/migration-workforce-exception-employee-responses.test.ts \
          src/__tests__/api-workforce-exception-employee-response.test.ts \
          src/__tests__/api-workforce-my-exceptions.test.ts
          (5 files, 16 tests)

    PASS  DATABASE_URL=<nonconnecting validation URL> npx prisma validate
    PASS  i18n parity (EN/RU/AZ), targeted ESLint and git diff --check

    NOT RUN  migration apply/disposable-DB RLS, browser accessibility evidence,
             mobile UI, notification delivery, full typecheck/build, staging
             and production tests.
