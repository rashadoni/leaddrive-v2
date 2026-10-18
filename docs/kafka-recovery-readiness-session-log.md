# Kafka recovery readiness — append-only session log

## 2026-10-19 (Asia/Baku): scope and baseline

- User requests bounded A3 backup/recovery preparation; coordinator is chat
  «Проверить защиту Kafka-консюмера». No merge/deploy, production restore,
  PostgreSQL/timer/Kafka/offset/replay changes, purchases or private key requests.
- Read AGENTS.md, ran codex-project-context, fetched origin/main. Canonical dirty
  checkout preserved. Dedicated clean worktree and codex/kafka-recovery-readiness
  start at 226dde0e77c0c36a4de991bb703ba8f8416c5a64.
- Origin: https://github.com/rashadoni/leaddrive-v2.git. Registry and deployment
  docs agree on 13.140.132.245:/opt/leaddrive-v2; delivery GitHub Actions only.
  AGENTS.md's Hetzner sentence is superseded by this current routing contract.
- Reviewed backup, restore canary, offline verifier, readiness reporter, runbook,
  ISMS-04 and Kafka backlog. Files/configuration are not execution receipts.
- Existing read-only backup-readiness workflow dispatched on exact main:
  https://github.com/rashadoni/leaddrive-v2/actions/runs/39163236284
  Initial state waiting; no fresh verdict inferred.
- Resource preflight: available RAM 15186 MiB, swap used 0, disk available 205G,
  memory pressure avg10/60/300 zero. Only small sequential checks permitted.

## 2026-10-19: bounded preparation and verification

- Added A3_RECOVERY_READINESS.md: evidence levels, controls, independent Farah
  acceptance packet, explicit PENDING and DR limitations. Linked fresh status
  in Kafka backlog. No changes to operational helpers or pinned digests needed.
- Read-only workflow completed failure at 2026-10-18T20:26Z (00:26 Baku):
  machine_ready=no, enterprise_ga_ready=no, issues=24, enterprise_gaps=9.
  Encryption explicitly off; live unit drift, missing runtime timer, other
  timers disabled/inactive; stale/uncompleted runs, swap fences absent;
  missing/unsafe evidence/genesis; Object Lock unknown_failure, not a proven
  policy/credential cause. Pinned tools/passfile checks passed. Restore NOT RUN.
- PASS sequentially: pgpass-contract 29 tests; object-lock-diagnostic 12 tests;
  event-platform assets (27 domains/86 topics/5 schemas); bash -n on backup,
  restore canary, offline verifier and readiness reporter; git diff --check.
- NOT RUN: actual libpq integration (test skipped by its CI-only disposable DB
  opt-in); full build/typecheck/browser suites (docs-only scope; heavy checks
  prohibited on Contabo); backup/decrypt/restore/PITR/full-authority/host-loss
  drills (outside authorized operations; keys/operator evidence unavailable).
- Identified historical docs conflicts: ISMS-04 three-timer/certification
  activation and runbook GitHub reviewer stop condition. Current deployment
  contract and four-timer activation ceremony apply; no reviewer gate restored.
- Remaining blocker: recovery commissioning prerequisites and successful
  independent exact-version restore + Farah decision. Next coordinator action:
  review this packet, scope prerequisite remediation and authorize isolated drill.
