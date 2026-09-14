# Workforce C6 — mobile self-exception correction foundation

**Status:** WF-C6-006 partial safe source slice.
**Date:** 2026-08-31

## Delivered boundary

The standalone Workforce Android client can now request an explicit refresh of
generic cards for the authenticated employee's own exception cases. The mobile
endpoint is explicitly classified as `workforce-hrm` rather than relying on a
path inference that would classify a nested `/mobile/hrm/*` route as Routes.
It requires the existing `WORKTIME_SELF_READ` permission, verifies the active
employee, filters by tenant and that exact employee, caps the result at 100
cards, uses `private, no-store` and refuses an oversized result rather than
silently truncating it.

Each card contains only an opaque case reference, generic type, owned workday
ID/date and the one `REQUEST_CORRECTION` action. Location, QR, device proof,
free-text reason, decision reason and employee-response-ledger state are not
selected or rendered. The Android screen localizes known generic types in
EN/RU/AZ and maps an unknown type to a localized review label instead of
displaying a raw server code.

Selecting a card pre-fills only a `TIME_CORRECTION` for that card's workday.
Changing request type or selecting another workday clears the case link. The
mobile request parser accepts an opaque `exceptionCaseId` only for a time
correction. In the canonical mobile sync writer, the server verifies the exact
tenant + employee + workday + exception combination before creation. An
unavailable, foreign or reassigned case produces one generic conflict code and
the Android shell shows its normal generic request failure, not the case ID or
server diagnostics. The metadata-only audit records only whether a correction
was case-linked.

## Non-activation boundary

This does **not** write an employee acknowledgement or appeal, resolve an
exception, change attendance, decide pay/discipline, schedule notifications or
enable a tenant. The employee-response ledger migration and the immutable
case-to-correction trigger are still unapplied. The new endpoint is intentionally
separate from ordinary HRM history, so an unavailable future exception schema
cannot make the existing Work Time history request fail.

## Verification

    PASS  CI=true npx vitest run --maxWorkers=1
          src/__tests__/lib-mtm-mobile-hrm.test.ts
          src/__tests__/api-mtm-mobile-hrm-exceptions.test.ts
          src/__tests__/api-mtm-mobile-sync.test.ts
          src/__tests__/workforce-android-foundation.test.ts
          (4 files, 131 tests)

    PASS  EN/RU/AZ Android resource-key parity (198 keys)
    PASS  targeted ESLint and git diff --check
    PASS  python3 scripts/rls/find-context-gaps.py (0 gaps)

    NOT RUN  full typecheck/test baseline, Android Gradle lint/unit for this
             exact source SHA, browser E2E for this new screen, physical
             Android/QR/GPS/biometric checks, disposable-DB migration/RLS,
             staging load/backup/restore and legal/pilot evidence. Those gates
             must run in GitHub CI, an approved heavy worker or real controlled
             environments; they are not substituted on Contabo.
