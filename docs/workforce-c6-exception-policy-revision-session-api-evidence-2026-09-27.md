# Workforce C6 session-only exception-policy revision API evidence — 2026-09-27

Status: **CLEAN IMPLEMENTATION CHECKPOINT / EARLY REVIEW GREEN / FROZEN REVIEW
PENDING / EXACT-HEAD CI PENDING / NO PROGRESS CREDIT**

This bounded slice starts from exact deployed `main` SHA
`99b8ce27077352951769ce4a8c60cf2459e36ebf` plus release-receipt checkpoint
`7b06a349c2a9ccc048da0cc2ef9ec78ed1dd8a7f`. It exposes only one accountable
human-session entry point for the already released dormant writer:
`POST /api/v1/workforce/configuration/exception-policy/revisions`.

## Fixed request and response contract

- The strict JSON body accepts only `operationId`, using the same 1-100
  character opaque identifier grammar as the writer. Invalid JSON, missing or
  malformed IDs, and any caller-owned tenant, actor, definition, hash, version,
  reason, revision or effective-date field return a contained `400` before a
  transaction opens.
- `organizationId` and `recordedByUserId` come only from the authenticated
  session. The route never accepts either identity from request data.
- A new append returns `201`; an exact operation replay returns `200`. The
  public receipt contains only the numeric revision and idempotency flag. It
  does not expose the ledger ID, policy definition/hash/version, actor or
  tenant.
- Every route-owned response uses `private, no-store` and `nosniff`. There is
  no `GET`, export, list, delete, activation or update surface.

## Authorization, RLS and transaction boundary

The route uses the existing
`withWorkforceSessionPolicyConfigurationAuth` boundary. Before granular
cutover, that preserves the signed-in tenant admin/superadmin boundary; after
cutover, it requires an effective organization-scoped
`WORKFORCE_POLICY_DRAFT_WRITE` grant and does not restore broad CRM-admin
access. The wrapper also verifies the Workforce capability and enters the
tenant RLS context.

The append runs inside `prisma.$transaction`, so the existing Prisma
transaction wrapper places `app.org_id` on the same transaction connection
before the writer reads or inserts the FORCE-RLS ledger. The injected writer
authorization is not an unconditional allow: it requires exact
`POLICY_REVISION_APPEND`, session organization and session actor equality.
The database's composite actor FK remains the final same-tenant identity
fence.

The released writer still owns complete-stream validation, the 64-row bound,
organization advisory serialization, exact replay/conflict handling and the
canonical server-pinned `recommended-v1` payload. This route does not read or
write exception cases/decisions and never fills `policyRevisionId`.

## Controlled failures and log containment

- Invalid input returns `400`.
- A defensive writer-authorization rejection returns `403`.
- Invalid history, history exhaustion and changed-operation/write conflicts
  return controlled `409` responses with no policy or storage payload.
- RLS, FK, Prisma and other unexpected failures return one generic `500`.

The first independent early preflight found one P2: that unexpected path sent
the entire caught database error to `console.error`, which could place internal
query details and tenant/actor identifiers in production logs. The repair adds
only one fixed allowlisted operation label to
`logWorkforceSensitiveOperationFailure`; neither the caught object nor its
message is logged. The API test injects a secret-like RLS/FK message and proves
it appears in neither response nor any log call. Narrow independent rereview
returned GREEN with zero remaining P0-P3 findings. It also confirmed that no
new MFA or rate-limit layer is required by the current repository contract:
this inactive acknowledgement uses the same session policy boundary as the
existing draft/activation routes, while dedicated fresh-MFA/rate fences remain
attached to their separately classified attendance, grant, terminal-decision
and export operations.

## Consumer fence

The dependency-free source contract now has one exact consumer allowlist: this
route may import the writer, while every other production TypeScript file
outside the resolver/writer pair remains forbidden from importing either
policy-revision module. Positive assertions require the session-policy wrapper,
writer call and exact authorization comparison. The route is also required to
remain free of decision access, `policyRevisionId` and effective-window input;
the default configuration provisioner remains unable to write the ledger.

## Current verification

- PASS — focused six-file selection: five files / 67 tests; the exact
  PostgreSQL file discovered six cases and is `SKIPPED / NOT RUN` locally
  because no approved scratch URL is present.
- PASS — route file: 9 tests covering construction, session-derived identities,
  transaction adapter, exact authorization matcher, `201` create, `200` replay,
  strict body rejection, all controlled writer errors, generic failure, public
  payload minimization and response/log containment.
- PASS — targeted ESLint for the route, helper and touched tests.
- PASS — Prisma schema validation with a non-connecting validation URL.
- PASS — recursive RLS context scan: 553 organization-scoped models / zero
  gaps.
- PASS — runner policy for 37 workflows, event assets for 27 domains / 86
  topics / five schemas, main-protection configurator, translation parity
  (23,587 English leaf keys; RU/AZ missing=0 extra=0), and diff whitespace.
- The first focused run correctly failed one new source assertion that searched
  for an object-literal operation field while the route uses an exact equality
  expression. The assertion was repaired to require the actual equality; the
  complete focused rerun is GREEN. This was a proof defect, not a runtime
  failure.
- Reviewer-side narrow repair evidence: route 9/9, targeted ESLint and diff
  whitespace PASS; files were not edited by the reviewer.
- NOT RUN on Contabo — real PostgreSQL, full typecheck/build, browser E2E,
  Android/Gradle, load, physical-device and human-pilot checks. Exact
  PostgreSQL and full typecheck remain mandatory in exact-head GitHub CI.

Progress remains `81/161`, `14/15`, C5 81%, C6 20% and C9 99%. This slice
records only a tenant acknowledgement of a literal draft. It does not activate
or select a policy, create/link a decision, enable terminal behavior, change a
tenant flag, render UI or backfill historical NULL provenance.

## Clean implementation checkpoint

The task-owned implementation/evidence was checkpointed as
`0fc94d87d5fb144fdf4a6351b6c1a87b99005d1d` over unchanged exact deployed
base/merge-base/current `origin/main`
`99b8ce27077352951769ce4a8c60cf2459e36ebf`. Before this status receipt, the
complete base-to-head diff was nine paths / 42,686 binary-diff bytes with
SHA-256 `03715f4f137c6fbb751aae3abdf6c77ba8740ff5c231b1c71a5dadebef25148b`.
The branch remained clean and `origin/main` had not advanced. This status-only
documentation delta supersedes that preliminary identity; a new clean head and
fresh author-independent review of every base-to-head changed line are required
before push.
