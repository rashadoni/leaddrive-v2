# LeadDrive event-platform infrastructure assets

Status: **prepared, validated templates; no external infrastructure is
activated by these files**.

These assets describe the Kafka, Kafka Connect/Debezium, PostgreSQL logical
decoding, and JSON Schema Registry boundary for the canonical
`event_outbox`. They deliberately contain no provider endpoint, credential,
certificate, REST apply command, Terraform state, or production mutation.

The application writes a logical outbox route:

```text
leaddrive.domain.<domain>.v1
```

The Debezium EventRouter turns that into the environment-specific physical
topic:

```text
ld.<env>.<domain>.events.v1
```

Keeping `<env>` out of the database means a restored database does not carry a
stale production broker destination. `partitionKey` remains
`<organizationId>:<aggregateType>:<aggregateId>`, so records for one tenant
aggregate stay ordered on one partition.

## Included assets

- `topics.v1.json` is the machine-readable catalog for all 27 product domains.
  It expands each domain into events, incident replay, and quarantine topics,
  plus five control/effect/audit topics. Every topic inherits replication
  factor 3, minimum ISR 2, and disabled unclean leader election. Domain event
  retention is 90 days; the immutable archive and PostgreSQL event store, not
  unbounded broker disks, retain recovery truth beyond that window.
- `debezium/event-outbox-connector.template.json` reads only
  `public.event_outbox`, only INSERT operations, through the explicit
  `leaddrive_event_outbox` publication. The initial snapshot has a stable
  aggregate-key/version order. Update/delete/truncate records and processing
  errors fail closed. Its adjacent README defines the mandatory pre-publish
  application/SQL contract gate; the connector itself is transport, not a
  schema validator.
- `postgres/postgresql.conf.example` is the PostgreSQL 16 logical-decoding
  baseline. It includes a finite slot-WAL cap; it is not safe to paste without
  disk/write-rate sizing.
- `postgres/prepare-cdc.sql` creates the dedicated cross-tenant CDC role,
  explicit RLS SELECT policy, and INSERT-only publication. It does not create a
  slot, set a password, restart PostgreSQL, or contact Kafka.
- `postgres/prepare-effect-operator.sql` creates the exact NOLOGIN/NOINHERIT
  capability role required to append immutable provider-reconciliation
  evidence and perform its matching state transition. It deliberately grants
  no human or runtime membership; named/JIT membership and revocation require
  a separately approved DBA change.
- `schema-registry/subjects.v1.json` defines BACKWARD_TRANSITIVE JSON Schema
  subjects and references. The Finance Fund pilot has concrete schemas for
  opened, transaction-recorded, metadata-updated, archived, and compatibility
  reactivated events.
- `scripts/ci/test-event-platform-assets.mjs` checks catalog totality, topic
  safety, connector routing/least privilege, schema structure, and PostgreSQL
  guardrails without network access.

## Activation prerequisites

Activation is blocked until every item below has evidence in one reviewed
change record:

1. A provider-supported Kafka cluster spans at least three failure domains and
   has broker auto-topic creation disabled, TLS in transit, encryption at rest,
   authenticated principals, quotas, and tested backup/DR procedures.
2. Kafka Connect/Debezium runs outside the LeadDrive web host, is pinned to an
   immutable tested image/version, supports the PostgreSQL connector and
   Debezium Outbox EventRouter used by the template, and stores offsets/configs
   in replicated internal topics. Its effective source-producer settings use
   `acks=all` and idempotence; they are verified at worker/provider level rather
   than relying on a connector override that the provider may ignore.
3. A private TLS Schema Registry supports JSON Schema references and
   BACKWARD_TRANSITIVE compatibility. Registry, broker, and Connect endpoints
   are not public. Registry governs contract evolution, but neither it nor the
   Kafka brokers validates the schemaless values emitted by this connector.
4. Provider-generated credentials/certificates exist in the provider secret
   manager. The connector producer can write/describe only
   `ld.<env>.*.events.v1`; application and projection identities get separate
   least-privilege ACLs. No secret is rendered into Git or an operator log.
5. PostgreSQL capacity review covers peak WAL generation, outage duration,
   disk alerts, PITR, and all existing slots/senders. `wal_level=logical` and a
   finite `max_slot_wal_keep_size` are active after a planned restart.
