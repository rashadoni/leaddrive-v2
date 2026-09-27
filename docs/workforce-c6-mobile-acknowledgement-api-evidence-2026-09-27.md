# C6 revision-bound mobile acknowledgement API evidence — 2026-09-27

Status: `PARTIAL`

Task: `WF-C6-006`

## Bounded claim

This server-only slice exposes one fixed acknowledgement action for a mobile
employee's own current exception cycle. It adds no Android button, offline
outbox, notification, correction response, explanation, appeal completion,
terminal decision, tenant activation or raw attendance evidence.

Progress remains `81/161`, `14/15`, C5 81%, C6 20% and C9 99%. This slice adds
no task or phase-gate credit.

## Employee-visible revision contract

The existing self exception GET keeps its 100-case sentinel, 65-decision and
one-response bounds. A card now exposes `availableResponseAction` only when:

- the fresh mobile-auth snapshot says the response rollout is `AVAILABLE`;
- the canonical revision/lifecycle projector returns `NOT_ACKNOWLEDGED`;
- the current role has `WORKTIME_SELF_MUTATE`; and
- the freshly verified mobile principal has a non-empty linked `userId`.

The action contains only `{ kind: "ACKNOWLEDGE", expectedCaseRevision }`.
Acknowledged, unavailable, resolved, malformed, truncated, over-bound,
unlinked or rollout-disabled contexts receive `null`. The current Android
client continues to ignore this additive field and remains display-only.

## Strict mobile POST boundary

`POST /api/v1/mtm/mobile/hrm/exceptions/:id/response` accepts only a strict
UUID `operationId` and integer `expectedCaseRevision` from 0 through 63. The
client cannot submit a response code, correction request, agent/user/workday,
segment, reason, proof, timestamp or ledger identifier. The server always
derives `ACKNOWLEDGED`, the fresh tenant/agent/linked-user scope and the exact
own case/workday/segment.

The route reuses `withMobileRls`, the fresh rollout snapshot,
`WORKTIME_SELF_MUTATE` and the existing fail-closed 12-per-60-second shared
principal limiter. Malformed input stops before the limiter or database;
rollout-disabled and unlinked principals stop before the case query. Missing,
foreign and reassigned cases share one generic 404. Success returns only the
case reference, fixed response code and idempotent bit; no response/audit ID or
revision is returned. Handler responses use private no-store/nosniff headers,
and unexpected failures log only a fixed operation label.

## Post-lock revision and replay safety

The new writer entry point keeps the existing authorization-first, canonical
case-lock then employee-operation-lock ordering. It reads an existing response
including its lock-observed revision before lifecycle validation:

- the same operation, exact draft and exact expected/stored revision remains a
  200 replay even after a later resolution;
- the same UUID with another case, detail or revision is a conflict;
- a legacy response without a revision cannot impersonate a bound replay;
- a new response must pass the complete bounded lifecycle guard and match the
  expected revision while the canonical case lock is held; and
- a new manager request/reopen that wins the lock makes the stale mobile write
  fail without a response or audit append.

The existing database trigger still verifies case/workday/segment/actor
topology at insertion. The established web writer keeps its current behavior;
its presentation-to-write revision race remains an explicit blocker for tenant
activation and full WF-C6-006 completion.

## Focused verification

- Mobile GET, mobile POST and writer core: 3 files / 37 tests passed.
- After integrating current `main`, an expanded related
  API/writer/lifecycle/rate-limit/migration selection passed 15 files / 100
  tests. The earlier 10-file / 77-test selection also passed on the original
  implementation snapshot.
- The real-PostgreSQL shared-lock file compiled and discovered 12 scenarios,
  including the new stale-revision race, but all 12 are `SKIPPED / NOT RUN`
  locally because no approved disposable PostgreSQL URL is present. The
  exact-head CI `static-checks` database gate is mandatory.
- Targeted ESLint passed for all seven changed TypeScript runtime/test files.
- Tracked and explicit untracked diff whitespace checks passed.

The checks used a temporary read-only dependency link whose target had exact
package-lock SHA-256
`54c9be2264ef8e1ec5f8b0d9c545ba868c24de938ee0cf3734f4c475e62c816f`.
The link was removed without modifying the external cache.

The first author-independent preflight was GREEN with zero P0-P3 findings on
the complete 11-path, 72,975-byte snapshot rooted at deployed main
`a7189fd72d62fb0b0f04f327341a0377d1191a41`, SHA-256
`da0061372e6902e46d2f47bda5865a4fa665da2c49826e52978bef22071b046f`.
That identity is historical only: remote main advanced through PR #468 to
`fb1833a1bbbba77f5f9fbd603507144a8a41f0b5`. Its 12 MTM/map paths were
non-overlapping and were integrated by merge commit
`6893772b87a1c604d30e5927e3fc6553f41e7f0c`; all checks above were then
repeated. Main subsequently advanced through PR #469 to
`a043fc9f1b41b87c032714d8d4f28e5dde9def3a`; its only changed path was the
same unrelated MTM map-matching workflow. It was integrated by merge commit
`03964302087911b19db7c519f8b900acf530f844`, and the 37-test core, 100-test
expanded selection, 12-case PostgreSQL collection, ESLint and whitespace
checks were repeated again with the same results. A fresh clean-head identity
and author-independent review remain mandatory before publication.

Full local typecheck/build, browser E2E, Android/Gradle, load, signed APK,
physical-device and human-pilot checks are `NOT RUN` under the Contabo workload
policy. Fresh author-independent review and all exact-head GitHub checks remain
mandatory before merge.

## Remaining boundaries

Different UUIDs can still append more than one acknowledgement in one cycle;
the existing rate limiter bounds churn, but exactly-once delivery is not
claimed before a stable Android outbox operation or separately reviewed
cycle-deduplication rule exists. Unlinked mobile agents cannot write the
user-attributed ledger, and no synthetic actor is introduced.
