# Workforce C9 — recovery server-truth return (2026-08-31)

## Scope

`WF-C9-010` now exposes a separate **Refresh server state** action in both
states of the Android Recovery tab:

- before local recovery metadata is loaded;
- after the metadata-only recovery list is displayed.

The action reuses the existing canonical `refreshToday` path. It reloads the
current workday from the server and clears only in-memory derived screens
(history, requests, local recovery metadata and device summary) so the employee
can start again from current server truth. It does **not** decrypt, display,
delete, retry or create an encrypted outbox operation.

## Safety boundary

- The control is distinct from **Refresh recovery state**, which only reloads
  the metadata-only local queue view.
- It does not trigger QR scanning, local authentication or location capture;
  those proofs remain explicit, immediate, action-bound flows.
- It does not turn a queued/expired/conflicted claim into an accepted fact. A
  later work-time action still goes through the canonical server transition and
  its current proof policy.
- The same existing EN/RU/AZ `refresh_server_state` resource is used; the
  nearby recovery instruction now explicitly says *current* server state.

## Verification

Passed in this worktree:

```text
vitest: workforce Android foundation source/resource contract
eslint: updated Workforce Android source-contract test
git diff --check
```

`NOT RUN`: Android Gradle lint/unit for this SHA, real offline/conflict/review
recovery on signed devices, QR/device/location physical matrix, browser E2E,
full typecheck/build, staging and pilot. The source contract is not a physical
mobile recovery exercise.
