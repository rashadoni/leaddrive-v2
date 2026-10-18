import type { KafkaEventRecord } from "./consumer"
import type { PartitionAssignment, PartitionBroker } from "./partition-processor"
import type { Readable, Writable } from "node:stream"

/** Private process pipes only. stdout carries payloads and MUST NOT be logged. */
export interface KafkaBridgeChannel {
  read(): Promise<string>
  write(command: string): Promise<void>
  close(): Promise<void>
}
type Processor = { processBatch(batch: { fetchOffset: string; records: KafkaEventRecord[] }): Promise<unknown>; revoke(): void }
type Lease = { assignment: Readonly<PartitionAssignment>; processor: Processor; cursor: string; active: boolean }
export class KafkaBridgeError extends Error {
  constructor() { super("KAFKA_BRIDGE_STOPPED"); this.name = "KafkaBridgeError" }
}
/** Bounded private-pipe implementation. terminate must kill/reap ONLY its child. */
export function createKafkaBridgeChannel(input: {
  stdout: Readable; stdin: Writable; terminate: () => Promise<void>; timeoutMs?: number
}): KafkaBridgeChannel {
  const timeout = input.timeoutMs ?? 35_000
  requireFrame(Number.isInteger(timeout) && timeout > 0 && timeout <= 60_000)
  const iterator = input.stdout[Symbol.asyncIterator]()
  let pending = Buffer.alloc(0), reading = false, closing: Promise<void> | undefined
  async function close() {
    if (!closing) {
      closing = Promise.resolve().then(input.terminate).catch(() => { throw new KafkaBridgeError() })
      input.stdout.destroy(); input.stdin.destroy()
    }
    await closing
  }
  input.stdin.on("error", () => { void close().catch(() => {}) })
  async function bounded<T>(operation: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([operation, new Promise<never>((_, reject) => {
        timer = setTimeout(() => { void close().catch(() => {}); reject(new KafkaBridgeError()) }, timeout)
      })])
    } finally { if (timer) clearTimeout(timer) }
  }
  return {
    async read() {
      requireFrame(!reading && !closing); reading = true
      try {
        return await bounded((async () => {
          for (;;) {
            const newline = pending.indexOf(10)
            if (newline >= 0) {
              requireFrame(newline <= 1_500_000)
              const line = pending.subarray(0, newline); pending = pending.subarray(newline + 1)
              requireFrame(line.every(byte => byte === 9 || (byte >= 32 && byte <= 126)))
              return line.toString("ascii")
            }
            requireFrame(pending.length <= 1_500_000)
            const chunk = await iterator.next(); requireFrame(!chunk.done && Buffer.isBuffer(chunk.value))
            requireFrame(pending.length + chunk.value.length <= 1_565_536)
            pending = Buffer.concat([pending, chunk.value])
          }
        })())
      } catch { await close(); throw new KafkaBridgeError() }
      finally { reading = false }
    },
    async write(command) {
      requireFrame(!closing && command.length <= 512 && /^(?:NEXT|ACK\t[1-9][0-9]*\t(?:0|[1-9][0-9]*))$/.test(command))
      try { await bounded(new Promise<void>((resolve, reject) => {
        input.stdin.write(command + "\n", error => error ? reject(error) : resolve())
      })) } catch { await close(); throw new KafkaBridgeError() }
    },
    close,
  }
}
function requireFrame(ok: unknown): asserts ok { if (!ok) throw new KafkaBridgeError() }
function decimal(text: string, max = BigInt("9223372036854775807")): bigint {
  requireFrame(/^(0|[1-9][0-9]*)$/.test(text) && text.length <= 19);
  const value = BigInt(text); requireFrame(value <= max); return value
}
function identity(text: string) { requireFrame(/^[A-Za-z0-9_.:-]{1,249}$/.test(text)); return text }
function decode(text: string): Buffer | null {
  if (text === "~") return null
  // Simple linear scan plus canonical re-encoding; avoid repeated capture
  // groups that can exhaust the RegExp stack on a valid 1 MiB record.
  requireFrame(text.length <= 1_398_104 && text.length % 4 === 0 && !/[^A-Za-z0-9+/=]/.test(text))
  const result = Buffer.from(text, "base64")
  requireFrame(result.toString("base64") === text); return result
}

/**
 * Inactive connected-driver adapter: explicit NEXT handshake serializes poll
 * with complete DB/ACK handling. No process launch, credentials or automatic
 * restart here. Channel implementation must enforce bounded frames/deadlines
 * and terminate its child on EOF, abort, pipe loss or uncertain acknowledgement.
 */
