# Workforce C9 — employee Work Time day detail (2026-08-31)

## Scope

This source slice extends the existing employee-only Workforce history lane. It
does not create an alternate attendance state machine, inspect local GPS, or
turn queued client data into a time fact.

For each accepted self workday the mobile HRM API now returns a bounded,
allow-listed detail object with:

- accepted `START`/`PAUSE`/`RESUME`/`FINISH` event action and server event time;
- the server-derived overall and per-event review state;
- statuses of correction requests linked to that exact accepted workday.

The Android Work Time screen keeps the normal compact day list and lets the
employee expand one day at a time. All labels are present in EN, RU and AZ.
Unknown response values are omitted rather than rendered as invented local
state.

## Privacy and state boundaries

- The nested event select has a 32-item cap and deliberately excludes latitude,
  longitude, accuracy, notes, review reason codes, QR/device evidence and raw
  evidence receipts.
- The detail is based on accepted server history only. It does not claim that a
  local encrypted outbox row, a network failure or an unresolved conflict has
  become an accepted workday event. Those recovery outcomes remain the separate
  C9-010 recovery center.
- A review status is an employee-facing workflow signal, not a payroll,
  discipline, geofence, identity or automated approval decision.

## Verification

Passed in this worktree:

```text
vitest: api-mtm-mobile-hrm + workforce-android-foundation
24 tests passed
```

`NOT RUN`: Android Gradle lint/unit for this SHA, physical TalkBack/font/device
review, browser E2E, Prisma migration apply, staging, load/restore and pilot.
