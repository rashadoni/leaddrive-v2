# Kafka operator readiness — append-only session journal

## 2026-10-19 — scope and baseline

User requests bounded A5 preparation and exact A7 inventory for all 27 domains;
no production mutations, consumer startup, offsets/replay, business sends,
merge/deploy or changes to another session's checks. Overall delivery remains
with «Проверить защиту Kafka-консюмера».

Ran codex-project-context from canonical cwd. Preserved dirty checkout on
fix/reply-matrix-ai-agent-label. Fetched origin/main 226dde0e7 and created clean
/mnt/HC_Volume_106454338/codex-alt-data/worktrees/leaddrive-kafka-operator-readiness,
branch codex/kafka-operator-readiness. Origin rashadoni/leaddrive-v2.
Deployment docs/registry confirm 13.140.132.245:/opt/leaddrive-v2, GitHub Actions
main artifact route. Stale Hetzner wording in AGENTS is superseded by host
contract and current deployment docs; no production action is authorized.

Inspected A1/A2 checkpoint e298057d94804417d38fb105d960721bae6fc1cc:
worker-admission/artifact and full CDC fixtures are on that branch, not this
main baseline. Do not cherry-pick or duplicate them. New real integration
receipts remain NOT RUN; earlier broker/SQL receipts cover their exact scope.

Plan: audit operator/lifecycle/effect boundaries; add an inactive, offline
alert-delivery receipt gate with negative tests (no sends); document 27-domain
source/effect/rebuild gaps; run small sequential checks and checkpoint commits.

## 2026-10-19 — bounded A5 component and A7 inventory completed

Added inactive scripts/event-platform/operator-alert-evidence.mjs and dedicated
negative tests. Trusted read-only adapter must independently return matching
provider/archive receipts for ten gates, exact environment/SHA/change/challenge,
destination and responder, delivered+acknowledged status and fresh ordered UTC
times. No sender, network, credentials, consumer or activation wiring added.
This verifier does not authenticate operators, prove a real alert was delivered,
or atomically consume a challenge. These remain explicit follow-up gates.
Existing activation validator and other sessions' tests/workflows unchanged.

Added docs/event-platform/KAFKA_OPERATOR_READINESS.md: audited authenticated
admission gap, tenant/build fences, assignment versus durable lease distinction,
stop/SQL settlement, catch-up, atomic promotion, rollback and legacy effects.
27 catalog domains each list observed facts/state, derived projections, effects,
known/unknown idempotency, safe rebuild requirements and missing evidence.
Schema/catalog inspection of verticals is not an exhaustive writer audit.
Appended scoped status/link to KAFKA_IMPLEMENTATION_BACKLOG.md.

Verification in this exact worktree:
- Before targeted checks: ~15 GB available RAM, swap unused, 205 GB disk free,
  memory pressure averages zero. Node20.20.2. No install or heavy build.
- node --test scripts/event-platform/operator-alert-evidence.test.mjs
  scripts/event-platform/consumer-observation.test.mjs: PASS31/31
  (28 new receipt tests +3 unchanged observation tests).
- node --check both new mjs files: PASS.
- Catalog/document ID comparison: PASS27/27, no duplicate/missing domains.
- git diff --check: PASS for tracked diff; repeat staged check before commit.
- Full tsc/build/browser/whole-suite: NOT RUN; standalone mjs/docs change,
  no app imports and heavy verification forbidden on Contabo.
- Real Kafka/PG/CDC/worker integrations and A1/A2 new gates: NOT RUN here;
  require isolated CI/worker, owned by original delivery session.
- Real alarm delivery/provider read-back/ack: NOT RUN; no sends authorized.
- Production inspection/mutation, consumers, offsets/replay, sends: NOT RUN
  by task restriction. No push/PR/merge/deploy performed.

Current result: bounded A5 verifier and exact 27-domain evidence-gap map ready
for review; operational A5/A7 remain incomplete and activation fail-closed.
Last completed action: local targeted validation and evidence inventory.
Stopping point: local checkpoint only, no external delivery action.
Next action: originating session obtains exact-head A1/A2 integration receipts;
next A5 code slice is durable immutable operator request + two authenticated,
tenant-scoped admissions and atomic consume/revoke with restricted-SQL race
and isolation tests. Overall delivery remains «Проверить защиту Kafka-консюмера».

