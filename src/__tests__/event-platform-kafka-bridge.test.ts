import { PassThrough } from "node:stream"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createKafkaBridgeChannel, KafkaBridgeError, runKafkaBridge, type KafkaBridgeChannel } from "../lib/event-platform/kafka-bridge"
import type { KafkaEventRecord } from "../lib/event-platform/consumer"
import { createPartitionProcessor, type PartitionAssignment, type PartitionBroker } from "../lib/event-platform/partition-processor"

const CLUSTER = "fixture-cluster"
const GROUP = "fixture-shadow-build"
const TOPIC = "ld.test.finance.events.v1"
const READY = `READY\t${CLUSTER}\t${GROUP}\t${TOPIC}`
const encode = (value: string | Buffer) => (Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8")).toString("base64")
const assigned = (id = "1", cursor = "0", partition = 0, member = "member-original", generation = 7) =>
  `ASSIGN\t${id}\t${member}\t${generation}\t${partition}\t${cursor}`
function record(offset = "0", options: {
  id?: string; key?: string | null; value?: string | null; headers?: Array<[string, string | null]>
} = {}) {
  const key = options.key === undefined ? "tenant-a:fund:a" : options.key
  const value = options.value === undefined ? "synthetic-payload" : options.value
  const headers = options.headers ?? []
  return ["RECORD", options.id ?? "1", offset, key === null ? "~" : encode(key), value === null ? "~" : encode(value),
    String(headers.length), ...headers.flatMap(([name, bytes]) => [encode(name), bytes === null ? "~" : encode(bytes)])].join("\t")
}
function gate() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}
type Step = string | (() => Promise<string>)
function harness(steps: Step[], options: {
  apply?: (record: KafkaEventRecord) => Promise<unknown>
  afterBatch?: () => Promise<void>
  signal?: AbortSignal
  maxRecords?: number
} = {}) {
  const queue = [...steps]
  const order: string[] = []
  const apply = vi.fn(options.apply ?? (async (_record: KafkaEventRecord) => undefined))
  const processors: ReturnType<typeof createPartitionProcessor>[] = []
  const batches: Array<{ fetchOffset: string; records: KafkaEventRecord[] }> = []
  const channel = {
    read: vi.fn(async () => {
      const next = queue.shift()
      if (next === undefined) throw new Error("synthetic private pipe EOF")
      return typeof next === "function" ? next() : next
    }),
    write: vi.fn(async (command: string) => { order.push(command) }),
    close: vi.fn(async () => {}),
  } satisfies KafkaBridgeChannel
  const createProcessor = vi.fn((assignment: Readonly<PartitionAssignment>, broker: PartitionBroker) => {
    const processor = createPartitionProcessor({ assignment, broker, applyCommitted: apply })
    processors.push(processor)
    return {
      revoke: () => processor.revoke(),
      async processBatch(batch: { fetchOffset: string; records: KafkaEventRecord[] }) {
        batches.push(batch)
        const result = await processor.processBatch(batch)
        await options.afterBatch?.()
        return result
      },
    }
  })
  const run = () => runKafkaBridge({ channel, clusterId: CLUSTER, groupId: GROUP, topic: TOPIC,
    createProcessor, maxRecords: options.maxRecords ?? 1, signal: options.signal })
  return { channel, createProcessor, apply, processors, batches, order, run }
}

