# Booking create event-coherence fix — session journal

Append-only continuation of the booking role acceptance. Earlier requirements,
account setup and live failure evidence remain preserved in the previous
managed worktree's docs/booking-role-sandbox-session-log.md.

## 2026-10-25T16:44:32+04:00 — Clean current-main fix worktree and live exception evidence

- User said «начинай» to continue diagnosis, fix the proven create500 and repeat three blocked filled-role scenarios in the designated GUVEN/tenantleaddrive. Existing authorization to message the native-local role task persists; no new accounts or original-customer/page changes. Prior two test accounts/read-only grant retained, temporary page inactive/public404, no fixture bookings.
- New clean current-main worktree: /mnt/HC_Volume_106454338/codex-alt-data/worktrees/booking-create-event-coherence-20261025/leaddrive-v2; branchcodex/booking-create-event-coherence-20261025, originhttps://github.com/rashadoni/leaddrive-v2.git, baselinecee8b68a7a811c0b861d00ab97664bb58f58511d. Original task worktree/canonical/unrelated work preserved. Registered prod13.140.132.245:/opt/leaddrive-v2; only normal reviewed-main/GitHub Actions release, no direct server mutation.
- Earlier direct SSH failures are superseded as a diagnostics blocker: discovered existing Inspect production safely workflow tail-app-logs.yml; exact-main read-only dispatch40193896108, tail job121170506143 SUCCESS. Existing protected/pinned workflow SSH read PM2 app error log. Raw log only retained in tool memory; no unrelated payload/config/key copied.
- Exact two synthetic request timestamps in app log (13:06:19 and13:07:47 +01:00 match12:06:19Z and12:07:47Z) report PrismaClientUnknownRequestError: event stream head does not match its final version, aggregateTypebooking, with bookings/route stack. Foundation constraint event_stream_commit_coherence_fn rejects final head/event mismatch. This establishes the failing invariant, not yet which field differs.
- Safety-lane plan: first prove a focused regression on actual PostgreSQL with foundation guards; correct only faulty append data construction; retain guards/RLS/schema; verify unit+real DB in hosted CI and required source checks; then return to native live filled-role acceptance. No speculative key/schema edits or guard disabling.
- Candidate hypothesis: raw Date parameter cast to TIMESTAMP depends on session TimeZone whereas Prisma DateTime and CloudEvent time are UTC. Added real existing SDK gate cases for UTC/EuropeBerlin/AsiaBaku/AmericaNewYork, milliseconds/winter/summer instants, all three append paths and persisted head/event/outbox timestamp equality. Production append source unchanged pending real regression proof.
- Shared node_modules linked read-only from existing dependency tree; no install/generate/patch. Host RAM/disk/pressure inspected (available12GiB, disk119GiB, pressure0); only small sequential local lint/unit checks allowed. Real PostgreSQL/full build/typecheck belong hostedCI and are NOT RUN locally.
- Current result: exact live invariant failure identified and reproduction test prepared. Last completed action: clean-main test harness extension. Precise stopping point: timezone hypothesis unproven pending hosted PostgreSQL run. Next: scoped local checks, checkpoint/push feature branch/PR for real CI proof; no merge/deploy until required verification/authorization.


## 2026-10-25T16:46:42+04:00 — Local targeted checks before hosted regression proof

- Scoped ESLint for the extended SDK PostgreSQL test passed. Existing event-platform foundation unit suite run separately; actual result recorded in current tool output before checkpoint. No production append modification yet.
- Real SDK/booking PostgreSQL and full typecheck/build NOT RUN on Contabo by workload policy. Push only task-owned regression/journal to feature branch for existing hosted PR gates; no main push or deployment.


## 2026-10-25T16:51:21+04:00 — Regression PR and exact local unit result

- Scoped ESLint PASS; existing foundation unit suite14/14PASS (not the database regression). Feature test commit9d7c5107faabfd1219e47f34f73626dbe8b39b7c pushed and PRhttps://github.com/rashadoni/leaddrive-v2/pull/1038 opened/attached. PR checks40194634988, runner40194635012, scan40194635041 queued; no DB result yet. No production source changes in this candidate.
- Full PostgreSQL cases intentionally run only on hostedCI with actual foundation constraints; do not claim hypothesis proven before its output. If disproven, keep useful coverage and investigate next actual mismatch without weakening the invariant.


## 2026-10-25T17:06:28+04:00 — Real PostgreSQL red proof confirms timezone failure; narrow UTC fix prepared

- On exact regression source9d7c5107f, hosted run40194634988/static121173666202 passed actual foundation migration/database invariant gate, then SDK gate failed3/6: UTC and two existing baseline cases PASS; EuropeBerlin/AsiaBaku/AmericaNewYork each fail the same PrismaClientUnknownRequestError/event stream head final-version invariant as both live requests. Production append source remained unchanged for this red proof. Sanitized result saved evidence/regression-before-fix.json; no expected-negative PG invariant log failures misreported as extra product defects.
- Cause reproduced: raw Date-to-TIMESTAMP cast follows the database session timezone while event ORM/CloudEvent fields retain UTC. Prepared explicit timestamptz AT TIME ZONE UTC conversion at the three head-write bind sites (optimistic create, optimistic update, blind append). No constraint/trigger/RLS/schema/encryption/permission changes. This is the causal isolated regression; live resolution still requires exact-source release and real create/filled acceptance.
- Main advanced to3fe2919839437a64cff66560ad4fbca9418642a4 in an unrelated pharmacy change, including shared permissions/schema/workflows. Do not overwrite it; incorporate current main before final proof. No event/append source conflict in the inspected compare.
- Current result: source fix prepared against a proven regression. Last completed action: red PostgreSQL proof and explicit UTC normalization patch. Precise stopping point: fixed-source real PostgreSQL/required checks pending. Next: targeted local lint/unit, checkpoint/fetch-merge current main/push PR, run hosted green proof and remaining gates; then normal release/role tests within authorization.
