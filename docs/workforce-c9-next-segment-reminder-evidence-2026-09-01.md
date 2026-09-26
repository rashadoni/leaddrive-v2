# Workforce C9 — next-segment local-reminder source evidence

> **Status:** source-only partial implementation of `WF-C9-011`.
> **Recorded:** 2026-09-01.

## Implemented safely

- `GET /api/v1/mtm/mobile/workday` keeps the existing restrictive schedule
  projection.  It exposes an ISO `startsAt` only when its immutable schedule
  resolver selected exactly one **NEXT** segment.  It does not expose a
  segment ID, site ID, address, geofence revision, proof-policy reference,
  QR, device proof or coordinates.
- Android parses that instant only as an already-resolved server value.  It
  does not construct it from a local date, device timezone or clock.
- When an employee has explicitly opted into private local reminders and the
  OS allows notifications, `WorkforceReminderScheduler` replaces at most two
  fixed-name, `Data.EMPTY` WorkManager jobs: a planned-shift-end reminder and
  a next-segment reminder.  Neither name nor input contains an employee,
  tenant, workday, site, segment, action, location, QR or proof identifier.
- Both jobs use the same generic localized notification text.  The notification
  never names a shift, time, employee, place, evidence method or required
  action.  Disabling the option, sign-out/account switch, a completed workday,
  unavailable schedule context or elapsed windows cancels the jobs.

## Verification performed

```text
CI=true npx vitest run --maxWorkers=1 \
  src/__tests__/api-mtm-mobile-workday.test.ts \
  src/__tests__/workforce-android-foundation.test.ts

PASS: 2 files, 25 tests

npx eslint src/app/api/v1/mtm/mobile/workday/route.ts \
  src/__tests__/api-mtm-mobile-workday.test.ts \
  src/__tests__/workforce-android-foundation.test.ts

PASS
```

`api-mtm-mobile-workday.test.ts` proves that a current segment has no
`startsAt`, while a next segment returns only the immutable instant plus safe
display context and omits schedule identifiers and geofence/address fields.

## Still open — not claimed

- **NOT RUN:** Android Gradle lint/unit/instrumentation, device notification
  permission/channel/delivery, process death and WorkManager timing.  Heavy
  Android verification belongs to GitHub CI or a temporary Mac worker, not
  Contabo.
- No push provider/credential, pre-workday shift-start reminder, server no-show
  notification, delivery receipt, retry worker or notification analytics exists.
- The current local path is optional and private only; it does not create an
  attendance fact, infer a required action or change schedule/exception policy.
