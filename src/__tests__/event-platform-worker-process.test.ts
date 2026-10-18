import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import { describe, expect, it, vi } from "vitest"
import { KafkaBridgeError } from "../lib/event-platform/kafka-bridge"
import { createPartitionProcessor } from "../lib/event-platform/partition-processor"
import { createSupervisedKafkaChannel } from "../lib/event-platform/worker-process"
import { startKafkaWorkerSession } from "../lib/event-platform/worker-session"

function fakeChild() {
  const events = new EventEmitter()
  const child = Object.assign(events, {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    kill: vi.fn((_signal: NodeJS.Signals) => true), exitCode: null as number | null, signalCode: null as NodeJS.Signals | null,
  })
  function close(code: number | null = 0, signal: NodeJS.Signals | null = null) {
    child.exitCode = code; child.signalCode = signal
    child.stdout.end(); child.stderr.end()
    child.emit("exit", code, signal)
    child.emit("close", code, signal)
  }
  return { child: child as unknown as ChildProcessWithoutNullStreams & {
    stdin: PassThrough; stdout: PassThrough; stderr: PassThrough
  }, kill: child.kill, close }
}
const nextTurn = () => new Promise<void>(resolve => { setImmediate(resolve) })

describe("inactive supervised Kafka process admission", () => {
  it.each([0, -1, 0.5, 10_001, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid lifecycle budgets %s before spawn", value => {
    const factory = vi.fn()
    expect(() => createSupervisedKafkaChannel({ spawn: factory, stopGraceMs: value })).toThrow(KafkaBridgeError)
    expect(() => createSupervisedKafkaChannel({ spawn: factory, killGraceMs: value })).toThrow(KafkaBridgeError)
    expect(factory).not.toHaveBeenCalled()
  })
  it.each([0, -1, 0.5, 60_001, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid channel budget %s before spawn", value => {
    const factory = vi.fn()
    expect(() => createSupervisedKafkaChannel({ spawn: factory, timeoutMs: value })).toThrow(KafkaBridgeError)
    expect(factory).not.toHaveBeenCalled()
  })
  it("sanitizes synchronous spawn failures without retry", () => {
    const factory = vi.fn(() => { throw new Error("synthetic-secret-and-connection") })
    expect(() => createSupervisedKafkaChannel({ spawn: factory })).toThrow("KAFKA_BRIDGE_STOPPED")
    expect(factory).toHaveBeenCalledTimes(1)
  })
})

