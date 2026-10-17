# Disposable event-platform test stack

Status: **K1.2 fixture preparation — infrastructure smoke only.**
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
