# Workforce C8 — employee exception response state

> **Status:** additional safe slice of `WF-C8-005`; the composite task remains
> **PARTIAL**.
> **Recorded:** 2026-09-01

## Delivered contract

The employee-only Workforce exceptions page now renders the exact
server-provided `MIGRATION_REQUIRED` response-recording state. It tells the
employee that acknowledgement is unavailable until the separately tracked
employee-response ledger is applied, and directs them to the existing protected
time-correction request when recorded time needs review.

The screen only accepts the established self-scoped generic case/workday
projection. It still does not show a manager reason, raw location, QR/device
proof, decision, another employee's case or a response-ledger row.

## Safety boundary

This is deliberately a transparent unavailable state, not a fake UI action:

- it makes **no** request to the exception response POST endpoint;
- it does not create an acknowledgement, appeal or correction;
- it does not treat a correction request as a resolution; and
- it requires the server's explicit `MIGRATION_REQUIRED` state instead of
  inferring migration/tenant readiness in the browser.

The additive response-ledger migration and its server writer remain inactive
until disposable-DB/RLS evidence and the accountable lifecycle are complete.
The later release can expose a write only after those gates, rather than
letting an employee click a button that cannot be truthfully recorded.

## Verification

- `PASS` — 9 sequential focused API/employee-UI/response contracts.
- `PASS` — scoped ESLint for the component and UI contract.
- `PASS` — `npm run i18n:check` (EN/RU/AZ parity: 21,449 leaf keys).
- `PASS` — `git diff --check`.
- `NOT RUN` — browser E2E/accessibility, disposable migration/RLS apply,
  Android mobile UI, staging and production. These are separate C6/C14 gates.
