# Workforce C7 — periodic access-review foundation

**Task:** `WF-C7-010` partial internal slice
**Recorded:** 2026-09-13

## Delivered boundary

`reviewWorkforceAccess` evaluates one already-authorized, bounded tenant
snapshot without changing it. The review identifies:

- grants whose effective window ended but which lack an explicit revocation;
- grants held by an inactive or missing principal;
- active privileged assignments unused beyond a bounded 30–365 day policy
  window (90 days by default);
- active incompatible role pairs from the accepted separation-of-duties
  contract; and
- privileged actions attributed to an exact grant but recorded outside that
  grant's effective/revoked window.

Freshness belongs to the exact grant ID. Activity through one role therefore
cannot keep an unrelated sensitive role from being flagged as stale. The input
is capped at 1,000 grants and 5,000 actions; malformed dates, duplicate grants,
unknown activity and cross-tenant rows fail closed.

## Safety boundary

The result is a dry-run review list with finite finding codes. It explicitly
returns `automaticAction: NONE` and requires an accountable human review.
There is no database reader, scheduler, role assignment, revocation writer,
notification, tenant activation or production behavior in this slice.

`WF-C7-010` remains partial until a tenant-scoped reader can attribute actions
to the exact historical grant, a reviewed append-only revocation path disables
confirmed stale assignments, and a scheduled/staging exercise proves the
review and revocation SLA.

## Verification

- **PASS:** targeted Vitest, 2 files / 13 tests.
- **PASS:** scoped ESLint.
- **PASS:** `git diff --check`.
- **NOT RUN:** full typecheck/build, database/RLS, scheduler, browser, staging,
  revocation and production checks. Heavy and environment-backed gates remain
  assigned to GitHub CI and C14.
