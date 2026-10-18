import { afterEach, describe, expect, it, vi } from "vitest"
import { KafkaBridgeError, type KafkaBridgeChannel } from "../lib/event-platform/kafka-bridge"
import { createPartitionProcessor } from "../lib/event-platform/partition-processor"
import { startKafkaWorkerSession, type KafkaWorkerResources } from "../lib/event-platform/worker-session"

const config = { clusterId: "fixture", groupId: "shadow", topic: "ld.test.finance.events.v1", maxRecords: 1, maxDurationMs: 1000 }
function gate() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}
function harness(options: { apply?: () => Promise<void>; close?: () => Promise<void>; release?: () => Promise<void> } = {}) {
  const queue = [`READY\t${config.clusterId}\t${config.groupId}\t${config.topic}`, "ASSIGN\t1\tmember\t1\t0\t0",
    "RECORD\t1\t0\ta2V5\tdmFsdWU=\t0", "COMMITTED\t1\t1"]
  const order: string[] = []
  const channel: KafkaBridgeChannel = {
    read: vi.fn(async () => { const next = queue.shift(); if (!next) throw new Error("fixture EOF"); return next }),
    write: vi.fn(async command => { order.push(command) }),
    close: vi.fn(async () => { order.push("close"); await options.close?.() }),
  }
  const release = vi.fn(async () => { order.push("release"); await options.release?.() })
  const apply = vi.fn(async () => { order.push("SQL-start"); await options.apply?.(); order.push("SQL-settled") })
  const open = vi.fn((): KafkaWorkerResources => ({ channel, release,
    createProcessor: (assignment, broker) => createPartitionProcessor({ assignment, broker, applyCommitted: apply }) }))
  return { open, release, apply, channel, order }
}
afterEach(() => { vi.useRealTimers() })

describe("finite Kafka session lifecycle (not production admission)", () => {
  it("rejects a malformed resource factory with a sanitized error", () => {
    expect(() => startKafkaWorkerSession({ ...config, open: null as unknown as () => KafkaWorkerResources })).toThrow(KafkaBridgeError)
  })
  it.each([0, -1, 0.5, 600_001, NaN, Infinity])("rejects bad intake deadline %s before opening resources", maxDurationMs => {
    const h = harness()
    expect(() => startKafkaWorkerSession({ ...config, maxDurationMs, open: h.open })).toThrow(KafkaBridgeError)
    expect(h.open).not.toHaveBeenCalled()
  })
  it.each([0, -1, 0.5, 100_001, NaN, Infinity])("rejects bad record budget %s before opening resources", maxRecords => {
    const h = harness()
    expect(() => startKafkaWorkerSession({ ...config, maxRecords, open: h.open })).toThrow(KafkaBridgeError)
    expect(h.open).not.toHaveBeenCalled()
  })
  it.each(["", "spaces not allowed", "\nsecret", "x".repeat(250)])("rejects invalid identities before opening resources", value => {
    const h = harness()
    for (const field of ["clusterId", "groupId", "topic"]) {
      expect(() => startKafkaWorkerSession({ ...config, [field]: value, open: h.open })).toThrow(KafkaBridgeError)
    }
    expect(h.open).not.toHaveBeenCalled()
  })
  it("waits for committed processing, confirmed channel close AND resource release before success", async () => {
    const exiting = gate(), reaped = gate(), releasing = gate(), released = gate()
    const h = harness({ close: async () => { exiting.release(); await reaped.promise },
      release: async () => { releasing.release(); await released.promise } })
    const session = startKafkaWorkerSession({ ...config, open: h.open })
    let done = false
    const result = session.done.then(value => { done = true; return value })
    await exiting.promise; expect(done).toBe(false); expect(h.release).not.toHaveBeenCalled()
    reaped.release(); await releasing.promise; expect(done).toBe(false)
    released.release(); await expect(result).resolves.toEqual({ processed: 1 })
    expect(h.order).toEqual(["NEXT", "SQL-start", "SQL-settled", "ACK\t1\t1", "close", "release"])
    session.stop(); expect(h.release).toHaveBeenCalledOnce(); expect(h.open).toHaveBeenCalledOnce()
  })
  it.each(["stop", "external", "deadline"])("%s fences ACK immediately, then drains SQL before releasing owned connections", async mode => {
    vi.useFakeTimers()
    const entered = gate(), finish = gate(), external = new AbortController()
    const h = harness({ apply: async () => { entered.release(); await finish.promise } })
    const session = startKafkaWorkerSession({ ...config, open: h.open, signal: external.signal })
    const failure = expect(session.done).rejects.toThrow("KAFKA_BRIDGE_STOPPED")
    await entered.promise
    if (mode === "stop") { session.stop(); session.stop() }
    else if (mode === "external") external.abort()
    else await vi.advanceTimersByTimeAsync(1000)
    expect(h.channel.close).toHaveBeenCalled()
    expect(h.release).not.toHaveBeenCalled()
    expect(h.order.some(value => value.startsWith("ACK"))).toBe(false)
    finish.release(); await failure
    expect(h.order.indexOf("release")).toBeGreaterThan(h.order.indexOf("SQL-settled"))
    expect(h.order.some(value => value.startsWith("ACK"))).toBe(false)
    expect(h.open).toHaveBeenCalledOnce(); expect(h.release).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
  it.each(["stop", "external"])("%s before startup acquires nothing", async mode => {
    const h = harness(), external = new AbortController()
    if (mode === "external") external.abort()
    const session = startKafkaWorkerSession({ ...config, open: h.open, signal: external.signal })
    if (mode === "stop") session.stop()
    await expect(session.done).rejects.toThrow(KafkaBridgeError)
    expect(h.open).not.toHaveBeenCalled(); expect(h.release).not.toHaveBeenCalled()
  })
  it.each(["open", "SQL", "close", "release"])("sanitizes %s failure, releases acquired resources once and never restarts", async phase => {
    const fail = async () => { throw new Error("synthetic-private-credential") }
    const h = harness({ apply: phase === "SQL" ? fail : undefined, close: phase === "close" ? fail : undefined,
      release: phase === "release" ? fail : undefined })
    if (phase === "open") h.open.mockImplementation(() => { throw new Error("synthetic-private-credential") })
    const session = startKafkaWorkerSession({ ...config, open: h.open })
    await expect(session.done).rejects.toThrow(/^KAFKA_BRIDGE_STOPPED$/)
    expect(h.open).toHaveBeenCalledOnce(); expect(h.release).toHaveBeenCalledTimes(phase === "open" ? 0 : 1)
  })
  it("removes only its abort listener and clears lifetime timer after success", async () => {
    vi.useFakeTimers()
    const external = new AbortController(), unrelated = vi.fn()
    external.signal.addEventListener("abort", unrelated)
    const remove = vi.spyOn(external.signal, "removeEventListener"), h = harness()
    await startKafkaWorkerSession({ ...config, open: h.open, signal: external.signal }).done
    expect(remove).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0)
    external.abort(); expect(unrelated).toHaveBeenCalledOnce(); expect(h.channel.close).toHaveBeenCalledOnce()
  })
  it("takes immutable startup values so caller mutation cannot redirect a running session", async () => {
    const h = harness(), input = { ...config, open: h.open }
    const session = startKafkaWorkerSession(input)
    input.groupId = "other"; input.maxRecords = 9; input.open = vi.fn(() => { throw new Error("replacement") })
    await expect(session.done).resolves.toEqual({ processed: 1 })
    expect(input.open).not.toHaveBeenCalled()
  })
})
