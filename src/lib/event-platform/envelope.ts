import { randomUUID } from "node:crypto"
import type { CanonicalJsonValue } from "./canonical-json"

export const EVENT_CLASSIFICATIONS = [
  "public",
  "internal",
  "confidential",
  "restricted",
] as const

export type EventClassification = (typeof EVENT_CLASSIFICATIONS)[number]

export interface DomainEventEnvelope<TData extends Record<string, CanonicalJsonValue> = Record<string, CanonicalJsonValue>> {
  specversion: "1.0"
  id: string
  source: string
  type: string
  time: string
  datacontenttype: "application/json"
  dataschema: string
  organizationid: string
  aggregatetype: string
  aggregateid: string
  aggregateversion: number
  correlationid: string
  causationid?: string
  traceparent?: string
  producer: string
  producerversion: string
  classification: EventClassification
  subjectref?: string
  data: TData
}

const EVENT_TYPE = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*\.v[1-9][0-9]*$/
const AGGREGATE_TYPE = /^[a-z][a-z0-9-]*$/
const TRACEPARENT = /^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/

export interface BuildEnvelopeInput<TData extends Record<string, CanonicalJsonValue>> {
  id?: string
  source: string
  type: string
  time: Date
  dataSchema: string
  organizationId: string
  aggregateType: string
  aggregateId: string
  aggregateVersion: bigint | number
  correlationId?: string
  causationId?: string
  traceparent?: string
  producer: string
  producerVersion: string
  classification: EventClassification
  subjectRef?: string
  data: TData
}

export function buildDomainEventEnvelope<TData extends Record<string, CanonicalJsonValue>>(
  input: BuildEnvelopeInput<TData>,
): DomainEventEnvelope<TData> {
  const version = typeof input.aggregateVersion === "bigint"
    ? Number(input.aggregateVersion)
    : input.aggregateVersion
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new RangeError("aggregateVersion must be a positive safe integer")
  }
  if (!EVENT_TYPE.test(input.type)) throw new TypeError(`invalid versioned event type: ${input.type}`)
  if (!AGGREGATE_TYPE.test(input.aggregateType)) throw new TypeError(`invalid aggregate type: ${input.aggregateType}`)
  if (!input.organizationId || !input.aggregateId) throw new TypeError("tenant and aggregate IDs are required")
  if (input.traceparent && !TRACEPARENT.test(input.traceparent)) throw new TypeError("invalid traceparent")
  if (!EVENT_CLASSIFICATIONS.includes(input.classification)) throw new TypeError("invalid event classification")

  return {
    specversion: "1.0",
    id: input.id ?? randomUUID(),
    source: input.source,
    type: input.type,
    time: input.time.toISOString(),
    datacontenttype: "application/json",
    dataschema: input.dataSchema,
    organizationid: input.organizationId,
    aggregatetype: input.aggregateType,
    aggregateid: input.aggregateId,
    aggregateversion: version,
    correlationid: input.correlationId ?? randomUUID(),
    ...(input.causationId ? { causationid: input.causationId } : {}),
    ...(input.traceparent ? { traceparent: input.traceparent } : {}),
    producer: input.producer,
    producerversion: input.producerVersion,
    classification: input.classification,
    ...(input.subjectRef ? { subjectref: input.subjectRef } : {}),
    data: input.data,
  }
}

export function eventVersionFromType(eventType: string): number {
  const match = eventType.match(/\.v([1-9][0-9]*)$/)
  if (!match || !EVENT_TYPE.test(eventType)) throw new TypeError(`invalid versioned event type: ${eventType}`)
  return Number(match[1])
}

export function topicForDomain(domain: string): string {
  if (!/^[a-z][a-z0-9-]*$/.test(domain)) throw new TypeError(`invalid event domain: ${domain}`)
  return `leaddrive.domain.${domain}.v1`
}

export function aggregatePartitionKey(organizationId: string, aggregateType: string, aggregateId: string): string {
  if ([organizationId, aggregateType, aggregateId].some((part) => !part || part.includes(":"))) {
    throw new TypeError("partition-key components must be non-empty and colon-free")
  }
  return `${organizationId}:${aggregateType}:${aggregateId}`
}
