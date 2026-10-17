# Kafka readiness session log

## 2026-10-17 — current-state audit

- User asked what remains for Kafka after the PostgreSQL scratch/recovery work.
- Read-only audit used current `origin/main` (`1800e514b757c7bb14dde4ec3caf680941cd4a12`) from the canonical remote `rashadoni/leaddrive-v2`; no production, Kafka, offset, replay, consumer, or data mutation was performed.
- Confirmed foundation: the repository contains canonical event/outbox/inbox/projection/effect contracts and the concrete Finance Fund pilot.  CI validates event-platform assets and the scheduled event-recovery audit is currently succeeding.
- Confirmed non-activation: current architecture and recovery runbook explicitly state that Kafka transport, archive, consumers, live broker history, consumer groups, replay controller, and safe offsets are not active.  The repository contains template assets and a fail-closed evidence preflight, not a provisioned Kafka deployment.
- Confirmed no live runtime adapter: `src/lib/event-platform/consumer.ts` is a transport-neutral idempotency boundary; no current-main caller or Kafka client dependency starts a consumer.
- Current remaining work is external Kafka platform activation plus controlled runtime implementation and a non-production replay drill.  It must not begin from this audit without a separately approved target, provider/budget choice, two-person change approval, and maintenance window.

## Current stopping point

Read-only readiness assessment complete.  The next safe action, if authorized, is to prepare a provider-neutral activation change plan and costed options; it is not to activate consumers or reset/replay offsets.

## 2026-10-17 — task breakdown requested by owner

- User requested a concrete task breakdown for all eight remaining workstreams.
- Added `docs/event-platform/KAFKA_IMPLEMENTATION_BACKLOG.md`: baseline tasks, eight workstreams with IDs/dependencies/acceptance, a reusable per-domain task set, coverage of all 27 current domain IDs, and staged deliveries P0–P5.
- Preserved the owner's preference for no new paid subscription. The plan first inventories existing resources and separates development progress from the unresolved production capacity/failure-domain requirements; no purchase or infrastructure activation was performed.
- Clarification superseding any reading of the previous entry as “only external setup remains”: runtime broker adapters, actual consumer/effect workers, replay operator API, versioned read-path integration, and non-Fund adoption still need implementation and testing.
- The current main documentation contains conflicting deployment statements about projection control-plane/pointer readiness. K0.1 explicitly requires fresh production receipts and reconciled documentation; this planning turn did not independently re-audit production or treat old cutover pins as current.
- Independent read-only planning review confirmed the missing runtime, current topology/approver constraints, schema-validation boundary, and need to size topic partitions. Its findings were incorporated without adding a new CI approval gate.
- Routing was reconciled with current-main deployment documents: `origin` is `https://github.com/rashadoni/leaddrive-v2.git`; production is the registered Contabo host at `/opt/leaddrive-v2`; GitHub PR/checks/deploy remains the release path.
- Scope of this turn is documentation. No external issue/PR, push, merge, deploy, PostgreSQL change, consumer activation, offset reset, or replay was requested or executed as part of the breakdown.
- Verification: staged `git diff --check` passed; document validation found 27/27 current-main domains covered, 67 unique task definitions (including eight reusable per-domain tasks), and no broken local source links. Runtime tests/build are NOT RUN because only documentation changed.

### Latest stopping point

The task breakdown is complete and awaiting execution, starting with K0/P0
(current-state and resource inventory) plus design of the isolated test stack.
Production activation remains a later scoped change with actual runtime evidence.

## 2026-10-17 — owner authorized sequential execution

