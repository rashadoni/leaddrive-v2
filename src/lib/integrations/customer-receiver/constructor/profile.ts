import { z } from "zod"
import { BUILDER_FIELDS, CONTEXT_FIELDS, fieldsForResource, type BuilderField } from "./catalog"

export const safePath = (value: string) => value.split(".").length <= 8 && value.split(".").every((part) => /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(part) && !["__proto__", "constructor", "prototype"].includes(part))
const path = z.string().min(1).max(256).refine(safePath)
const scalar = z.union([z.string().max(2000), z.number().finite(), z.boolean(), z.null()])
const sourceKey = z.string().max(180).refine((key) => BUILDER_FIELDS.some((entry) => entry.key === key) || (safePath(key) && /^custom\.(company|contact|deal)\.[A-Za-z0-9_-]{1,128}$/.test(key)))
const transformSchema = z.discriminatedUnion("type", [
  z.object({ type: z.enum(["trim", "upper", "lower"]) }).strict(),
  z.object({ type: z.literal("decimal"), scale: z.number().int().min(0).max(4), rounding: z.enum(["reject", "half_up"]) }).strict(),
  z.object({ type: z.literal("date"), format: z.enum(["utc_date", "utc_timestamp"]) }).strict(),
  z.object({ type: z.literal("affix"), prefix: z.string().max(120), suffix: z.string().max(120) }).strict(),
  z.object({ type: z.literal("lookup"), entries: z.array(z.object({ from: scalar, to: scalar }).strict()).max(100), fallback: z.enum(["reject", "keep"]) }).strict(),
])
export const mappingSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), target: path,
  source: z.discriminatedUnion("type", [
    z.object({ type: z.literal("field"), field: sourceKey }).strict(),
    z.object({ type: z.literal("context"), field: z.enum(CONTEXT_FIELDS) }).strict(),
    z.object({ type: z.literal("constant"), value: scalar }).strict(),
  ]),
  missing: z.enum(["omit", "null", "reject"]), transforms: z.array(transformSchema).max(8),
}).strict()
const conditionSchema = z.object({
  field: sourceKey, operator: z.enum(["eq", "not_eq", "in", "not_in", "exists", "missing", "gte", "lte"]),
  value: z.union([scalar, z.array(scalar).min(1).max(100)]),
}).strict()
const resourceSchema = z.object({
  resource: z.enum(["customers", "contacts", "deals"]), enabled: z.boolean(),
  method: z.enum(["PUT", "POST"]),
  path: z.string().min(1).max(256).refine((value) => {
    const expanded = value.replaceAll("{externalId}", "record-id").replaceAll("{resource}", "records")
    return /^\/[A-Za-z0-9_./-]+$/.test(expanded) && !expanded.includes("//") && !expanded.split("/").some((part) => part === "." || part === "..")
  }),
  selection: z.object({ mode: z.enum(["manual", "all", "filtered"]), match: z.enum(["all", "any"]), conditions: z.array(conditionSchema).max(30) }).strict(),
  mappings: z.array(mappingSchema).min(1).max(100),
}).strict()

export const builderProfileSchema = z.object({
  schemaVersion: z.literal("1.0"), label: z.string().trim().min(1).max(120),
  environment: z.enum(["TEST", "PROD"]), lifecycle: z.literal("draft"),
  resources: z.array(resourceSchema).min(1).max(3),
  schedule: z.object({ mode: z.enum(["manual", "on_change", "interval"]), intervalSeconds: z.number().int().min(60).max(86400) }).strict(),
  limits: z.object({ requestsPerSecond: z.number().int().min(1).max(5), concurrency: z.number().int().min(1).max(2), batchSize: z.number().int().min(1).max(500),
    connectTimeoutSeconds: z.number().int().min(1).max(5), timeoutSeconds: z.number().int().min(5).max(30), maxBodyKiB: z.number().int().min(1).max(1024), retryWindowHours: z.number().int().min(1).max(24) }).strict(),
  receipt: z.object({ statusPath: path, acceptedValue: z.string().min(1).max(64), eventIdPath: path, externalIdPath: path, versionPath: path, receiptIdPath: path, operationIdPath: path, acceptedAtPath: path }).strict(),
  logSources: z.array(z.enum(["crm_auth", "crm_access", "crm_admin", "crm_data", "integration", "azure_activity", "entra", "key_vault", "waf", "vpn", "database", "host", "deployment", "collector"])).min(1).max(14),
  logRetentionDays: z.number().int().min(1).max(365),
}).strict().superRefine((profile, context) => {
  const issue = (message: string) => context.addIssue({ code: "custom", message })
  if (new Set(profile.resources.map((entry) => entry.resource)).size !== profile.resources.length) issue("duplicate_resource")
  if (profile.limits.connectTimeoutSeconds > profile.limits.timeoutSeconds) issue("invalid_timeout_budget")
  if (new Set(profile.logSources).size !== profile.logSources.length) issue("duplicate_log_source")
  const receiptPaths = Object.entries(profile.receipt).filter(([key]) => key.endsWith("Path")).map(([, value]) => value)
  if (new Set(receiptPaths).size !== receiptPaths.length) issue("duplicate_receipt_path")
  for (const resource of profile.resources) {
    if (resource.selection.mode === "filtered" && resource.selection.conditions.length === 0) issue("empty_filter")
    if (new Set(resource.mappings.map((entry) => entry.id)).size !== resource.mappings.length) issue("duplicate_mapping_id")
    if (resource.enabled && ["eventId", "externalId", "entityVersion"].some((field) => !resource.mappings.some((entry) => entry.source.type === "context" && entry.source.field === field && entry.missing === "reject" && entry.transforms.length === 0))) issue("required_identity_mapping")
    const targets = resource.mappings.map((entry) => entry.target)
    if (targets.some((target, index) => targets.some((other, otherIndex) => index !== otherIndex && (target === other || target.startsWith(other + "."))))) issue("overlapping_targets")
    for (const mapping of resource.mappings) for (const transform of mapping.transforms) if (transform.type === "lookup" && new Set(transform.entries.map((entry) => JSON.stringify(entry.from))).size !== transform.entries.length) issue("ambiguous_lookup")
    const permitted = fieldsForResource(resource.resource).map((entry) => entry.key)
    const allowed = (key: string) => permitted.includes(key) || (key.startsWith("custom.") && fieldsForResource(resource.resource, [{ key, entity: key.split(".")[1] as BuilderField["entity"], kind: "text", label: { ru: "", en: "", az: "" } }]).length > 0)
    if (resource.mappings.some((entry) => entry.source.type === "field" && !allowed(entry.source.field)) || resource.selection.conditions.some((entry) => !allowed(entry.field))) issue("field_outside_resource")
    for (const condition of resource.selection.conditions) {
      if (["in", "not_in"].includes(condition.operator) && !Array.isArray(condition.value)) issue("membership_requires_array")
      if (!["in", "not_in"].includes(condition.operator) && Array.isArray(condition.value)) issue("comparison_requires_scalar")
    }
  }
})

