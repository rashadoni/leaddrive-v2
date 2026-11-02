/** Real Kafka + real restricted PostgreSQL; synthetic disposable CI only. */
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import type { KafkaEventRecord } from "../../src/lib/event-platform/consumer"
import { startKafkaWorkerSession } from "../../src/lib/event-platform/worker-session"
import { createFundShadowPartitionWorker } from "../../src/lib/event-platform/fund-shadow-worker"
import type { FundShadowDatabase } from "../../src/lib/event-platform/fund-shadow-consumer"
import type { PartitionAssignment } from "../../src/lib/event-platform/partition-processor"
import { createBrokerFixtureHarness } from "./fixtures/kafka-broker-harness"
import { createFundShadowPostgresFixture, fundShadowDatabase, type FundShadowContext } from "../../src/__tests__/fixtures/fund-shadow-postgres"

function gate() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}
async function bounded<T>(operation: Promise<T>, timeout = 10_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("combined fixture deadline")), timeout)
    })])
  } finally { if (timer) clearTimeout(timer) }
}
type Outcome = { ok: true; processed: number } | { ok: false }

async function main() {
  assert.equal(process.env.GITHUB_ACTIONS, "true")
  assert.equal(process.env.LD_EVENT_STACK_DISPOSABLE, "1")
  assert.equal(process.env.LD_EVENT_STACK_COMBINED, "1")
  assert.equal(process.env.FUND_SHADOW_DB_GATE, "required")
  const codeSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", timeout: 5000 }).trim()
  assert.match(codeSha, /^[0-9a-f]{40}$/)
  const db = createFundShadowPostgresFixture({ adminUrl: process.env.FUND_SHADOW_TEST_DATABASE_URL ?? "", environment: "testbroker", codeSha })
  const harness = createBrokerFixtureHarness()
  let phase = "setup"
  const active: Array<{ stop: () => Promise<void>; outcome: Promise<Outcome> }> = []
  try {
    await db.setup()
    harness.create("finance", "empty")
    async function prepare(name: string, two = false, direct = false) {
      const a = await db.fixture(), contexts = [a]
      if (two) contexts.push(await db.fixture())
      const records = two
        ? [a.records[0], contexts[1].records[0], a.records[1], ...a.records.slice(2), ...contexts[1].records.slice(1)]
        : a.records
      const published = harness.produce("finance", records)
      harness.admitGroup(name, "finance", published[0].offset,
        direct ? `ld.testbroker.finance.fund-shadow.v2.${name}` : undefined)
      const before = await Promise.all(contexts.map(context => db.snapshotSource(context.scope.organizationId)))
      return { name, contexts, published, before, start: published[0].offset,
        end: (BigInt(published[published.length - 1].offset) + BigInt(1)).toString() }
    }
    type Scenario = Awaited<ReturnType<typeof prepare>>
    function start(test: Scenario, count: number, options: {
      databaseFor?: (context: FundShadowContext) => FundShadowDatabase
      dropAck?: boolean; dropReceipt?: boolean; timeoutMs?: number
      assignment?: (value: Readonly<PartitionAssignment>) => void
      ack?: () => void; ackWritten?: () => void; observed?: KafkaEventRecord[]
      released?: () => void
      driver?: ReturnType<typeof harness.driver> | Awaited<ReturnType<typeof harness.directDriver>>
    } = {}) {
      const config = harness.configurations.get(test.name)!
      const driver = options.driver ?? harness.driver(test.name, options.timeoutMs)
      const { channel, child } = driver
      const plan = driver.kind === "direct" ? driver.plan : undefined
      if (plan) {
        assert.equal(plan.broker.groupId, config.group); assert.equal(plan.broker.topic, config.topic)
        assert.equal(plan.limits.maxRecords, count); assert.equal(plan.releaseSha, codeSha)
        assert.deepEqual(plan.routes.map(route => route.scope), test.contexts.map(context => context.scope))
      }
      const expected = new Map(test.published.map(record => [record.offset, record]))
      let recordReceivedAt = 0
      const privateChannel = { ...channel, async read() {
        const frame = await channel.read()
        if (frame.startsWith("RECORD\t")) recordReceivedAt = Date.now()
        if (options.dropReceipt && frame.startsWith("COMMITTED\t")) { await channel.close(); throw new Error("synthetic receipt loss") }
        return frame
      }, async write(command: string) {
        if (command.startsWith("ACK\t")) {
          options.ack?.()
          if (options.dropAck) { await channel.close(); throw new Error("synthetic ACK loss") }
        }
        await channel.write(command)
        if (command.startsWith("ACK\t")) options.ackWritten?.()
      } }
      const session = startKafkaWorkerSession({ clusterId: config.cluster, groupId: config.group,
        topic: config.topic, maxRecords: plan?.limits.maxRecords ?? count, maxDurationMs: plan?.limits.maxDurationMs ?? 120_000,
        open() {
          // Session-owned restricted logins, never the application/admin pool.
          const contexts = test.contexts.map((context, index) => ({ ...context,
            scope: plan?.routes[index].scope ?? context.scope, client: db.connect(context) }))
          return {
            channel: privateChannel,
            async release() {
              const closed = await Promise.allSettled(contexts.map(context => context.client.$disconnect()))
              assert.ok(closed.every(result => result.status === "fulfilled"))
              options.released?.()
            },
            createProcessor(assignment, broker) {
              options.assignment?.(assignment)
              const worker = createFundShadowPartitionWorker({ assignment, broker, environment: "testbroker",
                routes: contexts.map(context => ({ scope: context.scope,
                  database: options.databaseFor?.(context) ?? fundShadowDatabase(context.client) })) })
              return { revoke: () => worker.revoke(), async processBatch(batch: { fetchOffset: string; records: KafkaEventRecord[] }) {
                for (const record of batch.records) {
                  const source = expected.get(record.offset); assert.ok(source)
                  assert.equal(record.key?.toString(), source.key?.toString())
                  assert.equal(record.value?.toString(), source.value?.toString())
                  assert.deepEqual(Object.keys(record.headers ?? {}).sort(), Object.keys(source.headers ?? {}).sort())
                  for (const name of ["id", "eventtype", "organizationid", "payloadhash"]) {
                    assert.ok(!Array.isArray(record.headers?.[name]))
                    assert.equal(record.headers?.[name]?.toString(), source.headers?.[name]?.toString())
                  }
                  options.observed?.push(record)
                }
                return worker.processBatch(batch)
              } }
            },
          }
        },
      })
      const outcome = session.done.then<Outcome, Outcome>(result => ({ ok: true, processed: result.processed }), () => ({ ok: false }))
      // Attach handlers immediately, including while another member is held.
      const running = { outcome, child, get recordReceivedAt() { return recordReceivedAt },
        requestStop: session.stop,
        async stop() { session.stop(); await outcome; await channel.close() } }
      active.push(running)
      return running
    }
    const cursor = (test: Scenario) => harness.fixture("offset", test.name, undefined, 10_000)
    async function enteredBeforeExit(entered: ReturnType<typeof gate>, outcome: Promise<Outcome>, timeout = 10_000) {
      await bounded(Promise.race([entered.promise, outcome.then(() => { throw new Error("worker exited before checkpoint") })]), timeout)
    }
    async function unchanged(test: Scenario) {
      assert.deepEqual(await Promise.all(test.contexts.map(context => db.snapshotSource(context.scope.organizationId))), test.before)
    }
    async function complete(test: Scenario) {
      assert.equal(cursor(test), test.end)
      for (const context of test.contexts) {
        assert.deepEqual(await db.counts(context), { shadows: 1, inbox: 6, checkpoints: 1 })
        const [row] = await db.scratch.$queryRawUnsafe<Array<{ parity: boolean; balance: string; version: string }>>(`SELECT
          s.balance = a.balance AND s.currency = a.currency AND s."aggregateVersion" = a."aggregateVersion"
          AND s."lastEventId" = a."lastEventId" AS parity, s.balance::text AS balance, s."aggregateVersion"::text AS version
          FROM fund_balance_projections s JOIN fund_balance_projections a ON a."organizationId" = s."organizationId"
          AND a."fundId" = s."fundId" AND a.status = 'active' WHERE s."organizationId" = $1 AND s."buildKey" = $2`,
        context.scope.organizationId, context.scope.buildKey)
        assert.deepEqual(row, { parity: true, balance: "10.0000", version: "6" })
        const records = test.published.filter(record => record.headers!.organizationid === context.scope.organizationId)
        const last = records[records.length - 1]
        const checkpoint = await db.scratch.$queryRawUnsafe<Array<{ offset: string; event: string; topic: string; partition: number }>>(`SELECT
          "sourceOffset"::text AS offset, "lastEventId"::text AS event, "sourceTopic" AS topic, "sourcePartition" AS partition
          FROM projection_checkpoints WHERE "organizationId" = $1 AND "buildId" = $2::uuid`, context.scope.organizationId, context.scope.buildId)
        assert.deepEqual(checkpoint, [{ offset: last.offset, event: last.headers!.id, topic: last.topic, partition: 0 }])
        const inbox = await db.scratch.$queryRawUnsafe<Array<{ offset: string; event: string }>>(`SELECT
          "sourceOffset"::text AS offset, "eventId"::text AS event FROM consumer_inbox
          WHERE "organizationId" = $1 AND "consumerName" = $2 ORDER BY "sourceOffset"`,
        context.scope.organizationId, `fund-shadow:${context.scope.buildId}`)
        assert.deepEqual(inbox, records.map(record => ({ offset: record.offset, event: record.headers!.id })))
      }
      await unchanged(test)
      await Promise.all(test.contexts.map(context => db.closeContext(context)))
    }

    phase = "ordered"
    {
      const test = await prepare("combined-ordered", true), observed: KafkaEventRecord[] = []
      assert.throws(() => harness.fixture("seed", test.name, (BigInt(test.start) + BigInt(1)).toString()), /synthetic broker command failed/)
      assert.equal(cursor(test), test.start, "fixture admission must never reset an existing group")
      assert.deepEqual(await start(test, 3, { observed }).outcome, { ok: true, processed: 3 })
      assert.deepEqual(observed.map(record => record.headers!.organizationid!.toString()),
        [test.contexts[0], test.contexts[1], test.contexts[0]].map(context => context.scope.organizationId))
      assert.deepEqual(await start(test, 9, { observed }).outcome, { ok: true, processed: 9 })
      assert.deepEqual(observed.map(record => record.offset), test.published.map(record => record.offset))
      await complete(test)
      console.log("broker_postgres_ordered_restart_exact_parity=PASS")
    }

    phase = "direct-jvm-ordered"
    {
      const test = await prepare("jvm-ordered", true, true), observed: KafkaEventRecord[] = []
      const first = await harness.directDriver(test.name, test.contexts.map(context => context.scope), 3)
      assert.deepEqual(await start(test, 3, { observed, driver: first }).outcome, { ok: true, processed: 3 })
      assert.deepEqual(await first.exited, { code: 0, signal: null })
      const second = await harness.directDriver(test.name, test.contexts.map(context => context.scope), 9)
      assert.deepEqual(await start(test, 9, { observed, driver: second }).outcome, { ok: true, processed: 9 })
      assert.deepEqual(await second.exited, { code: 0, signal: null })
      assert.deepEqual(observed.map(record => record.offset), test.published.map(record => record.offset))
      await complete(test)
      console.log("worker_jvm_ordered_restart_exact_parity=PASS")
    }

    phase = "before-commit"
    {
      const test = await prepare("combined-before-commit"), entered = gate(), release = gate()
      const running = start(test, 1, { databaseFor: context => fundShadowDatabase(context.client, {
        beforeCommit: async () => { entered.release(); await bounded(release.promise, 8_000) },
      }) })
      try {
        await enteredBeforeExit(entered, running.outcome)
        assert.equal(cursor(test), test.start)
        assert.deepEqual(await db.counts(test.contexts[0]), { shadows: 0, inbox: 0, checkpoints: 0 })
      } finally { release.release() }
      assert.deepEqual(await running.outcome, { ok: true, processed: 1 })
      assert.deepEqual(await start(test, 5).outcome, { ok: true, processed: 5 })
      await complete(test)
      console.log("broker_postgres_no_ack_before_real_commit=PASS")
    }

    for (const direct of [false, true]) for (const afterCommit of [false, true]) {
      const stopPhase = afterCommit ? "stop-after-commit" : "stop-during-commit"
      phase = `${direct ? "direct-jvm" : "combined"}-${stopPhase}`
      const test = await prepare(`${direct ? "jvm" : "combined"}-${stopPhase}`, false, direct), entered = gate(), release = gate()
      let ackAttempts = 0, released = false
      const hold = async () => { entered.release(); await bounded(release.promise, 8_000) }
      const first = direct ? await harness.directDriver(test.name, test.contexts.map(context => context.scope), 6) : undefined
      const running = start(test, 6, { ack: () => { ackAttempts++ }, released: () => { released = true },
        driver: first,
        databaseFor: context => fundShadowDatabase(context.client, afterCommit ? { afterCommit: hold } : { beforeCommit: hold }) })
      try {
        await enteredBeforeExit(entered, running.outcome)
        running.requestStop()
        assert.equal(released, false, "stop must not disconnect under an unsettled SQL operation")
        assert.equal(ackAttempts, 0)
      } finally { release.release() }
      assert.equal((await bounded(running.outcome)).ok, false, "stop is never a successful completed run")
      assert.equal(released, true, "owned SQL clients must be released after transaction settlement")
      assert.equal(running.child.exitCode, 0); assert.equal(running.child.signalCode, null)
      assert.equal(ackAttempts, 0); assert.equal(cursor(test), test.start)
      assert.deepEqual(await db.counts(test.contexts[0]), { shadows: 1, inbox: 1, checkpoints: 1 })
      await unchanged(test)
      // Restart from the broker cursor, including the already-committed record.
      // Actual inbox identity suppresses duplicate effects; no offset reset.
      const observed: KafkaEventRecord[] = []
      if (first) assert.deepEqual(await first.exited, { code: 0, signal: null })
      const second = direct ? await harness.directDriver(test.name, test.contexts.map(context => context.scope), 6) : undefined
      assert.deepEqual(await start(test, 6, { observed, driver: second }).outcome, { ok: true, processed: 6 })
      if (second) assert.deepEqual(await second.exited, { code: 0, signal: null })
      assert.equal(observed[0].offset, test.start)
      await complete(test)
      console.log(direct
        ? afterCommit ? "worker_jvm_stop_after_commit_restart=PASS" : "worker_jvm_stop_during_commit_restart=PASS"
        : afterCommit ? "broker_postgres_stop_after_commit_restart=PASS" : "broker_postgres_stop_during_commit_restart=PASS")
    }

    phase = "deferred-commit-rejection"
    {
      const test = await prepare("combined-commit-reject")
      db.sql(`CREATE FUNCTION combined_commit_reject() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'synthetic combined deferred failure' USING ERRCODE = '23514'; END $$;
        CREATE CONSTRAINT TRIGGER combined_commit_reject AFTER INSERT ON consumer_inbox
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION combined_commit_reject();`)
      let callbackReturned = false, deferredRejected = false, ackAttempts = 0
      try {
        const result = await start(test, 1, { ack: () => { ackAttempts++ }, databaseFor: context => {
          const real = fundShadowDatabase(context.client, { beforeCommit: async () => { callbackReturned = true } })
          return { async $transaction(work, options) {
            try { return await real.$transaction(work, options) }
            catch (error) { deferredRejected = error instanceof Error && error.message.includes("synthetic combined deferred failure"); throw error }
          } }
        } }).outcome
        assert.equal(result.ok, false); assert.equal(callbackReturned, true); assert.equal(deferredRejected, true)
        assert.equal(ackAttempts, 0); assert.equal(cursor(test), test.start)
        assert.deepEqual(await db.counts(test.contexts[0]), { shadows: 0, inbox: 0, checkpoints: 0 })
        await unchanged(test)
      } finally {
        db.sql("DROP TRIGGER combined_commit_reject ON consumer_inbox; DROP FUNCTION combined_commit_reject();")
      }
      assert.deepEqual(await start(test, 6).outcome, { ok: true, processed: 6 })
      await complete(test)
      console.log("broker_postgres_deferred_failure_rollback_no_ack=PASS")
    }

    for (const dropReceipt of [false, true]) {
      phase = dropReceipt ? "lost-receipt" : "lost-ack"
      const test = await prepare(`combined-${phase}`)
      assert.equal((await start(test, 6, { dropAck: !dropReceipt, dropReceipt }).outcome).ok, false)
      assert.deepEqual(await db.counts(test.contexts[0]), { shadows: 1, inbox: 1, checkpoints: 1 })
      assert.equal(cursor(test), dropReceipt ? (BigInt(test.start) + BigInt(1)).toString() : test.start)
      const observed: KafkaEventRecord[] = []
      const count = dropReceipt ? 5 : 6
      assert.deepEqual(await start(test, count, { observed }).outcome, { ok: true, processed: count })
      assert.equal(observed[0].offset, test.published[dropReceipt ? 1 : 0].offset)
      await complete(test)
      console.log(dropReceipt ? "broker_postgres_receipt_loss_resume=PASS" : "broker_postgres_ack_loss_durable_inbox=PASS")
    }

    phase = "concurrent-takeover"
    {
      const test = await prepare("combined-takeover"), context = test.contexts[0]
      const oldEntered = gate(), newEntered = gate(), releaseOld = gate(), releaseNew = gate()
      const members = new Map<string, Readonly<PartitionAssignment>>()
      let oldAck = 0, oldAckWritten = 0, newAck = 0
      const old = start(test, 1, { timeoutMs: 60_000, assignment: a => members.set("old", a), ack: () => {
        assert.ok(old.recordReceivedAt > 0 && Date.now() - old.recordReceivedAt < 50_000,
          "stale ACK must precede the Java 60s command timeout")
        assert.equal(old.child.exitCode, null); assert.equal(old.child.signalCode, null)
        oldAck++
      }, ackWritten: () => { oldAckWritten++ },
        databaseFor: c => fundShadowDatabase(c.client, { afterCommit: async () => {
          oldEntered.release(); await bounded(releaseOld.promise, 70_000)
        } }) })
      let replacement: ReturnType<typeof start> | undefined
      try {
        phase = "takeover-wait-old-commit"
        await enteredBeforeExit(oldEntered, old.outcome)
        phase = "takeover-assert-old-durable"
        assert.deepEqual(await db.counts(context), { shadows: 1, inbox: 1, checkpoints: 1 })
        replacement = start(test, 1, { timeoutMs: 60_000, assignment: a => members.set("new", a), ack: () => { newAck++ },
          databaseFor: c => fundShadowDatabase(c.client, { afterCommit: async () => {
            newEntered.release(); await bounded(releaseNew.promise, 40_000)
          } }) })
        // Hold only AFTER actual SQL COMMIT: the 15s SQL timeout is unchanged.
        phase = "takeover-wait-replacement-commit"
        await enteredBeforeExit(newEntered, replacement.outcome, 40_000)
        phase = "takeover-assert-membership"
        assert.notEqual(members.get("old")!.memberId, members.get("new")!.memberId)
        assert.ok(members.get("new")!.generationId > members.get("old")!.generationId)
        phase = "takeover-assert-duplicate-durable"
        assert.deepEqual(await db.counts(context), { shadows: 1, inbox: 1, checkpoints: 1 })
        phase = "takeover-assert-no-early-ack"
        assert.equal(oldAck, 0); assert.equal(newAck, 0)
        phase = "takeover-assert-old-live-window"
        assert.ok(Date.now() - old.recordReceivedAt < 45_000, "takeover must leave a real stale-ACK observation window")
        assert.equal(old.child.exitCode, null); assert.equal(old.child.signalCode, null)
        phase = "takeover-wait-stale-ack-rejection"
        releaseOld.release()
        assert.equal((await bounded(old.outcome)).ok, false)
        phase = "takeover-assert-stale-ack-written"
        assert.equal(oldAck, 1); assert.equal(oldAckWritten, 1)
        phase = "takeover-assert-old-exit"
        assert.equal(old.child.exitCode, 1); assert.equal(old.child.signalCode, null)
        phase = "takeover-assert-not-command-timeout"
        assert.ok(Date.now() - old.recordReceivedAt < 60_000, "command timeout is not membership-fencing evidence")
        phase = "takeover-assert-unadvanced-cursor"
        assert.equal(newAck, 0); assert.equal(cursor(test), test.start)
        phase = "takeover-release-replacement"
        releaseNew.release()
        assert.deepEqual(await bounded(replacement.outcome), { ok: true, processed: 1 })
        phase = "takeover-assert-replacement-cursor"
        assert.equal(cursor(test), (BigInt(test.start) + BigInt(1)).toString())
      } finally {
        releaseOld.release(); releaseNew.release()
        const cleanup = await Promise.allSettled([old.stop(), replacement?.stop()])
        assert.ok(cleanup.every(result => result.status === "fulfilled"), "both members and restricted connection must close")
      }
      phase = "takeover-resume-tail"
      assert.deepEqual(await start(test, 5).outcome, { ok: true, processed: 5 })
      phase = "takeover-final-parity"
      await complete(test)
      console.log("broker_postgres_takeover_durable_inbox_stale_ack_fenced=PASS")
    }
    await harness.exportArtifact()
    console.log("worker_jvm_integration=PASS; child=direct-java; artifact=verified-client-only; sql=restricted-real-commit; production_activation=not-performed")
    console.log("broker_postgres_integration=PASS; kafka=real; sql=restricted-real-commit; cdc=separate-proof; production_activation=not-performed")
  } catch { throw new Error(`broker_postgres_phase=${phase}`) }
  finally {
    const stopped = await Promise.allSettled(active.map(run => run.stop()))
    const children = await Promise.allSettled([harness.close()])
    const database = await Promise.allSettled([db.close()])
    assert.ok(stopped.every(result => result.status === "fulfilled"), "combined fixture children must exit")
    assert.ok(children.every(result => result.status === "fulfilled"), "broker fixture cleanup must complete")
    assert.ok(database.every(result => result.status === "fulfilled"), "database fixture cleanup must complete")
  }
}
void main().catch(error => { console.error(error.message.startsWith("broker_postgres_phase=") ? error.message : "broker_postgres_integration=FAIL"); process.exitCode = 1 })
