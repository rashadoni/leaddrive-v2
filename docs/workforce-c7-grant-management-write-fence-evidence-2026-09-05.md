# Workforce C7 — role-grant management write fence

**Task:** `WF-C7-002`
**Status:** partial, source- and targeted-test evidence only
**Recorded:** 2026-09-05

## Delivered boundary

`POST /api/v1/workforce/configuration/access/grants` is the first deliberately
narrow durable grant-assignment path. It is not a generic role editor and it
does not activate Workforce granular access for any tenant.

- It accepts only a signed-in session already behind
  `workforce-granular-access-v1` and a currently effective,
  organization-scoped `TENANT_ADMIN` grant with `ROLE_GRANT_MANAGE`.
  The former CRM `admin`/`superadmin` configuration boundary has **no** fallback
  here. Before controlled bootstrap, the endpoint returns a contained conflict
  response and writes nothing.
- It requires a currently enrolled MFA factor before parsing a request,
  reading a target or touching the ledger.
- The authenticated administrator cannot grant a role to themselves, and
  `TENANT_ADMIN` is intentionally not assignable over HTTP. That bootstrap
  remains a controlled migration/change-management operation, preventing the
  first holder from creating an escalation loop.
- The server owns `effectiveFrom`; callers cannot backdate or schedule an
  authority. A finite end instant must be valid and later than that server
  instant.
- The principal, team, site or agent scope must be active and belong to the
  current tenant. Missing, inactive and cross-tenant targets share the same
  bounded response, avoiding a directory oracle.
- The route performs a bounded proposed-role separation-of-duties check before
  the transaction and repeats the administrator grant decision inside a
  serializable transaction. The immutable ledger's advisory lock and database
  trigger remain the durable race fence.
- The immutable audit records the server-derived request IP/user-agent and the
  existing opaque operation/reason metadata. The HTTP response returns only a
  new grant identifier and retry state: it does not expose role inventory,
  existing grants, scope details or an incompatible-role pair.

## Verification

- `PASS` — focused Vitest: role boundary, ledger/writer, role matrix and
  resolution plus the new API negative paths (`6 files / 66 tests`).
- `PASS` — RLS route-context coverage (`1 file / 3 tests`), including the new
  session grant-management wrapper.
- `PASS` — scoped ESLint for all changed server, writer, test and static-RLS
  contract files; `git diff --check`.
- `NOT RUN` — full TypeScript, production build, Chromium browser journey,
  Android, entire recursive RLS call-graph scan, applied migration/RLS,
  staging, physical MFA/device verification, real grant bootstrap and
  production. The Contabo worktree runs only small sequential checks; the
  heavier or real-world evidence requires GitHub CI, the owner Mac staging
  channel or a controlled pilot.

## Explicit non-activation

No tenant feature flag, durable grant, user role, staging database, migration,
production data or deployment was changed by this checkpoint. Tenant bootstrap
and first named least-privilege assignments remain an accountable staged
operation after applied schema/RLS and real staging evidence.
