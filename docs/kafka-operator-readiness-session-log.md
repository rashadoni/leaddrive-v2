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
