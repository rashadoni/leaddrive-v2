# Disposable event-platform test stack

Status: **K1 infrastructure smoke passed in run39072900806; K2 synthetic CDC
drill prepared, integration receipt pending.** Neither is production activation.
Current progress and production authorization boundaries remain in the
[Kafka session journal](../../../docs/kafka-readiness-session-log.md).

This stack is for synthetic-data tests on a disposable GitHub Linux runner.
Do not start it on the persistent Contabo development/inspection host or the
production host. The repository-owned
[test harness](../../../scripts/event-platform/test-stack.sh) requires the
explicit disposable-job markers and an isolated Compose project name. Its
cleanup removes only that run's containers, network and image-created anonymous
volumes. It refuses a project that already has containers.

## Components and isolation

| Service | Pinned version | Memory ceiling | Test role |
|---|---|---|---|
| `postgres` | PostgreSQL 16.13 Alpine | 384 MiB | Empty `event_platform_test`, synthetic `event_test` login, logical WAL |
| `kafka` | Apache Kafka 4.3.1 | 1,024 MiB | One combined KRaft broker/controller, `kafka:9092` inside the test network |
| `connect` | Debezium Connect 3.7.0.Final | 1,024 MiB | PostgreSQL connector plugin and distributed worker |
| `registry` | Apicurio Registry 3.3.0 | 512 MiB | SQL/H2 **in-memory** registry; restart loses registered artifacts |

All four Linux/amd64 images are pinned by manifest digest in
[`compose.yml`](./compose.yml). Container memory ceilings total 2,944 MiB;
the harness requires at least 4 GiB of available runner memory for additional
tooling and Docker overhead. Swap growth is disabled per service and logs rotate.
This is a small synthetic fixture, not a performance sizing claim.

### Debezium pin refresh — 2026-10-18

The previously tested Connect digest `e37dee587fc65dcaed9467c07f6370fb33a421793c5dcad84392792298bd0da0`
became unavailable: actual CDC run39085527336 and a separate public registry
GET returned `MANIFEST_UNKNOWN`/404 before Connect started. No CDC assertion
failed and the test cleanup succeeded. Repeating that missing digest is not
a fix, and removing the digest or falling back to an unreviewed tag is forbidden.

The same official `3.7.0.Final` tag now indexes Linux/amd64 manifest
`d76ab3d1d412e9aa38fa8532ac01d99d36b87355a21ee99fbe6f847c168be924`
(index `c804b88d97b74e0834b45f35f33210051159078b31e295d5daeceab36ab7d908`).
The public manifest and config bytes were SHA-256 checked; config
`7172c82542f0c932b1fdf92a9e858cd475676b04ce0c47767a1a810b9201d7ea`
identifies Linux/amd64, `/docker-entrypoint.sh`, `DEBEZIUM_VERSION=3.7.0.Final`
and `KAFKA_VERSION=4.3.1`. The pin remains immutable and platform-specific.
Runtime admission now also requires exactly one PostgreSQL **source** plugin
reporting version `3.7.0.Final`; a versionless, different or ambiguous plugin
fails closed. The refreshed image still needs an actual new-head CDC receipt.

A digest proves content identity, not permanent upstream availability or
publisher signatures. Production image retention/mirroring and provenance
remain separate K1.2 prerequisites; this disposable pin refresh does not close
them or change production services.

The Compose network is internal. No service mounts host paths, production
configuration, Docker sockets or credentials. PostgreSQL and Kafka have no host
port. Connect and Registry also publish **no host ports**. HTTP probes execute
inside the existing Connect container over the same isolated network. This
avoids relying on host port mappings that internal-only bridges can suppress;
it does not add an externally routable network or relax isolation.
Their interfaces have no production authentication/TLS setup and must not be
published beyond that runner. Passwords in this fixture are public synthetic
values and must never be reused for real data.

No service automatically restarts. PostgreSQL and Kafka image-created anonymous
volumes exist only for the isolated run and are removed by the harness's final
`down --volumes`; they are not a backup or durable archive.

## Required startup order

Use the harness, not an unqualified `docker compose up`:

1. Start `postgres` and `kafka` and wait for both to answer readiness probes.
2. Explicitly create these compacted Kafka Connect internal topics, each with
   one partition and replication factor 1:
   `ld.test.connect.config`, `ld.test.connect.offset`, `ld.test.connect.status`.
   Explicitly create the synthetic `ld.test.finance.events.v1` topic as well.
3. Start `connect` and `registry`. Connect also waits for broker/database
   health, but Compose dependencies do **not** create or prove the internal
   topics; precreation is the harness's responsibility.
4. Probe Connect's `/connectors` and `/connector-plugins` endpoints, and
   Registry's `/apis/registry/v3/system/info`. Produce/consume a synthetic Kafka
   key/value using the broker's bundled CLI.
5. Capture the bounded smoke result and always clean up the isolated project.

Broker auto-topic creation and Connect business-topic creation are disabled.
The worker is configured with `acks=all` and producer idempotence. These settings
do not make replication factor 1 highly available and do not make external
effects exactly once.

## What this stage proves, and what remains

The first smoke is limited to container startup, logical WAL setting, explicit
topic creation, PostgreSQL connector availability, Registry HTTP availability,
and Kafka key/value round-trip. It does not create a Debezium connector, apply
the application migrations, register the Fund schemas, run a tenant worker,
rebuild a projection or connect to production.

