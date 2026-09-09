import { EventIntegrityConflictError } from "./errors"
import type { DomainEventEnvelope } from "./envelope"

export interface IncomingEventPosition {
  organizationId: string
  consumerName: string
  consumerVersion: number
  eventId: string
  eventType: string
  payloadHash: string
  sourceTopic: string
  sourcePartition: number
  sourceOffset: bigint
}

interface ConsumerTransaction {
  consumerInbox: {
    findUnique(args: Record<string, unknown>): Promise<{ payloadHash: string; result: unknown } | null>
    create(args: Record<string, unknown>): Promise<unknown>
  }
}

export type ConsumerResult<TResult> =
  | { duplicate: true; result: TResult }
  | { duplicate: false; result: TResult }

export interface KafkaEventRecord {
  topic: string
  partition: number
  offset: string
  key: string | Buffer | null
  value: string | Buffer | null
  headers?: Record<string, string | Buffer | Array<string | Buffer> | undefined>
}

export interface ValidatedKafkaEvent {
  envelope: DomainEventEnvelope
  position: Omit<IncomingEventPosition, "consumerName" | "consumerVersion">
}

export interface ConsumerKafkaEvent extends Omit<ValidatedKafkaEvent, "position"> {
  position: IncomingEventPosition
}

export type ConsumerExecutionMode = "live" | "shadow" | "replay"

function scalarHeader(record: KafkaEventRecord, name: string): string {
  const raw = record.headers?.[name]
  if (raw === undefined || Array.isArray(raw)) throw new TypeError(`Kafka header ${name} must occur exactly once`)
  const value = Buffer.isBuffer(raw) ? raw.toString("utf8") : raw
  if (!value) throw new TypeError(`Kafka header ${name} is required`)
  return value
}

function decodeUtf8(value: string | Buffer | null, field: string): string {
  if (value === null) throw new TypeError(`Kafka ${field} is required`)
  return Buffer.isBuffer(value) ? value.toString("utf8") : value
}

/**
 * Validates the transport identity before tenant-scoped database work begins.
 * payloadHash is intentionally compared to the immutable origin header rather
 * than recomputed from transport JSON; PostgreSQL jsonb canonicalization is the
 * governed hash boundary.
 */
export function validateKafkaEventRecord(record: KafkaEventRecord, environment: string): ValidatedKafkaEvent {
  if (!/^[a-z][a-z0-9]*$/.test(environment)) throw new TypeError("invalid Kafka environment slug")
  if (!Number.isInteger(record.partition) || record.partition < 0) throw new RangeError("Kafka partition cannot be negative")
  if (!/^(0|[1-9][0-9]*)$/.test(record.offset)) throw new RangeError("Kafka offset must be an unsigned integer")

  const topic = record.topic.match(/^ld\.([a-z][a-z0-9]*)\.([a-z][a-z0-9-]*)\.events\.v1$/)
  if (!topic || topic[1] !== environment) throw new TypeError("record is outside the configured event topic boundary")

  let envelope: DomainEventEnvelope
  try {
    envelope = JSON.parse(decodeUtf8(record.value, "value")) as DomainEventEnvelope
  } catch {
    throw new TypeError("Kafka value must be valid JSON")
  }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) throw new TypeError("Kafka value must be an event object")
  if (envelope.specversion !== "1.0" || envelope.datacontenttype !== "application/json") {
    throw new TypeError("unsupported event envelope version or content type")
  }
  for (const field of ["id", "type", "dataschema", "organizationid", "aggregatetype", "aggregateid"] as const) {
    if (typeof envelope[field] !== "string" || !envelope[field]) throw new TypeError(`event ${field} is required`)
  }
  if (!Number.isSafeInteger(envelope.aggregateversion) || envelope.aggregateversion < 1) {
    throw new TypeError("event aggregateversion must be a positive safe integer")
  }

  const eventType = scalarHeader(record, "eventtype")
  const organizationId = scalarHeader(record, "organizationid")
  const payloadHash = scalarHeader(record, "payloadhash")
  if (!/^[0-9a-f]{64}$/.test(payloadHash)) throw new TypeError("payloadhash must be SHA-256 hex")
  if (eventType !== envelope.type || organizationId !== envelope.organizationid) {
    throw new EventIntegrityConflictError("Kafka headers disagree with the event envelope")
  }
  const expectedKey = `${envelope.organizationid}:${envelope.aggregatetype}:${envelope.aggregateid}`
  if (decodeUtf8(record.key, "key") !== expectedKey) {
    throw new EventIntegrityConflictError("Kafka key disagrees with the tenant aggregate identity")
  }

  return {
    envelope,
    position: {
      organizationId,
      eventId: envelope.id,
      eventType,
      payloadHash,
      sourceTopic: record.topic,
      sourcePartition: record.partition,
      sourceOffset: BigInt(record.offset),
    },
  }
}

