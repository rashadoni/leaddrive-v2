# Workforce C9 — Work Time local recovery status (2026-08-31)

## Scope

This source slice pairs the existing accepted server Work Time history with a
small, metadata-only view of the encrypted Android outbox. It gives an
employee a clear distinction between:

- accepted server history, day detail, review state and correction state; and
- unresolved local Work Time delivery state, shown only as global pending,
  conflict or recovery-review counts.

Only the `WORKDAY` domain is counted. A queued or conflicted local operation is
never assigned to a calendar date, reconstructed into an event or presented as
an accepted workday. The screen directs the employee to the existing Recovery
tab to refresh current server truth.

## Privacy and safety boundaries

- The history path reads `WorkforceOutboxRecoveryItem` metadata only. It does
  not decrypt an envelope, select ciphertext, show an operation identifier or
  expose QR, location, device, biometric or request-reason data.
- The API is fetched first and remains the only source for accepted attendance
  facts. If it is unavailable, the UI does not invent a local Work Time
  history.
- Counts are global to the signed-in account boundary and intentionally have no
  day or event linkage. This prevents a retry, conflict or expired action from
  appearing to be an accepted attendance fact.
- EN, RU and AZ copy explicitly says that the local status is neither an
  accepted workday nor an attendance proof.

## Verification

Passed in this worktree:

```text
vitest: workforce-android-foundation plus attendance/mobile contract regression set
eslint: updated Android source-contract test
git diff --check
```

`NOT RUN`: Android Gradle lint/unit for this SHA, Room/process-death recovery,
TalkBack/font/device exercise, signed application, physical QR/location/device
matrix, browser E2E, Prisma migration apply, staging, load/restore and pilot.
