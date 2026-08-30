# Workforce C1g — canonical workday recovery contract evidence

> **Status:** `WF-C1-008` implementation evidence; C1 gate remains open
> **Recorded:** 2026-08-30T07:51:00+02:00

## Contract

Every canonical workday conflict now carries a `recovery` object:

- `canonicalState`: `STARTED`, `PAUSED`, `COMPLETED`, `NOT_FOUND` or
  `UNKNOWN`;
- `reason.code` and a bounded localizable `reason.messageKey`;
- server-derived `allowedActions`; and
- `refreshRequired: true`.

The existing top-level machine code, message, workday and `allowedActions` are
kept for compatible clients. Web and mobile-sync adapters expose the same
recovery object. For an altered retry, the web adapter uses the current
same-actor replay relation, and mobile sync re-reads the current workday under
tenant and employee scope from the saved workday ID. It therefore does not
present a stale pinned result as current state.

The operational-week UI accepts only the bounded server key and maps it to
AZ/RU/EN copy; it never renders a raw server error as employee guidance. A
conflict always schedules a fresh facts refresh before another action.

## Verification

- `PASS` — state-machine contract test maps each workday conflict family to
  safe state/reason/actions and verifies no action is proposed for a missing
  workday.
- `PASS` — web and mobile idempotency-mismatch tests prove current canonical
  state/actions are returned instead of a bare conflict.
- `PASS` — targeted state-machine, web, mobile sync and operational-week
  client suite: 166 tests passed.
- `PASS` — `npm run i18n:check` reports AZ/RU/EN parity.
- `PASS` — ESLint for changed production route/lib paths and `git diff --check`.
- `KNOWN BASELINE` — full touched-test lint reports 27 existing
  `no-explicit-any` findings; the UI file has four existing warnings outside
  this slice. No new lint finding was introduced.
- `NOT RUN` — browser/UI interaction evidence, full typecheck, build, Android,
  load and physical-device checks: these require browser/CI/heavy-worker or
  real-device gates and are not run unbounded on Contabo.

This checkpoint provides recovery guidance only. It is not an automated
attendance decision and does not enable a Workforce pilot.