describe("bounded child ownership and private pipes", () => {
  it("forwards exact frames/commands privately and confirms close after graceful stdin EOF", async () => {
    const own = fakeChild(), factory = vi.fn(() => own.child)
    const supervised = createSupervisedKafkaChannel({ spawn: factory, stopGraceMs: 100, killGraceMs: 20 })
    const written: Buffer[] = []
    own.child.stdin.on("data", chunk => { written.push(chunk) })
    own.child.stdout.write("READY\tcluster\tgroup\ttopic\n")
    expect(await supervised.channel.read()).toBe("READY\tcluster\tgroup\ttopic")
    await supervised.channel.write("NEXT")
    expect(Buffer.concat(written).toString()).toBe("NEXT\n")
    let complete = false
    const closing = supervised.channel.close().then(() => { complete = true })
    await nextTurn()
    expect(own.child.stdin.writableEnded).toBe(true)
    expect(own.child.stdout.destroyed).toBe(false)
    expect(complete).toBe(false)
    // Late output is drained, never pushed into a destroyed bridge reader.
    own.child.stdout.write("REVOKE\tprivate-finally-payload\n")
    own.close()
    await closing
    expect(await supervised.exited).toEqual({ code: 0, signal: null })
    expect(complete).toBe(true)
    expect(own.kill).not.toHaveBeenCalled()
    expect(factory).toHaveBeenCalledTimes(1)
  })
  it("does not treat an exit event or successful kill return as confirmed child close", async () => {
    const own = fakeChild()
    const supervised = createSupervisedKafkaChannel({ spawn: () => own.child, stopGraceMs: 100, killGraceMs: 20 })
    let complete = false
    const closing = supervised.channel.close().then(() => { complete = true })
    own.child.emit("exit", 0, null)
    await nextTurn()
    expect(complete).toBe(false)
    own.close()
    await closing
  })
  it("shares concurrent close and does not signal another process", async () => {
    const own = fakeChild(), unrelated = fakeChild()
    const supervised = createSupervisedKafkaChannel({ spawn: () => own.child, stopGraceMs: 100, killGraceMs: 20 })
    const first = supervised.channel.close(), second = supervised.channel.close()
    await nextTurn(); own.close()
    await Promise.all([first, second, supervised.channel.close()])
    expect(own.kill).not.toHaveBeenCalled()
    expect(unrelated.kill).not.toHaveBeenCalled()
  })
  it.each([[1, null], [null, "SIGTERM"]] as const)("rejects already-closed abnormal outcome %s/%s", async (code, signal) => {
    const own = fakeChild()
    const supervised = createSupervisedKafkaChannel({ spawn: () => own.child, stopGraceMs: 10, killGraceMs: 10 })
    own.close(code, signal)
    await expect(supervised.channel.close()).rejects.toThrow("KAFKA_BRIDGE_STOPPED")
    expect(await supervised.exited).toEqual({ code, signal })
    expect(own.kill).not.toHaveBeenCalled()
  })
  it("rejects a forced TERM stop even when the process exits zero", async () => {
    const own = fakeChild()
    own.kill.mockImplementation(() => { own.close(); return true })
    const supervised = createSupervisedKafkaChannel({ spawn: () => own.child, stopGraceMs: 5, killGraceMs: 5 })
    await expect(supervised.channel.close()).rejects.toThrow("KAFKA_BRIDGE_STOPPED")
    expect(own.kill.mock.calls).toEqual([["SIGTERM"]])
    expect(await supervised.exited).toEqual({ code: 0, signal: null })
  })
  it("escalates TERM to KILL within bounds and rejects forced close", async () => {
    const own = fakeChild()
    own.kill.mockImplementation(signal => { if (signal === "SIGKILL") own.close(null, "SIGKILL"); return true })
    const supervised = createSupervisedKafkaChannel({ spawn: () => own.child, stopGraceMs: 5, killGraceMs: 5 })
    await expect(supervised.channel.close()).rejects.toThrow("KAFKA_BRIDGE_STOPPED")
    expect(own.kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]])
    expect(await supervised.exited).toEqual({ code: null, signal: "SIGKILL" })
  })
  it("fails boundedly when reaping cannot be confirmed instead of inventing success", async () => {
    const own = fakeChild()
    const supervised = createSupervisedKafkaChannel({ spawn: () => own.child, stopGraceMs: 5, killGraceMs: 5 })
    const observedExit = expect(supervised.exited).rejects.toThrow("KAFKA_BRIDGE_STOPPED")
    await expect(supervised.channel.close()).rejects.toThrow("KAFKA_BRIDGE_STOPPED")
    await observedExit
    expect(own.kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]])
    expect(own.child.stdout.destroyed).toBe(true)
  })
  it("abort immediately stops its own child and cannot be reported as graceful close", async () => {
    const own = fakeChild()
    own.kill.mockImplementation(() => { own.close(null, "SIGTERM"); return true })
    const supervised = createSupervisedKafkaChannel({ spawn: () => own.child, stopGraceMs: 100, killGraceMs: 5 })
    await supervised.abort()
    expect(own.kill.mock.calls).toEqual([["SIGTERM"]])
    await expect(supervised.channel.close()).rejects.toThrow("KAFKA_BRIDGE_STOPPED")
  })
  it("abort interrupts a pending private read as well as the process", async () => {
    const own = fakeChild()
    own.kill.mockImplementation(() => { own.close(null, "SIGTERM"); return true })
    const supervised = createSupervisedKafkaChannel({ spawn: () => own.child, timeoutMs: 60_000 })
    const reading = expect(supervised.channel.read()).rejects.toThrow("KAFKA_BRIDGE_STOPPED")
    await nextTurn()
    await supervised.abort()
    await reading
  })
  it("abort interrupts an existing graceful wait without waiting out its budget", async () => {
    const own = fakeChild()
    const supervised = createSupervisedKafkaChannel({ spawn: () => own.child, stopGraceMs: 10_000, killGraceMs: 5 })
    const closing = expect(supervised.channel.close()).rejects.toThrow("KAFKA_BRIDGE_STOPPED")
    await nextTurn()
    own.kill.mockImplementation(signal => { if (signal === "SIGKILL") own.close(null, signal); return true })
    await supervised.abort()
    await closing
    expect(own.kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]])
  })
  it("handles asynchronous spawn error and never prints raw diagnostics", async () => {
    const own = fakeChild()
    own.kill.mockImplementation(() => { own.close(-2); return false })
    const consoleError = vi.spyOn(console, "error"), consoleLog = vi.spyOn(console, "log")
    try {
      const supervised = createSupervisedKafkaChannel({ spawn: () => own.child, stopGraceMs: 5, killGraceMs: 5 })
      own.child.emit("error", new Error("synthetic-secret"))
      await expect(supervised.channel.close()).rejects.toThrow("KAFKA_BRIDGE_STOPPED")
      expect(await supervised.exited).toEqual({ code: -2, signal: null })
      expect(consoleError).not.toHaveBeenCalled(); expect(consoleLog).not.toHaveBeenCalled()
    } finally { consoleError.mockRestore(); consoleLog.mockRestore() }
  })
  it("drains stderr without retaining or logging private bytes", async () => {
    const own = fakeChild(), supervised = createSupervisedKafkaChannel({ spawn: () => own.child })
    for (let index = 0; index < 20; index++) own.child.stderr.write(Buffer.alloc(64 * 1024, 120))
    await nextTurn()
    expect(own.child.stderr.readableLength).toBe(0)
    own.close()
    await supervised.channel.close()
  })
  it("sanitizes private stream failures and still reaps the owned child", async () => {
    const own = fakeChild()
    own.kill.mockImplementation(() => { own.close(null, "SIGTERM"); return true })
    const supervised = createSupervisedKafkaChannel({ spawn: () => own.child })
    own.child.stdout.emit("error", new Error("synthetic-private-payload"))
    await expect(supervised.channel.close()).rejects.toThrow("KAFKA_BRIDGE_STOPPED")
    expect(await supervised.exited).toEqual({ code: null, signal: "SIGTERM" })
  })
  it("read EOF closes/reaps and remains a sanitized bridge failure", async () => {
    const own = fakeChild(), supervised = createSupervisedKafkaChannel({ spawn: () => own.child })
    const reading = expect(supervised.channel.read()).rejects.toThrow("KAFKA_BRIDGE_STOPPED")
    own.close()
    await reading
    expect(await supervised.exited).toEqual({ code: 0, signal: null })
  })
})

