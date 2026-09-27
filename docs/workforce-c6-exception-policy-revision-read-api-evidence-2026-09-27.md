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