## 2026-10-19 — autonomous continuation authorized

User asks to proceed between remaining steps without additional prompts.
Preserved all original prohibitions (no merge/deploy, production, consumers,
offsets/replay or sends), and original-session delivery ownership. Re-ran
codex-project-context in recorded worktree, fetched main (still226dde0e7),
read current worktree AGENTS and delivery architecture. Earlier journal mention
of stale Hetzner AGENTS wording referred to canonical snapshot; this current
worktree AGENTS explicitly documents the correct Contabo route.

Next slice implements an inactive SQL control schema outside Prisma migrations:
separate named DB-login admissions (session_user), protected identity mapping,
immutable plan/hash, approval, one-time consume, generation/expiry/revoke and
same-transaction assert-current/settle. No live operation executor. Prepare a
new isolated PostgreSQL CI workflow without touching A1/A2 or existing gates.
No PostgreSQL client/server exists in this worktree host environment; actual
SQL concurrency proof belongs on a disposable hosted Linux CI service.

## 2026-10-19 — inactive named-login admission prepared

Added ops/event-platform/operator/admission.sql outside Prisma migrations:
private control schema, named session_user identity mapping, immutable exact
Fund plan + DB jsonb hash, independent approval, single-use consume and audited
generation, controller-bound assert-current/settle and revoke. No runtime
executor or business DB privileges. Companion README documents limits including
human independence, trusted provisioner, no pooled-login impersonation and no
deferred COMMIT-time expiry fence. Holding request lock serializes revocation;
it does not cancel work already admitted inside that transaction.

Added own operator-admission.integration.mjs and dedicated hosted-Linux PG16
workflow (no Kafka/consumer, credentials or production environments). Existing
A1/A2 and required checks untouched. Local Node syntax and runner-policy72/72
PASS; actual SQL integration still NOT RUN pending CI. RAM~14GB available,
204GB disk free, swap0 and memory pressure averages0 before checks.
Proceeding to authorized draft PR, branch-only push, and isolated CI proof.
No ready-for-review/merge/deploy is part of this task's delivery boundary.

## 2026-10-19 — draft PR and workflow validation correction

Created draft PR894 https://github.com/rashadoni/leaddrive-v2/pull/894 and
attached it to this chat. First source6ca3b5e2e produced run39164415054 failure
before any job/log: service-port expression was placed in job-level env, where
job.services context is unavailable. Moved it to the integration step's env.
This is a workflow-definition failure, NOT SQL test evidence. Existing CDC
job skipped on draft, as required; no consumer was started. Required heavy
app checks likewise remain skipped while this PR stays draft.

## 2026-10-19 — real isolated admission proof and hardening

Run39164468500/job117784407296 whole SUCCESS on
ab0aff696d2b1f6bdf0a6079e7abd6ac64fd3674: actual separate TCP PostgreSQL16
logins,13/13 admission/transaction/race cases and28/28 receipt units. Container
cleanup passed. This supersedes NOT RUN for that exact inactive SQL source,
not A1/A2, runtime controller, Kafka integration, actual alerts or production.

PR scan39164468608 failed with a false positive in original source6ca3b5e2e,
ops/event-platform/operator/README.md lines82–83. Pinned gitleaks8.30.1 archive
checksum verified against repository workflow; bounded branch-range scan
reproduced exactly one generic-api-key match spanning ordinary prose:
'direct-access denial' followed by 'expiry/revocation/principal'. No credential.
Changed current prose to avoid new occurrence. Historical commit still scans.
No .gitleaksignore/.gitleaks.toml/workflow exception or history rewrite made:
user forbids changing others' checks and checkpoint history must be preserved.
Leave that check standing; draft is not mergeable and no merge is attempted.

Follow-up self-review hardened install-role validation (three restricted
NOLOGIN roles), rejects elevated operator logins, rechecks expiry after identity
locks, adds live role revocation/controller remap/identity expiry tests.
New exact-source PG proof pending next push. No production or Kafka operations.

## 2026-10-19 — transaction-end expiry fence prepared

