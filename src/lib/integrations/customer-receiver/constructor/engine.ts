import { createHash } from "node:crypto"
import { canonicalJson } from "../../../event-platform/canonical-json"
import { identifier, utcTime, uuid } from "../contract"
import { BUILDER_FIELDS, type BuilderEntity, type BuilderField, type BuilderResource } from "./catalog"
import { builderProfileSchema, safePath, validateProfileCatalogue, type BuilderProfile, type BuilderTransform } from "./profile"

export class BuilderEvaluationError extends Error {
  constructor(readonly code: string) { super(code); this.name = "BuilderEvaluationError" }
}
function ensure(test: unknown, code: string): asserts test { if (!test) throw new BuilderEvaluationError(code) }

export interface BuilderSnapshot {
  organizationId: string
  entities: Partial<Record<BuilderEntity, {
    organizationId: string
    fields: Record<string, unknown>
    customFields?: Record<string, unknown>
  }>>
}
export interface BuilderContext {
  organizationId: string
  integrationId: string
  eventId: string
  externalId: string
  entityVersion: number
  occurredAt: string
  customerExternalId?: string
}

function sourceValue(snapshot: BuilderSnapshot, key: string): unknown {
  const segments = key.split(".")
  const custom = segments[0] === "custom"
  const entity = snapshot.entities[(custom ? segments[1] : segments[0]) as BuilderEntity]
  const fields = custom ? entity?.customFields : entity?.fields
  const name = custom ? segments[2] : segments[1]
  return fields && Object.hasOwn(fields, name) ? fields[name] : undefined
}

function scalar(value: unknown): string | number | boolean | null {
  ensure(value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)), "unsupported_value")
  if (typeof value === "string") ensure(value.length <= 4000, "value_too_long")
  return value as string | number | boolean | null
}

function decimalParts(value: unknown) {
  ensure(typeof value === "string" || (typeof value === "number" && Number.isSafeInteger(value)), "decimal_requires_lossless_string")
  const match = String(value).match(/^(-?)(0|[1-9]\d{0,31})(?:\.(\d{1,12}))?$/)
  ensure(match, "invalid_decimal")
  return { negative: match![1] === "-", integer: match![2], fraction: match![3] ?? "" }
}

export function transformBuilderValue(value: unknown, transform: BuilderTransform): unknown {
  if (transform.type === "decimal") {
    const part = decimalParts(value)
    const discarded = part.fraction.slice(transform.scale)
    if (transform.rounding === "reject") ensure(!/[1-9]/.test(discarded), "precision_loss")
    let units = BigInt(part.integer + part.fraction.padEnd(transform.scale, "0").slice(0, transform.scale))
    if (transform.rounding === "half_up" && discarded.length > 0 && Number(discarded[0]) >= 5) units += BigInt(1)
    const digits = units.toString().padStart(transform.scale + 1, "0")
    return (part.negative && units !== BigInt(0) ? "-" : "") + (transform.scale === 0 ? digits : digits.slice(0, -transform.scale) + "." + digits.slice(-transform.scale))
  }
  if (transform.type === "lookup") {
    const found = transform.entries.find((entry) => entry.from === value)
    if (found) return found.to
    ensure(transform.fallback === "keep", "unmapped_value")
    return value
  }
  ensure(typeof value === "string", "transform_requires_text")
  const text = value as string
  if (transform.type === "trim") return text.trim()
  if (transform.type === "upper") return text.toUpperCase()
  if (transform.type === "lower") return text.toLowerCase()
  if (transform.type === "affix") return transform.prefix + text + transform.suffix
  ensure(transform.type === "date", "unsupported_transform")
  const timestamp = text.length === 10 ? `${text}T00:00:00Z` : text
  try { utcTime(timestamp) } catch { throw new BuilderEvaluationError("invalid_date") }
  return transform.format === "utc_date" ? timestamp.slice(0, 10) : new Date(timestamp).toISOString()
}

function compareDecimal(a: unknown, b: unknown) {
  const left = decimalParts(a), right = decimalParts(b)
  const scale = Math.max(left.fraction.length, right.fraction.length)
  const asUnits = (part: typeof left) => BigInt(part.integer + part.fraction.padEnd(scale, "0")) * (part.negative ? BigInt(-1) : BigInt(1))
  const l = asUnits(left), r = asUnits(right)
  return l < r ? -1 : l > r ? 1 : 0
}

