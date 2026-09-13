# Workforce C7 named-read session boundary evidence

Date: 2026-09-13

Scope: `WF-C7-002` partial least-privilege hardening for the independent
Workforce Today and Timesheet browser APIs.

## Accepted boundary

- `/api/v1/workforce/today` and `/api/v1/workforce/timesheet` require an
  authenticated human session plus the existing Workforce read permission and
  tenant entitlement checks.
- An API key cannot obtain named employees, workday state, schedule context or
  derived time facts by inheriting the role of the user who created it.
- The change does not add a role grant, activate granular access for a tenant,
  alter Route & Field, or change the mobile authentication protocol.
- Existing tenant, actor and persisted-grant checks remain in force inside the
  route after the session boundary succeeds.

This is a fail-closed authorization correction. It is intentionally separate
from the next slice that permits a deliberately granted Workforce principal
without a legacy CRM actor record.

## Verification

- Targeted Vitest: 2 files / 23 tests passed. The exact route contract proves
  the two named-read routes are wrapped by
  `withWorkforceSessionAuth("read", ...)` and neither uses the API-key-capable
  `withWorkforceRlsAuth` boundary; the existing Today/Timesheet suite covers
  response behavior and granular authorization.
- Scoped ESLint and `git diff --check` passed.
- Existing Today/Timesheet response and granular-access tests remain the
  behavioral regression suite.
- Full build, browser E2E, Android and production smoke are delegated to the
  repository PR/deploy pipelines and are **NOT RUN locally** on Contabo.
