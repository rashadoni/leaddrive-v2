import type { KafkaEventRecord } from "./consumer"

/** Supplied by the broker driver, never by an event or tenant checkpoint. */
export interface PartitionAssignment {
  readonly clusterId: string
  readonly groupId: string
  readonly memberId: string
  readonly generationId: number
  readonly topic: string
  readonly partition: number
  /** Broker resume position, after verifying retention/full-history coverage. */
  readonly nextOffset: string
}

export interface PartitionBroker {
  /** Synchronous local check; this does not replace broker-side fencing. */
  isCurrent(assignment: Readonly<PartitionAssignment>): boolean
  /**
   * Must send the ORIGINAL member/generation to the broker and reject stale
   * membership, including a revoke between isCurrent() and this request.
   * Must not silently substitute a newly joined generation or auto-retry
   * under it. Bound request time in the driver. Auto-commit must be disabled.
   */
  commitNextOffset(assignment: Readonly<PartitionAssignment>, nextOffset: string): Promise<void>
}

export class PartitionProcessingError extends Error {
  constructor(readonly code: "INVALID_DELIVERY" | "ASSIGNMENT_REVOKED" | "PARTITION_BUSY" | "PARTITION_STOPPED") {
    super(code)
    this.name = "PartitionProcessingError"
  }
}

const MAX_OFFSET = BigInt("9223372036854775807")

function requireDelivery(condition: unknown): asserts condition {
  if (!condition) throw new PartitionProcessingError("INVALID_DELIVERY")
}

function offset(value: unknown): bigint {
  requireDelivery(typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value) && value.length <= 19)
  const parsed = BigInt(value)
  requireDelivery(parsed <= MAX_OFFSET)
  return parsed
}

function identity(value: unknown): void {
  requireDelivery(typeof value === "string" && value.length > 0 && value.length <= 249 && !/[\s\u0000-\u001f\u007f]/.test(value))
}

/**
 * INACTIVE building block, not a network consumer or a durable SQL lease.
 * One instance owns ONE assignment of ONE partition across ALL its tenants.
 * The driver must supply every record from its ordered, unfiltered fetch.
 * Numeric holes can be legitimate Kafka positions; this module cannot prove
 * that a caller omitted a record. fetchOffset binds successive deliveries to
 * the cursor, not to an arbitrary topic high-water mark.
 *
 * applyCommitted must resolve only after its real, bounded DB COMMIT. Its
 * result (including any tenant checkpoint) is deliberately ignored. No
 * retry/skip/quarantine acknowledgement is implicit. An uncertain commit or
 * processing error stops the assignment; restart reads the broker position
 * and uses the existing DB inbox to deduplicate.
 */
export function createPartitionProcessor(input: {
  assignment: PartitionAssignment
  broker: PartitionBroker
  applyCommitted: (record: KafkaEventRecord) => Promise<unknown>
  maxBatchRecords?: number
  maxBatchBytes?: number
}) {
  const assignment = Object.freeze({ ...input.assignment })
  for (const value of [assignment.clusterId, assignment.groupId, assignment.memberId, assignment.topic]) identity(value)
  requireDelivery(Number.isInteger(assignment.generationId) && assignment.generationId >= 0 && assignment.generationId <= 2147483647)
  requireDelivery(Number.isInteger(assignment.partition) && assignment.partition >= 0 && assignment.partition <= 2147483647)
  let nextOffset = offset(assignment.nextOffset)
  const maxRecords = input.maxBatchRecords ?? 100
  const maxBytes = input.maxBatchBytes ?? 4 * 1024 * 1024
  requireDelivery(Number.isInteger(maxRecords) && maxRecords >= 1 && maxRecords <= 1000)
  requireDelivery(Number.isInteger(maxBytes) && maxBytes >= 1 && maxBytes <= 16 * 1024 * 1024)
  const applyCommitted = input.applyCommitted
  const isCurrent = input.broker.isCurrent.bind(input.broker)
  const commitNextOffset = input.broker.commitNextOffset.bind(input.broker)
  let state: "active" | "processing" | "stopped" | "revoked" = "active"

  function assertCurrent() {
    // A synchronous driver callback can itself deliver a revoke notification.
    const current = state !== "revoked" && isCurrent(assignment) === true
    if (state === "revoked" || !current) {
      state = "revoked"
      throw new PartitionProcessingError("ASSIGNMENT_REVOKED")
    }
  }

  function snapshot(records: readonly KafkaEventRecord[]) {
    requireDelivery(Array.isArray(records) && records.length <= maxRecords)
    let bytes = 0
    const reserve = (size: number) => { bytes += size; requireDelivery(bytes <= maxBytes) }
    const copy = (value: unknown): string | Buffer => {
      requireDelivery(typeof value === "string" || Buffer.isBuffer(value))
      reserve(Buffer.isBuffer(value) ? value.length : Buffer.byteLength(value, "utf8"))
      return Buffer.isBuffer(value) ? Buffer.from(value) : value
    }
    let previous: bigint | null = null
    return records.map(record => {
      requireDelivery(record && record.topic === assignment.topic && record.partition === assignment.partition)
      const position = offset(record.offset)
      requireDelivery(position >= nextOffset && position < MAX_OFFSET && (previous === null || position > previous))
      previous = position
      reserve(Buffer.byteLength(record.topic, "utf8") + record.offset.length + 8)
      const entries = Object.entries(record.headers ?? {})
      requireDelivery(entries.length <= 32)
      const headers = Object.fromEntries(entries.map(([name, value]) => {
        requireDelivery(name.length > 0 && name.length <= 128)
        reserve(Buffer.byteLength(name, "utf8"))
        if (value === undefined) return [name, undefined]
        if (Array.isArray(value)) {
          requireDelivery(value.length <= 8)
          return [name, value.map(copy)]
        }
        return [name, copy(value)]
      }))
      return { topic: record.topic, partition: record.partition, offset: record.offset,
        key: copy(record.key), value: copy(record.value), headers } satisfies KafkaEventRecord
    })
  }

  return Object.freeze({
    /** Immediate invalidation; an already-running SQL transaction may finish. */
    revoke() { state = "revoked" },
    status() { return Object.freeze({ state, nextOffset: nextOffset.toString() }) },
    async processBatch(batch: { fetchOffset: string; records: readonly KafkaEventRecord[] }) {
      if (state === "processing") throw new PartitionProcessingError("PARTITION_BUSY")
      if (state === "stopped") throw new PartitionProcessingError("PARTITION_STOPPED")
      try {
        assertCurrent()
        requireDelivery(offset(batch.fetchOffset) === nextOffset)
        // Snapshot before the first await: caller mutation cannot replace the
        // tenant, payload, ordering or position of an in-flight batch.
        const records = snapshot(batch.records)
        state = "processing"
        for (const record of records) {
          assertCurrent()
          const committedNext = (offset(record.offset) + BigInt(1)).toString()
          await applyCommitted(record)
          assertCurrent()
          await commitNextOffset(assignment, committedNext)
          assertCurrent()
          nextOffset = BigInt(committedNext)
        }
        state = "active"
        return Object.freeze({ processed: records.length, nextOffset: nextOffset.toString() })
      } catch (error) {
        // Revoke is terminal even if the callback failed for another reason.
        if (state !== "revoked") state = "stopped"
        throw error
      }
    },
  })
}