function conditionMatches(snapshot: BuilderSnapshot, condition: BuilderProfile["resources"][number]["selection"]["conditions"][number]) {
  const value = sourceValue(snapshot, condition.field)
  const exists = value !== undefined && value !== null && value !== ""
  if (condition.operator === "exists") return exists
  if (condition.operator === "missing") return !exists
  if (!exists) return false
  if (condition.operator === "eq") return value === condition.value
  if (condition.operator === "not_eq") return value !== condition.value
  if (condition.operator === "in") return (condition.value as unknown[]).includes(value)
  if (condition.operator === "not_in") return !(condition.value as unknown[]).includes(value)
  const comparison = compareDecimal(value, condition.value)
  return condition.operator === "gte" ? comparison >= 0 : comparison <= 0
}

function assign(target: Record<string, unknown>, path: string, value: unknown) {
  ensure(safePath(path), "unsafe_target")
  const keys = path.split(".")
  let cursor = target
  for (const key of keys.slice(0, -1)) {
    if (!Object.hasOwn(cursor, key)) cursor[key] = Object.create(null)
    ensure(cursor[key] !== null && typeof cursor[key] === "object" && !Array.isArray(cursor[key]), "overlapping_targets")
    cursor = cursor[key] as Record<string, unknown>
  }
  cursor[keys[keys.length - 1]] = value
}

/** Pure dry-run: no queries, mutations, token lookup, queue activation or HTTP. */
export function previewBuilderResource(input: {
  profile: BuilderProfile
  resource: BuilderResource
  snapshot: BuilderSnapshot
  context: BuilderContext
  catalogue?: readonly BuilderField[]
}) {
  const parsed = builderProfileSchema.safeParse(input.profile)
  ensure(parsed.success, "invalid_profile")
  const profile = parsed.data!
  const catalogue = input.catalogue ?? BUILDER_FIELDS
  validateProfileCatalogue(profile, catalogue)
  const configuration = profile.resources.find((entry) => entry.resource === input.resource)
  ensure(configuration, "resource_not_configured")
  const config = configuration!
  const { snapshot, context } = input
  identifier(context.organizationId); identifier(context.integrationId)
  uuid(context.eventId); identifier(context.externalId); utcTime(context.occurredAt)
  ensure(Number.isSafeInteger(context.entityVersion) && context.entityVersion > 0, "invalid_version")
  ensure(snapshot.organizationId === context.organizationId, "foreign_organization")
  for (const entity of Object.values(snapshot.entities)) ensure(entity.organizationId === context.organizationId, "foreign_organization")
  const primary = input.resource === "customers" ? "company" : input.resource === "contacts" ? "contact" : "deal"
  ensure(sourceValue(snapshot, `${primary}.id`) === context.externalId, "identity_mismatch")
  if (primary !== "company") {
    ensure(context.customerExternalId && sourceValue(snapshot, "company.id") === context.customerExternalId, "customer_reference_mismatch")
    ensure(sourceValue(snapshot, `${primary}.companyId`) === context.customerExternalId, "customer_reference_mismatch")
  }
  const values = { ...context, schemaVersion: profile.schemaVersion, sourceSystem: "LeadDrive" }
  const data: Record<string, unknown> = Object.create(null)
  const omitted: string[] = []
  for (const mapping of config.mappings) {
    let value: unknown = mapping.source.type === "constant" ? mapping.source.value : mapping.source.type === "context" ? values[mapping.source.field] : sourceValue(snapshot, mapping.source.field)
    if (mapping.source.type === "field") {
      const sourceField = mapping.source.field
      if (catalogue.find((entry) => entry.key === sourceField)?.kind === "decimal" && value !== undefined && value !== null) ensure(typeof value === "string", "decimal_requires_lossless_string")
    }
    if (value === undefined || value === null || value === "") {
      if (mapping.missing === "omit") { omitted.push(mapping.target); continue }
      ensure(mapping.missing === "null", "required_value_missing")
      value = null
    } else {
      for (const transform of mapping.transforms) value = transformBuilderValue(value, transform)
      if (value === undefined || value === null || value === "") {
        if (mapping.missing === "omit") { omitted.push(mapping.target); continue }
        ensure(mapping.missing === "null", "required_value_missing")
        value = null
      }
    }
    assign(data, mapping.target, scalar(value))
  }
  const checks = config.selection.conditions.map((condition) => conditionMatches(snapshot, condition))
  const matches = config.selection.mode !== "filtered" || (config.selection.match === "all" ? checks.every(Boolean) : checks.some(Boolean))
  const body = canonicalJson(data)
  const bytes = Buffer.byteLength(body, "utf8")
  ensure(bytes <= profile.limits.maxBodyKiB * 1024, "payload_limit_exceeded")
  const identity = canonicalJson([context.organizationId, context.integrationId, profile.environment, input.resource, context.eventId])
  return {
    organizationId: context.organizationId, integrationId: context.integrationId, environment: profile.environment,
    expectedReceipt: { eventId: context.eventId, externalId: context.externalId, entityVersion: context.entityVersion },
    resource: input.resource, selected: config.enabled && matches,
    selection: !config.enabled ? "disabled" : !matches ? "no_match" : config.selection.mode === "manual" ? "manual" : "matched",
    method: config.method,
    path: config.path.replaceAll("{resource}", input.resource).replaceAll("{externalId}", encodeURIComponent(context.externalId)),
    data, body, bytes, omitted,
    idempotencyKey: createHash("sha256").update(identity).digest("hex"),
    payloadHash: createHash("sha256").update(body).digest("hex"),
    externalSendingAvailable: false as const,
  }
}