// Fake private pipe, real partition processor: these prove adapter boundaries,
// not Kafka group fencing, physical broker fetches, actual SQL or restore proof.
describe("Kafka private bridge adapter", () => {
  it("waits for real processor DB completion before sending ACK and waits for COMMITTED before success", async () => {
    const dbEntered = gate(), dbDone = gate(), ackEntered = gate(), ackDone = gate()
    const h = harness([READY, assigned(), record(), async () => {
      ackEntered.release(); await ackDone.promise; return "COMMITTED\t1\t1"
    }], { apply: async () => { dbEntered.release(); await dbDone.promise } })
    let finished = false
    const pending = h.run().then(value => { finished = true; return value })
    await dbEntered.promise
    expect(h.order).toEqual(["NEXT"])
    expect(h.channel.read).toHaveBeenCalledTimes(3)
    dbDone.release()
    await ackEntered.promise
    expect(h.order).toEqual(["NEXT", "ACK\t1\t1"])
    expect(finished).toBe(false)
    ackDone.release()
    await expect(pending).resolves.toEqual({ processed: 1 })
    expect(h.channel.close).toHaveBeenCalledTimes(1)
    expect(h.processors[0].status()).toEqual({ state: "revoked", nextOffset: "1" })
  })

  it("does not request the next poll until the entire processBatch has returned", async () => {
    const returned = gate(), releaseReturn = gate()
    let completed = 0
    const h = harness([READY, assigned(), record(), "COMMITTED\t1\t1", record("1"), "COMMITTED\t1\t2"], {
      maxRecords: 2,
      afterBatch: async () => { if (++completed === 1) { returned.release(); await releaseReturn.promise } },
    })
    const pending = h.run()
    await returned.promise
    expect(h.order).toEqual(["NEXT", "ACK\t1\t1"])
    expect(h.channel.read).toHaveBeenCalledTimes(4)
    releaseReturn.release()
    await expect(pending).resolves.toEqual({ processed: 2 })
    expect(h.order).toEqual(["NEXT", "ACK\t1\t1", "NEXT", "ACK\t1\t2"])
  })

  it("preserves A/B/A order and ignores every tenant-local checkpoint for the broker cursor", async () => {
    const h = harness([READY, assigned(), record("0", { key: "tenant-a" }), "COMMITTED\t1\t1",
      record("1", { key: "tenant-b" }), "COMMITTED\t1\t2", record("2", { key: "tenant-a" }), "COMMITTED\t1\t3"], {
      maxRecords: 3, apply: async () => ({ duplicate: true, checkpoint: { sourceOffset: BigInt(900) } }),
    })
    await h.run()
    expect(h.apply.mock.calls.map(([event]) => String(event.key))).toEqual(["tenant-a", "tenant-b", "tenant-a"])
    expect(h.batches.map(batch => batch.fetchOffset)).toEqual(["0", "1", "2"])
    expect(h.order.filter(command => command.startsWith("ACK"))).toEqual(["ACK\t1\t1", "ACK\t1\t2", "ACK\t1\t3"])
  })

  it("keeps the logical cursor across empty/control-only polls and sparse offsets", async () => {
    const h = harness([READY, assigned(), "IDLE", record("3"), "COMMITTED\t1\t4", "IDLE",
      record("8"), "COMMITTED\t1\t9"], { maxRecords: 2 })
    await h.run()
    expect(h.batches.map(batch => batch.fetchOffset)).toEqual(["0", "4"])
    expect(h.order.filter(command => command.startsWith("ACK"))).toEqual(["ACK\t1\t4", "ACK\t1\t9"])
  })

  it.each([
    ["9007199254740993", "9007199254740995", "9007199254740996"],
    ["9223372036854775806", "9223372036854775806", "9223372036854775807"],
  ])("preserves exact decimal offsets starting at %s", async (cursor, incoming, committed) => {
    const h = harness([READY, assigned("1", cursor), record(incoming), `COMMITTED\t1\t${committed}`])
    await h.run()
    expect(h.batches[0].fetchOffset).toBe(cursor)
    expect(h.apply.mock.calls[0][0].offset).toBe(incoming)
    expect(h.order).toEqual(["NEXT", `ACK\t1\t${committed}`])
  })

  it("binds separate partition cursors to frozen assignment identities", async () => {
    const h = harness([READY, assigned("1", "10", 0), assigned("2", "20", 1), record("20", { id: "2" }),
      "COMMITTED\t2\t21", record("10"), "COMMITTED\t1\t11"], { maxRecords: 2 })
    await h.run()
    expect(h.batches.map(batch => [batch.fetchOffset, batch.records[0].partition])).toEqual([["20", 1], ["10", 0]])
    expect(h.createProcessor.mock.calls.map(([value]) => Object.isFrozen(value))).toEqual([true, true])
    expect(h.createProcessor.mock.calls[0][0]).toEqual({ clusterId: CLUSTER, groupId: GROUP, topic: TOPIC,
      memberId: "member-original", generationId: 7, partition: 0, nextOffset: "10" })
  })

  it("revokes an old lease before admitting the replacement assignment", async () => {
    const h = harness([READY, assigned(), "REVOKE\t1", assigned("2", "5", 0, "member-new", 8),
      record("5", { id: "2" }), "COMMITTED\t2\t6"])
    await h.run()
    expect(h.processors[0].status()).toEqual({ state: "revoked", nextOffset: "0" })
    expect(h.createProcessor.mock.calls[1][0]).toMatchObject({ memberId: "member-new", generationId: 8, nextOffset: "5" })
    expect(h.order).toEqual(["NEXT", "ACK\t2\t6"])
  })

  it("retains duplicate binary headers as arrays, including prototype-like names", async () => {
    const h = harness([READY, assigned(), record("0", { headers: [["trace", "first"], ["trace", "second"],
      ["__proto__", "data"], ["empty", ""]] }), "COMMITTED\t1\t1"])
    await h.run()
    const incoming = h.apply.mock.calls[0][0]
    expect(incoming.headers?.trace).toEqual([Buffer.from("first"), Buffer.from("second")])
    expect(incoming.headers?.__proto__).toEqual(Buffer.from("data"))
    expect(incoming.headers?.empty).toEqual(Buffer.alloc(0))
    expect(Buffer.isBuffer(incoming.key)).toBe(true)
    expect(Buffer.isBuffer(incoming.value)).toBe(true)
  })

  it("preserves a header-name BOM rather than aliasing a different trusted header", async () => {
    const h = harness([READY, assigned(), record("0", { headers: [["\uFEFFeventId", "untrusted-name"]] }), "COMMITTED\t1\t1"])
    await h.run()
    expect(h.apply.mock.calls[0][0].headers?.["\uFEFFeventId"]).toEqual(Buffer.from("untrusted-name"))
    expect(h.apply.mock.calls[0][0].headers?.eventId).toBeUndefined()
  })

  it("does not acknowledge an adapter DB failure or request another record", async () => {
    const failure = new Error("synthetic deferred database COMMIT failure")
    const h = harness([READY, assigned(), record(), "COMMITTED\t1\t1", record("1")], {
      apply: async () => { throw failure }, maxRecords: 2,
    })
    await expect(h.run()).rejects.toEqual(new KafkaBridgeError())
    expect(h.order).toEqual(["NEXT"])
    expect(h.apply).toHaveBeenCalledTimes(1)
    expect(h.channel.read).toHaveBeenCalledTimes(3)
    expect(h.channel.close).toHaveBeenCalledTimes(1)
  })

  it.each(["COMMITTED\t1\t2", "COMMITTED\t2\t1", "COMMITTED\t1\t01", "COMMITTED\t1\t1\textra",
    "REVOKE\t1", "IDLE", "FAIL\tBRIDGE_STOPPED", record("1")])("fails terminally on unexpected acknowledgement %s", async ack => {
    const h = harness([READY, assigned(), record(), ack, record("1")], { maxRecords: 2 })
    await expect(h.run()).rejects.toBeInstanceOf(KafkaBridgeError)
    expect(h.apply).toHaveBeenCalledTimes(1)
    expect(h.order).toEqual(["NEXT", "ACK\t1\t1"])
    expect(h.channel.close).toHaveBeenCalledTimes(1)
  })

  it("treats EOF after DB completion as uncertain acknowledgement and closes", async () => {
    const h = harness([READY, assigned(), record()])
    await expect(h.run()).rejects.toThrow()
    expect(h.apply).toHaveBeenCalledTimes(1)
    expect(h.order).toEqual(["NEXT", "ACK\t1\t1"])
    expect(h.processors[0].status()).toEqual({ state: "revoked", nextOffset: "0" })
    expect(h.channel.close).toHaveBeenCalledTimes(1)
  })

  it("invalidates an in-flight SQL operation on abort without acknowledging its eventual completion", async () => {
    const controller = new AbortController(), entered = gate(), finished = gate()
    const h = harness([READY, assigned(), record(), "COMMITTED\t1\t1"], {
      signal: controller.signal, apply: async () => { entered.release(); await finished.promise },
    })
    const pending = h.run()
    const rejected = expect(pending).rejects.toEqual(new KafkaBridgeError())
    await entered.promise
    controller.abort()
    expect(h.channel.close).toHaveBeenCalled()
    finished.release()
    await rejected
    expect(h.order).toEqual(["NEXT"])
    expect(h.channel.read).toHaveBeenCalledTimes(3)
    expect(h.processors[0].status().state).toBe("revoked")
  })

  it("closes an already-aborted invocation without reading or polling", async () => {
    const controller = new AbortController(); controller.abort()
    const h = harness([READY], { signal: controller.signal })
    await expect(h.run()).rejects.toBeInstanceOf(KafkaBridgeError)
    expect(h.channel.read).not.toHaveBeenCalled()
    expect(h.order).toEqual([])
    expect(h.channel.close).toHaveBeenCalledTimes(1)
  })

  it.each([
    ["cluster mismatch", READY.replace(CLUSTER, "other-cluster")],
    ["group mismatch", READY.replace(GROUP, "other-group")],
    ["topic mismatch", READY.replace(TOPIC, "ld.test.other.events.v1")],
    ["extra ready field", READY + "\textra"],
    ["non-ready first frame", "IDLE"],
  ])("closes on %s without requesting records", async (_name, frame) => {
    const h = harness([frame])
    await expect(h.run()).rejects.toBeInstanceOf(KafkaBridgeError)
    expect(h.order).toEqual([])
    expect(h.createProcessor).not.toHaveBeenCalled()
    expect(h.channel.close).toHaveBeenCalledTimes(1)
  })

  const malformed: Array<[string, Step[]]> = [
    ["unknown lease", [record("0", { id: "2" })]],
    ["old lease after revoke", ["REVOKE\t1", record()]],
    ["unknown revoke", ["REVOKE\t9"]],
    ["duplicate lease", [assigned()]],
    ["duplicate active partition", [assigned("2")]],
    ["reused lease id after revoke", ["REVOKE\t1", assigned()]],
    ["invalid member", ["REVOKE\t1", assigned("2", "0", 0, "member with whitespace")]],
    ["negative generation", ["REVOKE\t1", assigned("2", "0", 0, "member", -1)]],
    ["overflow partition", [assigned("2", "0", 2147483648)]],
    ["noncanonical lease", [assigned("02", "0", 1)]],
    ["noncanonical offset", [record("00")]],
    ["negative offset", [record("-1")]],
    ["record offset cannot be acknowledged", [record("9223372036854775807")]],
    ["overflow offset", [record("9223372036854775808")]],
    ["bad base64", ["RECORD\t1\t0\t%%%\tYQ==\t0"]],
    ["noncanonical base64", ["RECORD\t1\t0\tZh==\tYQ==\t0"]],
    ["missing header field", ["RECORD\t1\t0\tYQ==\tYQ==\t1\tYg=="]],
    ["extra record field", [record() + "\textra"]],
    ["negative header count", ["RECORD\t1\t0\tYQ==\tYQ==\t-1"]],
    ["too many headers", [record("0", { headers: Array.from({ length: 33 }, (_, i) => [`h${i}`, "v"]) })]],
    ["too many duplicate headers", [record("0", { headers: Array.from({ length: 9 }, () => ["same", "v"]) })]],
    ["empty header name", [record("0", { headers: [["", "value"]] })]],
    ["oversized header name", [record("0", { headers: [["h".repeat(129), "value"]] })]],
    ["invalid UTF-8 header name", ["RECORD\t1\t0\tYQ==\tYQ==\t1\t/w==\tYg=="]],
    ["null header", [record("0", { headers: [["key", null]] })]],
    ["null key", [record("0", { key: null })]],
    ["null value", [record("0", { value: null })]],
    ["embedded newline", [record() + "\n"]],
    ["non-ASCII protocol", ["IDLE\u0080"]],
    ["oversized protocol frame", ["X".repeat(1_500_001)]],
    ["oversized decoded record", [record("0", { key: "a", value: "v".repeat(1024 * 1024) })]],
    ["unknown frame", ["FAIL\tBRIDGE_STOPPED"]],
  ]
  it.each(malformed)("rejects %s before applying or acknowledging", async (_name, frames) => {
    const h = harness([READY, assigned(), ...frames])
    await expect(h.run()).rejects.toThrow()
    expect(h.apply).not.toHaveBeenCalled()
    expect(h.order).toEqual(["NEXT"])
    expect(h.channel.close).toHaveBeenCalledTimes(1)
  })

  it("rejects a record behind the acknowledged cursor", async () => {
    const h = harness([READY, assigned("1", "5"), record("4")])
    await expect(h.run()).rejects.toBeInstanceOf(KafkaBridgeError)
    expect(h.apply).not.toHaveBeenCalled()
    expect(h.order).toEqual(["NEXT"])
  })

  it("accepts the exact decoded-record size limit without losing binary bytes", async () => {
    const h = harness([READY, assigned(), record("0", { key: "a", value: "v".repeat(1024 * 1024 - 1) }), "COMMITTED\t1\t1"])
    await expect(h.run()).resolves.toEqual({ processed: 1 })
    expect(h.apply.mock.calls[0][0].value).toEqual(Buffer.alloc(1024 * 1024 - 1, 118))
  })

  it("sanitizes channel-close failure rather than leaking private pipe diagnostics", async () => {
    const h = harness([READY, assigned(), record(), "COMMITTED\t1\t1"])
    h.channel.close.mockRejectedValueOnce(new Error("synthetic secret from process cleanup"))
    await expect(h.run()).rejects.toEqual(new KafkaBridgeError())
    expect(h.channel.close).toHaveBeenCalledTimes(1)
  })

  it.each([0, -1, 1.5, 100_001, Number.NaN])("closes the supplied channel on invalid record limit %s", async maxRecords => {
    const h = harness([READY], { maxRecords })
    await expect(h.run()).rejects.toBeInstanceOf(KafkaBridgeError)
    expect(h.channel.read).not.toHaveBeenCalled()
    expect(h.channel.close).toHaveBeenCalledTimes(1)
  })
})

