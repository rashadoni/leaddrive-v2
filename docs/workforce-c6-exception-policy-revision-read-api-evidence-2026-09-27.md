# C6 exception-policy draft-receipt read evidence — 2026-09-27

## Scope and release boundary

This slice adds only a session-authenticated read of the dormant tenant
acknowledgement ledger at
`GET /api/v1/workforce/configuration/exception-policy/revisions`. It reports
one of two exact root payloads:

- `{ "state": "NOT_RECORDED" }` for an empty tenant stream;
- `{ "state": "RECORDED_DRAFT", "revision": <positive integer> }` for a
  complete stream resolved to the exact supported draft.

`RECORDED_DRAFT` is deliberately not an active, current or effective policy.
The response exposes no ledger ID or history, tenant, actor, operation ID,
timestamp, policy version, definition, hash or reason. Query parameters are
not selectors and are ignored; the database predicate always comes from the
authenticated session. The GET does not parse a body, open a transaction,
take an advisory lock, call the writer or mutate any record.

This slice does not add tenant provisioning, activation/effective windows,
decision linkage, terminal behavior, UI, translations, backfill, schema or
migration changes. It earns no task or gate credit.

## Tenant and stream safety

The route uses the existing session-only policy-configuration boundary. Its
single read has the explicit predicate `organizationId = auth.orgId`, ascending
revision order, a `MAX_WORKFORCE_EXCEPTION_POLICY_REVISIONS + 1` bound and the
complete ten-field projection required by the released pure resolver. The
overbound check runs before resolution. Empty history is the only
`NOT_RECORDED` case; gaps, reorder, mixed tenancy, unsupported version/hash/
definition and overbound history all produce the same generic `409`.

Unexpected storage failures produce one generic `500` and the fixed privacy
label `configuration-exception-policy-revision-read`; caught error objects are
not logged. Success, controlled conflict and failure responses carry
`private, no-store` and `nosniff` headers.

## Early independent findings and repairs

The first author-independent read-only preflight found one P2 in the existing
policy-session wrapper: capability/grant denial paths did not consistently
receive sensitive response headers, and its policy-authorization lookup catch
logged the raw error object. The narrow repair applies the existing sensitive
header decorator to every resolved response from that wrapper and uses only
the existing fixed `configuration-access-lookup` label. Tests cover allowed,
legacy denial, granular denial, outer session denial and an injected secret
lookup failure. The shared outer session authenticator is otherwise unchanged;
this slice does not claim a new repository-wide auth-exception logging
contract.

The first rereview then found one P1 in the new success contract: the route and
tests wrapped the two intended receipts in `{ success, data }`. The repair
returns only the exact root payloads above and asserts their exact root keys.
A replacement narrow rereview returned GREEN with zero remaining P0-P3
findings. These early reviews are diagnostic only and do not replace the
mandatory frozen complete-diff review.

## Current verification

- PASS — focused seven-file Vitest selection: six files / 89 tests; the
  opt-in exact-PostgreSQL file discovered six cases and is `SKIPPED / NOT RUN`
  locally because no approved scratch URL is present.
- PASS — route coverage includes exact exports and wrapper construction,
  tenant predicate/full select/order/bound, empty and valid root-only receipts,
  ignored selectors, gap/reorder/mixed-tenant/unsupported/overbound generic
  conflicts, no transaction/write, response minimization and no-secret logs.
- PASS — policy-wrapper behavior covers legacy and granular authorization,
  inner and outer response containment, and fixed-label lookup failure.
- PASS — targeted ESLint for all seven changed TypeScript files.
- PASS — Prisma schema validation with a non-connecting validation URL.
- PASS — recursive RLS context scan: 553 organization-scoped models / zero
  gaps.
- PASS — runner policy for 37 workflows, event assets for 27 domains / 86
  topics / five schemas, main-protection configurator, translation parity
  (23,587 English leaf keys; RU/AZ missing=0 extra=0), and diff whitespace.
- NOT RUN on Contabo — real PostgreSQL, full typecheck/build, browser E2E,
  Android/Gradle, load, physical-device and human-pilot checks. Exact
  PostgreSQL and full typecheck remain mandatory in exact-head GitHub CI.

Progress remains `81/161`, `14/15`, C5 81%, C6 20% and C9 99%. A clean
checkpoint, exact base/head/diff identity, author-independent complete-diff
review, receipt-integrity review and all protected exact-head contexts remain
mandatory before merge.

## Clean implementation checkpoint

The release receipt and GET implementation/evidence are checkpointed through
`e76407def5a2abdc84a0b80058de3fb3d4686fc8`. A fresh fetch confirmed exact
base/merge-base/current `origin/main`
`a78fa409888fb319fab2a049f86fa299212cd3aa`; the worktree was clean and no
upstream integration was needed. Before this status receipt, the complete
base-to-head diff was 11 paths / 46,989 binary-diff bytes with SHA-256
`6ee85938cc40c1c057e6c96a6c2b8c698786a2b3aeb9309db0f5e2a18d00a2f8`.
This append-only status delta supersedes that preliminary identity. A new clean
head and fresh review of every changed line remain required before push.

## Independent frozen complete-diff review

The replacement clean identity was base/merge-base/current `origin/main`
`a78fa409888fb319fab2a049f86fa299212cd3aa`, head
`441e1f76d4f161b6025a9cce66713a74f1920c33`, 11 paths and 49,672
binary-diff bytes with SHA-256
`8828a616b87df2f3ed89bfd3ce95a4d074945dd41a428eb5197cd01fd9499a67`.
The size is below the 400 KB review boundary.

A fresh author-independent reviewer inherited no early GREEN credit, read
every changed line plus relevant unchanged route/auth/resolver/writer/RLS/
schema/migration/consumer context and returned GREEN with zero P0-P3 findings.
The review confirmed the exact root-only receipts, session/capability/granular
authorization, tenant-RLS and explicit organization predicate, complete
ascending bounded stream, resolver mapping, selector non-authority, absence of
GET transaction/lock/write, response/log containment, wrapper compatibility,
consumer fence and all activation/effective/decision/provisioner/UI/backfill
exclusions. PR #458 release and deploy facts were independently reconfirmed.

Reviewer-side diff whitespace, RLS 553/0, runner policy 37, event assets
27/86/5, main protection, i18n 23,587/0/0, production consumer/exclusion scans
and final identity/cleanliness passed. Dependency-backed Vitest/ESLint/Prisma,
exact PostgreSQL, typecheck/build, browser, Android, load and physical/pilot
checks were `NOT RUN` by the reviewer and are not inferred from the primary
local checks or future CI. The reviewer made no edits or publications. This
three-document receipt must receive an independent integrity check before
push.
