import { BUILDER_FIELDS, type BuilderField } from "./catalog"
import { builderProfileSchema, validateProfileCatalogue, type BuilderMapping, type BuilderProfile } from "./profile"
import { transformBuilderValue } from "./engine"

type Scalar = string | number | boolean | null
export interface ProposalSchema {
  type?: string | string[]
  const?: Scalar
  enum?: Scalar[]
  anyOf?: ProposalSchema[]
  not?: ProposalSchema
  properties?: Record<string, ProposalSchema>
  required?: string[]
  additionalProperties?: boolean
  format?: string
  pattern?: string
  minLength?: number
  maxLength?: number
  minimum?: number
  description?: string
  "x-leaddrive-mapping"?: BuilderMapping
}
interface ProposalOperation {
  operationId: string
  summary: string
  parameters: { name: string; in: "path" | "header"; required: true; schema: ProposalSchema }[]
  requestBody: { required: true; content: { "application/json": { schema: ProposalSchema } } }
  responses: Record<string, { description: string; content?: { "application/json": { schema: ProposalSchema } } }>
  "x-leaddrive-resources": string[]
}
const identifier: ProposalSchema = { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$", maxLength: 128 }
const eventId: ProposalSchema = { type: "string", format: "uuid", pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$" }
const utc: ProposalSchema = { type: "string", format: "date-time", pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z$" }
const object = (): ProposalSchema => ({ type: "object", properties: Object.create(null), required: [], additionalProperties: false })

function add(root: ProposalSchema, path: string, schema: ProposalSchema, required: boolean) {
  const keys = path.split(".")
  let cursor = root
  for (const [index, key] of keys.entries()) {
    if (required && !cursor.required!.includes(key)) cursor.required!.push(key)
    if (index === keys.length - 1) cursor.properties![key] = schema
    else cursor = cursor.properties![key] ??= object()
  }
}

function scalarSchema(value: Scalar): ProposalSchema {
  return { type: value === null ? "null" : typeof value, const: value }
}

/** Structural output schema; transformation/business constraints remain in the profile. */
function outputSchema(mapping: BuilderMapping, catalogue: readonly BuilderField[]): ProposalSchema {
  let schema: ProposalSchema
  if (mapping.source.type === "constant") {
    let value: unknown = mapping.source.value
    if (value !== null && value !== "") for (const transform of mapping.transforms) value = transformBuilderValue(value, transform)
    if (value === null || value === "") {
      if (mapping.missing === "reject") throw new Error("required_constant_missing")
      if (mapping.missing === "null") value = null
    }
    schema = scalarSchema(value as Scalar)
    return { ...schema, "x-leaddrive-mapping": mapping }
  }
  else if (mapping.source.type === "context") {
    const field = mapping.source.field
    schema = field === "entityVersion" ? { type: "integer", minimum: 1 }
      : field === "eventId" ? { ...eventId } : field === "occurredAt" ? { ...utc }
      : field === "schemaVersion" ? scalarSchema("1.0") : field === "sourceSystem" ? scalarSchema("LeadDrive") : { ...identifier }
  } else {
    const kind = catalogue.find((entry) => entry.key === (mapping.source as { field: string }).field)!.kind
    schema = { type: kind === "boolean" ? "boolean" : kind === "number" ? "number" : "string" }
  }
  // The exact mapping is included alongside conservative structural types.
  for (const transform of mapping.transforms) {
    if (transform.type === "lookup") {
      const outputs = transform.entries.map((entry) => scalarSchema(entry.to))
      schema = { anyOf: [...outputs, ...(transform.fallback === "keep" ? [schema] : [])] }
      if (!schema.anyOf!.length) schema = { not: {} }
    } else if (transform.type === "decimal") schema = {
      type: "string", pattern: transform.scale === 0 ? "^-?(0|[1-9]\\d*)$" : `^-?(0|[1-9]\\d*)\\.\\d{${transform.scale}}$`,
    }
    else if (transform.type === "date") schema = transform.format === "utc_date" ? { type: "string", format: "date", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } : { ...utc }
    else schema = { type: "string" }
  }
  if (schema.type === "string") schema.maxLength = 4000
  if (mapping.missing === "null") schema = { anyOf: [schema, { type: "null" }] }
  return { ...schema, "x-leaddrive-mapping": mapping }
}

/** Pure downloadable proposal: no server URL, tokens, real records or network calls. */
export function buildReceivingApiProposal(input: BuilderProfile, catalogue: readonly BuilderField[] = BUILDER_FIELDS) {
  const profile = builderProfileSchema.parse(input)
  validateProfileCatalogue(profile, catalogue)
  const acceptance = object()
  for (const [path, schema] of [
    [profile.receipt.statusPath, scalarSchema(profile.receipt.acceptedValue)],
    [profile.receipt.eventIdPath, eventId], [profile.receipt.externalIdPath, identifier],
    [profile.receipt.versionPath, { type: "integer", minimum: 1 }],
    [profile.receipt.receiptIdPath, identifier], [profile.receipt.operationIdPath, identifier],
    [profile.receipt.acceptedAtPath, utc],
  ] as [string, ProposalSchema][]) add(acceptance, path, { ...schema }, true)
  // Receiver may include additional metadata. The sender validates the required
  // aliases and identities and never treats extra fields as ERP completion.
  const openObjects = (schema: ProposalSchema) => {
    if (schema.type === "object") schema.additionalProperties = true
    Object.values(schema.properties ?? {}).forEach(openObjects)
  }
  openObjects(acceptance)
  const paths: Record<string, Partial<Record<"put" | "post", ProposalOperation>>> = Object.create(null)
  for (const resource of profile.resources.filter((entry) => entry.enabled)) {
    const body = object()
    resource.mappings.forEach((mapping) => add(body, mapping.target, outputSchema(mapping, catalogue), mapping.missing !== "omit"))
    const path = resource.path.replaceAll("{resource}", resource.resource)
    const method = resource.method.toLowerCase() as "put" | "post"
    const entry = paths[path] ??= {}
    const existing = entry[method]
    if (existing) {
      const schema = existing.requestBody.content["application/json"].schema
      existing.requestBody.content["application/json"].schema = { anyOf: [...(schema.anyOf ?? [schema]), body] }
      existing["x-leaddrive-resources"].push(resource.resource)
      continue
    }
    entry[method] = {
      operationId: `receive_${resource.resource}_${method}`,
      summary: "Durably accept approved CRM data; ERP processing is owned by the customer",
      "x-leaddrive-resources": [resource.resource],
      parameters: [
        ...(path.includes("{externalId}") ? [{ name: "externalId", in: "path" as const, required: true as const, schema: { ...identifier } }] : []),
        { name: "Idempotency-Key", in: "header", required: true, schema: { type: "string", pattern: "^[0-9a-f]{64}$" } },
        { name: "X-Correlation-ID", in: "header", required: true, schema: { ...identifier } },
      ],
      requestBody: { required: true, content: { "application/json": { schema: body } } },
      responses: {
        "2XX": { description: "Durable API acceptance only. Required aliases must match the submitted event ID, external ID and entity version. HTTP success alone is insufficient.", content: { "application/json": { schema: acceptance } } },
        "400": { description: "Invalid data; manual correction required" }, "401": { description: "Authentication failed; stop delivery" },
        "403": { description: "Access denied; stop delivery" }, "409": { description: "Event identity or payload conflict; manual investigation required" },
        "422": { description: "Validation failed; manual correction required" }, "429": { description: "Rate limited; uncertain outcome, reconcile before retry" },
        "5XX": { description: "Uncertain outcome; reconcile before retry" },
      },
    }
  }
  return {
    openapi: "3.1.0", jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
    info: { title: `${profile.label} — receiving API proposal`, version: "1.0", description: "DRAFT for customer approval. No operational endpoint is configured. This describes structural JSON types; mapping rules and validation must also be reviewed in the profile. OAuth issuance, receipt lookup, durable deduplication and ERP processing require a separate agreed customer contract." },
    // Relative paths only; an approved private origin must be added before use.
    "x-leaddrive-operational": false,
    "x-leaddrive-environment": profile.environment,
    "x-leaddrive-profile": profile,
    "x-leaddrive-limits": { ...profile.limits, maxResponseBytes: 16384, httpsPort: 443, redirectsAllowed: false },
    "x-leaddrive-idempotency": { sameEventSameBody: "same durable receipt", sameEventDifferentBody: "409 conflict", uncertainOutcome: "lookup receipt before retry; lookup API is not yet agreed" },
    paths,
    components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", description: "Token supplied by approved server-side OAuth configuration; token endpoint and scopes remain to be agreed." }, clientCertificate: { type: "mutualTLS" } } },
    security: [{ bearerAuth: [], clientCertificate: [] }],
  }
}
