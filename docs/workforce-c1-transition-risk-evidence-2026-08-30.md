# Workforce C1f — workday transition risk evidence

> **Status:** `WF-C1-007` implementation evidence; C1 gate remains open
> **Recorded:** 2026-08-30T07:41:00+02:00

## Review-only conflict signals

The canonical state machine now attaches stable `riskCodes` to rejected
transitions without creating an attendance fact, review case, disciplinary
state, or automatic decision:

- `DUPLICATE_ACTIVE_SHIFT_ATTEMPT` — a new `START` conflicts with an existing
  active workday;
- `CLAIM_BEFORE_WORKDAY_START` — a non-start claim predates the workday;
- `CLAIM_PRECEDES_ACCEPTED_EVENT` — a claim predates an already accepted event.

The established conflict/recovery contract remains intact. Web responses expose
an empty-or-populated `riskCodes` array with canonical workday/recovery data;
mobile sync preserves the codes in its atomically pinned conflict result. A
valid exact replay is still resolved before live state checks, so it returns
the original canonical success and never gains a duplicate-active signal.

## Verification

- `PASS` — state-machine tests distinguish both impossible-order causes and a
  duplicate active shift; no mutation or review case is created for either.
- `PASS` — cross-channel replay test proves the replay lookup remains ahead of
  active-shift/state checks.
- `PASS` — targeted workday, web/mobile sync and mobile workday suite: 160
  tests passed.
- `PASS` — ESLint for changed production paths and `git diff --check`.
- `NOT RUN` — full typecheck, build, browser E2E, Android, load and physical
  device checks: CI/heavy-worker or real-world gates only.

The codes are operational review hints, not proof of fraud, presence, identity
or misconduct. Gate C1 still requires the remaining recovery, migration and
abuse-matrix tasks.