Next integration tasks are a synthetic schema/Fund fixture, a restricted CDC
role, actual Outbox EventRouter snapshot/change delivery, schema registration
and compatibility tests, and the shadow-only consumer/crash/rebuild drills from
the [write-path inventory](../../../docs/event-platform/WRITE_PATH_INVENTORY.md).
The generic Fund activation pointer is not yet connected to the Fund API read
path; the first consumer must leave the synchronous v1 projection active.

The test PostgreSQL WAL cap is deliberately 64 MiB for a short synthetic run.
The production [CDC preparation script](../postgres/prepare-cdc.sql) requires
a separately sized cap of at least 4 GiB and will reject this fixture setting.
A later CDC drill must explicitly define its test configuration without
modifying the production preflight or pretending this small cap is sufficient
for production outages.

## Synthetic CDC drill (K2)

The separate `event-platform-cdc.yml` job enables the CI-only CDC extension of
the same harness. Its global disposable-integration concurrency group is shared
with the infrastructure smoke, so two JVM stacks do not run simultaneously.
No production environment, secret, SSH alias or endpoint is used.

The drill starts from an empty `event_platform_test` database. A small fixture
creates only organization/Fund ownership anchors and distinct non-superuser
application/migration logins. It then applies the **complete, unchanged** real
foundation migration. The Fund anchor is not the application Fund model or an
adopted business command. Real RLS, grants, hashes and deferred head/event/outbox
coherence triggers remain enabled; the fixture does not reimplement them.

The unchanged CDC preparation must first reject the base 64 MiB WAL ceiling
without creating its role. Only then does the explicit
[`cdc.compose.yml`](./cdc.compose.yml) test override recreate this run's PG
container with a finite 4096 MiB ceiling and its existing anonymous volume.
This is not preallocated WAL space or a production sizing result. Preparation
runs twice to check its repeatability. Read-only catalog assertions verify
role attributes/memberships, current effective table/column/sequence grants,
FORCE RLS, the named cross-tenant SELECT policy and the exact unfiltered
INSERT-only outbox publication. Actual TCP authentication and denied SQL
operations distinguish permissions from connection/syntax failures.

Two organizations share an aggregate ID but have distinct tenant-qualified
keys. Snapshot inserts are physically v2-before-v1 with reverse-sorted UUIDs;
the connector's actual snapshot query must deliver semantic version order.
Outbox `createdAt` differs from event time and also reverses version order,
so the timestamp assertion cannot accidentally validate the wrong time field.
The raw candidate additionally streams v3, stops Connect, commits v4 while it
is down and starts the same worker again. Config/offset/status topics, connector
name, source database and logical slot are retained. No offset reset, topic
deletion or client-data replay is used. Source SQL rows provide expected event
IDs, envelope JSON, PG-computed payload hashes and timestamps. The strict
verifier rejects incomplete IDs, altered scalar headers/key/time, JSON loss,
key partition changes and out-of-order first-seen versions. Identical duplicate
deliveries at new offsets are permitted, not counted as new business events.

The A/B test uses separate `ld.testexpanded.transport.events.v1` and
`ld.testraw.transport.events.v1` topics. `expanded` is an explicit legacy
JsonConverter/JSON-expansion diagnostic; `raw` uses the corrected production
template's unexpanded JSON text plus StringConverter. Unicode, null/false/zero,
nested objects and empty arrays exercise serializer fidelity. The detected
legacy payload defect is reported separately from metadata and the corrected
template's strict pass. The test never changes a template at runtime; the
serializer correction is a reviewed source change backed by A/B evidence.

Successful cleanup deletes only the known test connector and its validated,
inactive `pgoutput` slot in `event_platform_test`; outer teardown always removes
only this run's project and disposable volume. On failure there is no host-DB
or production fallback.

Limits remain explicit: this does not prove concurrent-snapshot writes,
business/Fund writers or projections, schema compatibility, crash-at-commit
exactly-once behavior, production TLS/auth/HA, archive/DR, or safe side effects.
App SQL trusts the selected `app.org_id` context; the application credential
can change that context. A REPLICATION credential is not an outbox-only
compromise boundary. The ordinary SQL privilege assertions cover the current
fixture, not arbitrary future PUBLIC/default grants or a compromised DBA.
The distinction follows PostgreSQL's
[logical replication security model](https://www.postgresql.org/docs/16/logical-replication-security.html);
the actual pinned fixture run remains the evidence for these test results.

Replication factor 1, one fault domain, plaintext test traffic, ephemeral H2,
and the absence of archive/DR evidence mean this stack **cannot** satisfy the
[production activation gates](../README.md). The production topic catalogue,
activation evidence and preflight are unchanged. Runtime smoke status belongs
to the actual GitHub run receipt; this document alone is not a passing result.

## Primary configuration references

- [Apache Kafka 4.3.1 container configuration](https://github.com/apache/kafka/blob/4.3.1/docker/resources/common-scripts/configure)
  and [image definition](https://github.com/apache/kafka/blob/4.3.1/docker/jvm/Dockerfile).
- [Debezium 3.7 Connect entrypoint](https://github.com/debezium/container-images/blob/main/connect-base/3.7/docker-entrypoint.sh)
  documents the short worker variables and `CONNECT_` property mapping used
  here. The pinned image, not the moving source branch, is the runtime target.
- [Apicurio Registry 3.3.0 configuration](https://github.com/Apicurio/apicurio-registry/blob/3.3.0/app/src/main/resources/application.properties)
  uses `sql` with H2 for in-memory storage; the old Registry 2.x `mem` image
  configuration is not used.
- [Official PostgreSQL container](https://hub.docker.com/_/postgres) documents
  initialization variables, data-volume behavior and server arguments.
