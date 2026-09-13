# WF-C8-001 — employee Workforce Today web fallback

## Delivered boundary

The employee's `/workforce` page now renders a self-only daily work surface
instead of the manager roster when the authenticated Workforce actor is an
`AGENT`. It presents:

- the published current assignment and ordered site/remote/field/travel
  segments, independent of Route & Field;
- the current workday state and exactly one primary action selected from the
  canonical state machine;
- the proof methods required for that exact next action;
- the latest server receipt, kept distinct from a pending human review;
- an explicit reviewed-correction recovery path for a previous open day or an
  action that cannot safely be completed in a browser.

The new `/api/v1/workforce/today/action` transport re-exports the existing
authenticated `/api/v1/mtm/week/workday` handler. It therefore uses the same
transaction lock, idempotency contract, audit, snapshot writer and attendance
proof verification; no second workday state machine was introduced.

## Safety properties

- Only a self-scoped `AGENT` receives `employeeToday`; manager/team responses
  remain unchanged.
- A previous open day, non-working calendar day, missing assignment or invalid
  policy disables the browser action rather than guessing.
- QR, trusted-device or local-auth requirements are shown but never bypassed.
  The browser action stays disabled and points to the reviewed request flow.
- A server `PENDING_REVIEW` response is not rendered as accepted attendance.
- Snapshot assignment is used after START. Missing historical snapshots remain
  explicitly unavailable instead of being reconstructed from live policy.
- Routes, customers and Route geofences are never queried.

## Verification in the exact checkpoint tree

- PASS: ESLint on the employee projection, API routes, workbench and focused
  tests.
- PASS: targeted Vitest — 3 files, 30 tests.
- PASS: `npm run i18n:check` — EN/RU/AZ parity, 22,590 leaf keys.
- PASS: JSON parse and `git diff --check`.
- NOT RUN: full typecheck/build and browser E2E on Contabo; these remain GitHub
  CI/heavy-worker gates.
- NOT RUN: physical Android/QR/GPS/device/biometric behavior; this web fallback
  does not claim physical-device evidence.

## Acceptance

WF-C8-001 is accepted at the web/source boundary: an HRM-only employee can see
their assignment and complete an ordinary no-proof workday from `/workforce`
without navigating to `/mtm`. Proof-enforced actions still require the approved
mobile flow or human-reviewed fallback, exactly as the trust policy requires.
