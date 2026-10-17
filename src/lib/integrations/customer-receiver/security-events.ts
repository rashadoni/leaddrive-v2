import { createHash } from "node:crypto"
import { contractAssert, exactKeys, identifier, record, utcTime, uuid } from "./contract"

export const SECURITY_CATEGORIES = ["authentication", "authorization", "administration", "data_access", "integration", "infrastructure", "logging"] as const
export const SECURITY_ACTIONS = [
  "login", "logout", "access_check", "role_change", "configuration_change", "credential_rotation",
  "data_read", "data_export", "submission_queued", "submission_attempted", "submission_accepted",
  "submission_rejected", "submission_uncertain", "receipt_lookup", "erp_result_reported",
  "network_connection", "resource_change", "collector_health", "collection_gap", "incident_export",
  "submission_deferred", "submission_skipped", "lease_recovered", "retention_purge", "incident_hold",
] as const
export const SECURITY_OUTCOMES = ["success", "failure", "unknown"] as const
export const SECURITY_SEVERITIES = ["info", "low", "medium", "high", "critical"] as const

const idSchema = { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$" }
const uuidSchema = { type: "string", format: "uuid", pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$" }
const timestampSchema = { type: "string", format: "date-time", pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$" }
const nullable = (schema: object) => ({ anyOf: [schema, { type: "null" }] })
const objectSchema = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties })

/** Included with every export so an incident analyst can configure a parser. */
export const SECURITY_EVENT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "LeadDrive Security Event 1.0",
  ...objectSchema({
    schema_version: { const: "1.0" }, event_id: uuidSchema,
    event_time: timestampSchema, observed_at: timestampSchema, ingested_at: nullable(timestampSchema),
    environment: { enum: ["TEST", "PROD"] }, organization_id: nullable(idSchema),
    source: objectSchema({ system: idSchema, service: idSchema, instance_id: idSchema, version: idSchema }),
    category: { enum: SECURITY_CATEGORIES }, action: { enum: SECURITY_ACTIONS },
    outcome: { enum: SECURITY_OUTCOMES }, severity: { enum: SECURITY_SEVERITIES },
    actor: { oneOf: [
      objectSchema({ type: { enum: ["user", "service"] }, id: idSchema }),
      objectSchema({ type: { const: "unknown" }, id: { type: "null" } }),
    ] },
    target: nullable(objectSchema({ type: idSchema, id: idSchema })),
    correlation_id: nullable(idSchema), integration_event_id: nullable(uuidSchema),
  }),
}

export interface SecurityEvent {
  schema_version: "1.0"
  event_id: string
  event_time: string
  observed_at: string
  ingested_at: string | null
  environment: "TEST" | "PROD"
  organization_id: string | null
  source: { system: string; service: string; instance_id: string; version: string }
  category: typeof SECURITY_CATEGORIES[number]
  action: typeof SECURITY_ACTIONS[number]
  outcome: typeof SECURITY_OUTCOMES[number]
  severity: typeof SECURITY_SEVERITIES[number]
  actor: { type: "user" | "service" | "unknown"; id: string | null }
  target: { type: string; id: string } | null
  correlation_id: string | null
  integration_event_id: string | null
}

/** No raw messages, exception text, business bodies, URLs or credential headers. */
export function normalizeSecurityEvent(input: unknown): SecurityEvent {
  const value = record(input)
  exactKeys(value, ["schema_version", "event_id", "event_time", "observed_at", "ingested_at", "environment", "organization_id", "source", "category", "action", "outcome", "severity", "actor", "target", "correlation_id", "integration_event_id"])
  contractAssert(value.schema_version === "1.0")
  contractAssert(value.environment === "TEST" || value.environment === "PROD")
  const source = record(value.source)
  exactKeys(source, ["system", "service", "instance_id", "version"])
  const actor = record(value.actor)
  exactKeys(actor, ["type", "id"])
  contractAssert(actor.type === "user" || actor.type === "service" || actor.type === "unknown")
  contractAssert(actor.type === "unknown" ? actor.id === null : actor.id !== null)
  const target = value.target === null ? null : record(value.target)
  if (target) exactKeys(target, ["type", "id"])
  contractAssert(SECURITY_CATEGORIES.includes(value.category as SecurityEvent["category"]))
  contractAssert(SECURITY_ACTIONS.includes(value.action as SecurityEvent["action"]))
  contractAssert(SECURITY_OUTCOMES.includes(value.outcome as SecurityEvent["outcome"]))
  contractAssert(SECURITY_SEVERITIES.includes(value.severity as SecurityEvent["severity"]))
  const event: SecurityEvent = {
    schema_version: "1.0", event_id: uuid(value.event_id),
    event_time: new Date(utcTime(value.event_time)).toISOString(),
    observed_at: new Date(utcTime(value.observed_at)).toISOString(),
    ingested_at: value.ingested_at === null ? null : new Date(utcTime(value.ingested_at)).toISOString(),
    environment: value.environment,
    organization_id: value.organization_id === null ? null : identifier(value.organization_id),
    source: { system: identifier(source.system), service: identifier(source.service), instance_id: identifier(source.instance_id), version: identifier(source.version) },
    category: value.category as SecurityEvent["category"], action: value.action as SecurityEvent["action"],
    outcome: value.outcome as SecurityEvent["outcome"], severity: value.severity as SecurityEvent["severity"],
    actor: { type: actor.type, id: actor.id === null ? null : identifier(actor.id) },
    target: target === null ? null : { type: identifier(target.type), id: identifier(target.id) },
    correlation_id: value.correlation_id === null ? null : identifier(value.correlation_id),
    integration_event_id: value.integration_event_id === null ? null : uuid(value.integration_event_id),
  }
  contractAssert(event.integration_event_id !== event.event_id)
  contractAssert(Buffer.byteLength(JSON.stringify(event), "utf8") <= 16 * 1024)
  return event
}

