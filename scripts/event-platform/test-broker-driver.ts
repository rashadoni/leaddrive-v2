/** Actual Kafka/IPC test, disposable CI only; database effects are simulated. */
import assert from "node:assert/strict"
import { runKafkaBridge } from "../../src/lib/event-platform/kafka-bridge"
import { createPartitionProcessor } from "../../src/lib/event-platform/partition-processor"
import { createBrokerFixtureHarness } from "./fixtures/kafka-broker-harness"

const harness = createBrokerFixtureHarness()
const { create, fixture, driver, configurations } = harness
type Apply = (record: { offset: string; key: Buffer | string | null; value: Buffer | string | null }) => Promise<unknown>
async function consume(name: string, count: number, apply: Apply, options: { dropAck?: boolean; dropReceipt?: boolean } = {}) {
  const { channel } = driver(name)
  const guarded = { ...channel, async read() {
    const frame = await channel.read()
    if (options.dropReceipt && frame.startsWith("COMMITTED\t")) { await channel.close(); throw new Error("synthetic receipt loss") }
    return frame
  }, async write(command: string) {
    if (options.dropAck && command.startsWith("ACK\t")) { await channel.close(); throw new Error("synthetic ack loss") }
    await channel.write(command)
  } }
  return runKafkaBridge({ channel: guarded, clusterId: configurations.get(name)!.cluster, groupId: `ld-testbroker-${name}`,
    topic: `ld.testbroker.${name}.events.v1`, maxRecords: count,
    createProcessor: (assignment, broker) => createPartitionProcessor({ assignment, broker, applyCommitted: apply }) })
}
async function main() {
let phase = "setup"
try {
  phase = "ordered"
  create("ordered")
  const seen: string[] = []
  await consume("ordered", 1, async record => {
    assert.equal(fixture("offset", "ordered"), "0", "broker must not acknowledge before DB callback")
    seen.push(record.key!.toString()); return { checkpoint: "9000" }
  })
  assert.equal(fixture("offset", "ordered"), "1")
  await consume("ordered", 2, async record => { seen.push(record.key!.toString()); return { checkpoint: "9000" } })
  assert.deepEqual(seen, ["tenant-a", "tenant-b", "tenant-a"])
  assert.equal(fixture("offset", "ordered"), "3")
  console.log("broker_driver_ordered_restart=PASS")

  phase = "poison"; create("poison")
  let calls = 0
  await assert.rejects(consume("poison", 3, async () => { calls++; throw new Error("synthetic SQL failure") }))
  assert.equal(calls, 1); assert.equal(fixture("offset", "poison"), "0")
  console.log("broker_driver_poison_no_ack=PASS")

  phase = "lostack"; create("lostack")
  const inbox = new Set<string>(); let effects = 0
  const apply: Apply = async record => { if (!inbox.has(record.offset)) { inbox.add(record.offset); effects++ } }
  await assert.rejects(consume("lostack", 3, apply, { dropAck: true }))
  assert.equal(fixture("offset", "lostack"), "0")
  await consume("lostack", 3, apply)
  assert.equal(effects, 3); assert.equal(fixture("offset", "lostack"), "3")
  console.log("broker_driver_pre_send_ack_loss_restart=PASS")

  phase = "lostreceipt"; create("lostreceipt")
  const receipts = new Set<string>(); let receiptEffects = 0
  const applyReceipt: Apply = async record => { if (!receipts.has(record.offset)) { receipts.add(record.offset); receiptEffects++ } }
  await assert.rejects(consume("lostreceipt", 3, applyReceipt, { dropReceipt: true }))
  assert.equal(fixture("offset", "lostreceipt"), "1")
  assert.equal(receiptEffects, 1)
  await consume("lostreceipt", 2, applyReceipt)
  assert.equal(receiptEffects, 3); assert.equal(fixture("offset", "lostreceipt"), "3")
  console.log("broker_driver_post_commit_receipt_loss_restart=PASS")

  phase = "transactions"; create("transactions", "transactions")
  const positions: string[] = []
  await consume("transactions", 2, async record => { positions.push(record.offset); assert.notEqual(record.key!.toString(), "tenant-b") })
  assert.equal(positions.length, 2); assert.ok(BigInt(positions[1]) > BigInt(positions[0]) + BigInt(1))
  assert.equal(fixture("offset", "transactions"), (BigInt(positions[1]) + BigInt(1)).toString())
  console.log("broker_driver_transaction_holes=PASS")

  for (const mode of ["missing", "compact", "expired"] as const) {
    phase = mode
    create(mode, mode === "expired" ? "plain" : mode)
    if (mode === "expired") fixture("expire", mode)
    let applied = false
    await assert.rejects(consume(mode, 1, async () => { applied = true }))
    assert.equal(applied, false)
    assert.equal(fixture("offset", mode), mode === "missing" ? "NONE" : "0")
    console.log(`broker_driver_${mode}_fail_closed=PASS`)
  }

  phase = "recreated"; create("recreated"); fixture("recreate", "recreated")
  let recreatedApplied = false
  await assert.rejects(consume("recreated", 1, async () => { recreatedApplied = true }))
  assert.equal(recreatedApplied, false)
  console.log("broker_driver_recreated_topic_fail_closed=PASS")

  phase = "expired-during-db"; create("expired-during-db")
  await assert.rejects(consume("expired-during-db", 1, async () => { fixture("expire", "expired-during-db") }))
  assert.equal(fixture("offset", "expired-during-db"), "0")
  console.log("broker_driver_retention_during_db_fail_closed=PASS")

  phase = "recreated-during-db"; create("recreated-during-db")
  await assert.rejects(consume("recreated-during-db", 1, async () => { fixture("recreate", "recreated-during-db") }))
  assert.notEqual(fixture("offset", "recreated-during-db"), "1")
  console.log("broker_driver_incarnation_during_db_fail_closed=PASS")

  phase = "expired-member"; create("expired-member")
  await assert.rejects(consume("expired-member", 3, async () => {
    await new Promise(resolve => setTimeout(resolve, 34_000))
  }))
  assert.equal(fixture("offset", "expired-member"), "0")
  await consume("expired-member", 1, async () => {})
  assert.equal(fixture("offset", "expired-member"), "1")
  console.log("broker_driver_expired_membership_no_rejoin_ack=PASS")

  phase = "concurrent-takeover"; create("concurrent-takeover")
  {
    const name = "concurrent-takeover", deadline = Date.now() + 75_000
    function gate() {
      let release!: () => void
      const promise = new Promise<void>(resolve => { release = resolve })
      return { promise, release }
    }
    async function bounded<T>(operation: Promise<T>): Promise<T> {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        return await Promise.race([operation, new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("takeover deadline exceeded")), Math.max(1, deadline - Date.now()))
        })])
      } finally { if (timer) clearTimeout(timer) }
    }
    const committedOffset = () => fixture("offset", name, undefined, Math.max(1, Math.min(10_000, deadline - Date.now())))
    type Outcome = { ok: true; processed: number } | { ok: false }
    const oldEntered = gate(), newEntered = gate(), releaseOld = gate(), releaseNew = gate()
    const channels: ReturnType<typeof driver>["channel"][] = []
    const controllers: AbortController[] = []
    const outcomes: Promise<Outcome>[] = []
    const members = new Map<string, { memberId: string; generationId: number }>()
    const ackAttempts = new Map<string, number>()
    function start(role: "old" | "new", entered: ReturnType<typeof gate>, released: ReturnType<typeof gate>) {
      // Joining while the old member is blocked can consume its 30s max-poll
      // interval. This scenario permits a bounded 60s IPC read, not a retry.
      const { channel } = driver(name, 60_000), controller = new AbortController()
      channels.push(channel); controllers.push(controller)
      const outcome: Promise<Outcome> = runKafkaBridge({
        channel: { ...channel, async write(command: string) {
          if (command.startsWith("ACK\t")) ackAttempts.set(role, (ackAttempts.get(role) ?? 0) + 1)
          await channel.write(command)
        } },
        clusterId: configurations.get(name)!.cluster, groupId: `ld-testbroker-${name}`,
        topic: `ld.testbroker.${name}.events.v1`, maxRecords: 1, signal: controller.signal,
        createProcessor: (assignment, broker) => {
          members.set(role, { memberId: assignment.memberId, generationId: assignment.generationId })
          return createPartitionProcessor({ assignment, broker, applyCommitted: async record => {
            assert.equal(record.offset, "0", "replacement must resume the unacknowledged record")
            entered.release()
            await released.promise
          } })
        },
      }).then<Outcome, Outcome>(result => ({ ok: true, processed: result.processed }), () => ({ ok: false }))
      // Attach both handlers immediately: an early child/IPC failure must never
      // become an unhandled rejection while the other member is still held.
      outcomes.push(outcome)
      return outcome
    }
    async function enteredBeforeExit(entered: ReturnType<typeof gate>, outcome: Promise<Outcome>) {
      await bounded(Promise.race([entered.promise, outcome.then(() => { throw new Error("member exited before record") })]))
    }
    try {
      const oldOutcome = start("old", oldEntered, releaseOld)
      await enteredBeforeExit(oldEntered, oldOutcome)
      const newOutcome = start("new", newEntered, releaseNew)
      // No NEXT/poll is sent by the old member while its DB callback is held.
      // The replacement can receive this partition only after actual takeover.
      await enteredBeforeExit(newEntered, newOutcome)
      assert.notEqual(members.get("new")!.memberId, members.get("old")!.memberId)
      assert.ok(members.get("new")!.generationId > members.get("old")!.generationId)
      assert.equal(ackAttempts.get("old") ?? 0, 0)
      assert.equal(ackAttempts.get("new") ?? 0, 0)
      releaseOld.release()
      assert.equal((await bounded(oldOutcome)).ok, false, "old generation must not acknowledge after takeover")
      assert.equal(ackAttempts.get("old"), 1, "exercise the stale ACK, not just an abandoned callback")
      assert.equal(committedOffset(), "0", "held replacement must not mask a stale old-member commit")
      assert.equal(ackAttempts.get("new") ?? 0, 0)
      releaseNew.release()
      assert.deepEqual(await bounded(newOutcome), { ok: true, processed: 1 })
      assert.equal(committedOffset(), "1")
      console.log("broker_driver_concurrent_takeover_no_stale_ack=PASS")
    } finally {
      controllers.forEach(controller => controller.abort())
      releaseOld.release(); releaseNew.release()
      const closed = await Promise.allSettled(channels.map(channel => channel.close()))
      await Promise.all(outcomes)
      assert.ok(closed.every(result => result.status === "fulfilled"), "both takeover children must exit before another scenario")
    }
  }
  console.log("broker_driver_integration=PASS; database_effects=simulated; production_activation=not-performed")
} catch { throw new Error(`broker_driver_phase=${phase}`) }
finally { await harness.close() }
}
void main().catch(error => { console.error(error.message.startsWith("broker_driver_phase=") ? error.message : "broker_driver_integration=FAIL"); process.exitCode = 1 })
