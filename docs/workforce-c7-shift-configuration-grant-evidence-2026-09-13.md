# Workforce C7 shift configuration grant evidence

Date: 2026-09-13

Scope: partial `WF-C7-002` migration of shift-template configuration to the
existing granular schedule-authorization boundary.

## Accepted behavior

- Shift-template inventory and the organization-default timeline require
  `SCHEDULE_READ`; creating, editing, activating or scheduling a default
  requires `SCHEDULE_WRITE`.
- All handlers remain session-only and retain Workforce entitlement/RLS
  context. API keys cannot configure employee schedules.
- Before granular cutover, the shared boundary preserves the existing tenant
  admin/superadmin behavior. After cutover, the matching effective Workforce
  grant is authoritative and broad CRM administration is no fallback.
- No schedule, template, assignment, grant or tenant feature is changed merely
  by introducing the authorization fence.
- Route & Field remains an independent module and is not read by these routes.

## Verification

- Targeted Vitest passed 2 files / 33 tests. The route-construction contract
  accounts for all nine schedule-bound handlers and the shared wrapper tests
  cover legacy admin, legacy manager denial and granular default-deny.
- Scoped ESLint and `git diff --check` passed.
- Full build, browser E2E, Android, disposable-database RLS and production smoke
  are **NOT RUN locally** on Contabo; applicable heavy gates remain CI-owned.
