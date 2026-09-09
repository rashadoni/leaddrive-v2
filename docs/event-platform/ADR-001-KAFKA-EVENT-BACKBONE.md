# ADR-001: Kafka event backbone and selective event sourcing

Status: **ACCEPTED — incremental implementation active; external Kafka
activation remains a separate approved change**
Date: 2026-09-01
Owners: LeadDrive platform, security, SRE, and domain owners
Decision scope: all tenants, modules, integrations, workers, projections, and
externally visible side effects

## Context

LeadDrive is a multi-tenant system with hundreds of persisted models and many
independent business domains. A faulty consumer or derived calculation can
write incorrect values while unrelated tenants and modules continue to accept
valid writes. Rolling application code back does not undo those writes. A
whole-database point-in-time restore would also discard valid changes made
after the restore point.

The current codebase contains several useful but separate reliability
mechanisms: durable webhook receipts, payment and sync idempotency records,
domain outboxes, BullMQ jobs, `PlatformEventLog`, and the `EventStream*`
control-plane models. They do not yet form one immutable, replayable contract
for every correctness-critical domain. Some request handlers and jobs can
still combine a database mutation with an external call or update derived
state without a universal idempotency key.

The platform needs a recovery unit smaller than the production database and a
way to distinguish rebuilding derived state from repeating an external effect.

## Decision

LeadDrive will use a hybrid architecture described in
[Kafka and event-sourcing target architecture](./KAFKA_EVENT_SOURCING_ARCHITECTURE.md):

1. PostgreSQL remains the command-side source of truth for Profile B modules
   during incremental migration.
2. A business transaction appends a canonical event and transactional outbox
   row in the same PostgreSQL transaction. Application code does not dual-write
   independently to PostgreSQL and Kafka.
3. Debezium publishes only the explicit outbox contract to Kafka. Generic CDC
   of application tables is not a domain API.
4. Kafka is the ordered, replayable distribution backbone. PostgreSQL PITR and
   an immutable encrypted event archive remain independent recovery controls.
5. Money, points, stock, entitlements, approvals, and other
   correctness-critical aggregates migrate to true event sourcing first.
   Ordinary CRUD domains initially keep transactional state plus domain events.
6. Consumers use at-least-once delivery plus a transactional inbox. Kafka's
   transactional guarantees are used only for Kafka-to-Kafka flows and are not
   represented as exactly-once delivery to PostgreSQL or an external provider.
7. A projection rebuild uses a new consumer group and shadow projection
   version. Promotion changes a read pointer only after per-tenant invariants
   pass. The active consumer group is not reset for a normal rebuild.
8. External calls are submitted through an effect outbox with a stable
   business idempotency key. Replays fence all non-replay-safe effects, and an
   unknown provider outcome requires reconciliation rather than blind retry.
9. Committed source events are append-only. Incorrect source facts are repaired
   with correction or compensating events.
10. Tenant scope is a mandatory envelope field and replay-plan constraint.
    Cross-tenant replay or promotion requires two-person approval.

The canonical envelope follows CloudEvents 1.0 semantics and the checked-in
[JSON Schema](./event-envelope-v1.schema.json). Topic, consumer, and migration
ownership is recorded in the
[module event catalog](./MODULE_EVENT_CATALOG.md).

## Why this decision

This design makes the most likely failure classes independently recoverable:

| Failure | Recovery unit |
|---|---|
| Incorrect calculation or projection code | One versioned projection, optionally one tenant |
| Consumer missed delivery | One inactive consumer group and explicit offset range |
| Duplicate delivery | One event/effect key resolved by a uniqueness constraint |
| Incorrect business fact | One append-only correction/compensation chain |
| Uncertain provider operation | One effect reconciled against provider evidence |
| PostgreSQL loss | Isolated PITR restore plus event/outbox watermark proof |
| Kafka loss | Secondary cluster or immutable archive rehydration |

It also permits risk-based adoption: the system does not need to rewrite all
existing models before the first high-risk ledger is protected.

## Alternatives considered

### Database backup and code rollback only — rejected

Backups protect against database loss, but restoring the shared database to
repair one bad projection discards valid writes made by other tenants and
modules after the restore point. A code rollback also leaves already-corrupted
derived rows unchanged.