6. The immutable event archive, connector/slot lag alerts, under-replicated
   partition alerts, schema compatibility gate, and on-call ownership are live.
7. A non-production snapshot/replay drill proves per-aggregate ordering,
   duplicate handling, tenant isolation, effect fencing, and event/archive
   watermark reconciliation.

Record the evidence by copying `activation-evidence.template.json` outside the
repository into the approved change workspace. Do not put credentials in that
file: it accepts only secret-manager references. Before any topic, Registry,
connector, replication-slot, or consumer mutation, bind the record to the exact
release and target:

```bash
node scripts/event-platform/activation-preflight.mjs \
  --evidence /secure/change/activation-evidence.json \
  --expected-environment prod \
  --expected-sha "$RELEASE_SHA"
```

Only `{"ready":true,...}` permits the operator to continue. A green preflight
means the reviewed evidence is complete; it does not replace live provider,
PostgreSQL, topic, ACL, or monitoring verification. Any false/missing gate,
self-approval, plaintext credential, target mismatch, mutable Connect image,
or non-logical PostgreSQL state exits non-zero before activation.

Repository/production reconnaissance before these templates were added found
PostgreSQL at `wal_level=replica` and no Kafka, Connect, Registry, or provider
credentials. Therefore application/database migrations may be deployable while
external event delivery remains intentionally inactive. Do not treat the
presence of this directory as proof that Kafka is running.

## Fail-closed activation sequence

Use one environment slug matching `[a-z][a-z0-9]*` (`prod`, `staging`, and so
on). The stricter form also produces a valid PostgreSQL replication-slot name.
Render templates only into an access-controlled temporary workspace and replace
every token; validation must reject any remaining placeholder.

1. Run `node scripts/ci/test-event-platform-assets.mjs` in the exact release
   commit.
2. Expand `topics.v1.json`; have capacity and domain owners approve partition
   counts because Kafka partitions cannot be reduced. Create all 86 topics and
   verify their effective broker configs before granting producer access.
3. Register the base envelope first, then the five pilot subjects and their
   references. Set and verify BACKWARD_TRANSITIVE compatibility per subject.
   A failed compatibility check stops the release.
4. Apply broker/Registry/Connect ACLs. Prove the connector cannot create topics,
   read business topics, or write replay/quarantine/control topics.
5. Take a verified PostgreSQL backup, apply the reviewed parameter-group
   changes, perform the planned restart, and re-run the read-only settings
   preflight. Execute `prepare-cdc.sql` as the database DBA. Set the
   `leaddrive_event_cdc` password separately through the secret manager.
6. Replace `__ENV__`, database host/name, TLS root path, and the provider secret
   reference in the connector template. The production slot becomes
   `leaddrive_event_outbox_prod`. Submit the connector only inside the approved
   activation window; creating it starts the initial snapshot.
7. Prove connector/task state, publication identity, slot activity, zero
   under-replicated/offline partitions, and a test event's database event ID,
   Kafka key, origin payload hash, schema, and archive watermark end to end.
   `payloadHash` is the SHA-256 of PostgreSQL's canonical `jsonb::text`; treat it
   as an opaque origin-integrity value unless a consumer deliberately implements
   that same canonicalization. It is not a checksum of re-serialized Kafka
   value bytes.
8. Keep the release canary-scoped until per-tenant event counts and aggregate
   versions reconcile. Expanding consumers is a separate reviewed change.

External effect workers are a separate activation boundary. Before the first
worker can create an ambiguous outcome, execute
`postgres/prepare-effect-operator.sql` as DBA, grant its capability role only
to the approved named/JIT operator login, and prove the web, worker, CDC,
backup, and migration roles have no membership. The operator must set
`app.org_id`, `SET ROLE leaddrive_effect_operator`, insert one evidence record,
and perform the matching transition in the same transaction. Provider
read-back, ticket/approval reference, evidence hash, `session_user`, and role
membership expiry belong in the incident record.

