/** Synthetic Fund drill on the REAL primary cluster: canonical SQL -> Debezium
 * on the production Connect cluster -> real brokers over SASL_SSL with ACLs ->
 * restricted Fund SQL. Same scenario and assertions as the CI full-cdc-fund
 * proof (scripts/event-platform/test-cdc-fund-postgres.ts), with these
 * differences forced by shared infrastructure:
 *   - the source is the disposable ld-drill-pg on kafka-p-connect-eu, reached
 *     through ssh (psql in its container, Prisma through an ssh tunnel);
 *   - "cold restart" stops/resumes only this drill connector, never a Connect
 *     worker (the production connector runs on the same workers);
 *   - the bridge runs on kafka-p-connect-eu in a throw-away container with the
 *     ld-drill-worker SCRAM identity, TLS 1.3 and hostname verification;
 *   - group cursors and offsets are read/seeded with the admin mTLS identity.
 * Prerequisite: scripts/event-platform/cluster/fund-drill.sh up. Afterwards: down.
 * Operator workstation only, LD_KAFKA_FUND_DRILL=1. Never a production launcher.
 */
import assert from "node:assert/strict"
import { execFileSync, spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process"
import { appendFileSync, readFileSync } from "node:fs"
import { createConnection, createServer } from "node:net"
import { homedir } from "node:os"
import { resolve } from "node:path"
import type { KafkaEventRecord } from "../../../src/lib/event-platform/consumer"
import { startKafkaWorkerSession } from "../../../src/lib/event-platform/worker-session"
import { createFundShadowPartitionWorker } from "../../../src/lib/event-platform/fund-shadow-worker"
import { createFundShadowPostgresFixture, fundShadowDatabase, type FundShadowContext } from "../../../src/__tests__/fixtures/fund-shadow-postgres"
import { createBrokerFixtureChannel } from "../fixtures/kafka-broker-harness"
import { assertFullCdcHeaders, FULL_CDC_CONNECTOR, FULL_CDC_SLOT, FULL_CDC_TOPIC,
  renderFullCdcBoundary, renderFullCdcConnector } from "../fixtures/cdc-fund-contract.mjs"

const root = resolve(process.cwd())
const state = process.env.LD_KAFKA_STATE ?? resolve(homedir(), ".leaddrive-kafka")
const HOST = "kafka-p-connect-eu", OVERLAY = "10.88.0.16", PG_PORT = 55432
const BROKERS = ["10.88.0.10", "10.88.0.11", "10.88.0.12"].map(ip => `${ip}:9092`).join(",")
const inventory = JSON.parse(readFileSync(resolve(state, "inventory.json"), "utf8"))
const CLUSTER_ID: string = inventory.clusters.primary.clusterId
const hostIp: string = inventory.hosts[HOST].publicAddress
const sshArgs = ["-i", process.env.LD_KAFKA_SSH_KEY ?? resolve(homedir(), ".ssh/leaddrive_kafka_ops"), "-o", "IdentitiesOnly=yes",
  "-o", "ControlMaster=no", "-o", "ControlPath=none", "-o", `UserKnownHostsFile=${resolve(state, "known_hosts")}`,
  "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=15", "-o", "BatchMode=yes", "-o", "ServerAliveInterval=15"]
const pause = (ms: number) => new Promise<void>(done => setTimeout(done, ms))

function run(binary: string, args: string[], options: { input?: string; allowFailure?: boolean; timeout?: number } = {}) {
  const result = spawnSync(binary, args, { cwd: root, encoding: "utf8", input: options.input,
    timeout: options.timeout ?? 60_000, maxBuffer: 4 * 1024 * 1024 })
  if (result.error || (!options.allowFailure && result.status !== 0)) {
    throw new Error(`drill command failed: ${binary} ${args[0] ?? ""} (${result.status}) ${String(result.stderr ?? "").trim().split("\n").slice(-2).join(" | ")}`)
  }
  return result
}
function remote(command: string, options?: Parameters<typeof run>[2]) { return run("ssh", [...sshArgs, `root@${hostIp}`, command], options) }
function admin(tool: string, args: string[]) {
  return run("bash", ["scripts/event-platform/cluster/provision.sh", "admin", "kafka-p-broker-eu", tool, ...args], { timeout: 120_000 }).stdout
}
function dba(database: string, sql: string, allowFailure = false) {
  assert.ok(database === "event_platform_test" || /^ld_fund_shadow_[1-9][0-9]*_[0-9a-f]{12}$/.test(database))
  return remote(`docker exec -i ld-drill-pg psql -U event_test -p ${PG_PORT} -d ${database} -X -qAt -v ON_ERROR_STOP=1 -v VERBOSITY=verbose`,
    { input: sql, allowFailure })
}
const connectorPaths = new Set(["/connectors", `/connectors/${FULL_CDC_CONNECTOR}`, `/connectors/${FULL_CDC_CONNECTOR}/status`,
  `/connectors/${FULL_CDC_CONNECTOR}/stop`, `/connectors/${FULL_CDC_CONNECTOR}/resume`, `/connectors/${FULL_CDC_CONNECTOR}/offsets`,
  "/connectors/leaddrive-event-outbox-prod/status"])
function connect(path: string, method = "GET", body?: unknown, allowFailure = false) {
  assert.ok(connectorPaths.has(path))
  return remote(`curl --fail --silent --show-error --max-time 10 -X ${method}${body ? " -H 'Content-Type: application/json' --data-binary @-" : ""} http://${OVERLAY}:8083${path}`,
    { input: body ? JSON.stringify(body) : undefined, allowFailure })
}
async function waitFor(check: () => boolean, name: string, attempts = 60, intervalMs = 1000) {
  for (let i = 0; i < attempts; i++) { if (check()) return; await pause(intervalMs) }
  throw new Error(`drill ${name} deadline`)
}
function connectorState() {
  const result = connect(`/connectors/${FULL_CDC_CONNECTOR}/status`, "GET", undefined, true)
  if (result.status !== 0) return undefined
  const status = JSON.parse(result.stdout)
  assert.notEqual(status.connector?.state, "FAILED", "drill connector FAILED")
  assert.ok(!status.tasks?.some((task: { state: string }) => task.state === "FAILED"), "drill connector task FAILED")
  return status as { connector: { state: string }; tasks: Array<{ state: string }> }
}
async function waitConnector(expected: "RUNNING" | "STOPPED") {
  await waitFor(() => {
    const status = connectorState()
    if (!status) return false
    return expected === "RUNNING" ? status.connector.state === "RUNNING" && status.tasks.length === 1 && status.tasks[0].state === "RUNNING"
      : status.connector.state === "STOPPED"
  }, `connector ${expected}`, 90)
}
function prodConnector() {
  const status = JSON.parse(connect("/connectors/leaddrive-event-outbox-prod/status").stdout)
  return `${status.connector.state}/${status.tasks.map((task: { state: string }) => task.state).join(",")}`
}

/** Admin-side replacements for the disposable KafkaBridgeFixture. */
function endOffset() {
  return admin("kafka-get-offsets.sh", ["--topic", FULL_CDC_TOPIC, "--time", "-1"]).trim()
}
function groupOffset(group: string) {
  const out = admin("kafka-consumer-groups.sh", ["--describe", "--group", group])
  const row = out.split("\n").map(line => line.trim().split(/\s+/)).find(cols => cols[1] === FULL_CDC_TOPIC && cols[2] === "0")
  return !row || row[3] === "-" ? "NONE" : row[3]
}
function seedGroup(group: string, offset: string) {
  assert.match(offset, /^(0|[1-9][0-9]*)$/)
  assert.equal(groupOffset(group), "NONE", "a drill group cursor is seeded once, never reset")
  admin("kafka-consumer-groups.sh", ["--group", group, "--topic", `${FULL_CDC_TOPIC}:0`, "--reset-offsets", "--to-offset", offset, "--execute"])
  assert.equal(groupOffset(group), offset)
}
function topicId() {
  const match = /TopicId:\s*(\S+)/.exec(admin("kafka-topics.sh", ["--describe", "--topic", FULL_CDC_TOPIC]))
  assert.ok(match); return match[1]
}

function createRemoteHarness(topicIdValue: string) {
  const image = remote(`docker inspect -f '{{.Config.Image}}' ${HOST}-connect`).stdout.trim()
  assert.match(image, /^ghcr\.io\/rashadoni\/debezium-connect:[^@\s]+@sha256:[0-9a-f]{64}$/)
  const password = readFileSync(resolve(state, "secrets/drill-ld-drill-worker"), "utf8").trim()
  assert.match(password, /^[0-9a-f]{48}$/)
  const configurations = new Map<string, { cluster: string; topicId: string; topic: string; group: string }>()
  const children = new Set<ChildProcessWithoutNullStreams>()
  let counter = 0
  function configure(name: string, group: string) {
    assert.match(name, /^[a-z0-9][a-z0-9-]{0,60}$/); assert.ok(!configurations.has(name))
    const config = { cluster: CLUSTER_ID, topicId: topicIdValue, topic: FULL_CDC_TOPIC, group }
    configurations.set(name, config)
    const properties = [`expected.cluster.id=${config.cluster}`, `expected.topic.id=${config.topicId}`, "expected.partitions=1",
      `bootstrap.servers=${BROKERS}`, "security.protocol=SASL_SSL", "sasl.mechanism=SCRAM-SHA-512",
      `sasl.jaas.config=org.apache.kafka.common.security.scram.ScramLoginModule required username="ld-drill-worker" password="${password}";`,
      "ssl.truststore.type=PEM", "ssl.truststore.location=/drill-ca.pem", `group.id=${group}`, `topic=${config.topic}`, ""].join("\n")
    remote(`install -m 0600 /dev/stdin /opt/ld-drill/${name}.properties`, { input: properties })
  }
  async function terminate(child: ChildProcessWithoutNullStreams, container: string) {
    if (child.exitCode === null && child.signalCode === null) {
      child.stdin.end()
      await new Promise<void>(done => {
        const timer = setTimeout(() => { child.kill("SIGKILL"); done() }, 100_000)
        child.once("exit", () => { clearTimeout(timer); done() })
      })
    }
    remote(`docker rm -f ${container} >/dev/null 2>&1 || true`, { allowFailure: true })
    children.delete(child)
  }
  function driver(name: string, timeoutMs = 60_000) {
    assert.ok(configurations.has(name))
    const container = `ld-drill-bridge-${name}-${++counter}`
    const command = `docker run -i --rm --user 0 --name ${container} --network host --memory 256m --pids-limit 128 `
      + `-v /opt/ld-drill:/drill:ro -v /etc/leaddrive-kafka/tls/ca.pem:/drill-ca.pem:ro --entrypoint java '${image}' `
      // No coreutils timeout wrapper: it swallows the bridge's stdout here.
      // The deadline is ours: channel timeout, then docker rm -f by name.
      + `-Xms16m -Xmx96m -XX:ActiveProcessorCount=1 -Dlog4j2.configurationFile=/drill/log4j2.properties `
      + `-cp '/kafka/libs/*:/drill/classes' KafkaPartitionBridge /drill/${name}.properties`
    const child = spawn("ssh", ["-T", ...sshArgs, `root@${hostIp}`, command], { cwd: root, stdio: ["pipe", "pipe", "pipe"] })
    children.add(child)
    child.on("error", () => { child.stdout.destroy(); child.stdin.destroy() })
    if (process.env.LD_KAFKA_FUND_DRILL_DEBUG) {
      const log = (tag: string) => (data: Buffer) => appendFileSync(process.env.LD_KAFKA_FUND_DRILL_DEBUG!,
        data.toString("utf8").split("\n").filter(Boolean).map(line => `${container} ${tag} ${line.split("\t").slice(0, 2).join(" ").slice(0, 160)}\n`).join(""))
      child.stderr.on("data", log("stderr")); child.stdout.on("data", log("stdout"))
    } else child.stderr.resume()
    return { channel: createBrokerFixtureChannel({ stdout: child.stdout, stdin: child.stdin, terminate: () => terminate(child, container), timeoutMs }) }
  }
  async function close() {
    await Promise.allSettled([...children].map(child => terminate(child, "ld-drill-bridge-unknown")))
    remote("docker rm -f $(docker ps -aq --filter name=ld-drill-bridge) >/dev/null 2>&1 || true", { allowFailure: true })
  }
  return { configure, driver, close, configurations }
}

async function openTunnel() {
  // A local port only; the far end is the drill PostgreSQL on the overlay.
  const port = await new Promise<number>((done, fail) => {
    const probe = createServer(); probe.once("error", fail)
    probe.listen(0, "127.0.0.1", () => { const address = probe.address(); probe.close(() => done(typeof address === "object" && address ? address.port : 0)) })
  })
  const child = spawn("ssh", ["-N", "-o", "ExitOnForwardFailure=yes", ...sshArgs, "-L", `127.0.0.1:${port}:${OVERLAY}:${PG_PORT}`, `root@${hostIp}`],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] })
  child.stderr.resume()
  for (let i = 0; ; i++) {
    const open = await new Promise<boolean>(done => {
      const socket = createConnection({ host: "127.0.0.1", port }, () => { socket.destroy(); done(true) })
      socket.on("error", () => { socket.destroy(); done(false) })
    })
    if (open) break
    if (i >= 40) throw new Error("drill tunnel deadline")
    await pause(500)
  }
  return { child, url: `postgresql://postgres:postgres@127.0.0.1:${port}/event_platform_test` }
}