- User instructed: execute all planned tasks in sequence. This authorizes implementation, existing GitHub PR/check/merge/deploy flow, and preparation of the test stack. The existing no-new-paid-subscription preference remains; destructive source-data operations are not inferred from it.
- Started K0. The obsolete September branch was preserved. Implementation continues from current main `9ead36ce7ef64cb16d521acad9bc3b210812a3c9` in clean managed worktree `/mnt/HC_Volume_106454338/codex-alt-data/worktrees/leaddrive-kafka-delivery-20261017`, branch `codex/kafka-foundation-delivery-20261017`; only the two task-owned journal/plan commits were carried forward.
- Current-main AGENTS/delivery/deployment/registry agree on `rashadoni/leaddrive-v2`, registered Contabo production `/opt/leaddrive-v2`, and GitHub Actions. Main protection has the five expected required checks and enforce_admins; no gate was changed.
- Public read-only smoke passed: `/api/v1/ping` returned `{"ok":true}`; build-info reported `1800e514b757c7bb14dde4ec3caf680941cd4a12`, matching successful deploy run `39062272509`. The newer `9ead36ce...` release run `39066347230` was already active and was not duplicated or interrupted.
- Direct approved production SSH alias was denied by public-key authentication. No alternate production key/host was attempted. Added a reviewed-main-only, deployment-serialized GitHub workflow for aggregate read-only inspection through the existing pinned production access.
- New inspection script refuses an unbound SHA, unsafe migration env and duplicate/missing values; it never sources the env. SQL starts read-only, uses bounded deadlines, selects settings/table metadata/aggregate storage and WAL counters only, and suppresses raw connection errors. Backup timer/config presence is explicitly not restore verification.
- Local small checks after resource inspection passed: five tooling tests (including no-eval/duplicate/missing-value cases), bash syntax, GitHub runner policy, existing event-platform asset gate (27 domains/86 topics/5 schemas), and whitespace check. Full builds/typechecks: NOT RUN locally; GitHub owns those gates.
- Fund integration reconnaissance found that writers and compatibility triggers still require active projection v1, and Fund GET reads currentBalance rather than the generic projection pointer. The first Kafka worker must write an isolated shadow projection; live reader/writer adaptation is a later tested change.

### Current execution position

K0 tooling is implemented locally; live production inventory awaits reviewed
GitHub delivery and workflow execution. K0.2 Fund/write-path inventory is being
documented. No production configuration, Kafka worker, offset or replay has
been changed in this phase.

### K0 checkpoint and delivery

- Added the Fund-focused `WRITE_PATH_INVENTORY.md`; remaining domains and dynamic/raw writers stay explicitly NOT INSPECTED. All 34 relative references were checked.
- Independent review found no blocker in the inspection design, and noted the inherited psql-argv credential pattern. Replaced that pattern with standard-library URI parsing and environment-only libpq credentials; unknown/duplicate options and read-only overrides fail closed. Seven targeted tooling tests now pass, including credential-argv and override regressions.
- Checkpoint `3231e6dbb` was pushed to the task branch. Draft PR: https://github.com/rashadoni/leaddrive-v2/pull/860. No mandatory branch/environment gate was added or weakened. Next: complete existing required GitHub checks, merge this internal tooling, verify deployment, then dispatch the aggregate inventory from current main.

## 2026-10-17 — disposable test-stack preparation during K0 checks

- PR #860 is ready on exact head `074028396c208fec187c7a69a2976bf2308b2c4b`. Tooling validation, secret scan, runner policy and pr-scope passed; static-checks/typecheck were still running. GitHub auto-merge is disabled, so the task keeps one local checks watcher (no duplicate workflow attempt).
- Prepared K1.2/K1.3 fixture code in a separate managed worktree `/mnt/HC_Volume_106454338/codex-alt-data/worktrees/leaddrive-kafka-test-stack-20261017`, branch `codex/kafka-test-stack-20261017`, based on that task-owned head. This preparation does not mark K0's pending live inventory complete.
- Added digest-pinned Linux/amd64 PostgreSQL/Kafka/Connect/Apicurio services on an internal disposable network. No host bind mounts, production secrets, production addresses or persistent restart policy; only Connect/Registry have loopback dynamic ports. Memory ceilings total 2,944 MiB, and the harness requires 4 GiB available memory. The single broker, RF1, plaintext and ephemeral registry are test-only and cannot satisfy the unchanged production gates.
- Added a CI-only synthetic smoke with explicit test-project naming, per-run isolation, precreated Connect topics, logical-WAL check, actual Connect plugin/Registry probes, key/value transport assertion, bounded diagnostics, and scoped cleanup. JVM services have not been started on Contabo.
- Primary upstream configuration and Registry endpoint were independently checked. Static Compose parsing, three fixture safety tests, all ten current tooling tests, bash syntax, runner policy and existing 27-domain asset gate passed. Runtime smoke is NOT RUN until its GitHub job executes; it does not yet test CDC snapshot, schemas, consumer/RLS, archive, replay or HA.

### Test-stack stopping point

Fixture implementation is ready for a draft PR. Its heavy smoke stays skipped
while draft; it is queued for execution after the K0 required checks, preserving
the sequence and avoiding a second manual heavy phase on the development host.

- Test-stack checkpoint `3100de7a1` is pushed; draft PR https://github.com/rashadoni/leaddrive-v2/pull/861 depends on #860. Its integration smoke is explicitly skipped while draft and will be made ready after predecessor gates. The K0 tooling and integration worktrees remain separate and cleanly scoped.