The connector template intentionally uses structured JSON without automatic
Schema Registry serialization. Before any application Fund append touches its
aggregate head, the runtime Zod gate validates the exact eventType/dataSchema
pair and payload. CI executes live, legacy-bootstrap, and rollback-compatibility
fixtures and keeps the five runtime contracts aligned with the five registered
subjects. Only those contract-validated outbox rows may publish. The connector,
Schema Registry, and Kafka brokers do not perform that record validation;
`dataschema` names the immutable governed contract. This avoids Kafka Connect
silently registering a generic database-row schema in place of the event-type
schema without pretending the transport is an enforcement layer.

## A4 readiness and bounded WAL admission

Current evidence and remaining no-cost gaps are recorded in
[A4 infrastructure readiness](../../docs/event-platform/INFRASTRUCTURE_READINESS.md).
The JSON preflight checks consistency of reviewed claims; it cannot authenticate
receipts, discover hosts or prove that three endpoints occupy independent hosts.
Do not fill its fields from this template or synthetic test fixtures.

The additional evidence fields require measured capacity/placement, effective
RF/minISR, negative ACL tests and Connect placement outside the web host.
`infrastructureEvidenceId` must locate the reviewed broker/controller/host/disk
map, private routing and TLS/ACL receipts. Archive policy remains >=400 days
with an immutable off-provider copy; a paid provider is not implicitly required,
but equivalent verified guarantees cannot be waived to meet a zero-cost target.

The PostgreSQL budget uses positive safe integer bytes/seconds:
`peakWalBytesPerSecond * maxOutageSeconds <= walStopBytes`, and
`walWarningBytes < walStopBytes < maxSlotWalKeepSizeBytes`.
`maxSlotWalKeepSizeBytes + checkpointOvershootBytes <= walDiskBudgetBytes`.
The disk budget must be an allocated residual after baseline WAL, other slots,
application/backup use and the primary free-space reserve. Overshoot is a
measured conservative allowance, not a fixed PostgreSQL guarantee. Record all
slot positions and shared WAL overlap in `walBudgetEvidenceId`; do not multiply
slot caps blindly or infer a peak from cumulative cluster means.

`cdcStopDrillVerified` means a non-production drill of the reviewed emergency
procedure with alert delivery, operator acknowledgement, detection/response time,
continued writes, slot invalidation and recovery-range reconciliation. At the
stop threshold, stop new CDC activation/restarts and escalate to the DBA; pausing
an existing connector alone does **not** release retained WAL and may increase
it. Keep observing slot bytes and free space. Any slot sacrifice or source
write intervention requires a separately authorized incident procedure; never
automate a slot drop, offset reset or replay from this validator. If response
headroom or a tested procedure is absent, activation stays blocked.

## Stop and recovery rules

- To stop delivery, pause/stop the connector first. The application continues
  committing immutable outbox rows; do not roll back business data or delete
  events.
- Preserve the replication slot while a bounded connector recovery is in
  progress. Alert on retained WAL bytes and primary free space. The finite WAL
  cap is a last-resort disk guard, not a recovery plan.
- Never drop/recreate a slot merely to clear lag. If the slot is invalidated or
  must be dropped for primary safety, open an incident and rebuild the missing
  range from `domain_events`/the immutable archive into an incident-scoped
  replay, with hash and watermark evidence.
- A connector rollback changes transport only. Projection recovery uses a new
  versioned shadow projection and consumer group; it does not reset the active
  group or restore the whole multi-tenant database.
- Publication, CDC role, topic, schema, or archive deletion is a separate
  decommission procedure with retention/legal approval. It is never part of a
  routine application rollback.

## Required monitoring

At minimum alert on connector/task failure, restart loops, source-LSN age,
replication-slot retained bytes versus the configured cap, PostgreSQL free
space, outbox-to-Kafka watermark age, consumer lag, offline/under-replicated
partitions, min-ISR violations, rejected schemas, quarantine rate, archive
watermark lag, and per-tenant projection parity. Logs and metric labels must not
contain event payloads or customer PII.

### What the watch covers today (2026-10-23)

`scripts/event-platform/cluster/watch.mjs` runs every 5 minutes on the operator
workstation (`provision.sh install-watch prod`, user timer `ld-kafka-watch`)
and sends to the owner's Telegram through `~/bin/notify-telegram`. Each host
answers through `health-probe.py`, the forced command of the watch key
(`restrict`, no shell, no forwarding, read-only); one broker answers for the
cluster with its own certificate. A problem is told after two passes in a row,
once, with a reminder a day later and a note when it is over; a crash of the
watch itself is told at most every six hours; a Monday note says it is alive.