export async function runKafkaBridge(input: {
  channel: KafkaBridgeChannel
  clusterId: string
  groupId: string
  topic: string
  createProcessor: (assignment: Readonly<PartitionAssignment>, broker: PartitionBroker) => Processor
  signal?: AbortSignal
  /** Bounded canary exit; unlimited only under the future governed service. */
  maxRecords: number
}) {
  const channel = input.channel
  const expected = [input.clusterId, input.groupId, input.topic]
  const leases = new Map<string, Lease>()
  const partitions = new Set<number>()
  let processed = 0
  let highestLease = BigInt(0)
  function revokeAll() {
    let failed = false
    for (const lease of leases.values()) {
      lease.active = false
      try { lease.processor.revoke() } catch { failed = true }
    }
    if (failed) throw new KafkaBridgeError()
  }
  const abort = () => {
    try { revokeAll() } catch { /* close is still mandatory */ }
    void channel.close().catch(() => {})
  }
  input.signal?.addEventListener("abort", abort, { once: true })
  async function read() {
    requireFrame(!input.signal?.aborted)
    const line = await channel.read()
    requireFrame(!input.signal?.aborted && line.length <= 1_500_000 && !/[\r\n\u0000-\u0008\u000b-\u001f\u007f-\uffff]/.test(line))
    return line.split("\t")
  }
  try {
    expected.forEach(identity)
    requireFrame(Number.isSafeInteger(input.maxRecords) && input.maxRecords > 0 && input.maxRecords <= 100_000)
    const ready = await read()
    requireFrame(ready.length === 4 && ready[0] === "READY" && ready.slice(1).every((value, index) => value === expected[index]))
    await channel.write("NEXT")
    for (;;) {
      const frame = await read()
      if (frame[0] === "ASSIGN") {
        requireFrame(frame.length === 6 && leases.size < 128)
        const id = decimal(frame[1]); requireFrame(id > highestLease); highestLease = id
        const partition = Number(decimal(frame[4], BigInt(2147483647)))
        requireFrame(!partitions.has(partition))
        const assignment = Object.freeze({ clusterId: expected[0], groupId: expected[1], topic: expected[2],
          memberId: identity(frame[2]), generationId: Number(decimal(frame[3], BigInt(2147483647))), partition,
          nextOffset: decimal(frame[5]).toString() })
        let lease: Lease
        const matches = (a: Readonly<PartitionAssignment>) => Object.keys(assignment).every(key =>
          a[key as keyof PartitionAssignment] === assignment[key as keyof PartitionAssignment])
        const broker: PartitionBroker = {
          isCurrent(a) { return lease.active && matches(a) && !input.signal?.aborted },
          async commitNextOffset(a, next) {
            requireFrame(lease.active && matches(a) && !input.signal?.aborted)
            decimal(next)
            await channel.write(`ACK\t${frame[1]}\t${next}`)
            const ack = await read()
            requireFrame(ack.length === 3 && ack[0] === "COMMITTED" && ack[1] === frame[1] && ack[2] === next && lease.active)
          },
        }
        lease = { assignment, processor: input.createProcessor(assignment, broker), cursor: assignment.nextOffset, active: true }
        leases.set(frame[1], lease); partitions.add(partition)
      } else if (frame[0] === "REVOKE") {
        requireFrame(frame.length === 2)
        const lease = leases.get(frame[1]); requireFrame(lease)
        lease.active = false; lease.processor.revoke(); leases.delete(frame[1]); partitions.delete(lease.assignment.partition)
      } else if (frame[0] === "IDLE") {
        requireFrame(frame.length === 1); await channel.write("NEXT")
      } else {
        requireFrame(frame[0] === "RECORD" && frame.length >= 6)
        const lease = leases.get(frame[1]); requireFrame(lease?.active)
        const offset = decimal(frame[2]); requireFrame(offset >= decimal(lease.cursor) && offset < BigInt("9223372036854775807"))
        const headerCount = Number(decimal(frame[5], BigInt(32)))
        requireFrame(frame.length === 6 + headerCount * 2)
        const key = decode(frame[3]), value = decode(frame[4])
        let size = (key?.length ?? 0) + (value?.length ?? 0)
        const headers: Record<string, Buffer | Buffer[]> = Object.create(null)
        for (let index = 6; index < frame.length; index += 2) {
          const nameBytes = decode(frame[index]), bytes = decode(frame[index + 1])
          requireFrame(nameBytes && nameBytes.length > 0 && nameBytes.length <= 128 && bytes)
          // Header identifiers are exact strings, not text documents: a BOM
          // must remain part of the name rather than alias a trusted header.
          const name = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(nameBytes)
          size += nameBytes.length + bytes.length
          const previous = headers[name]
          if (previous === undefined) headers[name] = bytes
          else { const list = Array.isArray(previous) ? previous : [previous]; requireFrame(list.length < 8); headers[name] = [...list, bytes] }
        }
        requireFrame(size <= 1024 * 1024)
        await lease.processor.processBatch({ fetchOffset: lease.cursor, records: [{ topic: lease.assignment.topic,
          partition: lease.assignment.partition, offset: frame[2], key, value, headers }] })
        requireFrame(lease.active && !input.signal?.aborted)
        lease.cursor = (offset + BigInt(1)).toString(); processed++
        if (processed === input.maxRecords) return Object.freeze({ processed })
        await channel.write("NEXT")
      }
    }
  } catch {
    throw new KafkaBridgeError()
  } finally {
    input.signal?.removeEventListener("abort", abort)
    try { revokeAll() } finally {
      try { await channel.close() } catch { throw new KafkaBridgeError() }
    }
  }
}
