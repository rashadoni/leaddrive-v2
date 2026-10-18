import { describe, expect, it, vi } from "vitest"
import type { KafkaEventRecord } from "../lib/event-platform/consumer"
import { createPartitionProcessor, type PartitionAssignment, type PartitionBroker } from "../lib/event-platform/partition-processor"

const TOPIC = "ld.test.finance.events.v1"

function gate() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}

function assignment(overrides: Partial<PartitionAssignment> = {}): PartitionAssignment {
  return { clusterId: "fixture-cluster", groupId: "fixture-shadow-build", memberId: "member-original",
    generationId: 7, topic: TOPIC, partition: 0, nextOffset: "0", ...overrides }
}

function record(position = "0", tenant = "tenant-a"): KafkaEventRecord {
  return { topic: TOPIC, partition: 0, offset: position, key: `${tenant}:fund:fund-a`,
    value: JSON.stringify({ organizationid: tenant }), headers: { organizationid: tenant } }
}

function harness(options: {
  assignment?: PartitionAssignment
  apply?: (record: KafkaEventRecord) => Promise<unknown>
  maxBatchRecords?: number
  maxBatchBytes?: number
} = {}) {
  const apply = vi.fn(options.apply ?? (async (_record: KafkaEventRecord) => undefined))
  const isCurrent = vi.fn((_assignment: Readonly<PartitionAssignment>) => true)
  const commit = vi.fn(async (_assignment: Readonly<PartitionAssignment>, _next: string) => {})
  const broker: PartitionBroker = { isCurrent, commitNextOffset: commit }
  const processor = createPartitionProcessor({ assignment: options.assignment ?? assignment(), broker,
    applyCommitted: apply, maxBatchRecords: options.maxBatchRecords, maxBatchBytes: options.maxBatchBytes })
  return { processor, apply, isCurrent, commit, broker }
}

