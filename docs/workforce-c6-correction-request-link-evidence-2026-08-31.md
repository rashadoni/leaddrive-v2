# Workforce C6 correction-request source link evidence

**Status:** WF-C6-006 partial safe source-link slice
**Date:** 2026-08-31

## Delivered boundary

An employee who opens a correction request from one of their own Workforce
exception cases now submits the opaque case reference together with the
already self-scoped workday selection. The server does not trust either query
parameter: it first proves the selected workday belongs to the signed-in
employee and selected local date, then proves the case is in the same tenant,
belongs to that employee and names that exact workday.

The new optional `MtmHrmRequest.exceptionCaseId` records that source only for
a `TIME_CORRECTION`. Ordinary correction requests remain valid without it.
The idempotency comparison includes the source link, so a retry key cannot be
reused to silently associate a correction with a different exception. The
metadata-only audit records a boolean that a source link was present; it never
records the case id, employee explanation, location, QR, device or evidence
payload.

The additive migration has no backfill or attendance mutation. Its database
trigger rejects a non-correction link, a missing workday, another employee's
case, a different case workday and any later link reassignment. Existing
request-table RLS and grants remain the authority; the migration does not
introduce a privileged write path.

## Deliberate limits

- The migration is not applied in any database yet.
- Opening the correction form is not an acknowledgement or resolution. The
  separate append-only employee-response ledger remains migration-gated and
  has no visible acknowledgement write.
- There is no mobile implementation, notification delivery, automatic HR
  decision, attendance overwrite, pay calculation or disciplinary action.
- The browser scenario is updated for the exact case/workday URL but the
  current candidate Chromium/RLS job must pass in CI before browser evidence
  is claimed.

## Verification

    PASS  CI=true npx vitest run \
          src/__tests__/workforce-self-request.test.ts \
          src/__tests__/migration-workforce-exception-correction-request-link.test.ts \
          src/__tests__/mocks/mtm-prisma.test.ts \
          src/__tests__/workforce-browser-e2e-contract.test.ts
          (4 files, 22 tests)

    PASS  DATABASE_URL=<nonconnecting validation URL> npx prisma validate
    PASS  node --check scripts/workforce-browser-e2e.mjs
    PASS  targeted ESLint (0 errors; one pre-existing shared-mock unused
          parameter warning) and git diff --check

    NOT RUN  migration apply/disposable-DB RLS exercise, full typecheck/build,
             local Chromium E2E, Android, staging load and physical pilot.
             Contabo is restricted to small sequential checks.
