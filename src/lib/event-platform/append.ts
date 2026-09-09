import { randomUUID } from "node:crypto"
import { DEPLOY_SHA } from "@/generated/build-sha"
import type { CanonicalJsonValue } from "./canonical-json"
import {
  aggregatePartitionKey,
  buildDomainEventEnvelope,
  eventVersionFromType,
  topicForDomain,
  type EventClassification,
} from "./envelope"
import { AggregateVersionConflictError } from "./errors"
import { assertEventContract } from "./fund-contracts"

/** Minimal transaction shape, kept structural so helpers are simple to mock. */
export interface EventPlatformTransaction {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>
  domainEvent: { create(args: Record<string, unknown>): Promise<Record<string, unknown>> }
  eventOutbox: { create(args: Record<string, unknown>): Promise<Record<string, unknown>> }
}

export interface AppendDomainEventInput<TData extends Record<string, CanonicalJsonValue>> {
  organizationId: string
  domain: string
  aggregateType: string
  aggregateId: string
  expectedVersion?: bigint | number
  eventId?: string
  eventType: string
  source: string
  dataSchema: string
  classification: EventClassification
  subjectRef?: string
  correlationId?: string
  causationId?: string
  traceparent?: string
  commandId?: string
  producer: string
  producerVersion: string
  data: TData
  occurredAt?: Date
}

export interface AppendedDomainEvent {
  eventId: string
  aggregateVersion: bigint
  topic: string
  partitionKey: string
  envelope: ReturnType<typeof buildDomainEventEnvelope>
  payloadHash: string
}

/**
 * Atomically allocates an aggregate version and inserts event + outbox.
 * The caller must invoke this inside the same tenant-scoped interactive Prisma
 * transaction as the business-state mutation.
 */