// These are control-flow tests of an inactive primitive. The fake broker does
// not prove Kafka membership fencing, fetch coverage or durable group commits.
describe("partition processor — ordered committed prefix, not a network consumer", () => {
  it("holds the A/B/A partition barrier until B's database commit resolves", async () => {
    const waiting = gate()
    const entered = gate()
    const order: string[] = []
    const h = harness({ apply: async incoming => {
      order.push(`apply:${incoming.offset}`)
      if (incoming.offset === "1") { entered.release(); await waiting.promise }
      order.push(`committed:${incoming.offset}`)
    } })
    h.commit.mockImplementation(async (_assignment, next) => { order.push(`ack:${next}`) })
    const pending = h.processor.processBatch({ fetchOffset: "0", records: [record("0", "a"), record("1", "b"), record("2", "a")] })
    await entered.promise
    expect(order).toEqual(["apply:0", "committed:0", "ack:1", "apply:1"])
    expect(h.processor.status()).toEqual({ state: "processing", nextOffset: "1" })
    waiting.release()
    await expect(pending).resolves.toEqual({ processed: 3, nextOffset: "3" })
    expect(order).toEqual(["apply:0", "committed:0", "ack:1", "apply:1", "committed:1", "ack:2", "apply:2", "committed:2", "ack:3"])
  })

  it("does not ack a deferred COMMIT failure or visit a later tenant", async () => {
    const waiting = gate()
    const failure = new Error("synthetic deferred COMMIT rejection")
    const h = harness({ apply: async () => { await waiting.promise; throw failure } })
    const pending = h.processor.processBatch({ fetchOffset: "0", records: [record(), record("1", "tenant-b")] })
    expect(h.apply).toHaveBeenCalledTimes(1)
    expect(h.commit).not.toHaveBeenCalled()
    const rejected = expect(pending).rejects.toBe(failure)
    waiting.release()
    await rejected
    expect(h.commit).not.toHaveBeenCalled()
    expect(h.processor.status()).toEqual({ state: "stopped", nextOffset: "0" })
  })

  it("stops at poison B while retaining only the already committed prefix A", async () => {
    const failure = new Error("poison fact")
    const h = harness({ apply: async incoming => { if (incoming.offset === "1") throw failure } })
    await expect(h.processor.processBatch({ fetchOffset: "0", records: [record(), record("1", "b"), record("2")] })).rejects.toBe(failure)
    expect(h.apply.mock.calls.map(([incoming]) => incoming.offset)).toEqual(["0", "1"])
    expect(h.commit.mock.calls.map(([, next]) => next)).toEqual(["1"])
    await expect(h.processor.processBatch({ fetchOffset: "1", records: [record("1")] })).rejects.toMatchObject({ code: "PARTITION_STOPPED" })
    expect(h.apply).toHaveBeenCalledTimes(2)
  })

  it("stops on uncertain broker ack; a new assignment can replay the committed DB duplicate", async () => {
    const seen = new Set<string>()
    const results: boolean[] = []
    const apply = async (incoming: KafkaEventRecord) => {
      const duplicate = seen.has(incoming.offset)
      results.push(duplicate)
      seen.add(incoming.offset)
      return { duplicate }
    }
    const uncertain = new Error("broker commit outcome unknown")
    const first = harness({ apply })
    first.commit.mockRejectedValueOnce(uncertain)
    await expect(first.processor.processBatch({ fetchOffset: "0", records: [record(), record("1")] })).rejects.toBe(uncertain)
    expect(first.processor.status()).toEqual({ state: "stopped", nextOffset: "0" })
    expect(first.apply).toHaveBeenCalledTimes(1)
    const resumed = harness({ assignment: assignment({ memberId: "member-new", generationId: 8 }), apply })
    await expect(resumed.processor.processBatch({ fetchOffset: "0", records: [record()] })).resolves.toEqual({ processed: 1, nextOffset: "1" })
    expect(results).toEqual([false, true])
    expect(seen.size).toBe(1)
    expect(resumed.commit.mock.calls[0][1]).toBe("1")
  })

  it("ignores an older duplicate's newer tenant-local checkpoint", async () => {
    const h = harness({ apply: async () => ({ duplicate: true, checkpoint: { sourceOffset: BigInt(900), lastEventId: "old" } }) })
    await h.processor.processBatch({ fetchOffset: "0", records: [record()] })
    expect(h.commit.mock.calls.map(([, next]) => next)).toEqual(["1"])
    expect(h.processor.status().nextOffset).toBe("1")
  })

  it("allows numeric holes in an ordered complete fetch and binds the next fetch cursor", async () => {
    const h = harness()
    await expect(h.processor.processBatch({ fetchOffset: "0", records: [record("3"), record("7")] })).resolves.toEqual({ processed: 2, nextOffset: "8" })
    await expect(h.processor.processBatch({ fetchOffset: "8", records: [record("12")] })).resolves.toEqual({ processed: 1, nextOffset: "13" })
    expect(h.commit.mock.calls.map(([, next]) => next)).toEqual(["4", "8", "13"])
  })

  it("keeps offsets above Number.MAX_SAFE_INTEGER exact", async () => {
    const h = harness({ assignment: assignment({ nextOffset: "9007199254740993" }) })
    await h.processor.processBatch({ fetchOffset: "9007199254740993", records: [record("9007199254740993"), record("9007199254740995")] })
    expect(h.commit.mock.calls.map(([, next]) => next)).toEqual(["9007199254740994", "9007199254740996"])
  })

  it("allows the last representable next-offset but rejects a record whose acknowledgement overflows", async () => {
    const h = harness({ assignment: assignment({ nextOffset: "9223372036854775806" }) })
    await h.processor.processBatch({ fetchOffset: "9223372036854775806", records: [record("9223372036854775806")] })
    expect(h.commit.mock.calls[0][1]).toBe("9223372036854775807")
    await expect(h.processor.processBatch({ fetchOffset: "9223372036854775807", records: [record("9223372036854775807")] })).rejects.toMatchObject({ code: "INVALID_DELIVERY" })
    expect(h.apply).toHaveBeenCalledTimes(1)
  })

  it.each(["-1", "01", "+1", "1.0", "1e3", "9223372036854775808"])("rejects invalid record offset %s before any apply", async invalid => {
    const h = harness()
    await expect(h.processor.processBatch({ fetchOffset: "0", records: [record(), record(invalid)] })).rejects.toMatchObject({ code: "INVALID_DELIVERY" })
    expect(h.apply).not.toHaveBeenCalled()
    expect(h.commit).not.toHaveBeenCalled()
  })

  it.each([
    { name: "mismatched fetch cursor", fetchOffset: "1", records: [record("1")] },
    { name: "repeated record offset", fetchOffset: "0", records: [record(), record()] },
    { name: "descending record offset", fetchOffset: "0", records: [record("2"), record("1")] },
    { name: "mixed topic", fetchOffset: "0", records: [record(), { ...record("1"), topic: "ld.test.other.events.v1" }] },
    { name: "mixed partition", fetchOffset: "0", records: [record(), { ...record("1"), partition: 1 }] },
  ])("rejects $name without partially applying the batch", async ({ fetchOffset, records }) => {
    const h = harness()
    await expect(h.processor.processBatch({ fetchOffset, records })).rejects.toMatchObject({ code: "INVALID_DELIVERY" })
    expect(h.apply).not.toHaveBeenCalled()
    expect(h.commit).not.toHaveBeenCalled()
    expect(h.processor.status().state).toBe("stopped")
  })

  it("rejects delivery behind the current broker cursor", async () => {
    const h = harness({ assignment: assignment({ nextOffset: "5" }) })
    await expect(h.processor.processBatch({ fetchOffset: "5", records: [record("4")] })).rejects.toMatchObject({ code: "INVALID_DELIVERY" })
    expect(h.apply).not.toHaveBeenCalled()
  })

  it("does not advance an empty fetch to an arbitrary broker high-water", async () => {
    const h = harness()
    await expect(h.processor.processBatch({ fetchOffset: "0", records: [] })).resolves.toEqual({ processed: 0, nextOffset: "0" })
    expect(h.apply).not.toHaveBeenCalled()
    expect(h.commit).not.toHaveBeenCalled()
  })

  it("rejects concurrent batches without queueing or stopping the first batch", async () => {
    const waiting = gate()
    const h = harness({ apply: async () => { await waiting.promise } })
    const first = h.processor.processBatch({ fetchOffset: "0", records: [record()] })
    await expect(h.processor.processBatch({ fetchOffset: "0", records: [record()] })).rejects.toMatchObject({ code: "PARTITION_BUSY" })
    expect(h.processor.status().state).toBe("processing")
    expect(h.apply).toHaveBeenCalledTimes(1)
    waiting.release()
    await first
    await h.processor.processBatch({ fetchOffset: "1", records: [record("1")] })
    expect(h.apply).toHaveBeenCalledTimes(2)
  })

  it("permanently revokes synchronously before processing, even if the broker says current", async () => {
    const h = harness()
    h.processor.revoke()
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(h.processor.processBatch({ fetchOffset: "0", records: [record()] })).rejects.toMatchObject({ code: "ASSIGNMENT_REVOKED" })
    }
    expect(h.apply).not.toHaveBeenCalled()
    expect(h.commit).not.toHaveBeenCalled()
    expect(h.processor.status().state).toBe("revoked")
  })

  it("allows an in-flight DB commit to finish after revoke but never acknowledges it", async () => {
    const waiting = gate()
    let committed = false
    const h = harness({ apply: async () => { await waiting.promise; committed = true } })
    const pending = h.processor.processBatch({ fetchOffset: "0", records: [record(), record("1")] })
    h.processor.revoke()
    const rejected = expect(pending).rejects.toMatchObject({ code: "ASSIGNMENT_REVOKED" })
    waiting.release()
    await rejected
    expect(committed).toBe(true)
    expect(h.apply).toHaveBeenCalledTimes(1)
    expect(h.commit).not.toHaveBeenCalled()
    expect(h.processor.status()).toEqual({ state: "revoked", nextOffset: "0" })
  })

  it("does not resume after revoke while a broker commit request is in flight", async () => {
    const entered = gate()
    const waiting = gate()
    const h = harness()
    h.commit.mockImplementation(async () => { entered.release(); await waiting.promise })
    const pending = h.processor.processBatch({ fetchOffset: "0", records: [record(), record("1")] })
    await entered.promise
    h.processor.revoke()
    const rejected = expect(pending).rejects.toMatchObject({ code: "ASSIGNMENT_REVOKED" })
    waiting.release()
    await rejected
    expect(h.apply).toHaveBeenCalledTimes(1)
    expect(h.commit).toHaveBeenCalledTimes(1) // Already sent; revocation cannot unsend it.
    expect(h.processor.status()).toEqual({ state: "revoked", nextOffset: "0" })
  })

  it.each([2, 3, 4])("honours synchronous revoke inside isCurrent at boundary %s", async revokeAt => {
    const h = harness()
    let checks = 0
    h.isCurrent.mockImplementation(() => { if (++checks === revokeAt) h.processor.revoke(); return true })
    await expect(h.processor.processBatch({ fetchOffset: "0", records: [record()] })).rejects.toMatchObject({ code: "ASSIGNMENT_REVOKED" })
    expect(h.apply).toHaveBeenCalledTimes(revokeAt === 2 ? 0 : 1)
    expect(h.commit).toHaveBeenCalledTimes(revokeAt === 4 ? 1 : 0)
    expect(h.processor.status()).toEqual({ state: "revoked", nextOffset: "0" })
  })

  it("turns a stale broker membership check into terminal revocation", async () => {
    const h = harness()
    h.isCurrent.mockReturnValue(false)
    await expect(h.processor.processBatch({ fetchOffset: "0", records: [record()] })).rejects.toMatchObject({ code: "ASSIGNMENT_REVOKED" })
    expect(h.apply).not.toHaveBeenCalled()
    h.isCurrent.mockReturnValue(true)
    await expect(h.processor.processBatch({ fetchOffset: "0", records: [record()] })).rejects.toMatchObject({ code: "ASSIGNMENT_REVOKED" })
  })

  it("passes original membership to broker-side fencing for a race after the local guard", async () => {
    const original = { ...assignment() }
    const h = harness({ assignment: original })
    const fenced = new Error("broker rejected old member/generation")
    h.commit.mockImplementation(async captured => {
      expect(captured.memberId).toBe("member-original")
      expect(captured.generationId).toBe(7)
      throw fenced
    })
    original.memberId = "member-new"
    original.generationId = 8
    original.topic = "other-topic"
    original.partition = 8
    original.nextOffset = "900"
    await expect(h.processor.processBatch({ fetchOffset: "0", records: [record()] })).rejects.toBe(fenced)
    expect(h.commit).toHaveBeenCalledTimes(1)
    expect(Object.isFrozen(h.commit.mock.calls[0][0])).toBe(true)
    expect(h.processor.status()).toEqual({ state: "stopped", nextOffset: "0" })
  })

  it("snapshots all records, Buffers, header arrays and ordering before the first await", async () => {
    const waiting = gate()
    const h = harness({ apply: async incoming => { if (incoming.offset === "0") await waiting.promise } })
    const second: KafkaEventRecord = { ...record("1"), key: Buffer.from("original-key"), value: Buffer.from("original-value"),
      headers: { organizationid: Buffer.from("tenant-a"), trace: [Buffer.from("trace-one")] } }
    const records = [record(), second]
    const pending = h.processor.processBatch({ fetchOffset: "0", records })
    ;(second.key as Buffer).fill(0)
    ;(second.value as Buffer).fill(0)
    ;(second.headers!.organizationid as Buffer).fill(0)
    ;(second.headers!.trace as Buffer[])[0].fill(0)
    ;(second.headers!.trace as Buffer[]).push(Buffer.from("extra"))
    second.offset = "99"
    second.topic = "forged-topic"
    records.splice(1, 1, record("100", "tenant-b"))
    waiting.release()
    await pending
    expect(h.apply.mock.calls[1][0]).toEqual({ topic: TOPIC, partition: 0, offset: "1", key: Buffer.from("original-key"), value: Buffer.from("original-value"),
      headers: { organizationid: Buffer.from("tenant-a"), trace: [Buffer.from("trace-one")] } })
    expect(h.commit.mock.calls.map(([, next]) => next)).toEqual(["1", "2"])
  })

  it("captures the broker methods instead of replacing them mid-assignment", async () => {
    const h = harness()
    const replacement = vi.fn(async () => {})
    h.broker.commitNextOffset = replacement
    h.broker.isCurrent = () => false
    await h.processor.processBatch({ fetchOffset: "0", records: [record()] })
    expect(h.commit).toHaveBeenCalledTimes(1)
    expect(replacement).not.toHaveBeenCalled()
  })

  it("enforces record limits before applying any item", async () => {
    const h = harness({ maxBatchRecords: 1 })
    await expect(h.processor.processBatch({ fetchOffset: "0", records: [record(), record("1")] })).rejects.toMatchObject({ code: "INVALID_DELIVERY" })
    expect(h.apply).not.toHaveBeenCalled()
  })

  it("counts UTF-8 bytes, accepts the exact byte bound, and rejects excess before apply", async () => {
    const incoming: KafkaEventRecord = { topic: TOPIC, partition: 0, offset: "0", key: "", value: "😀😀", headers: {} }
    const bytes = Buffer.byteLength(TOPIC) + 1 + 8 + Buffer.byteLength("😀😀")
    const exact = harness({ maxBatchBytes: bytes })
    await exact.processor.processBatch({ fetchOffset: "0", records: [incoming] })
    const short = harness({ maxBatchBytes: bytes - 1 })
    await expect(short.processor.processBatch({ fetchOffset: "0", records: [incoming] })).rejects.toMatchObject({ code: "INVALID_DELIVERY" })
    expect(short.apply).not.toHaveBeenCalled()
  })

  it.each([
    { maxBatchRecords: 0 }, { maxBatchRecords: 1001 }, { maxBatchRecords: 1.5 },
    { maxBatchBytes: 0 }, { maxBatchBytes: 16 * 1024 * 1024 + 1 }, { maxBatchBytes: 1.5 },
  ])("rejects invalid configured bounds %j", options => {
    expect(() => harness(options)).toThrow("INVALID_DELIVERY")
  })

  it.each([
    { headers: Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`h${index}`, "v"])) },
    { headers: { repeated: Array(9).fill("value") } },
    { headers: { ["x".repeat(129)]: "value" } },
    { key: null }, { value: null },
  ])("rejects unbounded headers or absent record bytes %j", async changes => {
    const h = harness()
    await expect(h.processor.processBatch({ fetchOffset: "0", records: [{ ...record(), ...changes }] })).rejects.toMatchObject({ code: "INVALID_DELIVERY" })
    expect(h.apply).not.toHaveBeenCalled()
  })

  it.each([{ generationId: -1 }, { generationId: 1.5 }, { partition: 2147483648 }, { clusterId: "" }, { groupId: "unsafe group" }, { nextOffset: "01" }])(
    "rejects invalid assignment %j", changes => { expect(() => harness({ assignment: assignment(changes) })).toThrow("INVALID_DELIVERY") },
  )
})
