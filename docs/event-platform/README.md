# LeadDrive event-platform safety program

Status: **DATABASE FOUNDATION MERGED; NEW-HOST PRODUCTION CUTOVER BLOCKED BY
BACKUP COMMISSIONING; ENTERPRISE PITR/SECOND-REGION/FULL-AUTHORITY GATES OPEN;
KAFKA TRANSPORT PREPARED BUT NOT ACTIVATED**
Date: 2026-09-05

LeadDrive uses this program to make calculation, consumer, and projection bugs
recoverable without rolling the whole shared multi-tenant database back in
time. Status in this document is deliberately split by layer: repository code,
deployed database state, and external Kafka infrastructure are not the same
thing.

## Read in this order

1. [ADR-001: Kafka event backbone](./ADR-001-KAFKA-EVENT-BACKBONE.md) — the
   accepted decision, alternatives, costs, and activation boundary.
2. [Architecture](./KAFKA_EVENT_SOURCING_ARCHITECTURE.md) — components,
   contracts, tenancy, security, operations, and phased delivery.
3. [Module event catalog](./MODULE_EVENT_CATALOG.md) — governance coverage for
   every product domain; a catalog entry does not mean that domain is migrated.
4. [Projection recovery runbook](./PROJECTION_RECOVERY_RUNBOOK.md) — current
   database-only response plus the future Kafka shadow-rebuild/offset paths.
5. [Infrastructure assets](../../ops/event-platform/README.md) — 27-domain topic
   registry, Debezium/PostgreSQL CDC templates, Schema Registry subjects, and
   activation gates.
6. [Canonical event-envelope schema](./event-envelope-v1.schema.json) — common
   CloudEvents-compatible envelope contract.

These documents complement—not replace—the
[production backup runbook](../BACKUP_RUNBOOK.md). Backups repair source-storage
loss; immutable events rebuild derived state; effect reconciliation prevents
real-world operations from being repeated.

## Exact implementation state

| Layer | Repository state | Intended production meaning after gated cutover |
|---|---|---|
| Canonical PostgreSQL foundation | Implemented by `20260901090000_event_platform_foundation` | Immutable `domain_events`, transactional `event_outbox`, aggregate heads, command receipts, consumer inbox, projection build/checkpoint, effect outbox/attempts, and immutable operator reconciliation evidence |
| Database enforcement | Implemented and integration-tested on PostgreSQL 16 | FORCE RLS on canonical tables; a spoofed `app.rls_bypass` GUC is ignored; append-only, stream/head/outbox, effect-state, and replay-fence invariants are database triggers/constraints rather than application promises |
| Finance Fund Profile-A pilot | Implemented by `20260901100000_fund_event_source_pilot` and Finance API changes | Exact `NUMERIC(18,4)` money, command idempotency receipts, atomic fund/event/outbox/projection writes, canonical bootstrap of every existing fund transaction, rollback-artifact compatibility triggers, and an active rebuildable balance projection |
| Runtime SDK | Implemented under `src/lib/event-platform/` | Canonical envelope/hash, optimistic aggregate append, inbox claim, command receipts, monotonic projection checkpoints, lifecycle CAS, two-person promotion evidence, atomic read-pointer switching, and externally visible effect state transitions share one contract |
| CI/deploy safety | Implemented in the artifact; production commissioning still required | Clean PostgreSQL migration/invariant suite, runtime/schema contract fixtures, targeted API/SDK tests, one-time Fund write drain, reboot-safe PM2 stop fence and durable `migration_applied -> verified` journal. Backup recovery is a SHA-bound bootstrap → full chain: 400-day immutable log horizon, independently signed limited bootstrap restore, `recovery-bootstrap` operations-only deploy, full candidate v3/offline log restore, marker v4/catalog v3, then normal deploy revalidation before timers activate. The bootstrap record is historical; a fresh full certificate is required at least every 28 days. Catalog v3 is not yet a clean-host hydration capsule or signed log-discontinuity protocol, and the slice is not full authority/PITR/second-region DR. |
| All-module governance | Implemented as catalog/templates, not as domain migrations | 27 domain names expand to 86 governed physical-topic definitions; every module has a migration profile and effect/replay requirements |
| Kafka/Connect/Registry/archive | Templates only; deliberately inactive | No topic, connector, credential, slot, consumer offset, archive watermark, or claim of live Kafka delivery is created by this application release |
| Replay control-plane database/SDK | Deployed; runtime operator admission remains inactive | Tenant-scoped build lifecycle, monotonic checkpoints, effect-fenced target validation, append-only distinct-requester/approver promotion evidence, and an atomic versioned read pointer are available without contacting Kafka. The future operator API must bind those IDs to separately authenticated operators; string inequality alone is not a completed two-person control. |
| Kafka projection runtime boundary | Implemented as a transport-neutral SDK boundary; no broker adapter or worker is active | Topic/environment, key, tenant/event headers, envelope and Kafka position fail closed before tenant work; acknowledgement follows the committed idempotent transaction; replay/shadow modes fence effects. Broker-specific lifecycle, projection handlers and operator API remain gated. |
| Non-Fund module adoption | Cataloged only | Existing module tables, domain outboxes, receipts, and audit histories retain their current authority until migrated and drilled one domain at a time |