### Application dual-write to PostgreSQL and Kafka — rejected

There is no atomic commit across an ordinary PostgreSQL transaction and an
independent Kafka publish. Either side can succeed alone. The transactional
outbox gives one local commit boundary and a resumable relay.

### Generic CDC of every business table — rejected

Row-level changes expose storage implementation details, make schema refactors
breaking integration changes, and can publish sensitive columns accidentally.
Only the explicit outbox is a stable event contract.

### BullMQ/Redis Streams as the authoritative history — rejected

They remain suitable for bounded operational jobs, but the platform requires
durable ordered replay, partition ownership, schema governance, long-retention
archive integration, and cross-region replication as a shared backbone.

### Kafka exactly-once as universal idempotency — rejected

Kafka transactions can cover Kafka records and consumed offsets, but cannot
atomically control PostgreSQL, payment providers, email, telephony, or other
external systems. Database uniqueness, effect keys, and reconciliation are
still required.

### Big-bang event-sourcing rewrite — rejected

Rewriting every module at once would create a long unsafe migration and delay
protection of the most consequential paths. Profiles A, B, and C let each
domain move according to its risk and semantics.

## Consequences

### Positive

- Projection defects no longer require a whole-database restore.
- Historical events can deterministically rebuild versioned read models.
- Duplicate delivery and crash/retry behavior become explicit and testable.
- External effects have durable intent, attempt, outcome, and reconciliation
  evidence.
- Tenants and domains can be migrated and recovered independently.
- Audit, disaster recovery, and customer evidence share one event contract.

### Cost and complexity

- Kafka, schema registry, Debezium, an archive sink, and their observability
  become production dependencies.
- Event/schema ownership, retention, privacy, and compatibility require ongoing
  governance.
- Every projection needs deterministic rebuild and invariant checks.
- Dual-read/shadow periods temporarily increase storage and operational work.
- Teams must design corrections and compensations instead of editing history.

### Risks to control

- Kafka history can retain sensitive data longer than intended; payload
  minimization, classification, encryption, and erasure design are gates.
- Incorrect partition keys can break aggregate ordering or tenant isolation.
- Replaying an effect-producing consumer without a fence can duplicate real
  operations.
- Outbox/connector failure can retain PostgreSQL WAL or grow the outbox; both
  require age/LSN alerts and capacity limits.
- A second event framework could emerge if `PlatformEventLog`, `EventStream*`,
  and domain outboxes are not converged deliberately.

## Implementation constraints

- Production adoption is incremental and follows the catalog migration waves.
- No domain becomes authoritative on Kafka before every go/no-go gate in the
  target architecture passes.
- The first implementation must include replay-mode effect fencing and a
  projection rebuild drill; Kafka provisioning alone is not a completed
  safety feature.
- Existing audit/history rows are preserved. Adapters and compatibility views
  remain until parity and retention evidence is approved.
- Topic creation, ACLs, schemas, connector configuration, and retention are
  infrastructure-as-code and independently reviewed.
- Production activation, data migration, and offset changes require a separate
  authorized change window. This ADR does not authorize a deploy.

## Operational acceptance

The decision is considered implemented for a domain only after:

- its commands append state/event/outbox atomically;
- duplicate and crash-boundary tests prove idempotency;
- cross-tenant attempts fail closed;
- a full shadow replay matches per-tenant counts, values, and invariants;
- replay produces no non-replay-safe effects;
- correction and provider-`UNKNOWN` drills succeed;
- archive and disaster-recovery watermarks are proven; and
- an operator who did not write the consumer executes the
  [recovery runbook](./PROJECTION_RECOVERY_RUNBOOK.md).

## References

- [Apache Kafka delivery semantics and transactions](https://kafka.apache.org/43/design/design/)
- [Apache Kafka consumer-group offset operations](https://kafka.apache.org/43/operations/basic-kafka-operations/)
- [Debezium outbox event router](https://debezium.io/documentation/reference/stable/transformations/outbox-event-router.html)
- [CloudEvents specification](https://github.com/cloudevents/spec/tree/ce@stable/cloudevents)
