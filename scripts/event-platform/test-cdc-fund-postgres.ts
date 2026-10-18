/** Actual canonical SQL -> actual Debezium -> Kafka bytes -> restricted Fund SQL.
 * Runner-only synthetic proof. NOT a production activation or service launcher.
 */
import assert from "node:assert/strict"
import { execFileSync, spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process"
import { readFileSync } from "node:fs"
import { createInterface } from "node:readline"
import { resolve } from "node:path"
import type { KafkaEventRecord } from "../../src/lib/event-platform/consumer"
import { startKafkaWorkerSession } from "../../src/lib/event-platform/worker-session"
import { createFundShadowPartitionWorker } from "../../src/lib/event-platform/fund-shadow-worker"
import { createFundShadowPostgresFixture, fundShadowDatabase, type FundShadowContext } from "../../src/__tests__/fixtures/fund-shadow-postgres"
import { createBrokerFixtureHarness } from "./fixtures/kafka-broker-harness"
import { assertFullCdcEnvironment, assertPrivatePostgresTarget, FULL_CDC_CONNECTOR, FULL_CDC_SLOT,
  FULL_CDC_TOPIC, renderFullCdcBoundary, renderFullCdcConnector } from "./fixtures/cdc-fund-contract.mjs"

const root = resolve(process.cwd())
const project = process.env.LD_EVENT_STACK_PROJECT ?? ""
const composeArgs = ["compose", "-p", project, "-f", "ops/event-platform/test/compose.yml",
  "-f", "ops/event-platform/test/cdc.compose.yml"]
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
function docker(args: string[], options: { input?: string; allowFailure?: boolean; timeout?: number } = {}) {
  const result = spawnSync("docker", args, { cwd: root, encoding: "utf8", input: options.input,
    timeout: options.timeout ?? 30_000, maxBuffer: 2 * 1024 * 1024 })
  if (result.error || (!options.allowFailure && result.status !== 0)) throw new Error("full CDC bounded Docker command failed")
  return result
}
function compose(args: string[], options?: Parameters<typeof docker>[1]) { return docker([...composeArgs, ...args], options) }
function dba(database: string, sql: string, allowFailure = false) {
  assert.ok(database === "event_platform_test" || /^ld_fund_shadow_[1-9][0-9]*_[0-9a-f]{12}$/.test(database))
  return compose(["exec", "-T", "postgres", "psql", "-U", "event_test", "-d", database,
    "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"], { input: sql, allowFailure })
}
function connect(path: string, method = "GET", body?: unknown, allowFailure = false) {
  assert.ok(path === "/connectors" || path === `/connectors/${FULL_CDC_CONNECTOR}` || path === `/connectors/${FULL_CDC_CONNECTOR}/status`)
  return compose(["exec", "-T", "connect", "curl", "--fail", "--silent", "--show-error", "--max-time", "5",
    "-X", method, ...(body ? ["-H", "Content-Type: application/json", "--data-binary", "@-"] : []),
    `http://connect:8083${path}`], { input: body ? JSON.stringify(body) : undefined, allowFailure })
}
async function waitFor(check: () => boolean, name: string, attempts = 60) {
  for (let i = 0; i < attempts; i++) { if (check()) return; await pause(1000) }
  throw new Error(`full CDC ${name} deadline`)
}
async function waitConnector() {
  await waitFor(() => {
    const result = connect(`/connectors/${FULL_CDC_CONNECTOR}/status`, "GET", undefined, true)
    if (result.status !== 0) return false
    const status = JSON.parse(result.stdout)
    assert.notEqual(status.connector?.state, "FAILED")
    assert.ok(!status.tasks?.some((task: { state: string }) => task.state === "FAILED"))
    return status.connector?.state === "RUNNING" && status.tasks?.length === 1 && status.tasks[0].state === "RUNNING"
  }, "connector")
}
function inspectPrivateTarget() {
  const config = JSON.parse(compose(["config", "--format", "json"]).stdout)
  const id = compose(["ps", "-q", "postgres"]).stdout.trim(); assert.match(id, /^[0-9a-f]{64}$/)
  const [container] = JSON.parse(docker(["inspect", id]).stdout)
  const [network] = JSON.parse(docker(["network", "inspect", `${project}_default`]).stdout)
  assertPrivatePostgresTarget({ project, config, container, network })
}
async function openProxy() {
  const child = spawn(process.execPath, ["scripts/event-platform/fixtures/cdc-fund-loopback.mjs", "--disposable-loopback-proxy"],
    { cwd: root, stdio: ["pipe", "pipe", "pipe"] })
  child.stderr.resume()
  const reader = createInterface({ input: child.stdout })
  const port = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => { child.stdin.end(); reject(new Error("full CDC proxy startup deadline")) }, 20_000)
    child.once("error", () => { clearTimeout(timer); reject(new Error("full CDC proxy startup failed")) })
    child.once("exit", () => { clearTimeout(timer); reject(new Error("full CDC proxy startup exited")) })
    reader.once("line", line => { clearTimeout(timer); resolve(line) })
  })
  reader.close(); assert.match(port, /^[1-9][0-9]{0,4}$/); assert.ok(Number(port) <= 65535)
  return { child, url: `postgresql://postgres:postgres@127.0.0.1:${port}/event_platform_test` }
}
async function closeProxy(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null) { assert.equal(child.exitCode, 0); return }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("full CDC proxy exit deadline")) }, 5000)
    child.once("exit", code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error("full CDC proxy failed")) })
    child.stdin.end()
  })
}

