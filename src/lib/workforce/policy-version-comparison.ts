import {
  canonicalWorkforcePolicyJson,
  workforcePolicySnapshotValues,
  type WorkforcePolicySnapshotValues,
} from "@/lib/workforce/policy-definition"

export const WORKFORCE_POLICY_COMPARISON_FIELDS = [
  "expectedWorkSeconds", "lateGraceSeconds", "undertimeToleranceSeconds",
  "overtimeThresholdSeconds", "longPauseThresholdSeconds",
] as const satisfies readonly (keyof WorkforcePolicySnapshotValues)[]

export type WorkforcePolicyComparisonRecord = {
  id: string
  organizationId: string
  teamId: string | null
  version: number
  status: "DRAFT" | "ACTIVE" | "RETIRED"
  name: string
  effectiveFrom: Date
  effectiveTo: Date | null
  definition: unknown
  definitionHash: string
}
export class WorkforcePolicyComparisonError extends Error {
  constructor(readonly code:
    | "WORKFORCE_POLICY_COMPARISON_RECORD_INVALID"
    | "WORKFORCE_POLICY_COMPARISON_SCOPE_MISMATCH"
    | "WORKFORCE_POLICY_COMPARISON_INTEGRITY_INVALID",
  ) { super(code) }
}
function identifier(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 191 && !/[\u0000-\u001f]/u.test(value)
}
function dateKey(value: Date): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()) || value.toISOString().slice(11) !== "00:00:00.000Z") {
    throw new WorkforcePolicyComparisonError("WORKFORCE_POLICY_COMPARISON_RECORD_INVALID")
  }
  return value.toISOString().slice(0, 10)
}
function checkedRecord(record: WorkforcePolicyComparisonRecord) {
  if (!record || !identifier(record.id) || !identifier(record.organizationId)
    || (record.teamId !== null && !identifier(record.teamId))
    || !Number.isSafeInteger(record.version) || record.version < 1
    || !["DRAFT", "ACTIVE", "RETIRED"].includes(record.status)
    || typeof record.name !== "string" || !record.name.trim() || record.name.length > 160) {
    throw new WorkforcePolicyComparisonError("WORKFORCE_POLICY_COMPARISON_RECORD_INVALID")
  }
  const effectiveFrom = dateKey(record.effectiveFrom)
  const effectiveTo = record.effectiveTo === null ? null : dateKey(record.effectiveTo)
  if (effectiveTo !== null && effectiveTo < effectiveFrom) {
    throw new WorkforcePolicyComparisonError("WORKFORCE_POLICY_COMPARISON_RECORD_INVALID")
  }
  let values: WorkforcePolicySnapshotValues
  let opaqueDefinition: string
  try {
    values = workforcePolicySnapshotValues(record)
    opaqueDefinition = canonicalWorkforcePolicyJson(Object.fromEntries(
      Object.entries(record.definition as Record<string, unknown>).filter(([key]) => (
        !WORKFORCE_POLICY_COMPARISON_FIELDS.some(field => field === key)
      )),
    ))
  } catch {
    throw new WorkforcePolicyComparisonError("WORKFORCE_POLICY_COMPARISON_INTEGRITY_INVALID")
  }
  return {
    values, opaqueDefinition,
    metadata: { id: record.id, name: record.name, version: record.version, status: record.status, effectiveFrom, effectiveTo, definitionHash: record.definitionHash.toLowerCase() },
  }
}
/** Two recorded definitions only. No effective-policy resolution, impact, writes or activation. */
export function compareWorkforcePolicyVersions(input: {
  organizationId: string
  from: WorkforcePolicyComparisonRecord
  to: WorkforcePolicyComparisonRecord
}) {
  if (!identifier(input.organizationId) || input.from?.organizationId !== input.organizationId
    || input.to?.organizationId !== input.organizationId || input.from?.teamId !== input.to?.teamId) {
    throw new WorkforcePolicyComparisonError("WORKFORCE_POLICY_COMPARISON_SCOPE_MISMATCH")
  }
  const from = checkedRecord(input.from), to = checkedRecord(input.to)
  if (input.from.id === input.to.id || input.from.version === input.to.version) {
    throw new WorkforcePolicyComparisonError("WORKFORCE_POLICY_COMPARISON_RECORD_INVALID")
  }
  const fields = WORKFORCE_POLICY_COMPARISON_FIELDS.map(field => {
    const before = from.values[field], after = to.values[field]
    return { field, before, after, changed: before !== after, deltaSeconds: before === null || after === null ? null : after - before }
  })
  return {
    basis: "RECORDED_DEFINITIONS_ONLY_NO_EFFECTIVE_IMPACT_OR_APPROVAL" as const,
    scope: { kind: input.from.teamId === null ? "ORGANIZATION" as const : "TEAM" as const, teamId: input.from.teamId },
    from: from.metadata, to: to.metadata, fields,
    changedCalculationFields: fields.filter(field => field.changed).length,
    opaqueDefinitionChanged: from.opaqueDefinition !== to.opaqueDefinition,
    opaqueDefinitionInterpretation: "ADDITIONAL_HASH_VERIFIED_KEYS_NOT_DISPLAYED_OR_INTERPRETED" as const,
  }
}
export type WorkforcePolicyVersionComparison = ReturnType<typeof compareWorkforcePolicyVersions>
