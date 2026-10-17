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