async function main() {
  // All admission precedes Docker, Prisma clients, subprocesses or SQL writes.
  assertFullCdcEnvironment(process.env)
  const codeSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", timeout: 5000 }).trim()
  assert.match(codeSha, /^[0-9a-f]{40}$/)
  inspectPrivateTarget()
  compose(["up", "-d", "--no-deps", "postgres"])
  await waitFor(() => {
    const result = dba("event_platform_test", "SHOW max_slot_wal_keep_size;", true)
    return result.status === 0 && result.stdout.trim() === "4GB"
  }, "finite WAL")
  inspectPrivateTarget()
  // This exact isolated project is new and owns its complete disposable PG.
  // Existing/shared bootstrap roles are an error, never reused or overwritten.
  dba("event_platform_test", `DO $$ BEGIN
    IF current_database() <> 'event_platform_test' OR current_user <> 'event_test'
      OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=current_user AND rolsuper)
      OR current_setting('server_version_num')::int < 160000 OR current_setting('server_version_num')::int >= 170000
      OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('postgres','event_app','event_migrator'))
      OR to_regclass('public.event_outbox') IS NOT NULL THEN
      RAISE EXCEPTION 'full CDC requires a fresh exact disposable PostgreSQL fixture';
    END IF;
  END $$;
  CREATE ROLE postgres LOGIN SUPERUSER PASSWORD 'postgres';
  CREATE ROLE event_app LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD 'event-app-password';
  CREATE ROLE event_migrator LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS PASSWORD 'event-migrator-password';
  GRANT event_app TO event_migrator;`)
  const proxy = await openProxy()
  const db = createFundShadowPostgresFixture({ adminUrl: proxy.url, environment: "testbroker", sourceAppWrites: true, codeSha })
  let harness: ReturnType<typeof createBrokerFixtureHarness> | undefined
  let connectorCreated = false, phase = "setup"
  const sessions: Array<ReturnType<typeof startKafkaWorkerSession>> = []
  try {
    await db.setup()
    const database = db.databaseName
    harness = createBrokerFixtureHarness()
    harness.create("finance", "empty") // No fixture produce() call anywhere in this proof.
    assert.equal(harness.configurations.get("finance")!.topic, FULL_CDC_TOPIC)
    const a = await db.fixture()
    dba(database, readFileSync("ops/event-platform/postgres/prepare-cdc.sql", "utf8"))
    dba(database, "ALTER ROLE leaddrive_event_cdc PASSWORD 'synthetic-cdc-only';")
    dba(database, renderFullCdcBoundary(readFileSync("ops/event-platform/test/assert-cdc-boundary.sql", "utf8"), database))
    const template = JSON.parse(readFileSync("ops/event-platform/debezium/event-outbox-connector.template.json", "utf8"))
    connect("/connectors", "POST", renderFullCdcConnector(template, database)); connectorCreated = true
    await waitConnector()
    function endOffset() {
      return compose(["exec", "-T", "-e", "KAFKA_HEAP_OPTS=-Xms32m -Xmx128m", "kafka", "/opt/kafka/bin/kafka-get-offsets.sh",
        "--bootstrap-server", "kafka:9092", "--topic", FULL_CDC_TOPIC, "--time", "-1"]).stdout.trim()
    }
    phase = "snapshot"
    await waitFor(() => endOffset() === `${FULL_CDC_TOPIC}:0:6`, "six snapshot records", 30)
    const slotEvidence = () => dba(database, `SELECT slot_name || ':' || slot_type || ':' || plugin || ':' || database || ':' ||
      (confirmed_flush_lsn IS NOT NULL)::text FROM pg_replication_slots WHERE slot_name='${FULL_CDC_SLOT}';`).stdout.trim()
    await waitFor(() => slotEvidence() === `${FULL_CDC_SLOT}:logical:pgoutput:${database}:true`, "snapshot slot acknowledgement")
    const slotBefore = slotEvidence()
    compose(["stop", "--timeout", "10", "connect"])
    phase = "offline-source-write"
    const b = await db.fixture() // Actual source-role transactions while Connect is stopped.
    assert.equal(endOffset(), `${FULL_CDC_TOPIC}:0:6`)
    compose(["start", "connect"])
    await waitConnector()
    phase = "cold-restart-stream"
    await waitFor(() => endOffset() === `${FULL_CDC_TOPIC}:0:12`, "six streamed records after restart", 30)
    assert.equal(slotEvidence(), slotBefore, "restart retains the exact acknowledged slot and database")
    compose(["stop", "--timeout", "10", "connect"])
    // A third real source/active tenant is deliberately not in the two routed
    // builds. Its WAL remains unconsumed while its untouched state is checked.
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
            // Fixed protocol-stage labels only, never record/header contents.
            for (const kind of ["HELLO", "ASSIGN", "RECORD", "REVOKE", "COMMITTED", "FAIL", "IDLE"]) {
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
                assert.deepEqual(Object.keys(record.headers ?? {}).sort(), Object.keys(source.headers!).sort())
                phase = "record-header-value-binding"
                for (const name of ["id", "eventtype", "organizationid", "payloadhash"]) {
                  const bytes = record.headers?.[name]; assert.ok(Buffer.isBuffer(bytes))
                  assert.equal(bytes.toString("utf8"), source.headers![name])
                }
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
    // A transport, parser or SQL failure is NOT the intended ACK-loss result.
    // Keep its last safe stage if this assertion fails, rather than masking it.
    assert.equal(ackLossInjected, true, "must reach the actual post-COMMIT ACK-loss boundary")
    phase = "ack-loss-cursor-evidence"
    assert.equal(harness.fixture("offset", "finance"), "0")
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
    assert.equal(harness.fixture("offset", "finance"), "3")
    assert.deepEqual(await snapshot(), before)
    phase = "worker-restart-tail"
    assert.deepEqual(await start(9), { processed: 9 })
    assert.equal(harness.fixture("offset", "finance"), "12")
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
    await assertExactBuilds(contexts, observed.slice(1))
    assert.deepEqual(await snapshot(), before)

    phase = "shadow-only-wrong-reducer-fault-injection"
    // Synthetic fault injection ONLY: represent a reducer's wrong persisted
    // result without pretending this checked-out source contains a historical
    // reducer bug. The actual old restricted login can update only its shadow.
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
      const mismatched = await db.scratch.$queryRawUnsafe(`SELECT s.balance::text AS balance, s.currency,
        s."aggregateVersion"::text AS version, s.balance=a.balance AS exact,
        s.currency=a.currency AND s."aggregateVersion"=a."aggregateVersion" AND s."lastEventId"=a."lastEventId" AS "metadataUnchanged"
        FROM fund_balance_projections s JOIN fund_balance_projections a ON a."organizationId"=s."organizationId"
        AND a."fundId"=s."fundId" AND a.status='active' WHERE s."organizationId"=$1 AND s."buildKey"=$2`,
      context.scope.organizationId, context.scope.buildKey)
      assert.deepEqual(mismatched, [{ balance: "11.0000", currency: "USD", version: "6", exact: false, metadataUnchanged: true }])
    }
    assert.deepEqual(await snapshot(), before, "injected shadow defect must not affect source, active state, effects or the other tenant")
    const snapshotOldBuilds = () => Promise.all(contexts.map(context => db.scratch.$queryRawUnsafe(`SELECT jsonb_build_object(
      'build', (SELECT to_jsonb(x) FROM projection_builds x WHERE "organizationId"=$1 AND id=$2::uuid),
      'shadows', (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM fund_balance_projections x WHERE "organizationId"=$1 AND "buildKey"=$3),
      'inbox', (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM consumer_inbox x WHERE "organizationId"=$1 AND "consumerName"=$4),
      'checkpoints', (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM projection_checkpoints x WHERE "organizationId"=$1 AND "buildId"=$2::uuid)) AS old`,
    context.scope.organizationId, context.scope.buildId, context.scope.buildKey, `fund-shadow:${context.scope.buildId}`)))
    const badBuildsBeforeRecovery = await snapshotOldBuilds()
    assert.equal(harness.fixture("offset", "finance"), "12")

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
    // Initial admission of a NEW synthetic group only. Never reset, delete,
    // recreate or mutate the old group's already-acknowledged cursor/builds.
    harness.admitGroup("finance-corrected", "finance", "0")
    assert.equal(harness.fixture("offset", "finance-corrected"), "0")
    assert.equal(harness.fixture("offset", "finance"), "12")
    const replayed: KafkaEventRecord[] = []
    assert.deepEqual(await start(12, false, { contexts: corrected, groupName: "finance-corrected", observed: replayed }), { processed: 12 })
    assert.equal(harness.fixture("offset", "finance-corrected"), "12")
    assert.equal(harness.fixture("offset", "finance"), "12")
    assert.equal(replayed.length, 12)
    // The same broker bytes and original positions, not republished fixture
    // messages or modified/rehashed source events, drive the corrected build.
    assert.deepEqual(replayed, observed.slice(1))
    await assertExactBuilds(corrected, replayed)
    assert.deepEqual(await snapshotOldBuilds(), badBuildsBeforeRecovery, "corrected replay must preserve both bad old builds and their inbox/checkpoint evidence")
    assert.deepEqual(await snapshot(), before)
    console.log("full_cdc_fund_source_role=PASS; snapshot=PASS; connect_cold_restart_wal=PASS; raw_kafka_bytes_hash=PASS")
    console.log("full_cdc_fund_restricted_sql_exact_two_tenant_parity=PASS; committed_ack_loss_duplicate=PASS; worker_restart=PASS")
    console.log("full_cdc_fund_source_active_effects_other_tenant_unchanged=PASS; replay_sends=NONE")
    console.log("full_cdc_fund_shadow_only_fault_injection=PASS; historical_bug_source=NOT_CLAIMED; corrected_new_build_recovery=PASS; old_bad_builds_and_group_preserved=PASS")
    console.log("full_cdc_fund_integration=PASS; fixture_tls_acl=NOT_PROVEN; production_activation=NOT_RUN")
  } catch { throw new Error(`full_cdc_fund_phase=${phase}`) }
  finally {
    for (const session of sessions) session.stop()
    await Promise.allSettled(sessions.map(session => session.done))
    const cleanupErrors: unknown[] = []
    if (harness) { try { await harness.close() } catch (error) { cleanupErrors.push(error) } }
    if (connectorCreated) {
      try {
        compose(["start", "connect"])
        await waitFor(() => connect("/connectors", "GET", undefined, true).status === 0, "cleanup Connect")
        connect(`/connectors/${FULL_CDC_CONNECTOR}`, "DELETE")
        await waitFor(() => dba(db.databaseName, `SELECT active::text FROM pg_replication_slots WHERE slot_name='${FULL_CDC_SLOT}'
          AND slot_type='logical' AND plugin='pgoutput' AND database='${db.databaseName}';`).stdout.trim() === "false", "exact inactive slot")
        dba(db.databaseName, `SELECT pg_drop_replication_slot('${FULL_CDC_SLOT}');`)
      } catch (error) { cleanupErrors.push(error) }
    }
    try { await db.close() } catch (error) { cleanupErrors.push(error) }
    try { await closeProxy(proxy.child) } catch (error) { cleanupErrors.push(error) }
    assert.equal(cleanupErrors.length, 0, "full CDC owned cleanup failed; outer disposable project teardown remains required")
  }
}
void main().catch(error => { console.error(error.message?.startsWith("full_cdc_fund_phase=") ? error.message : "full_cdc_fund_integration=FAIL"); process.exitCode = 1 })