describe("tiny real process proof (no JVM, Docker, database or network)", () => {
  it("composes the actual private bridge and session with one tiny direct child", async () => {
    const supervised = createSupervisedKafkaChannel({
      spawn: () => spawn(process.execPath, ["-e", `
        const lines = require('node:readline').createInterface({ input: process.stdin });
        lines.on('line', line => {
          if (line === 'NEXT') process.stdout.write('ASSIGN\\t1\\tmember\\t1\\t0\\t0\\nRECORD\\t1\\t0\\ta2V5\\tdmFsdWU=\\t0\\n');
          else if (line === 'ACK\\t1\\t1') process.stdout.write('COMMITTED\\t1\\t1\\n');
          else process.exit(22);
        });
        lines.on('close', () => process.stdout.write('REVOKE\\t1\\n', () => process.exit(0)));
        process.stdout.write('READY\\tfixture\\tshadow\\tld.test.finance.events.v1\\n');
      `], { stdio: ["pipe", "pipe", "pipe"], env: { NODE_ENV: "test" } }),
      stopGraceMs: 1000, killGraceMs: 500, timeoutMs: 2000,
    })
    const order: string[] = []
    const session = startKafkaWorkerSession({
      clusterId: "fixture", groupId: "shadow", topic: "ld.test.finance.events.v1", maxRecords: 1, maxDurationMs: 4000,
      open: () => ({
        channel: supervised.channel,
        createProcessor: (assignment, broker) => createPartitionProcessor({ assignment, broker,
          applyCommitted: async () => { order.push("simulated-transaction-settled") } }),
        release: async () => {
          expect(await supervised.exited).toEqual({ code: 0, signal: null })
          order.push("owned-resources-released")
        },
      }),
    })
    try {
      await expect(session.done).resolves.toEqual({ processed: 1 })
      expect(order).toEqual(["simulated-transaction-settled", "owned-resources-released"])
    } finally { session.stop(); await supervised.abort().catch(() => {}) }
  })
  it("sends EOF and keeps late stdout alive until actual close", async () => {
    const supervised = createSupervisedKafkaChannel({
      spawn: () => spawn(process.execPath, ["-e", `
        process.stdin.resume();
        process.stdin.on('end', () => process.stdout.write('REVOKE\\tfinal\\n', () => process.exit(0)));
        process.stdout.write('READY\\tprivate\\n');
      `], { stdio: ["pipe", "pipe", "pipe"], env: { NODE_ENV: "test" } }),
      stopGraceMs: 1000, killGraceMs: 500, timeoutMs: 2000,
    })
    try {
      expect(await supervised.channel.read()).toBe("READY\tprivate")
      await supervised.channel.close()
      expect(await supervised.exited).toEqual({ code: 0, signal: null })
    } finally { await supervised.abort().catch(() => {}) }
  })
  it("reaps a real TERM-ignoring child using KILL and never calls the close graceful", async () => {
    const supervised = createSupervisedKafkaChannel({
      spawn: () => spawn(process.execPath, ["-e", `
        process.on('SIGTERM', () => {});
        process.stdin.resume();
        setInterval(() => {}, 1000);
        process.stdout.write('READY\\tprivate\\n');
      `], { stdio: ["pipe", "pipe", "pipe"], env: { NODE_ENV: "test" } }),
      stopGraceMs: 25, killGraceMs: 100, timeoutMs: 2000,
    })
    try {
      expect(await supervised.channel.read()).toBe("READY\tprivate")
      await expect(supervised.channel.close()).rejects.toThrow("KAFKA_BRIDGE_STOPPED")
      expect(await supervised.exited).toEqual({ code: null, signal: "SIGKILL" })
    } finally { await supervised.abort().catch(() => {}) }
  })
})
