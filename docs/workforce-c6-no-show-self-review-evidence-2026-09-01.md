# Workforce C6 schedule-only no-show self-review evidence

**Status:** `WF-C6-003` / `WF-C6-006` partial

## Delivered boundary

An employee's existing self-only exception read now includes an immutable
schedule-only `NO_SHOW` case only when all of these fields are present and
server-selected:

- the case belongs to the signed-in employee in the current tenant;
- `kind` is exactly `NO_SHOW`;
- it has no accepted `workdayId`; and
- it has an immutable `expectedWorkDate`.

The response exposes only the existing opaque display reference, generic case
kind, raised time and expected date. It does not return a schedule, segment,
manager decision, reason, location, QR value, device proof, evidence or an
employee-response identifier.

The web self-review page presents that shape as **view-only**. It labels the
date as expected rather than recorded, does not invent a workday, and hides
both correction and acknowledgement controls. The existing response ledger is
intentionally workday-bound, so even a tenant that has enabled the response
rollout cannot use a schedule-only no-show row to write an acknowledgement.

## Explicitly not activated

This change does not create a no-show case, schedule a detector, send a
notification, create a workday, accept an employee explanation, open a
correction request, make an HR decision, affect payroll or discipline, assign
a grant, or enable a tenant feature. A no-show row remains absent until a
separately fenced worker records its immutable review envelope.

The workday-bound correction and employee response lifecycle still needs its
own approved design for a schedule-only absence before it can be treated as
an appeal path. That decision is intentionally not guessed here.

## Verification

- PASS — `CI=true PATH=/home/codex-alt/.local/bin:$PATH npx vitest run
  --maxWorkers=1 src/__tests__/api-workforce-my-exceptions.test.ts
  src/__tests__/workforce-my-exceptions-ui-contract.test.ts --reporter=dot`
  (2 files, 8 tests).
- PASS — scoped ESLint for the route, component and both contracts.
- PASS — `npm run i18n:check` (EN/RU/AZ parity: 21,408 leaf keys).
- PASS — `git diff --check`.
- NOT RUN — full typecheck/build, browser E2E, Android, applied migration/RLS,
  scheduled detector, staging and physical employee-review evidence. Heavy or
  environment-dependent gates do not run on Contabo.
