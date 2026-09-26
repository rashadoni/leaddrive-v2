# Workforce C9 — account-bound Android outbox fence (2026-08-31)

## Scope

This hardens the existing encrypted Android outbox for `WF-C9-006`. It does
not make an offline operation an accepted attendance fact, add background
tracking, change server authorization, or activate any tenant/device.

Each authenticated mobile session now has a fresh, opaque 32-character random
account scope, stored only in the encrypted local session store. That value is
not an employee, tenant, device, API header or analytics field. The encrypted
outbox envelope and Room metadata carry the same opaque value. Every recovery
read, deferred-update write, pending-domain scan and retry deadline is scoped
to it; a worker checks that its session is still current before it starts work,
before each item and immediately before submitting an operation.

Consequently a delayed coroutine holding the former employee's session cannot
make its operation visible to, or drain it through, a later sign-in to the
same tenant. A post-logout enqueue that races with cleanup remains outside the
new account scope and is never visible/replayed by that account. A network
request already handed to transport before logout cannot be undone on the
phone; server idempotency and canonical state remain the authority for that
separate boundary.

## Additive local migration

The Room database moves from v1 to v2 with an additive `accountScope` column.
Pre-fence rows are marked with the empty default. The first authenticated
drain deletes only those unscoped legacy rows without decrypting them; it does
not reinterpret or replay a historic encrypted claim under a new session.

Normal account-bound rows preserve the existing seven-day expiry, eight-attempt
limit, per-domain ordering, encrypted payload and update deferral. Logout or
tenant switching cancels the unique WorkManager job, destroys the outbox key
and clears the rows. The migration does not delete or alter any server record.

## Verification

Passed in this worktree:

```text
vitest: workforce-android-foundation
17 tests passed
git diff --check passed
```

`NOT RUN`: Android Gradle lint/unit and Room upgrade test on a device/emulator,
process-death/logout race exercise, two-account physical matrix, browser E2E,
staging, load/restore and pilot. They require GitHub CI, an Android runtime or
an isolated external environment; source contracts do not stand in for them.
