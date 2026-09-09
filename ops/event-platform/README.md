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
