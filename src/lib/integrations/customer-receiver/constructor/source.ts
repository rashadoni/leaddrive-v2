import { identifier } from "../contract"
import { BUILDER_FIELDS, fieldsForResource, type BuilderEntity, type BuilderField, type BuilderResource } from "./catalog"
import { BuilderEvaluationError, type BuilderSnapshot } from "./engine"

export interface BuilderSourceReader {
  find: (entity: BuilderEntity, input: { id: string; organizationId: string; fields: readonly string[] }) => Promise<Record<string, unknown> | null>
  customValues: (input: { organizationId: string; entityId: string; fieldIds: readonly string[] }) => Promise<readonly { fieldId: string; value: string | null }[]>
}

/**
 * Call with a tenant-scoped transaction and its authenticated org. Reader adapters
 * must SELECT only the supplied fields and include organizationId for provenance.
 * This returns snapshots only; no export, queue write or network operation.
 */
export async function loadBuilderSnapshot(input: {
  reader: BuilderSourceReader; organizationId: string; resource: BuilderResource; externalId: string
  catalogue?: readonly BuilderField[]
}): Promise<BuilderSnapshot> {
  const organizationId = identifier(input.organizationId), externalId = identifier(input.externalId)
  const catalogue = fieldsForResource(input.resource, input.catalogue ?? BUILDER_FIELDS)
  const snapshot: BuilderSnapshot = { organizationId, entities: {} }
  const primary: BuilderEntity = input.resource === "customers" ? "company" : input.resource === "contacts" ? "contact" : "deal"
  const load = async (entity: BuilderEntity, id: string) => {
    const fields = [...new Set(["id", ...catalogue.filter((entry) => entry.entity === entity && !entry.key.startsWith("custom.")).map((entry) => entry.key.split(".")[1])])]
    if (fields.some((name) => !BUILDER_FIELDS.some((entry) => entry.key === `${entity}.${name}`))) throw new BuilderEvaluationError("unregistered_source_field")
    const row = await input.reader.find(entity, { id, organizationId, fields: [...new Set(["id", "organizationId", ...fields])] })
    if (!row) throw new BuilderEvaluationError("source_not_found")
    if (row.organizationId !== organizationId || row.id !== id) throw new BuilderEvaluationError("source_scope_mismatch")
    const values: Record<string, unknown> = {}
    for (const key of fields) {
      const value = row[key]
      if (value === undefined) continue
      if (key === "valueAmount") {
        if (typeof value === "string") values[key] = value
        else if (value !== null && typeof value === "object" && "toFixed" in value && typeof value.toFixed === "function") values[key] = value.toFixed(4)
        else throw new BuilderEvaluationError("decimal_requires_lossless_string")
      } else values[key] = value instanceof Date ? value.toISOString() : value
    }
    const custom = catalogue.filter((entry) => entry.entity === entity && entry.key.startsWith(`custom.${entity}.`))
    const customFields: Record<string, unknown> = {}
    if (custom.length) {
      const entries = await input.reader.customValues({ organizationId, entityId: id, fieldIds: custom.map((entry) => entry.key.split(".")[2]) })
      for (const entry of entries) {
        const definition = custom.find((field) => field.key.split(".")[2] === entry.fieldId)
        if (!definition) throw new BuilderEvaluationError("unregistered_source_field")
        if (definition.kind === "boolean" && entry.value !== null) {
          if (entry.value !== "true" && entry.value !== "false") throw new BuilderEvaluationError("invalid_boolean")
          customFields[entry.fieldId] = entry.value === "true"
        } else customFields[entry.fieldId] = entry.value
      }
    }
    snapshot.entities[entity] = { organizationId, fields: values, customFields }
    return row
  }
  const row = await load(primary, externalId)
  if (primary !== "company") {
    if (typeof row.companyId !== "string") throw new BuilderEvaluationError("customer_reference_missing")
    await load("company", identifier(row.companyId))
  }
  return snapshot
}
