# HRM fault, fairness and retention compatibility evidence

This bounded PR589 follow-up starts at `8053702bbde2a43da537e263630f8a81ded2b659`
and integrates main `5c7412266c29a53e12963621b090c4f1aee95a3a`, including PR594,
PR595, PR596 and the exact accepted Support PR597 blobs. The immutable candidate, source bindings and hosted outcomes
are recorded separately in the evidence branch. Earlier 8053 receipts retain
their original base and claims; they are historical evidence, not current-head
acceptance. No production scheduler, tenant cohort or collector is activated.

## Eight prepared scenarios

| Scenario | Executed mechanism and assertion | Boundary of the evidence |
| --- | --- | --- |
| F1 — one stream stalls | Real Routes/Workforce v2 handlers and cursor sealing; a deferred rate-guard promise holds either stream while the other completes before release. | Synthetic dependency stall, not a physical network timeout or Android scheduler proof. |
| F2 — 503/429 burst | Both directions reject a failed stream without changing its cursor; the healthy stream advances and the failed stream later resumes from its original cursor. | Handler and cursor contract; persistence/auth and rate-guard response are controlled fixtures. |
| F3 — cursor separation | A real sealed cursor from the other stream returns 400 before state, changes or snapshot reads, in both directions. | Real cryptographic envelope and admission boundary, with database reads mocked. |
| F4 — noisy tenant/stream | Real limiter exhausts 60 device requests plus 20 denied attempts; a second tenant and the other stream retain their full budgets. | Executed against both memory and actual Redis Lua in disposable loopback DB15; no representative sustained load or cluster failure claim. |
| F5 — atomic budgets | Independently exhaust device, user and tenant buckets; repeated denial spends neither other bucket. At 59,999 ms retry remains one second, at 60,000 ms admission resumes. Exhausted snapshot budget leaves all pull capacity. | Five cases per backend, real algorithm and Redis transport with a controlled clock. |
| F6 — oversized page | Actual serialized page exceeds the response bound, returns 413, and retries from the same cursor with limit one, advancing through both revisions. | Two deliberately oversized synthetic IDs exercise serialization; not representative identifier sizes or production performance. |
| F7 — poison push | Raw 512 KiB boundary, understated Content-Length streaming overflow/cancellation, canonical UTF-8 64 KiB operation boundary, malformed/deep envelopes and healthy sibling replay. Rejected workday operations cannot trigger settings selection or idempotency prechecks. | Actual push handler and bounded reader; auth/database/fences are mocked. Android source mapping is described below; no physical-device execution. |
| F8 — four entitlements | Neither/Routes-only/HRM-only/Both: v2 API denial precedes failing dependencies; navigation is independently gated; no-show worker needs HRM plus separate rollout opt-in, and a failing candidate dependency is never entered without entitlement. | Real handlers/navigation/scheduler with synthetic configuration and mocked storage. No production configuration change or signed-mobile acceptance. |

Tests: [cursor/failure matrix](../src/__tests__/api-mtm-mobile-sync-v2-fault-fairness.test.ts),
[fairness](../src/__tests__/workforce-sync-fairness.test.ts),
[push bounds](../src/__tests__/workforce-sync-push-bounds.test.ts), and
[navigation/jobs](../src/__tests__/workforce-entitlement-failure-matrix.test.ts).

## Push contract correction

The older roadmap link claimed 512 KiB/64 KiB push limits, but its referenced
document is absent and the inspected 8053 handler used unbounded `req.json()`.
This candidate implements those limits; earlier source receives no retroactive
credit. The existing 100-operation maximum remains. Oversized raw bodies receive
HTTP413 with `MTM_MOBILE_SYNC_BODY_TOO_LARGE` before operation processing.
Each malformed or oversized parsed operation receives an ordered error result
with `MTM_MOBILE_SYNC_OPERATION_INVALID` or `MTM_MOBILE_SYNC_OPERATION_TOO_LARGE`.
The envelope size includes unknown fields and UTF-8 bytes, not string length.
An invalid response identifier is replaced with `?`; operation data is omitted.
Rejected operations are not pinned, and healthy siblings retain their order.

