# Workforce C7 — role-grant management write fence

**Task:** `WF-C7-002`
**Status:** partial, source- and targeted-test evidence only
**Recorded:** 2026-09-05

## Delivered boundary

`POST /api/v1/workforce/configuration/access/grants` and
`DELETE /api/v1/workforce/configuration/access/grants/:id` are deliberately
narrow durable grant-management paths. They are not a generic role editor and
do not activate Workforce granular access for any tenant.

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
  the transaction and repeats both the administrator grant decision and the
  target's active tenant membership inside a serializable transaction. The
  immutable ledger's advisory lock and database trigger remain the durable race
  fence, including when an administrator or target is deactivated concurrently.
- The immutable audit records the server-derived request IP/user-agent and the
  existing opaque operation/reason metadata. The HTTP response returns only a
  new grant identifier and retry state: it does not expose role inventory,
  existing grants, scope details or an incompatible-role pair.
- Revocation is append-only and server-derived from the persisted grant's exact
  start instant; a caller cannot provide or alter that historical value. The
  writer re-reads it under the same tenant-principal advisory lock and rejects
  a missing or stale record. It performs the same in-transaction tenant-admin
  recheck and metadata-only audit as grant creation. Browser revocation of
  `TENANT_ADMIN` remains outside this route, so a normal session cannot remove
  the sole bootstrap authority or create a grant/revoke escalation loop.
- HTTP retries bind every caller-controlled and actor-derived field to the
  operation ID while treating `effectiveFrom` and `revokedAt` as server-owned
  timestamps. An exact retry returns the original receipt; a changed target,
  role, scope, reason, actor or expiry conflicts rather than creating a second
  authority fact.
- Grant and revocation mutations share a Redis-backed tenant/principal
  budget of 12 requests per minute. Exact identities are hashed before
  storage. Quota responses carry a bounded retry value; an unavailable or
  unexpected shared-guard failure is a contained `503`, never a per-process
  fallback that could weaken a multi-instance privilege boundary.
- The matching active-grant inventory is bounded to 500 current, unrevoked
  records and has the same rollout/session/MFA fence. It returns only the
  grant reference needed for revocation, role/scope kind, effective window and
  tenant-local display labels. Principal/scope internal IDs, operation keys,
  reason codes, revocation history and any evidence are absent. Viewing the
  inventory writes a counts-only access-control audit record.

## Verification

- `PASS` — focused Vitest (`7 files / 54 tests`) before this inventory slice:
  role boundary, ledger/writer replay modes, changed-payload conflicts,
  transactional target recheck, shared grant-rate guard and grant/revocation
  API negative paths. Inventory-specific verification is rerun in this
  checkpoint before acceptance.
- `PASS` — RLS route-context coverage (`1 file / 3 tests`), including the new
  session grant-management wrapper.
- `PASS` — scoped ESLint for all changed server, writer, test and static-RLS
  contract files; `git diff --check`.
- `NOT RUN` — full TypeScript, production build, Chromium browser journey,
  Android, entire recursive RLS call-graph scan, applied migration/RLS,
  staging, physical MFA/device verification, real grant bootstrap and
  production. The Contabo worktree runs only small sequential checks; the
  heavier or real-world evidence requires GitHub CI, the owner Mac staging
  channel or a controlled pilot. `codex-heavy-run` is installed but its shared
  host lock was unavailable before any heavy command could start.

## Explicit non-activation

No tenant feature flag, durable grant, user role, staging database, migration,
production data or deployment was changed by this checkpoint. Tenant bootstrap
and first named least-privilege assignments remain an accountable staged
operation after applied schema/RLS and real staging evidence.