Before freezing the next proof, closed another bounded contract gap: initial
lease checks alone did not reject COMMIT after lease expiry. Added initially
deferred constraint trigger on consume/guard/settle audit rows. assert-current
schedules an audit guard in the same transaction; final trigger revalidates
lease, generation, holder and fresh operator identities. Added actual PG test
that performs guard+settle, waits past the lease, then expects COMMIT rejection
and verifies both settle and its audit rows rolled back.

PostgreSQL allows deferrable constraints to be advanced with SET CONSTRAINTS;
this remains a documented trusted-executor boundary, not an invented guarantee
against arbitrary controller SQL. No HTTP/raw-SQL executor or business write is
exposed. Previous README statement of no deferred fence is superseded only
for the new isolated source; runtime deadline/deferral composition stays open.
Node syntax and diff check PASS; revised exact-source integration pending CI.

## 2026-10-19 — preparation frozen, real final-code proof recorded

Run https://github.com/rashadoni/leaddrive-v2/actions/runs/39164804703,
job117785392405, code source52c57a3974a5da74842023c553c824316a6a87b3:
whole SUCCESS,17/17 actual PG cases +28/28 offline receipt cases; cleanup PASS.
Actual deferred-COMMIT case passed and proved settle/audit rollback after
lease expiry. This supersedes pending integration for this isolated code.
Post-proof changes are documentation-only; executable SQL/scripts/workflow
stay byte-identical to tested source. Runner-policy/validate/pr-scope PASS.
Full static/typecheck/build are SKIPPED/NOT RUN (draft, no heavy Contabo work).
Schema is not a Prisma migration; no schema/client generation or deploy occurs.

Local pinned-gitleaks branch-range check reproduces exactly one historical
prose false positive (README82 in6ca3b5e2e). Scan remains FAIL; current prose
changed, no global exception/check weakening or checkpoint rewrite. PR894
remains draft, no mergeable/delivery-ready claim. No full suites rerun locally.

Read-only continuity check: original A1/A2 PR891 OPEN on1d526a126fd540d86b38ed8bbea09b435fc4a408,
its latest own CDC/stack runs pending. Did not dispatch/cancel/edit/merge those
checks. Prepared checkpoint e298057 remains historical starting reference,
not a fresh exact-head passing receipt. Overall delivery ownership unchanged.

Updated runbook, backlog and27-domain map with tested scope and limitations.
No production access/mutation, Kafka consumer, offsets/replay, sends, purchase,
merge or deploy performed. Actual alerts and A7 business recovery drills stay
NOT RUN; initiating them would cross explicit task prohibitions. All allowed
preparation in this session is complete; operational readiness is NOT claimed.

Current result/status: inactive A5 admissions+alarm verifier verified within
scope; A7 map27/27 complete; draft PR894, scanner false-positive blocker remains.
Last completed action: hosted PG final-code proof and documentation reconciliation.
Precise stopping point: reviewed preparation branch only; no runtime executor
or production migration installed, no activation/read cutover attempted.
Next action: originating «Проверить защиту Kafka-консюмера» obtains exact-head
A1/A2 receipts, resolves historical scan under its delivery authority, then
prepares restricted shadow-controller composition in isolated CI. Production,
consumers, replay, effects and merge/deploy remain outside this session.

## 2026-10-19 — correction: continue allowed A5 work autonomously

User correctly challenges repeated stopping between steps. Prior declaration
that all allowed preparation was complete is superseded: additional inactive
catch-up/parity and isolated promotion/rollback preparation is possible without
production, consumers or sends. No further autonomy prompt is needed.

Resume from clean5bd0b2334 on the same worktree/branch. Finite remaining
preparation checklist: (1) pinned full-history/catch-up/stop/effect/parity
manifest gate with negative tests; (2) isolated admission-to-shadow-pointer
promotion/rollback composition and races, no real app pointer; (3) actual
hosted-PG proof of the new source; (4) reconcile A5/A7 evidence/remaining gates,
checkpoint and update existing draft. Scanner policy/history, A1/A2 checks and
production remain outside authorization. Continue through this checklist
without returning to user merely because one component/checkpoint is finished.

## 2026-10-19 — recovery manifest gate and shadow composition prepared