The machine-readable Kafka assets are passive. Repository/production
reconnaissance before this release found PostgreSQL with `wal_level=replica`
and no Kafka, Connect, Schema Registry, archive sink, provider credentials, or
replication slot. Live activation therefore requires the separately approved
provider/restart sequence in `ops/event-platform/README.md`.

## One-release Fund cutover prerequisite

The first production Fund migration is allowed only from the exact predecessor
artifact `8fbd00c410c6908df65be999e11f2564afcd9a67` (PR #1076). That release keeps
legacy Fund writes atomic in INSERT-first order, exposes its full compiled
`artifactSha`, and carries the immutable marker
`.event-platform-fund-atomic-insert-first-v1` with contract
`fund-transaction-atomic-insert-first-v1`.

The final event-platform artifact deliberately does not carry that marker.
Before any Fund quiesce, backup, or migration, `scripts/server-deploy.sh`
requires the pinned SHA and exact marker bytes in the root-owned rollback copy
and requires the running localhost endpoint to report the same full SHA. A
different or intervening production release is a hard stop: update the pin only
through a new reviewed change and rerun all gates; never bypass the check on the
server.

The host migration is part of the same immutable release boundary: build runs
only on a GitHub-hosted ephemeral Linux runner, all build/deploy/recovery SSH
paths require the pinned production host key, and server preflight atomically
normalizes only the known legacy `SHARED_SERVER_IP` to the registered
production host `13.140.132.245`. A different host or DNS target fails closed
before the Fund cutover.

## What this release protects

For the Fund pilot, every successful create or transaction command now has one
atomic database boundary:

```text
idempotency receipt + Fund/FundTransaction + aggregate head
  + immutable domain event + immutable outbox + exact balance projection
```

A crash cannot commit only the transaction row or only the balance. A repeated
command key returns the stored result; the same key with different input is a
conflict. Rollback compatibility is deliberately limited to the exact pinned
expand artifact: it writes FundTransaction first and then the conditional Fund
balance update inside one interactive database transaction. Compatibility
triggers canonicalize that pair exactly once, and deferred constraints reject
either half on its own. A later contract migration may remove that bridge only
after the rollback window closes.

The deployment does not trust a successful migration exit by itself. On the
first Fund-pilot cutover it drains old writes, stops the previous process, and
persists a PM2 state with both standalone-backed processes absent **before** it
replaces the generic standalone path. The exact previous Prisma client,
artifact SHA and rollback backup path are persisted outside rotating release
state. The migration transaction writes a migration-role-only
`event_platform_cutover_gates` row as `migration_applied`; only the exact-client
and deep-reconciliation success path can advance it once to `verified`, bound
to candidate/previous SHAs and client/migration/backup hashes. A reboot or
retry therefore resumes verification instead of treating an applied migration
as an approved release.

The same deployment preflight rejects a web role that can `SET ROLE` into any
superuser or `BYPASSRLS` role; checking only the login role's own flags is not a
multi-tenant boundary.

The cutover also
forces a fresh run of the approved PostgreSQL backup pipeline. That run must
restore into an isolated scratch database, compare canaries, encrypt with the
offline age recipient, upload off-host, and prove COMPLIANCE retention before
the migration can start. It then loads the exact Prisma client from the
SHA-pinned, backed-up production artifact and executes its real Float and atomic
INSERT-first paths inside a transaction that rolls back at the hard-delete
fence, then runs a deep history reconciliation. Before every new application activation,
`scripts/event-platform-postconditions.sql` checks
the migration ledger, table ownership, FORCE RLS, constraints, indexes and
safety triggers. The full event/outbox hash, contiguous stream and exact Fund
rebuild scan runs in CI, in an explicit two-hour fail-safe window on the first
pilot migration, and when an operator explicitly sets
`app.event_platform_force_deep=on`; it is not a routine-deploy query over an
ever-growing ledger. All checks are read-only and fail the release instead of
rewriting evidence.

## What it does not protect yet

- There is no live Kafka history or consumer offset to rewind today.
- There is no automated shadow rebuild controller or active Kafka worker. The
  atomic projection read pointer is deployed, and Fund event history is
  sufficient source material, but a repair still needs the governed
  database-only procedure in runbook section 14.
- Other finance aggregates—invoice, bill, payment, refund, budget—and all other
  modules are not made event-sourced merely because shared tables exist.
- Existing external sends/calls remain protected only by their current local
  receipts/outboxes until they adopt the shared effect state machine.
- PostgreSQL PITR and backups remain mandatory. Kafka will not be the only copy
  of history and will not repair physical source loss.
- Current backup objects and catalog still share one provider/account/region;
  WAL/PITR, full roles/owners/ACL restore, coordinated media generations and
  operational-state/credential rebootstrap are explicit enterprise NO-GO gates.
- The broader legacy schema still contains RLS policies that use the historical
  application bypass convention. Canonical event tables intentionally do not.
  Removing that convention module by module and restricting cross-tenant work
  to real database roles is a multi-tenant enterprise GA gate.

## Safety model

```text
command transaction
  -> authoritative state/event + event outbox
  -> Debezium (inactive until approved activation)
  -> Kafka + immutable archive
  -> consumer inbox + versioned shadow projection
  -> optional effect outbox
  -> provider worker + reconciliation evidence
```

Each arrow has its own failure contract. Kafka preserves replayable delivery;
it does not by itself make a PostgreSQL update, payment, email, call, webhook,
or provider operation exactly once.

## Delivery program

1. **Completed in this release:** shared PostgreSQL primitives, TypeScript SDK,
   Fund Profile-A pilot, old-artifact compatibility, passive Kafka/CDC/schema
   assets, CI gates, deploy postconditions, and the governed runbook.
2. **External activation gate:** select a supported multi-zone provider;
   provision Kafka, Connect, Registry, archive, ACLs, secrets and monitoring;
   capacity-size finite retained WAL; approve the PostgreSQL logical-decoding
   restart; then complete a non-production end-to-end drill.
3. **Control plane:** the database/SDK lifecycle, effect-fenced target,
   monotonic checkpoints, two-person evidence, and atomic read pointer are
   implemented but not deployed. Still implement the operator API, explicit
   replay plans/tenant allowlists, shadow workers, invariant executors, and
   archive/watermark reconciliation before activation.
4. **High-consequence wave:** payments/refunds, invoices/bills, loyalty/points,
   inventory, entitlements, approvals, provisioning, and external effects.
5. **Operational and industry waves:** migrate the remaining catalog domains
   only after each domain passes duplicate, crash, correction, privacy,
   cross-tenant, and full-history rebuild gates.
6. **Enterprise readiness:** execute independent Fund and effect replay drills,
   PostgreSQL PITR/event-watermark reconciliation, archive rehydration, and
   regional Kafka failover with measured RPO/RTO.

## Definition of enterprise-ready

LeadDrive may claim end-to-end event-recovery protection for a domain only when
that domain has proven:

- atomic command/event/outbox commits and database-enforced idempotency;
- deterministic tenant-scoped shadow rebuilds with exact invariants;
- zero non-replay-safe effects during replay;
- provider `UNKNOWN` reconciliation without blind retry;
- schema, PII, retention, legal-hold, and cross-tenant fail-closed tests;
- Kafka/Connect/archive monitoring and bounded WAL-retention failure behavior;
- archive, PITR, secondary-cluster, and operator-run recovery drills; and
- measured RPO/RTO with independently reviewed customer-audit evidence.

Until those gates pass, use the precise status table above rather than the
blanket statement “LeadDrive has event sourcing.”
