# Workforce C3 — named assignment roster, picker and default timeline

> **Checkpoint:** `WF-C3-001` — 2026-08-30

## Delivered contract

The Workforce configuration assignment endpoint returns an administrator-only
named roster of active employees and active shift templates, plus labelled
historical assignment rows. The HR configuration web surface now uses that
roster in a visible employee/shift picker, so an administrator never has to
enter a raw employee or template identifier.

The picker schedules only a future individual assignment through the existing
tenant-scoped server contract. Its separate, on-demand effective-date preview
shows the direct individual assignment that applies on one real calendar date;
it cannot create a mutation simply by previewing. Historical rows retain their
employee/template labels even after a directory or template record is
deactivated, so the schedule history remains explainable.

`GET /api/v1/workforce/configuration/shifts/default` is a session-admin-only,
tenant-scoped read of the effective-dated organization-default timeline. The
same screen shows that timeline and gives the administrator a separate future
default scheduler. A replacement remains the advisory-locked, audited,
snapshot-safe write from `WF-C3-007`; the UI does not modify a current or past
default.

## Explicit boundary

The individual preview intentionally does not pretend to resolve the complete
server schedule: organization default resolution remains server-side and is
shown as its own timeline. Team-default timelines remain deliberately outside
this checkpoint. Although C1 now records historical team membership for new
workdays, team-default write semantics and migration guards require their own
review; this picker offers only organization-wide defaults and preserves that
safe boundary.

## Verification

Small sequential Contabo checks passed:

```text
npx vitest run src/__tests__/api-workforce-configuration.test.ts \
  src/__tests__/workforce-configuration-assignment-ui-contract.test.ts \
  --pool=forks --maxWorkers=1

2 files passed, 15 tests passed

npx eslint src/components/workforce/workforce-configuration-workbench.tsx \
  src/app/api/v1/workforce/configuration/shifts/default/route.ts \
  src/__tests__/api-workforce-configuration.test.ts \
  src/__tests__/workforce-configuration-assignment-ui-contract.test.ts
PASS

`npm run i18n:check`
PASS — AZ/RU/EN parity (20,948 leaf keys)

git diff --check
PASS
```

## Not run

- Full TypeScript check, production build and browser verification: **NOT
  RUN** — Contabo is limited to small sequential checks; these are CI/approved
  worker gates.
- Browser accessibility/responsive evidence for the new picker: **NOT RUN** —
  the source contract has keyboard-labelled native selects and touch-safe
  controls, but a real browser run remains a CI/approved-worker gate.