Added operator-recovery-evidence.mjs: exact-byte digest pinned to approved plan,
trusted scope/pointer match, fresh observation/soak interval, complete partition
set/history-start and next-offset parity, zero effects/quarantine, stop/settlement
receipt references, per-aggregate history/state/count/version/decimal/currency
parity and rollback retention/compatibility/write-fence checks. Local36/36 PASS.
These are consistency checks of trusted manifest bytes, NOT proof that a real
worker stopped, real archive restored or soak telemetry was sampled. Actual
producers/read-back of such evidence stay separate. Synthetic fixture receipts
must never be promoted into operational evidence.

Added private shadow-fixture.sql and7 real-PG composition cases on top of prior17:
admit+verify+atomic shadow pointer promotion/retained rollback; concurrent
promotions; stale evidence/target code/effect fence; revoke; deferred expiry
rolling back pointer/event/settle; expired rollback retention; direct-access
refusal. Fixture contains only synthetic builds/pointers and no app tables.
Controller cannot register its own trusted evidence. No runtime connection.

Updated only own dedicated workflow to run recovery gate units too. Node syntax,
runner policy72 workflows and diff checks PASS. Actual new PG24 cases NOT RUN
until the next exact-source CI. Resources~14GB available, swap0, disk204GB,
pressure averages0 before local tests. Continue directly to CI and reconcile
results; do not stop at this checkpoint.

## 2026-10-19 — autonomous checklist completed through reconciliation

Continued directly through all four recorded preparation steps. Actual hosted
run https://github.com/rashadoni/leaddrive-v2/actions/runs/39165969550,
job117788865931 on5ad987e953d28c36eedb9bc022eb194abb9973ab: whole SUCCESS,
64/64 receipt/recovery unit gates and24/24 real PG cases; cleanup PASS.
Seven new cases verify admitted synthetic pointer promotion/retained rollback,
competing CAS, stale evidence/target code/effect fence, revoke, deferred expiry
rolling back pointer+transition+settle, expired retention and denied direct
pointer/evidence access. These use synthetic control data, no real business
projection or Kafka. The earlier17-case source proof remains historical.

Source search found only four non-test appendDomainEvent call sites in three
Fund REST routes, no live generic effect/promotion SDK caller beyond definitions.
Updated A5 status,27-domain map, runbook/backlog and operator README. Compared
catalog IDs27/27 again: PASS. Local syntax/runner-policy/diff checks PASS.
Resource check~14GB available, disk204GB, swap0, pressure averages0.
Pinned branch-range gitleaks reproduces exactly one old prose finding; no new
finding introduced. Scanner remains FAIL; no exceptions/policy/history edits.
Full app static/typecheck/build stay NOT RUN while draft; no heavy host checks.

No new A1/A2 scheduling, real consumers, offsets/replay, external sends,
production mutation, merge/deploy occurred. Actual stop/soak/restore/alert
read-back is NOT RUN: fixture references are explicitly synthetic and cannot
replace authentic evidence. Obtaining delivery/consumer/replay receipts would
cross the user's retained prohibitions. A7 business adoption is a remaining
work map, not authorized activation of new integrations.

Current result/status: all four allowed continuation-preparation items are
implemented, tested and reconciled; operational readiness remains unproven.
Last completed action: actual64+24 CI proof and roadmap/runbook reconciliation.
Precise stopping boundary: draft PR894 plus failing historical scanner; no
real runtime authority, business pointer or activation installed.
Next action within shared delivery: original session integrates the prepared
contracts with its exact A1/A2 worker and restricted real Fund read path; an
authorized delivery owner must resolve historical scan without silently
weakening it. Live evidence requires permissions currently withheld here.

## 2026-10-19 — proof-quality correction before stopping boundary

Final review identified a false-positive possibility in the two deferred-COMMIT
negative fixtures: a pre-COMMIT admission error could satisfy their generic
expected-error assertion. Added explicit stdout markers after successful settle
and shadow-pointer change, before the expiry wait/COMMIT. Both tests must see
that intermediate success and then observe failure/rollback. Also constrain
concurrent-consume/promotion loser reasons to the expected admission/CAS denial,
so an unrelated connection error cannot count as a successful race test.
This strengthens evidence, not runtime behavior. Current code-source proof
must be refreshed; earlier64+24 result does not certify these revised tests.
Continue to CI without ending at this checkpoint. Existing rules untouched.