export function syntheticBuilderInput(organizationId: string, resource: BuilderResource, sample: "typical" | "missing_optional" | "precision" = "typical", catalogue: readonly BuilderField[] = BUILDER_FIELDS) {
  identifier(organizationId)
  const snapshot: BuilderSnapshot = { organizationId, entities: {
    company: { organizationId, fields: { id: "crm-customer-demo-001", name: "DEMO CUSTOMER", country: "AZ", email: sample === "missing_optional" ? null : "contact@example.invalid", phone: "+000000000", voen: "DEMO-TAX", category: "client", status: "active", leadStatus: "qualified", city: "DEMO CITY", address: "DEMO ADDRESS", createdAt: "2026-10-14T08:00:00Z", updatedAt: "2026-10-14T08:00:00Z" } },
    contact: { organizationId, fields: { id: "crm-contact-demo-001", companyId: "crm-customer-demo-001", fullName: "DEMO CONTACT", email: sample === "missing_optional" ? null : "person@example.invalid", phone: "+000000000", position: "DEMO POSITION", isActive: true, lifecycleStage: "customer" } },
    deal: { organizationId, fields: { id: "crm-deal-demo-001", companyId: "crm-customer-demo-001", name: "DEMO DEAL", pipelineId: "demo-pipeline", stage: "QUALIFIED", valueAmount: sample === "precision" ? "1500.1234" : "1500.0000", currency: "AZN", probability: 75, expectedClose: sample === "missing_optional" ? null : "2026-11-01T00:00:00Z", createdAt: "2026-10-14T08:00:01Z", updatedAt: "2026-10-14T08:00:01Z" } },
  } }
  for (const field of catalogue) {
    const entity = snapshot.entities[field.entity]
    if (!entity) continue
    const value = field.kind === "decimal" ? "123.0000" : field.kind === "number" ? 42 : field.kind === "boolean" ? true : field.kind === "date" ? "2026-10-14T08:00:00Z" : "DEMO VALUE"
    if (field.key.startsWith("custom.")) {
      entity.customFields ??= {}
      entity.customFields[field.key.split(".")[2]] = sample === "missing_optional" ? null : value
    } else {
      const name = field.key.split(".")[1]
      if (!Object.hasOwn(entity.fields, name)) entity.fields[name] = value
    }
  }
  const number = resource === "customers" ? "1" : resource === "deals" ? "2" : "3"
  const context: BuilderContext = { organizationId, integrationId: "draft-preview", eventId: `10000000-0000-4000-8000-00000000000${number}`, externalId: resource === "customers" ? "crm-customer-demo-001" : resource === "contacts" ? "crm-contact-demo-001" : "crm-deal-demo-001", entityVersion: 1, occurredAt: "2026-10-14T08:00:00Z", customerExternalId: "crm-customer-demo-001" }
  return { snapshot, context }
}