/**
 * Transport-neutral worker boundary. The adapter must implement transaction as
 * a real tenant-scoped database transaction. Kafka acknowledgement happens
 * only after that transaction resolves, so a crash produces a safe duplicate.
 */
export async function processKafkaEvent<TResult>(input: {
  record: KafkaEventRecord
  environment: string
  consumerName: string
  consumerVersion: number
  mode: ConsumerExecutionMode
  transaction: (event: ConsumerKafkaEvent, apply: () => Promise<TResult>) => Promise<ConsumerResult<TResult>>
  apply: (event: ConsumerKafkaEvent, context: { mode: ConsumerExecutionMode; effectsAllowed: boolean }) => Promise<TResult>
  acknowledge: () => Promise<void>
}): Promise<ConsumerResult<TResult>> {
  if (!input.consumerName) throw new TypeError("consumerName is required")
  if (!Number.isInteger(input.consumerVersion) || input.consumerVersion < 1) {
    throw new RangeError("consumerVersion must be a positive integer")
  }
  const validated = validateKafkaEventRecord(input.record, input.environment)
  const event: ConsumerKafkaEvent = {
    envelope: validated.envelope,
    position: {
      ...validated.position,
      consumerName: input.consumerName,
      consumerVersion: input.consumerVersion,
    },
  }
  const result = await input.transaction(event, () => input.apply(event, {
    mode: input.mode,
    effectsAllowed: input.mode === "live",
  }))
  await input.acknowledge()
  return result
}

/**
 * Runs one projection mutation and the immutable inbox INSERT in the caller's
 * single tenant-scoped DB transaction. The Kafka offset is committed only after
 * that surrounding transaction commits.
 */
export async function consumeIdempotently<TResult>(
  tx: ConsumerTransaction,
  event: IncomingEventPosition,
  apply: () => Promise<TResult>,
): Promise<ConsumerResult<TResult>> {
  if (event.consumerVersion < 1) throw new RangeError("consumerVersion must be positive")
  if (event.sourcePartition < 0 || event.sourceOffset < BigInt(0)) throw new RangeError("Kafka position cannot be negative")
  if (!/^[0-9a-f]{64}$/.test(event.payloadHash)) throw new TypeError("payloadHash must be SHA-256 hex")

  const existing = await tx.consumerInbox.findUnique({
    where: {
      organizationId_consumerName_consumerVersion_eventId: {
        organizationId: event.organizationId,
        consumerName: event.consumerName,
        consumerVersion: event.consumerVersion,
        eventId: event.eventId,
      },
    },
    select: { payloadHash: true, result: true },
  })
  if (existing) {
    if (existing.payloadHash !== event.payloadHash) throw new EventIntegrityConflictError()
    return { duplicate: true, result: existing.result as TResult }
  }

  const result = await apply()
  await tx.consumerInbox.create({
    data: {
      ...event,
      result: result ?? {},
    },
  })
  return { duplicate: false, result }
}
