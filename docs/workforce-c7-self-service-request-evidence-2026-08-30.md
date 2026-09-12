# Workforce C7 employee self-service request evidence

**Status:** WF-C7-005 complete
**Date:** 2026-08-30

The Workforce web fallback now lets an authenticated employee submit and
cancel only their own pending leave, absence and time-correction requests. It
does not depend on Route & Field or on an employee mobile application.

The request service resolves the employee through the session-backed Workforce
actor, rather than accepting an employee identifier from the browser. A
time-correction picker contains only that employee's last 100 recorded
workdays and displays date/status labels instead of raw database identifiers.
Its requested local boundaries are labelled with the organization timezone;
the server rejects an ambiguous/nonexistent daylight-saving time and never
silently converts it.

Submission requires an opaque client idempotency key. Exact retry returns the
same pending request; a changed payload with that key is rejected. Leave and
absence requests reject an overlapping pending/approved leave or absence;
time corrections reject another active correction of that same workday. A
correction must target the employee's own recorded workday on its selected
local date. The service writes metadata-only audit records and intentionally
excludes the employee's free-text explanation from the audit payload.

Cancellation is self-scoped, idempotent for an already cancelled request and
conditional on `PENDING`. A manager decision remains the sole path that can
apply a Workforce calendar/workday change or an immutable correction ledger;
the employee form says this explicitly. A decided request is never rewritten
by employee cancellation.

## Verification

    PASS  31 targeted Vitest tests, one sequential worker:
          workforce-self-request, api-workforce-self-requests,
          api-workforce, workforce-self-request-ui-contract and
          rls-route-context-coverage
    PASS  targeted ESLint for self-request service, session routes, workbench
          and focused tests
    PASS  npm run i18n:check (en/ru/az translation parity)
    PASS  git diff --check
    NOT RUN  browser interaction/accessibility evidence, full TypeScript/build,
             Android/mobile client, database apply and concurrent production
             request tests; these require CI or an approved external worker.

This completes the employee web fallback, not the absent employee mobile
application, granular HR role matrix, directory/history, bulk scheduling or
physical attendance proof workflows.
