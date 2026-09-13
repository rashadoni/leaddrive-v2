# Workforce C7 role-management browser evidence

Date: 2026-09-13

Roadmap item: `WF-C7-002` (partial)

## Delivered browser boundary

- The existing Workforce configuration page now contains a dedicated role and
  access section rather than exposing role operations through raw IDs.
- A grant administrator searches active tenant-local users, then chooses one
  non-bootstrap role and the smallest scope supported by that role.
- Team, site and employee scopes use the bounded server-side target search;
  target IDs are retained only for the subsequent request and are never shown.
- Temporary cover can carry an expiry. Every grant requires a reason plus an
  explicit review checkbox before submission.
- Active grants show named people, localized roles, named scope and effective
  window. Revocation uses an inline two-step confirmation with a reason; it is
  never a one-click destructive icon.
- `TENANT_ADMIN` bootstrap and removal remain unavailable in the browser.
  Server-side MFA, incompatibility, tenant/RLS and immutable-ledger checks stay
  authoritative.
- The section follows the existing light/dark LeadDrive shell, restrained
  orange emphasis, 44 px actions, responsive single-column fallback and
  EN/RU/AZ localization.

## Verification

- PASS: role-management UI contract plus access-control contract, 2 files / 13
  tests.
- PASS: scoped ESLint for the component, page and contracts.
- PASS: `npm run i18n:check` (22,665 EN leaf keys; RU/AZ parity).
- PASS: `git diff --check`.
- NOT RUN: real browser interaction and screenshot evidence; those require the
  approved browser/heavy gate, not Contabo.
- NOT RUN: full build, Android and load checks; this browser slice is queued
  behind the sequential PR chain and must use GitHub CI or an approved heavy
  worker.

## Explicit exclusions

No tenant-admin custodian, ordinary role grant, revocation, granular-access
flag or tenant configuration is created by this source slice. Initial custody,
live access review and activation remain owner-controlled rollout work.
