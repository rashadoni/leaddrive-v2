# Workforce exception-review grant UI evidence

**Tasks:** `WF-C7-002`, `WF-C8-005`
**Date:** 2026-09-01
**Scope:** source and targeted-contract validation in the dedicated Contabo
development worktree. This is not browser, assistive-technology, staging,
tenant-rollout or production evidence.

## Finding

The existing server boundary already fails closed on the active authorization
model:

- before `workforce-granular-access-v1`, an accountable session administrator
  is required;
- after that tenant flag, only an effective organization-scoped `HR_ADMIN`
  grant carrying `TEAM_EXCEPTION_READ` can read either the raw-proof-free case
  queue or its aggregate report;
- a CRM administrator has no fallback after cutover.

However, both corresponding web components performed their own CRM
`admin`/`superadmin` check before issuing the request. That client-side check
made an ordinary signed-in user with a valid Workforce grant unable to reach
the already-authoritative server decision.

## Safe correction

- `workforce-exception-queue.tsx` and
  `workforce-exception-report.tsx` now always call their existing
  session-bound endpoints; neither client computes or grants HR authority.
- A `403` produces the existing restricted no-access surface. It does not
  reveal whether denial was caused by a missing tenant capability, legacy
  administrator requirement, revoked grant or wrong grant scope.
- The no-access copy in EN/RU/AZ now describes the effective Workforce
  HR-review-role requirement rather than falsely promising that any CRM
  administrator can use the surface.
- A source contract pins the absence of the stale CRM role pre-gate and the
  `403`-to-restricted-state behaviour in both views.

No server permission, database row, role grant, rollout flag, exception case,
decision, report, route, location record or attendance fact was changed.

## Verification run

- PASS — targeted Vitest, one worker: exception queue/report UI, exception
  queue/report API and Workforce specialized authorization boundaries:
  **4 files, 42 tests**.
  Expected injected fail-closed lookup/table failure logs were emitted only by
  their negative-path test cases.
- PASS — scoped ESLint for the two components and their source contract.
- PASS — `npm run i18n:check` (EN/RU/AZ parity).
- PASS — `git diff --check`.

## Not run

- Browser role journey with a real `HR_ADMIN` grant after tenant cutover,
  keyboard/screen-reader, browser E2E, full typecheck/build, migration/RLS
  application, staging, physical/mobile, load and production checks were not
  run. They require CI, an approved heavy worker, an isolated environment or
  real rollout evidence and must not be inferred from this source contract.
