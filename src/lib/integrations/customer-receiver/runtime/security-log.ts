import { randomUUID } from "node:crypto"
import { normalizeSecurityEvent, type SecurityEvent } from "../security-events"
import type { ReceiverSqlTransaction } from "./sql"

export const RUNTIME_LOG_SERVICE = "receiver-runtime"
export const RUNTIME_LOG_VERSION = "1.0"

export interface RuntimeLogInput {
  organizationId: string
  environment: "TEST" | "PROD"
  instanceId: string
  category: SecurityEvent["category"]
  action: SecurityEvent["action"]
  outcome: SecurityEvent["outcome"]
  severity: SecurityEvent["severity"]
  actor: SecurityEvent["actor"]
  target: SecurityEvent["target"]
  correlationId: string | null
  integrationEventId: string | null
  retentionDays: number
}

/**
 * Writes one normalized security event in the caller's transaction, so the
 * evidence commits or rolls back with the state change it describes. The
 * schema has no free-text field: payload values, URLs, headers and receiver
 * bodies cannot be recorded here by construction.
 */
export async function recordRuntimeSecurityEvent(tx: ReceiverSqlTransaction, input: RuntimeLogInput): Promise<SecurityEvent> {
  if (!Number.isInteger(input.retentionDays) || input.retentionDays < 30 || input.retentionDays > 365) throw new RangeError("retentionDays")
  const now = new Date().toISOString()
  const event = normalizeSecurityEvent({
    schema_version: "1.0", event_id: randomUUID(), event_time: now, observed_at: now, ingested_at: null,
    environment: input.environment, organization_id: input.organizationId,
    source: { system: "LeadDrive", service: RUNTIME_LOG_SERVICE, instance_id: input.instanceId, version: RUNTIME_LOG_VERSION },
    category: input.category, action: input.action, outcome: input.outcome, severity: input.severity,
    actor: input.actor, target: input.target, correlation_id: input.correlationId, integration_event_id: input.integrationEventId,
  })
  await tx.$executeRawUnsafe(
    `INSERT INTO "customer_receiver_security_events" (
       "id", "organizationId", "environment", "eventTime", "observedAt", "service", "instanceId", "version",
       "category", "action", "outcome", "severity", "actorType", "actorId", "targetType", "targetId",
       "correlationId", "integrationEventId", "retainUntil"
     ) VALUES ($1::uuid, $2, $3, $4::timestamp, $5::timestamp, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
       $18::uuid, $4::timestamp + make_interval(days => $19::int))`,
    event.event_id, event.organization_id, event.environment, event.event_time, event.observed_at,
    event.source.service, event.source.instance_id, event.source.version, event.category, event.action,
    event.outcome, event.severity, event.actor.type, event.actor.id, event.target?.type ?? null, event.target?.id ?? null,
    event.correlation_id, event.integration_event_id, input.retentionDays,
  )
  return event
}

interface StoredRuntimeEvent {
  id: string; organizationId: string; environment: "TEST" | "PROD"; eventTime: Date; observedAt: Date; recordedAt: Date
  service: string; instanceId: string; version: string; category: string; action: string; outcome: string; severity: string
  actorType: string; actorId: string | null; targetType: string | null; targetId: string | null
  correlationId: string | null; integrationEventId: string | null
}

/** Tenant-scoped read for the protected export; bounded, never silently truncated. */
export async function readRuntimeSecurityEvents(tx: ReceiverSqlTransaction, input: { organizationId: string; environment: "TEST" | "PROD"; from: string; to: string; limit: number }) {
  const rows = await tx.$queryRawUnsafe<StoredRuntimeEvent[]>(
    `SELECT "id"::text AS "id", "organizationId", "environment", "eventTime", "observedAt", "recordedAt", "service", "instanceId",
            "version", "category", "action", "outcome", "severity", "actorType", "actorId", "targetType", "targetId",
            "correlationId", "integrationEventId"::text AS "integrationEventId"
       FROM "customer_receiver_security_events"
      WHERE "organizationId" = $1 AND "environment" = $2 AND "eventTime" >= $3::timestamp AND "eventTime" < $4::timestamp
      ORDER BY "eventTime", "id"
      LIMIT $5`,
    input.organizationId, input.environment, input.from, input.to, input.limit + 1,
  )
  return {
    truncated: rows.length > input.limit,
    events: rows.slice(0, input.limit).map((row) => normalizeSecurityEvent({
      schema_version: "1.0", event_id: row.id, event_time: row.eventTime.toISOString(), observed_at: row.observedAt.toISOString(),
      ingested_at: row.recordedAt.toISOString(), environment: row.environment, organization_id: row.organizationId,
      source: { system: "LeadDrive", service: row.service, instance_id: row.instanceId, version: row.version },
      category: row.category, action: row.action, outcome: row.outcome, severity: row.severity,
      actor: { type: row.actorType, id: row.actorId },
      target: row.targetType === null || row.targetId === null ? null : { type: row.targetType, id: row.targetId },
      correlation_id: row.correlationId, integration_event_id: row.integrationEventId,
    })),
  }
}