export type BuilderProfile = z.infer<typeof builderProfileSchema>
export type BuilderMapping = z.infer<typeof mappingSchema>
export type BuilderTransform = z.infer<typeof transformSchema>

/** Custom field names are allowed only after tenant-owned catalogue registration. */
export function validateProfileCatalogue(profile: BuilderProfile, catalogue: readonly BuilderField[]) {
  for (const resource of profile.resources) {
    const keys = fieldsForResource(resource.resource, catalogue).map((entry) => entry.key)
    for (const entry of resource.mappings) if (entry.source.type === "field" && !keys.includes(entry.source.field)) throw new Error("unregistered_source_field")
    for (const entry of resource.selection.conditions) if (!keys.includes(entry.field)) throw new Error("unregistered_source_field")
  }
}

export function defaultBuilderProfile(): BuilderProfile {
  const contextMappings: BuilderMapping[] = ["schemaVersion", "eventId", "externalId", "entityVersion", "occurredAt"].map((key) => ({ id: key, target: key, source: { type: "context", field: key as typeof CONTEXT_FIELDS[number] }, missing: "reject", transforms: [] }))
  const mapped = (id: string, target: string, field: string, transforms: BuilderTransform[] = [], missing: BuilderMapping["missing"] = "reject"): BuilderMapping => ({ id, target, source: { type: "field", field }, missing, transforms })
  return {
    schemaVersion: "1.0", label: "CRM → ERP", environment: "TEST", lifecycle: "draft",
    resources: [
      { resource: "customers", enabled: true, method: "PUT", path: "/integration/v1/customers/{externalId}", selection: { mode: "manual", match: "all", conditions: [] }, mappings: [...contextMappings,
        { id: "source", target: "sourceSystem", source: { type: "context", field: "sourceSystem" }, missing: "reject", transforms: [] },
        { id: "type", target: "customer.type", source: { type: "constant", value: "legal_entity" }, missing: "reject", transforms: [] },
        mapped("name", "customer.name", "company.name", [{ type: "trim" }]), mapped("country", "customer.countryCode", "company.country", [{ type: "upper" }]), mapped("email", "customer.email", "company.email", [{ type: "trim" }], "omit") ] },
      { resource: "contacts", enabled: false, method: "PUT", path: "/integration/v1/contacts/{externalId}", selection: { mode: "manual", match: "all", conditions: [] }, mappings: [...contextMappings,
        { id: "customer", target: "customerExternalId", source: { type: "context", field: "customerExternalId" }, missing: "reject", transforms: [] },
        mapped("name", "contact.name", "contact.fullName"), mapped("email", "contact.email", "contact.email", [], "omit"), mapped("phone", "contact.phone", "contact.phone", [], "omit") ] },
      { resource: "deals", enabled: true, method: "PUT", path: "/integration/v1/deals/{externalId}", selection: { mode: "manual", match: "all", conditions: [] }, mappings: [...contextMappings,
        { id: "customer", target: "customerExternalId", source: { type: "context", field: "customerExternalId" }, missing: "reject", transforms: [] },
        mapped("name", "deal.name", "deal.name"), mapped("stage", "deal.stageCode", "deal.stage"), mapped("amount", "deal.amount", "deal.valueAmount", [{ type: "decimal", scale: 2, rounding: "reject" }]), mapped("currency", "deal.currency", "deal.currency", [{ type: "upper" }]), mapped("date", "deal.expectedCloseDate", "deal.expectedClose", [{ type: "date", format: "utc_date" }], "omit") ] },
    ], schedule: { mode: "manual", intervalSeconds: 300 },
    limits: { requestsPerSecond: 5, concurrency: 2, batchSize: 100, connectTimeoutSeconds: 5, timeoutSeconds: 30, maxBodyKiB: 256, retryWindowHours: 24 },
    receipt: { statusPath: "status", acceptedValue: "accepted", eventIdPath: "eventId", externalIdPath: "externalId", versionPath: "acceptedVersion", receiptIdPath: "receiptId", operationIdPath: "operationId", acceptedAtPath: "acceptedAt" },
    logSources: ["crm_auth", "crm_access", "crm_admin", "crm_data", "integration", "azure_activity", "entra", "key_vault", "waf", "vpn", "database", "host", "deployment", "collector"], logRetentionDays: 90,
  }
}
