# Inactive Kafka partition bridge

This is a connected-driver building block, **not an installed production
consumer**. No systemd unit, credentials, restart loop, offset initializer or
application startup hook is provided. Normal application deployment does not
activate it. Do not point the disposable fixture at production.

## Pinned implementation and contract

Compile `KafkaPartitionBridge.java` with JDK 21 and the Kafka **4.3.1** client
jars from the digest-pinned test broker in `../test/compose.yml`. The disposable
workflow does this without downloading a second unpinned client dependency.
The Node private-pipe adapter is `src/lib/event-platform/kafka-bridge.ts`; its
processor factory supplies the existing partition coordinator and a callback
that resolves only after the actual bounded database COMMIT. Returned tenant
checkpoints never determine the Kafka offset.

The consumer uses the classic group protocol, dynamic membership and EAGER
RangeAssignor exclusively. Automatic commits, automatic topic creation and
offset reset are disabled. `read_committed` and one visible record per poll
are fixed, with byte-array deserializers and no interceptors. One foreground
thread executes:

`NEXT -> poll -> RECORD -> await database ACK -> commitSync(record offset + 1) -> COMMITTED -> NEXT`

There is no intervening poll, rejoin, seek, manual assignment or offset reset.
A missing group offset, retention gap, compaction, changed topic UUID/count,
malformed pipe, expiry, uncertain acknowledgement or failed database callback
stops the session. Restart is an explicit future service decision and relies
on the already-implemented durable database inbox, not this process's memory.

The public Java client may retry transport/coordinator discovery inside the
same synchronous commit. It does not join a replacement generation inside
that call. Membership snapshot equality is only a local guard: the broker
also fences the original member/generation. After heartbeat reset,
auto-subscription still takes the stable-generation guard and fails before
constructing a commit request; it cannot silently become a manually assigned
generation `-1` client.

Primary source review for this pinned version:

- [Synchronous commit and original-generation request](https://github.com/apache/kafka/blob/4.3.1/clients/src/main/java/org/apache/kafka/clients/consumer/internals/ConsumerCoordinator.java#L1033).
- [Stable generation and heartbeat reset](https://github.com/apache/kafka/blob/4.3.1/clients/src/main/java/org/apache/kafka/clients/consumer/internals/AbstractCoordinator.java#L962).
- [Automatic subscription classification](https://github.com/apache/kafka/blob/4.3.1/clients/src/main/java/org/apache/kafka/clients/consumer/internals/SubscriptionState.java#L466).
- [Consumer configuration](https://kafka.apache.org/43/configuration/consumer-configs/).

## Private protocol and resource boundaries

The channel is private stdin/stdout, **never application logs**. Event keys,
values and headers are base64, not encryption. Do not print the channel,
configuration, stderr or exceptions carrying event data/credentials. The
adapter exports only fixed sanitized failures. The Java launcher must disable
library console logging and supply a bounded stderr policy.

Frames are tab-separated ASCII: READY, ASSIGN, REVOKE, RECORD, IDLE and
COMMITTED. Input commands are NEXT and ACK (lease ID, exact decimal next
offset). Offset INT64s stay decimal strings/BigInt; no Number conversion.
Assignments are immutable and unique per partition; revoked/unknown leases
cannot acknowledge. Duplicate headers remain duplicates, never overwritten.
Records are at most 1 MiB, 32 headers, names at most 128 UTF-8 bytes; wire
frames and pending pipe buffers are bounded. No null-header normalization.

The logical cursor is the previous acknowledged record offset + 1, not the
client's cached fetch position/high-water mark. Transaction control records
and aborted transactions legitimately produce holes. All visible records
must be passed to the processor; no tenant/event filtering before it.

The consumer's fetch byte settings are soft limits for large first batches.
A future runtime must additionally cap JVM/process memory and CPU and bound
database work. The test JVM uses 96 MiB heap in the already-memory-capped
disposable broker container. The private channel has a 35-second I/O deadline,
the command reader 60 seconds, client APIs 10 seconds and max poll interval
30 seconds; expiration terminates processing rather than silently skipping.
Fixture processes have an independent container timeout and are reaped before
reusing their groups. These canary defaults are not a production sizing SLA.

## Proof and limits

`event-platform-broker.yml` runs only on GitHub's pinned Linux image. It uses
the existing isolated, digest-pinned, no-host-port Compose stack and shared
integration queue. Fixture topic/group names and the `kafka:9092` address are
hard restricted to the disposable network. Its administrator seeds synthetic
offsets and expires/recreates only exact synthetic test topics; the driver
itself never does so.

The test covers ordered A/B/A tenants, restart, exact acknowledgement,
database-callback failure, lost pre-send ACK and post-commit receipt,
transaction holes, missing offsets, compaction, expired history, topic
recreation (including during database work), expired group membership and
concurrent takeover with the new owner held until the old ACK is rejected.
The durable database effects are **simulated in this broker fixture**. The
separate restricted-role PostgreSQL gate proves actual inbox/projection
transactions. A subsequent **combined** phase in the same disposable broker
job runs `scripts/event-platform/test-broker-postgres.ts`: actual outbox bytes,
Kafka, private IPC, the Fund worker and restricted PostgreSQL COMMIT together.
Its receipt is distinct from the simulated broker fixture's13 markers; require
`broker_postgres_integration=PASS` on the exact reviewed source revision before
claiming the combined consumer boundary. Neither phase is a production restore.

The combined phase reuses the actual three database migrations and the same
per-login tenant/build RLS and column grants as the existing SQL gate. A separate
digest-pinned ephemeral PostgreSQL service exposes only the runner's synthetic
test connection; it does not publish Kafka/Connect/Registry or change their
private Compose topology. No production secret, source connection or live data
is available. Connections are capped to one per client, closed per scenario,
and only confirmed fixture-created databases/roles can be cleaned up.

The six combined scenarios assert exact A/B/A reconstruction and unchanged
source/active/pointers/effects; no ACK before real COMMIT; real deferred COMMIT
rejection with full rollback; pre-send ACK loss with durable inbox replay;
post-commit receipt loss with broker-cursor restart; and concurrent takeover
with a real committed duplicate while the old member's ACK is fenced. The
takeover hold is **after** the actual SQL transaction, never an extension of
its15-second timeout. Fixture administration seeds only new synthetic groups
at their scenario's first published offset and rejects reinitialization.

Outbox publication in this combined test is an exact-byte fixture producer,
not Debezium. The separate CDC smoke remains required. Full CDC-to-rebuild
composition, production topology/TLS/ACLs, HA, durable lifecycle governance and
the independent recovery ceremony are not certified by either CI phase.

A timeout does not mean the broker certainly did not commit: a response may
be lost after commit. Database COMMIT must precede ACK in every case; stop on
uncertainty, and restart from the broker position with inbox deduplication.
Exactly-once email/payments are not provided by a Kafka offset transaction.

Topic identity/configuration and range are rechecked before/after poll and
before commit. Classic OffsetCommit is name-based, so the checks are **not an
atomic topic-UUID fence**. Production must forbid delete/recreate and unsafe
configuration changes using ACLs/governed maintenance. A valid current cursor
does not prove a complete historical baseline/archive is still available.
That independent recovery admission remains required before activation.

## Remaining activation gates

Do not start production consumers until all are separately proved: protected
broker/Connect/registry deployment and credentials, governed retention and
full-history baseline, combined actual-broker/database failure drill, durable
lease/checkpoint governance and graceful shutdown, decryptable independently
verified offsite recovery, monitoring/alerts, nominated human's actual
recovery approval and the specifically authorized canary activation window.
No offset reset, production replay, source WAL/slot change, read-path cutover
or all-module readiness follows from merging this inactive driver.