async function main() {
  assert.equal(process.env.LD_KAFKA_FUND_DRILL, "1", "explicit operator drill opt-in required")
  const codeSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", timeout: 5000 }).trim()
  assert.match(codeSha, /^[0-9a-f]{40}$/)
  const prodBefore = prodConnector()
  assert.equal(prodBefore, "RUNNING/RUNNING", "production connector must be healthy before the drill")
  assert.equal(connect(`/connectors/${FULL_CDC_CONNECTOR}`, "GET", undefined, true).status === 0, false, "drill connector must not pre-exist")
  assert.equal(endOffset(), `${FULL_CDC_TOPIC}:0:0`, "drill topic must be fresh and empty")
  await waitFor(() => {
    const result = dba("event_platform_test", "SHOW max_slot_wal_keep_size;", true)
    return result.status === 0 && result.stdout.trim() === "4GB"
  }, "finite WAL")
  dba("event_platform_test", `DO $$ BEGIN
    IF current_database() <> 'event_platform_test' OR current_user <> 'event_test'
      OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=current_user AND rolsuper)
      OR current_setting('server_version_num')::int < 160000 OR current_setting('server_version_num')::int >= 170000
      OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('postgres','event_app','event_migrator'))
      OR to_regclass('public.event_outbox') IS NOT NULL THEN
      RAISE EXCEPTION 'drill requires a fresh exact disposable PostgreSQL';
    END IF;
  END $$;
  CREATE ROLE postgres LOGIN SUPERUSER PASSWORD 'postgres';
  CREATE ROLE event_app LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD 'event-app-password';
  CREATE ROLE event_migrator LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS PASSWORD 'event-migrator-password';
  GRANT event_app TO event_migrator;`)
  const tunnel = await openTunnel()
  const db = createFundShadowPostgresFixture({ adminUrl: tunnel.url, environment: "testbroker", sourceAppWrites: true, codeSha })
  let harness: ReturnType<typeof createRemoteHarness> | undefined
  let connectorCreated = false, phase = "setup"
  const sessions: Array<ReturnType<typeof startKafkaWorkerSession>> = []
  const prodSeen = new Set<string>([prodBefore])
  try {
    await db.setup()
    const database = db.databaseName
    harness = createRemoteHarness(topicId())
    seedGroup("ld-testbroker-finance", "0")
    harness.configure("finance", "ld-testbroker-finance")
    const a = await db.fixture()
    dba(database, readFileSync("ops/event-platform/postgres/prepare-cdc.sql", "utf8"))
    dba(database, "ALTER ROLE leaddrive_event_cdc PASSWORD 'synthetic-cdc-only';")
    dba(database, renderFullCdcBoundary(readFileSync("ops/event-platform/test/assert-cdc-boundary.sql", "utf8"), database))
    const template = JSON.parse(readFileSync("ops/event-platform/debezium/event-outbox-connector.template.json", "utf8"))
    const connector = renderFullCdcConnector(template, database)
    // Same reviewed test serializer; only the network location differs. The
    // source hop rides the WireGuard overlay; Kafka-side TLS is the subject here.
    Object.assign(connector.config, { "database.hostname": OVERLAY, "database.port": String(PG_PORT) })
    connect("/connectors", "POST", connector); connectorCreated = true
    await waitConnector("RUNNING")
    phase = "snapshot"
    await waitFor(() => endOffset() === `${FULL_CDC_TOPIC}:0:6`, "six snapshot records", 30, 2000)
    const slotEvidence = () => dba(database, `SELECT slot_name || ':' || slot_type || ':' || plugin || ':' || database || ':' ||
      (confirmed_flush_lsn IS NOT NULL)::text FROM pg_replication_slots WHERE slot_name='${FULL_CDC_SLOT}';`).stdout.trim()
    await waitFor(() => slotEvidence() === `${FULL_CDC_SLOT}:logical:pgoutput:${database}:true`, "snapshot slot acknowledgement")
    const slotBefore = slotEvidence()
    connect(`/connectors/${FULL_CDC_CONNECTOR}/stop`, "PUT"); await waitConnector("STOPPED")
    prodSeen.add(prodConnector())
    phase = "offline-source-write"
    const b = await db.fixture() // Actual source-role transactions while the drill connector is stopped.
    assert.equal(endOffset(), `${FULL_CDC_TOPIC}:0:6`)
    connect(`/connectors/${FULL_CDC_CONNECTOR}/resume`, "PUT"); await waitConnector("RUNNING")
    phase = "stop-resume-stream"
    await waitFor(() => endOffset() === `${FULL_CDC_TOPIC}:0:12`, "six streamed records after resume", 30, 2000)
    assert.equal(slotEvidence(), slotBefore, "resume retains the exact acknowledged slot and database")
    connect(`/connectors/${FULL_CDC_CONNECTOR}/stop`, "PUT"); await waitConnector("STOPPED")
    prodSeen.add(prodConnector())
    const other = await db.fixture(), contexts = [a, b]
    assert.ok([...contexts, other].every(context => context.scope.codeSha === codeSha))
    const snapshot = async () => ({
      sources: await Promise.all([a, b, other].map(context => db.snapshotSource(context.scope.organizationId))),
      effects: await db.scratch.$queryRawUnsafe(`SELECT jsonb_build_object(
        'effects', (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM effect_outbox x),
        'attempts', (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM effect_attempts x),
        'reconciliations', (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM effect_reconciliations x)) AS effects`),
      other: await db.scratch.$queryRawUnsafe(`SELECT jsonb_build_object(
        'builds', (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM projection_builds x WHERE "organizationId"=$1),
        'projections', (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM fund_balance_projections x WHERE "organizationId"=$1),
        'inbox', (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM consumer_inbox x WHERE "organizationId"=$1),
        'checkpoints', (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM projection_checkpoints x WHERE "organizationId"=$1)) AS other`, other.scope.organizationId),
    })
    const before = await snapshot()
    const expected = new Map(contexts.flatMap(context => context.records).map(record => [String(record.headers!.id), record]))
    const observed: KafkaEventRecord[] = []
    const sourceRuns = new Map<string, string>()
    let ackLossInjected = false
    function start(count: number, loseAck = false, options: {
      contexts?: FundShadowContext[]; groupName?: string; observed?: KafkaEventRecord[]
    } = {}) {
      const groupName = options.groupName ?? "finance"
      const { channel } = harness!.driver(groupName)
      const config = harness!.configurations.get(groupName)!
      const session = startKafkaWorkerSession({ clusterId: config.cluster, groupId: config.group, topic: config.topic,
        maxRecords: count, maxDurationMs: 120_000,
        open() {
          const clients = (options.contexts ?? contexts).map(context => ({ ...context, client: db.connect(context) }))
          return { channel: { ...channel, async read() {
            phase = "bridge-frame-read"
            const frame = await channel.read()
            for (const kind of ["READY", "ASSIGN", "RECORD", "REVOKE", "COMMITTED", "FAIL", "IDLE"]) {
              if (frame === kind || frame.startsWith(`${kind}\t`)) phase = `bridge-frame-${kind.toLowerCase()}`
            }
            return frame
          }, async write(command: string) {
            if (loseAck && command.startsWith("ACK\t")) {
              phase = "post-commit-ack-loss-injected"
              ackLossInjected = true
              await channel.close(); throw new Error("synthetic post-COMMIT ACK loss")
            }
            await channel.write(command)
          } },
          async release() { await Promise.all(clients.map(context => context.client.$disconnect())) },
          createProcessor(assignment, broker) {
            const worker = createFundShadowPartitionWorker({ assignment, broker, environment: "testbroker",
              routes: clients.map(context => ({ scope: context.scope, database: fundShadowDatabase(context.client) })) })
            return { revoke: () => worker.revoke(), async processBatch(batch: { fetchOffset: string; records: KafkaEventRecord[] }) {
              for (const record of batch.records) {
                phase = "record-event-binding"
                const source = expected.get(record.headers?.id?.toString() ?? ""); assert.ok(source)
                phase = "record-byte-types"
                assert.ok(Buffer.isBuffer(record.key)); assert.ok(Buffer.isBuffer(record.value))
                phase = "record-key-binding"
                assert.equal(record.key.toString("utf8"), source.key)
                phase = "record-value-byte-binding"
                assert.equal(record.value.toString("utf8"), source.value, "raw JSONB bytes must survive actual EventRouter/StringConverter")
                phase = "record-header-set-binding"
                const runId = assertFullCdcHeaders(record.headers, source.headers)
                phase = "record-header-value-binding"
                for (const name of ["id", "eventtype", "organizationid", "payloadhash"]) {
                  const bytes = record.headers?.[name]; assert.ok(Buffer.isBuffer(bytes))
                  assert.equal(bytes.toString("utf8"), source.headers![name])
                }
                phase = "record-header-context-binding"
                const sourcePhase = BigInt(record.offset) < BigInt(6) ? "snapshot" : "stream"
                const previousRun = sourceRuns.get(sourcePhase)
                if (previousRun) assert.equal(runId, previousRun)
                else sourceRuns.set(sourcePhase, runId)
                phase = "record-partition-binding"
                assert.equal(record.partition, 0); (options.observed ?? observed).push(record)
              }
              phase = "restricted-sql-apply"
              const result = await worker.processBatch(batch)
              phase = "restricted-sql-committed"
              return result
            } }
          } }
        } })
      sessions.push(session)
      return session.done
    }
    phase = "committed-ack-loss"
    await assert.rejects(start(1, true))
    assert.equal(ackLossInjected, true, "must reach the actual post-COMMIT ACK-loss boundary")
    phase = "ack-loss-cursor-evidence"
    assert.equal(groupOffset("ld-testbroker-finance"), "0")
    phase = "ack-loss-record-evidence"
    assert.equal(observed.length, 1)
    const firstTenant = contexts.find(context => context.scope.organizationId === observed[0].headers!.organizationid!.toString())!
    phase = "ack-loss-durable-inbox-evidence"
    assert.deepEqual(await db.counts(firstTenant), { shadows: 1, inbox: 1, checkpoints: 1 })
    phase = "ack-loss-source-effects-evidence"
    assert.deepEqual(await snapshot(), before)
    phase = "duplicate-restart-prefix"
    assert.deepEqual(await start(3), { processed: 3 })
    assert.equal(observed[1].offset, observed[0].offset, "same real group must redeliver the committed first SQL record")
    assert.equal(groupOffset("ld-testbroker-finance"), "3")
    assert.deepEqual(await snapshot(), before)
    phase = "worker-restart-tail"
    assert.deepEqual(await start(9), { processed: 9 })
    assert.equal(groupOffset("ld-testbroker-finance"), "12")
    assert.deepEqual(observed.slice(1).map(record => record.offset), Array.from({ length: 12 }, (_, index) => String(index)))
    assert.equal(new Set(observed.map(record => record.headers!.id!.toString())).size, 12)
    async function assertExactBuilds(builds: FundShadowContext[], deliveries: KafkaEventRecord[]) {
      for (const context of builds) {
        assert.deepEqual(await db.counts(context), { shadows: 1, inbox: 6, checkpoints: 1 })
        const records = deliveries.filter(record => record.headers!.organizationid!.toString() === context.scope.organizationId)
        assert.deepEqual(records.map(record => JSON.parse(record.value!.toString()).aggregateversion), [1, 2, 3, 4, 5, 6])
        const parity = await db.scratch.$queryRawUnsafe(`SELECT s.balance::text AS balance, s.currency, s."aggregateVersion"::text AS version,
          s.balance=a.balance AND s.currency=a.currency AND s."aggregateVersion"=a."aggregateVersion" AND s."lastEventId"=a."lastEventId" AS exact
          FROM fund_balance_projections s JOIN fund_balance_projections a ON a."organizationId"=s."organizationId"
          AND a."fundId"=s."fundId" AND a.status='active' WHERE s."organizationId"=$1 AND s."buildKey"=$2`, context.scope.organizationId, context.scope.buildKey)
        assert.deepEqual(parity, [{ balance: "10.0000", currency: "USD", version: "6", exact: true }])
        const inbox = await db.scratch.$queryRawUnsafe(`SELECT "sourceOffset"::text AS offset, "eventId"::text AS event, "payloadHash" AS hash
          FROM consumer_inbox WHERE "organizationId"=$1 AND "consumerName"=$2 ORDER BY "sourceOffset"`,
        context.scope.organizationId, `fund-shadow:${context.scope.buildId}`)
        assert.deepEqual(inbox, records.map(record => ({ offset: record.offset, event: record.headers!.id!.toString(), hash: record.headers!.payloadhash!.toString() })))
        const last = records.at(-1)!
        const checkpoint = await db.scratch.$queryRawUnsafe(`SELECT "sourceOffset"::text AS offset, "lastEventId"::text AS event,
          "sourceTopic" AS topic, "sourcePartition" AS partition FROM projection_checkpoints WHERE "organizationId"=$1 AND "buildId"=$2::uuid`,
        context.scope.organizationId, context.scope.buildId)
        assert.deepEqual(checkpoint, [{ offset: last.offset, event: last.headers!.id!.toString(), topic: FULL_CDC_TOPIC, partition: 0 }])
      }
    }
    phase = "exact-parity"
    assert.equal(sourceRuns.size, 2)
    assert.notEqual(sourceRuns.get("snapshot"), sourceRuns.get("stream"), "connector stop/resume must change the task incarnation")
    await assertExactBuilds(contexts, observed.slice(1))
    assert.deepEqual(await snapshot(), before)

    phase = "shadow-only-wrong-reducer-fault-injection"
    for (const context of contexts) {
      await context.client.$transaction(async tx => {
        const [role] = await tx.$queryRawUnsafe<Array<{ currentRole: string; sessionRole: string; restricted: boolean }>>(`SELECT
          current_user::text AS "currentRole", session_user::text AS "sessionRole",
          NOT (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication) AS restricted
          FROM pg_roles WHERE rolname=current_user`)
        assert.deepEqual(role, { currentRole: context.scope.expectedWorkerRole, sessionRole: context.scope.expectedWorkerRole, restricted: true })
        await tx.$queryRawUnsafe("SELECT set_config('app.org_id', $1, true)", context.scope.organizationId)
        const changed = await tx.$executeRawUnsafe(`UPDATE fund_balance_projections SET balance=balance+1.0000::numeric
          WHERE "organizationId"=$1 AND "fundId"=$2 AND "buildKey"=$3 AND "projectionVersion"=2 AND status='shadow'`,
        context.scope.organizationId, context.fundId, context.scope.buildKey)
        assert.equal(changed, 1, "fault injection must change exactly this restricted fixture-owned shadow")
      }, { isolationLevel: "Serializable", maxWait: 5000, timeout: 15000 })
    }
    assert.deepEqual(await snapshot(), before, "injected shadow defect must not affect source, active state, effects or the other tenant")
    const snapshotOldBuilds = () => Promise.all(contexts.map(context => db.scratch.$queryRawUnsafe(`SELECT jsonb_build_object(
      'build', (SELECT to_jsonb(x) FROM projection_builds x WHERE "organizationId"=$1 AND id=$2::uuid),
      'shadows', (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM fund_balance_projections x WHERE "organizationId"=$1 AND "buildKey"=$3),
      'inbox', (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM consumer_inbox x WHERE "organizationId"=$1 AND "consumerName"=$4),
      'checkpoints', (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM projection_checkpoints x WHERE "organizationId"=$1 AND "buildId"=$2::uuid)) AS old`,
    context.scope.organizationId, context.scope.buildId, context.scope.buildKey, `fund-shadow:${context.scope.buildId}`)))
    const badBuildsBeforeRecovery = await snapshotOldBuilds()
    assert.equal(groupOffset("ld-testbroker-finance"), "12")

    phase = "corrected-new-build-full-history-recovery"
    const corrected: FundShadowContext[] = []
    for (const context of contexts) {
      const fresh = await db.newBuild(context.scope.organizationId, context.fundId, context.records)
      assert.notEqual(fresh.scope.buildId, context.scope.buildId)
      assert.notEqual(fresh.scope.buildKey, context.scope.buildKey)
      assert.notEqual(fresh.scope.expectedWorkerRole, context.scope.expectedWorkerRole)
      assert.equal(fresh.scope.codeSha, codeSha)
      assert.deepEqual(await db.counts(fresh), { shadows: 0, inbox: 0, checkpoints: 0 })
      corrected.push(fresh)
    }
    seedGroup("ld-testbroker-finance-corrected", "0")
    harness.configure("finance-corrected", "ld-testbroker-finance-corrected")
    assert.equal(groupOffset("ld-testbroker-finance"), "12")
    const replayed: KafkaEventRecord[] = []
    assert.deepEqual(await start(12, false, { contexts: corrected, groupName: "finance-corrected", observed: replayed }), { processed: 12 })
    assert.equal(groupOffset("ld-testbroker-finance-corrected"), "12")
    assert.equal(groupOffset("ld-testbroker-finance"), "12")
    assert.equal(replayed.length, 12)
    assert.deepEqual(replayed, observed.slice(1))
    await assertExactBuilds(corrected, replayed)
    assert.deepEqual(await snapshotOldBuilds(), badBuildsBeforeRecovery, "corrected replay must preserve both bad old builds and their inbox/checkpoint evidence")
    assert.deepEqual(await snapshot(), before)
    prodSeen.add(prodConnector())
    assert.deepEqual([...prodSeen], ["RUNNING/RUNNING"], "production connector stayed RUNNING throughout")
    console.log(`fund_drill_cluster=primary(${CLUSTER_ID}); brokers=3; transport=SASL_SSL/SCRAM-SHA-512/TLSv1.3; identity=ld-drill-worker; acl=prefixed-deny-by-default`)
    console.log("fund_drill_source_role=PASS; snapshot=PASS; connector_stop_resume_wal=PASS; raw_kafka_bytes_hash=PASS")
    console.log("fund_drill_restricted_sql_exact_two_tenant_parity=PASS; committed_ack_loss_duplicate=PASS; worker_restart=PASS")
    console.log("fund_drill_source_active_effects_other_tenant_unchanged=PASS; replay_sends=NONE")
    console.log("fund_drill_shadow_only_fault_injection=PASS; corrected_new_build_recovery=PASS; old_bad_builds_and_group_preserved=PASS")
    console.log(`fund_drill_production_connector=${[...prodSeen].join("|")}; production_activation=NOT_RUN; fund_drill_integration=PASS`)
  } catch (error) {
    console.error(`fund_drill_phase=${phase}; ${(error as Error).message?.split("\n")[0] ?? "error"}`)
    throw error
  } finally {
    for (const session of sessions) session.stop()
    await Promise.allSettled(sessions.map(session => session.done))
    const cleanupErrors: unknown[] = []
    if (harness) { try { await harness.close() } catch (error) { cleanupErrors.push(error) } }
    if (connectorCreated) {
      try {
        if (connectorState()?.connector.state !== "STOPPED") { connect(`/connectors/${FULL_CDC_CONNECTOR}/stop`, "PUT"); await waitConnector("STOPPED") }
        connect(`/connectors/${FULL_CDC_CONNECTOR}/offsets`, "DELETE")
        connect(`/connectors/${FULL_CDC_CONNECTOR}`, "DELETE")
        await waitFor(() => dba(db.databaseName, `SELECT active::text FROM pg_replication_slots WHERE slot_name='${FULL_CDC_SLOT}'
          AND slot_type='logical' AND plugin='pgoutput' AND database='${db.databaseName}';`).stdout.trim() === "false", "exact inactive slot")
        dba(db.databaseName, `SELECT pg_drop_replication_slot('${FULL_CDC_SLOT}');`)
      } catch (error) { cleanupErrors.push(error) }
    }
    try { await db.close() } catch (error) { cleanupErrors.push(error) }
    tunnel.child.kill("SIGTERM")
    if (cleanupErrors.length) console.error(`fund_drill_cleanup_errors=${cleanupErrors.length}; run fund-drill.sh down`)
  }
}
void main().catch(() => { process.exitCode = 1 })