function pipeHarness(timeoutMs = 1000) {
  const stdout = new PassThrough(), stdin = new PassThrough()
  const terminate = vi.fn(async () => {})
  const channel = createKafkaBridgeChannel({ stdout, stdin, terminate, timeoutMs })
  return { stdout, stdin, terminate, channel }
}
afterEach(() => { vi.useRealTimers() })

describe("bounded private Kafka bridge pipes — no subprocess or network", () => {
  it("assembles fragmented frames and preserves coalesced subsequent frames", async () => {
    const h = pipeHarness()
    const first = h.channel.read()
    h.stdout.write(Buffer.from("REA")); h.stdout.write(Buffer.from("DY\tcluster\tgroup\ttopic\nIDLE\n"))
    await expect(first).resolves.toBe("READY\tcluster\tgroup\ttopic")
    await expect(h.channel.read()).resolves.toBe("IDLE")
    await h.channel.close()
    expect(h.terminate).toHaveBeenCalledTimes(1)
  })

  it("writes only newline-framed canonical commands", async () => {
    const h = pipeHarness()
    await h.channel.write("NEXT")
    expect(h.stdin.read()?.toString()).toBe("NEXT\n")
    await h.channel.write("ACK\t12\t9007199254740994")
    expect(h.stdin.read()?.toString()).toBe("ACK\t12\t9007199254740994\n")
    await h.channel.close()
  })

  it.each(["NEXT\nACK\t1\t1", "STOP", "ACK\t0\t1", "ACK\t01\t1", "ACK\t1\t01", "ACK\t1\t-1", "ACK\t1\t1\textra"])(
    "rejects malformed command %s without writing bytes", async command => {
      const h = pipeHarness()
      await expect(h.channel.write(command)).rejects.toBeInstanceOf(KafkaBridgeError)
      expect(h.stdin.read()).toBeNull()
      await h.channel.close()
    })

  it.each([Buffer.from("IDLE\r\n"), Buffer.from("IDLE\x00\n"), Buffer.from([0xff, 10]),
    Buffer.from("X".repeat(1_500_001) + "\n"), Buffer.alloc(1_565_537, 88)])("rejects a non-ASCII or oversized raw frame %#", async frame => {
    const h = pipeHarness()
    const pending = h.channel.read()
    const rejected = expect(pending).rejects.toBeInstanceOf(KafkaBridgeError)
    h.stdout.write(frame)
    await rejected
    expect(h.terminate).toHaveBeenCalledTimes(1)
    expect(h.stdout.destroyed).toBe(true)
    expect(h.stdin.destroyed).toBe(true)
  })

  it.each(["", "partial-frame"])("terminates on EOF with %s", async contents => {
    const h = pipeHarness()
    const pending = h.channel.read()
    const rejected = expect(pending).rejects.toBeInstanceOf(KafkaBridgeError)
    h.stdout.end(contents)
    await rejected
    expect(h.terminate).toHaveBeenCalledTimes(1)
  })

  it("bounds a stalled read and terminates only once", async () => {
    vi.useFakeTimers()
    const h = pipeHarness(20)
    const pending = h.channel.read()
    const rejected = expect(pending).rejects.toBeInstanceOf(KafkaBridgeError)
    await vi.advanceTimersByTimeAsync(21)
    await rejected
    await Promise.all([h.channel.close(), h.channel.close()])
    expect(h.terminate).toHaveBeenCalledTimes(1)
  })

  it("bounds a backpressured write and destroys both pipes", async () => {
    vi.useFakeTimers()
    const stdout = new PassThrough(), stdin = new PassThrough({ highWaterMark: 1 })
    const terminate = vi.fn(async () => {})
    const channel = createKafkaBridgeChannel({ stdout, stdin, terminate, timeoutMs: 20 })
    // With no reader and a one-byte readable high-water mark, this write's
    // callback cannot complete until the consuming side drains the pipe.
    const pending = channel.write("NEXT")
    const rejected = expect(pending).rejects.toBeInstanceOf(KafkaBridgeError)
    await vi.advanceTimersByTimeAsync(21)
    await rejected
    expect(terminate).toHaveBeenCalledTimes(1)
    expect(stdout.destroyed).toBe(true)
    expect(stdin.destroyed).toBe(true)
  })

  it("rejects concurrent reads without allowing a second consumer to steal the frame", async () => {
    const h = pipeHarness()
    const first = h.channel.read()
    await expect(h.channel.read()).rejects.toBeInstanceOf(KafkaBridgeError)
    h.stdout.write("IDLE\n")
    await expect(first).resolves.toBe("IDLE")
    await h.channel.close()
  })

  it("makes close idempotent and rejects further reads/writes", async () => {
    const h = pipeHarness()
    await Promise.all([h.channel.close(), h.channel.close()])
    await expect(h.channel.read()).rejects.toBeInstanceOf(KafkaBridgeError)
    await expect(h.channel.write("NEXT")).rejects.toBeInstanceOf(KafkaBridgeError)
    expect(h.terminate).toHaveBeenCalledTimes(1)
  })

  it("closing a pending read terminates it without waiting for the deadline", async () => {
    const h = pipeHarness()
    const pending = h.channel.read()
    const rejected = expect(pending).rejects.toBeInstanceOf(KafkaBridgeError)
    await h.channel.close()
    await rejected
    expect(h.terminate).toHaveBeenCalledTimes(1)
  })

  it("sanitizes a failed child terminator when a pipe ends", async () => {
    const h = pipeHarness()
    h.terminate.mockRejectedValueOnce(new Error("synthetic secret from child terminator"))
    const pending = h.channel.read()
    const rejected = expect(pending).rejects.toEqual(new KafkaBridgeError())
    h.stdout.end()
    await rejected
    expect(h.terminate).toHaveBeenCalledTimes(1)
  })
})