export interface SourceCoverage {
  /** Exact service identifier from event.source.service. */
  service: string
  state: "collected" | "partial" | "not_configured"
}

/**
 * Package builder only. Callers must authenticate and authorize the export,
 * query a tenant-scoped store, persist an export audit, and deliver via HTTPS.
 * Unknown-tenant infrastructure records are never reassigned to the recipient.
 */
export function buildSecurityExport(input: {
  organizationId: string
  environment: "TEST" | "PROD"
  from: string
  to: string
  generatedAt: string
  coverage: readonly SourceCoverage[]
  events: readonly unknown[]
}) {
  const organizationId = identifier(input.organizationId)
  contractAssert(input.environment === "TEST" || input.environment === "PROD")
  const from = utcTime(input.from), to = utcTime(input.to), generatedAt = utcTime(input.generatedAt)
  contractAssert(Date.parse(from) < Date.parse(to))
  contractAssert(input.events.length <= 10_000 && input.coverage.length > 0 && input.coverage.length <= 100)
  const coverage = input.coverage.map((entry) => {
    exactKeys(record(entry), ["service", "state"])
    contractAssert(["collected", "partial", "not_configured"].includes(entry.state))
    return { service: identifier(entry.service), state: entry.state }
  }).sort((a, b) => a.service.localeCompare(b.service))
  contractAssert(new Set(coverage.map((entry) => entry.service)).size === coverage.length)
  const events = input.events.map(normalizeSecurityEvent)
  const seen = new Set<string>()
  for (const event of events) {
    contractAssert(event.organization_id === organizationId && event.environment === input.environment)
    const instant = Date.parse(event.event_time)
    contractAssert(instant >= Date.parse(from) && instant < Date.parse(to))
    contractAssert(!seen.has(event.event_id))
    seen.add(event.event_id)
    const source = coverage.find((entry) => entry.service === event.source.service)
    contractAssert(source && source.state !== "not_configured")
  }
  events.sort((a, b) => a.event_time.localeCompare(b.event_time) || a.event_id.localeCompare(b.event_id))
  let bytes = 0
  const jsonl = events.map((event) => {
    const line = JSON.stringify(event) + "\n"
    bytes += Buffer.byteLength(line, "utf8")
    contractAssert(bytes <= 16 * 1024 * 1024)
    return line
  }).join("")
  const schema = JSON.stringify(SECURITY_EVENT_SCHEMA, null, 2) + "\n"
  return {
    jsonl, schema,
    manifest: {
      schema_version: "1.0", organization_id: organizationId, environment: input.environment,
      generated_at: generatedAt, interval: { from_inclusive: from, to_exclusive: to },
      files: [{ name: "security-events.jsonl", encoding: "UTF-8", records: events.length,
        bytes, sha256: createHash("sha256").update(jsonl, "utf8").digest("hex") },
      { name: "security-event.schema.json", encoding: "UTF-8", records: 1,
        bytes: Buffer.byteLength(schema, "utf8"), sha256: createHash("sha256").update(schema, "utf8").digest("hex") }],
      sources: coverage.map((entry) => ({ ...entry, exported_records: events.filter((event) => event.source.service === entry.service).length })),
      completeness: "not_attested" as const,
      integrity_note: "Hashes verify bytes against a trusted manifest; they do not prove authenticity or complete source coverage.",
    },
  }
}