export async function appendDomainEvent<TData extends Record<string, CanonicalJsonValue>>(
  tx: EventPlatformTransaction,
  input: AppendDomainEventInput<TData>,
): Promise<AppendedDomainEvent> {
  assertEventContract({
    domain: input.domain,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    eventType: input.eventType,
    dataSchema: input.dataSchema,
    classification: input.classification,
    data: input.data,
  })

  const eventId = input.eventId ?? randomUUID()
  const occurredAt = input.occurredAt ?? new Date()
  const expected = input.expectedVersion === undefined
    ? null
    : BigInt(input.expectedVersion)
  if (expected !== null && expected < BigInt(0)) throw new RangeError("expectedVersion cannot be negative")

  let heads: Array<{ currentVersion: bigint }>
  if (expected === null) {
    // Blind append: create version 1 or atomically increment the existing head.
    heads = await tx.$queryRawUnsafe<Array<{ currentVersion: bigint }>>(
      `INSERT INTO "event_aggregate_heads" (
         "organizationId", "aggregateType", "aggregateId", "currentVersion",
         "lastEventId", "lastEventAt", "createdAt", "updatedAt"
       ) VALUES ($1, $2, $3, 1, $4::uuid, $5::timestamp, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT ("organizationId", "aggregateType", "aggregateId") DO UPDATE
         SET "currentVersion" = "event_aggregate_heads"."currentVersion" + 1,
             "lastEventId" = EXCLUDED."lastEventId",
             "lastEventAt" = EXCLUDED."lastEventAt",
             "updatedAt" = CURRENT_TIMESTAMP
       RETURNING "currentVersion"`,
      input.organizationId,
      input.aggregateType,
      input.aggregateId,
      eventId,
      occurredAt,
    )
  } else if (expected === BigInt(0)) {
    // Optimistic create: an existing aggregate is a conflict, never an update.
    heads = await tx.$queryRawUnsafe<Array<{ currentVersion: bigint }>>(
      `INSERT INTO "event_aggregate_heads" (
         "organizationId", "aggregateType", "aggregateId", "currentVersion",
         "lastEventId", "lastEventAt", "createdAt", "updatedAt"
       ) VALUES ($1, $2, $3, 1, $4::uuid, $5::timestamp, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT ("organizationId", "aggregateType", "aggregateId") DO NOTHING
       RETURNING "currentVersion"`,
      input.organizationId,
      input.aggregateType,
      input.aggregateId,
      eventId,
      occurredAt,
    )
  } else {
    // Optimistic append: UPDATE the existing head only when its exact version
    // still matches. INSERT ... SELECT cannot reach ON CONFLICT when its source
    // SELECT emits no row, which is why positive expected versions must use a
    // separate UPDATE statement.
    heads = await tx.$queryRawUnsafe<Array<{ currentVersion: bigint }>>(
      `UPDATE "event_aggregate_heads"
          SET "currentVersion" = "currentVersion" + 1,
              "lastEventId" = $4::uuid,
              "lastEventAt" = $5::timestamp,
              "updatedAt" = CURRENT_TIMESTAMP
        WHERE "organizationId" = $1
          AND "aggregateType" = $2
          AND "aggregateId" = $3
          AND "currentVersion" = $6::bigint
      RETURNING "currentVersion"`,
      input.organizationId,
      input.aggregateType,
      input.aggregateId,
      eventId,
      occurredAt,
      expected,
    )
  }
  const head = heads[0]
  if (!head) throw new AggregateVersionConflictError()

  const topic = topicForDomain(input.domain)
  const partitionKey = aggregatePartitionKey(input.organizationId, input.aggregateType, input.aggregateId)
  const envelope = buildDomainEventEnvelope({
    id: eventId,
    source: input.source,
    type: input.eventType,
    time: occurredAt,
    dataSchema: input.dataSchema,
    organizationId: input.organizationId,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    aggregateVersion: head.currentVersion,
    correlationId: input.correlationId,
    causationId: input.causationId,
    traceparent: input.traceparent,
    producer: input.producer,
    producerVersion: input.producerVersion,
    classification: input.classification,
    subjectRef: input.subjectRef,
    data: input.data,
  })

  await tx.domainEvent.create({
    data: {
      id: eventId,
      organizationId: input.organizationId,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      aggregateVersion: head.currentVersion,
      eventType: input.eventType,
      eventVersion: eventVersionFromType(input.eventType),
      source: input.source,
      dataSchema: input.dataSchema,
      classification: input.classification,
      subjectRef: input.subjectRef ?? null,
      correlationId: envelope.correlationid,
      causationId: input.causationId ?? null,
      traceparent: input.traceparent ?? null,
      commandId: input.commandId ?? null,
      producer: input.producer,
      producerVersion: input.producerVersion,
      data: input.data,
      occurredAt,
    },
  })
  const outbox = await tx.eventOutbox.create({
    data: {
      organizationId: input.organizationId,
      eventId,
      eventType: input.eventType,
      topic,
      partitionKey,
      envelope,
    },
  })

  return {
    eventId,
    aggregateVersion: head.currentVersion,
    topic,
    partitionKey,
    envelope,
    payloadHash: String(outbox.payloadHash),
  }
}

const FULL_GIT_SHA = /^[0-9a-f]{40}$/i

function normalizedFullGitSha(value: string | undefined): string | null {
  return value && FULL_GIT_SHA.test(value) ? value.toLowerCase() : null
}

export interface EventProducerVersionResolution {
  compiledSha?: string
  nodeEnv?: string
  environment?: Partial<Record<
    "GIT_SHA" | "GITHUB_SHA" | "VERCEL_GIT_COMMIT_SHA" | "COMMIT_SHA",
    string | undefined
  >>
}

export function resolveEventProducerVersion({
  compiledSha = DEPLOY_SHA,
  nodeEnv = process.env.NODE_ENV,
  environment = process.env,
}: EventProducerVersionResolution = {}): string {
  const compiled = normalizedFullGitSha(compiledSha)
  if (nodeEnv === "production") {
    if (!compiled) {
      throw new Error("Production event provenance requires a valid compiled DEPLOY_SHA")
    }
    return compiled
  }

  if (compiled) return compiled
  for (const candidate of [
    environment.GIT_SHA,
    environment.GITHUB_SHA,
    environment.VERCEL_GIT_COMMIT_SHA,
    environment.COMMIT_SHA,
  ]) {
    const normalized = normalizedFullGitSha(candidate)
    if (normalized) return normalized
  }
  return "dev-local"
}

export function eventProducerVersion(): string {
  return resolveEventProducerVersion()
}