## 2026-10-19 — strengthened final-code evidence

Actual run39166310431/job117789862494 whole SUCCESS on
40a9b05e90ae3182b3fedf58d14f473473cf304f:64/64 unit gates +24/24 actual PG
cases, cleanup PASS. The two deferred-COMMIT cases now require positive markers
of staged settle/pointer change BEFORE waiting for expiry, and still verify
complete rollback after rejection. Concurrent losers must have exact expected
denial reasons. This supersedes earlier source proof for the revised tests.

All four autonomous continuation items are complete. No additional prompt was
requested between components, fixes, CI and reconciliation. Final documentation
checkpoint leaves executable source unchanged from40a9b05e9. Remaining limits
are specific: actual receipt producers/runtime integration and operations
prohibited by the initial task, plus historical scan policy/history resolution
outside this branch's authority. Preparation is not activation readiness.
Last completed action: strengthened real-PG proof, followed by PR/journal update.
Stopping boundary: clean draft branch, scanner remains FAIL, no activation.
Next action: shared delivery owner composes real A1/A2 worker/read-path with
these inactive contracts and obtains authorized authentic evidence; forbidden
production/consumer/replay/send operations are not attempted by this session.

## 2026-10-19 — start next authorized real-schema preparation

User says «начинай». Resume same clean55f6e3405 worktree/branch; context and
origin/main226dde0e7 reconfirmed. Original PR891 remains OPEN on1d526a126f;
broker/CDC smoke/stack passed, full-CDC/static pending at inspection. Do not
schedule, change or duplicate those gates. Production13.140.132.245:/opt/leaddrive-v2,
release GitHub Actions main; no production authorization added.

Next bounded slice: READ-ONLY Fund database evidence collection against the
three real existing migrations, not a replacement synthetic pointer. Reuse
existing legacy base.sql fixture anchors, run only our hosted-PG job; no
consumer, broker, source replay or application-pointer mutation. Fix recovery
manifest money scale6 to actual Fund NUMERIC(18,4). Add restricted-reader,
RLS/build boundaries, completeness/hash/parity and snapshot-consistency cases.
Do not label DB-only evidence as broker/stop/archive/alert readiness.

## 2026-10-19 — read-only real-schema slice prepared

Added parameterized operator-fund-snapshot.sql and inactive collector. It owns
no credentials/CLI/startup and requires a real RepeatableRead transaction plus
the existing canonical pure Fund reducer supplied by trusted composition.
First statement sets READ ONLY; real restricted session/current role required.
Trusted fixed tenant/build/version/key/SHA/environment and independent Fund-ID
inventory prevent a consistently hidden aggregate from looking complete.
Read caps200 funds/1000 events/128 checkpoints, payload16KiB/event and output
1MiB reject oversized/incomplete work. GUC is context only; independent RLS
provisioning remains mandatory. Source payloads are internal reducer inputs,
not returned or logged. Returned snapshot explicitly leaves broker positions
and external evidence unauthenticated.

Checks actual event/data/outbox hashes and canonical reducer results against
Fund/heads/active-v1/shadow, inbox identities/hashes and DB checkpoint coverage.
Checkpoints are LAST processed: next=last+1, never mistaken for broker proof.
Corrected manifest scale6 to actual nonnegative NUMERIC(18,4); old synthetic
six-decimal fixture convention is superseded. Existing reducer not duplicated.

Local targeted59/59 PASS (23 collector control-flow doubles +36 recovery gate),
syntax/runner-policy72/diff PASS. These doubles are not real-schema evidence.
Own CI adds minimal pinned esbuild0.25.12/zod4.4.3 dependencies (versions from
existing locks), compiles only canonical reducer, then runs8 actual PG cases.
They reuse unchanged scripts/ci/fixtures/fund-shadow/base.sql and the three
actual foundation/Fund/replay migrations; no foreign fixture/check is edited.
No consumer or Kafka is used; seeded inbox/checkpoint positions are synthetic.
Real PG proof pending next exact-source run. No full build/install on Contabo;
only small lock generation and focused Node tests, RAM~14GB/disk203GB/swap0.
Continue through actual CI, fixes and documentation without a user prompt.