Existing Android source reads the per-operation code and stores a terminal
`REQUIRES_REVIEW` state, exposing `QUARANTINED_OPERATION` as a recovery hint.
These are distinct values. The encrypted row remains; other domains can
continue, while the current domain pass stops. Whole-body413 behavior for all
old APKs, physical process death/restart, principal switching, encrypted queue
recovery and signed-device acceptance remain unproved. Oversized legacy batches
now face a new admission limit; this is an intentional bounded protocol change.

## PR594 integration: deletion versus retained history

PR594's setup-only agent deletion remains intact. Its membership FK cascade and
nested-delete trigger exception are preserved exactly; existing immutable
membership UPDATE/DELETE protection remains. Genuine attendance, approval or
exception history still blocks deletion and directs the user to deactivate.
The dynamic DMMF history classifier includes Workforce exception agent links.

Four real DELETE-handler/classifier cases cover schedule-only exception409,
approval409, setup-only200 and failing history lookup500 without deletion.
Five disposable PostgreSQL cases apply the unmodified PR594 migration after
the original membership functions/triggers: pre-migration deletion is blocked,
post-migration setup deletion cascades, a live exception still restricts deletion,
membership history remains immutable, schedule resolution selects the historical
team, roster health remains usable, and an orphan snapshot is rejected. Five
test cases contain these assertions; do not count assertions as extra cases.

The 64-case existing reconciliation-sweep/roster run also executes against
disposable PostgreSQL. This selected schema/fixture work is not a full migration
history replay, production RLS certification or live scheduler evidence. The
separate unmodified main contact-category PostgreSQL suite builds its own
schema-derived scratch database and exercises actual agent deletion. PR595/596
are transferred as exact main blobs with their UI and PostgreSQL regressions.
No migration history, compiler baseline, Support source or entitlement was edited.

Tests: [retention API](../src/__tests__/workforce-pr594-retention-compatibility.test.ts)
and [membership PostgreSQL](../src/__tests__/workforce-pr594-membership-postgres.test.ts).

## Remaining independent privacy criteria

GPS/media now normalize endpoints, result categories, schema and numeric bounds.
APK versions and sync build SHAs require primitive strings before regex checks;
coercible objects, `toJSON` values and Symbols cannot reach the serialized event.
Census protocol/cohorts and v1 endpoints also reject invalid runtime dimensions.
The actual serializers run against synthetic console sinks, including 500
adversarial tuples and object-coercion regressions. Valid canonical versions and
in-bound finite dimensions retain their representation; other formerly admitted
values are deliberately normalized. See [telemetry tests](../src/__tests__/workforce-aux-telemetry-privacy.test.ts).

Syntactically valid release versions are still not an approved release allowlist.
Tenant/principal HMACs remain pseudonymous and potentially high cardinality.
Shared auth/RLS, Prisma audit fallback, Pino and Sentry retain the prior documented
source/probe gaps. Their shared wrappers are also called by active Support routes;
changing global sinks requires a coordinated shared change with that owner.
This is runtime coupling, not an observed same-file writer collision: the
inspected Support PR592 (subsequently integrated through PR597) does not edit
those global sink files.
No production leak is asserted from synthetic probes. Collector minimization,
destination access/retention, approved dashboard aggregation and paging remain
operational acceptance work. No raw CI logs or screenshots were accessed.

## Acceptance and next dependencies

Local counts, retry reasons, compiler comparison and independent source acceptance
are bound in the immutable evidence packet, with failed originals preserved.
Hosted status must refer to this candidate SHA and its actual integration base.
A prior passing receipt is not a substitute. The compiler scope includes existing
historical diagnostics; unchanged diagnostics are not a global clean typecheck.

Canonical accounting stays **82/161 DONE, 79 open, weighted 59%, 14/15 gates**.
WF-C10-011 stays PLANNED; WF-C12-002/004/005/008 and WF-C13-006 stay PARTIAL.
Next independent work is signed-device isolation/quarantine and representative
staging fault/load evidence once their environments are authorized. Full clean
migration replay still depends on resolving the pre-existing `api_keys` baseline
through its owner, not editing migration history to make this candidate green.
Production activation, merge and deployment require separate scoped approval.