Covered: replication-slot retained bytes (256 MB warning, 2 GB critical, cap
16 GB; heartbeats keep a healthy slot at a few MB), slot inactive / unreserved / lost / missing, connector and task state,
each Connect worker and registry, controller quorum and each voter, each
broker's last fetch, offline / below-min-ISR / under-replicated partitions,
disk use on every host, WireGuard peers, node certificate expiry.

Not covered yet: consumer lag (no consumer runs), outbox-to-Kafka watermark
age beyond what the slot shows, schemas, quarantine, archive, projections. The
watch shares a failure domain with production (both in Contabo Hub Europe):
when that site is gone entirely, no alert comes until the planned monitoring
host outside it exists.

## Evidence identifiers and credential-reference shape

Evidence/change/operator IDs and endpoints must be canonical nonempty strings:
no surrounding whitespace, control characters or unresolved `__TOKEN__` /
`<placeholder>` markers. A requester padded with spaces is still the same
requester and must not satisfy the distinct-approver guard. The validator rejects
that formatting rather than guessing identity aliases or authenticating humans.
The real independent-operator check remains a reviewed operational requirement.

`secretReferences` must be an object with the four explicit service-role keys
`kafkaConsumer`, `connectProducer`, `schemaRegistry` and `postgresCdc`.
Four arbitrary keys or an array do not establish service separation. Each value
must be a distinct nonempty secret-manager location; a bare `vault://` or other
provider prefix is not a location. Invalid reference formatting is reported by
field label, without echoing the supplied reference. Additional references do
not replace a missing required role. Shape validation does not verify secret
existence, permissions, ownership, rotation or any external provider API.

## Inactive worker admission and client-only candidate

`src/lib/event-platform/worker-admission.ts` validates a strict, copied and
deeply frozen `FundShadowWorkerPlan`. Release SHA, manifest digest, environment,
cluster/topic identity, partition count, stable versioned group and distinct
tenant/build/worker-role routes must agree. Secret values and arbitrary local
credential-file paths are not accepted: the plan contains only opaque,
governed secret references. Parsing those references does not resolve them,
authenticate an operator, inspect live metadata, grant a role or approve
activation. The actual activation/recovery gates above remain mandatory.

`worker-artifact.ts` compares every actual file against an independently
supplied manifest digest and release pin. It rejects unlisted payloads, links,
special files, group/world-writable paths, oversized or changing files and
classpath delimiters in the root. The explicit classpath contains only listed
members; there is no classpath wildcard. Manifest digest equality is byte
verification, not proof that an arbitrary caller-provided digest is trusted.
Production must keep the artifact tree read-only to the worker principal
throughout its lifetime, and verify release provenance separately.

The disposable broker workflow compiles the driver from its exact checked-out
commit and takes client, compression and logging dependencies from the pinned
Kafka image. Broker/Connect/Streams/admin fixture classes are excluded from the
candidate. It exercises the actual supervised Java child (not a Docker CLI
proxy) with the admitted plan and real restricted PostgreSQL transactions:
two-tenant exact parity across restart, stop during COMMIT, stop after COMMIT
before acknowledgement, and durable-inbox redelivery. Existing membership
takeover/fencing tests still run unchanged. The private test broker is resolved
only inside that Java process using JDK21's documented
[`jdk.net.hosts.file` test facility](https://docs.oracle.com/en/java/javase/21/core/java-networking.html);
no system hosts/DNS change or broker host-port publication is performed.

Only after all combined scenarios succeed does the workflow export and
reverify `fund-shadow-worker-candidate-<checkout SHA>`. Its `manifest.json`
contains exact member lengths/hashes and the checkout SHA. The safe job output
records the manifest digest. A PR merge-test candidate is not the later main
release artifact. This is a short-retention CI candidate, not an installed
worker, production service unit, resolved secret configuration, authenticated
operator approval or Kafka activation. The separate full CDC drill, recovery
proof, production HA/TLS/ACL and operational gates must not be inferred from
these direct-child test markers.
