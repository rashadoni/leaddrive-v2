import { currentDateKey, isDateKey } from "@/lib/mtm/mobile-week"
import { isValidTimezone, localDateTimeToUnambiguousUtc } from "@/lib/timezone"
import { canonicalWorkforcePolicyJson, workforcePolicySnapshotValues } from "./policy-definition"
import { previewWorkforcePolicyFutureWindow } from "./policy-future-window-preview"
import { resolveWorkforcePolicy, WorkforcePolicyResolutionError } from "./policy-resolution"
import { WORKFORCE_POLICY_COMPARISON_FIELDS, type WorkforcePolicyComparisonRecord } from "./policy-version-comparison"

export const WORKFORCE_POLICY_IMPACT_EMPLOYEE_LIMIT = 100
export const WORKFORCE_POLICY_IMPACT_POLICY_LIMIT = 100
export type WorkforcePolicyImpactRecord = WorkforcePolicyComparisonRecord & {
  activatedAt: Date | null
  retiredAt: Date | null
}
export type WorkforcePolicyImpactEmployee = {
  id: string
  organizationId: string
  status: "ACTIVE"
  membership: {
    id: string
    organizationId: string
    agentId: string
    teamId: string | null
    effectiveAt: Date
  } | null
}
export class WorkforcePolicyEmployeeImpactError extends Error {
  constructor(readonly code:
    | "WORKFORCE_POLICY_IMPACT_INPUT_INVALID"
    | "WORKFORCE_POLICY_IMPACT_LIMIT_EXCEEDED"
    | "WORKFORCE_POLICY_IMPACT_RECORD_INVALID"
    | "WORKFORCE_POLICY_IMPACT_INTEGRITY_INVALID"
    | "WORKFORCE_POLICY_IMPACT_SCOPE_INVALID"
    | "WORKFORCE_POLICY_IMPACT_TIME_AMBIGUOUS"
    | "WORKFORCE_POLICY_IMPACT_POLICY_AMBIGUOUS",
  ) { super(code) }
}
const fail = (code: WorkforcePolicyEmployeeImpactError["code"]): never => { throw new WorkforcePolicyEmployeeImpactError(code) }
const identifier = (value: unknown): value is string => typeof value === "string" && !!value.trim()
  && value.length <= 191 && !/[\u0000-\u001f]/u.test(value)
const instant = (value: unknown): value is Date => value instanceof Date && Number.isFinite(value.getTime())
function dateKey(value: Date) {
  if (!instant(value) || value.toISOString().slice(11) !== "00:00:00.000Z"
    || !isDateKey(value.toISOString().slice(0, 10))) return fail("WORKFORCE_POLICY_IMPACT_RECORD_INVALID")
  return value.toISOString().slice(0, 10)
}
function checked(record: WorkforcePolicyImpactRecord, draft: boolean, observedAt: Date) {
  if (!record || !identifier(record.id) || !identifier(record.organizationId)
    || (record.teamId !== null && !identifier(record.teamId))
    || !Number.isSafeInteger(record.version) || record.version < 1
    || typeof record.name !== "string" || !record.name.trim() || record.name.length > 160
    || record.status !== (draft ? "DRAFT" : "ACTIVE")
    || record.retiredAt !== null
    || (draft ? record.activatedAt !== null : (!instant(record.activatedAt) || record.activatedAt > observedAt))) {
    return fail("WORKFORCE_POLICY_IMPACT_RECORD_INVALID")
  }
  const effectiveFrom = dateKey(record.effectiveFrom)
  const effectiveTo = record.effectiveTo === null ? null : dateKey(record.effectiveTo)
  if (effectiveTo !== null && effectiveTo < effectiveFrom) return fail("WORKFORCE_POLICY_IMPACT_RECORD_INVALID")
  try {
    const values = workforcePolicySnapshotValues(record)
    const opaque = canonicalWorkforcePolicyJson(Object.fromEntries(Object.entries(record.definition as Record<string, unknown>)
      .filter(([key]) => !WORKFORCE_POLICY_COMPARISON_FIELDS.some(field => field === key))))
    return { values, opaque, metadata: { id: record.id, name: record.name, version: record.version,
      effectiveFrom, effectiveTo, definitionHash: record.definitionHash.toLowerCase() } }
  } catch { return fail("WORKFORCE_POLICY_IMPACT_INTEGRITY_INVALID") }
}

/** Aggregate what-if only: no employee identities, future employment prediction or persisted changes. */
export function previewWorkforcePolicyEmployeeImpact(input: {
  organizationId: string
  observedAt: Date
  timezone: string
  draft: WorkforcePolicyImpactRecord
  published: readonly WorkforcePolicyImpactRecord[]
  employees: readonly WorkforcePolicyImpactEmployee[]
}) {
  if (!identifier(input.organizationId) || !instant(input.observedAt) || !isValidTimezone(input.timezone)
    || !Array.isArray(input.published) || !Array.isArray(input.employees)) return fail("WORKFORCE_POLICY_IMPACT_INPUT_INVALID")
  if (input.published.length > WORKFORCE_POLICY_IMPACT_POLICY_LIMIT
    || input.employees.length > WORKFORCE_POLICY_IMPACT_EMPLOYEE_LIMIT) return fail("WORKFORCE_POLICY_IMPACT_LIMIT_EXCEEDED")
  if (input.draft?.organizationId !== input.organizationId
    || input.published.some(row => row?.organizationId !== input.organizationId)
    || input.employees.some(row => row?.organizationId !== input.organizationId)) return fail("WORKFORCE_POLICY_IMPACT_SCOPE_INVALID")
  const draft = checked(input.draft, true, input.observedAt)
  const records = new Map(input.published.map(row => [row.id, checked(row, false, input.observedAt)]))
  if (records.size !== input.published.length || records.has(input.draft.id)) return fail("WORKFORCE_POLICY_IMPACT_RECORD_INVALID")
  const versions = new Set<string>()
  for (const row of [input.draft, ...input.published]) {
    const key = JSON.stringify([row.teamId, row.version])
    if (versions.has(key)) return fail("WORKFORCE_POLICY_IMPACT_RECORD_INVALID")
    versions.add(key)
  }
  const window = previewWorkforcePolicyFutureWindow({ organizationId: input.organizationId,
    currentDate: currentDateKey(input.observedAt, input.timezone), draft: input.draft,
    published: input.published.filter(row => row.teamId === input.draft.teamId) })
  let scopeInstant: Date
  try { scopeInstant = localDateTimeToUnambiguousUtc(`${draft.metadata.effectiveFrom}T00:00`, input.timezone) }
  catch { return fail("WORKFORCE_POLICY_IMPACT_TIME_AMBIGUOUS") }
  const employeeIds = new Set<string>()
  for (const employee of input.employees) {
    if (!identifier(employee.id) || employee.status !== "ACTIVE" || employeeIds.has(employee.id)) return fail("WORKFORCE_POLICY_IMPACT_RECORD_INVALID")
    employeeIds.add(employee.id)
    const membership = employee.membership
    if (membership && (membership.organizationId !== input.organizationId || membership.agentId !== employee.id)) return fail("WORKFORCE_POLICY_IMPACT_SCOPE_INVALID")
    if (membership && (!identifier(membership.id) || (membership.teamId !== null && !identifier(membership.teamId))
      || !instant(membership.effectiveAt) || membership.effectiveAt > scopeInstant)) return fail("WORKFORCE_POLICY_IMPACT_RECORD_INVALID")
  }
  // Closing the predecessor and activating the draft happen only in this in-memory scenario.
  const predecessor = window.predecessor
  const hypothetical: WorkforcePolicyImpactRecord[] = input.published.map(row => predecessor && row.id === predecessor.id
    ? { ...row, effectiveTo: new Date(`${predecessor.projectedEffectiveTo}T00:00:00.000Z`) } : row)
  hypothetical.push({ ...input.draft, status: "ACTIVE", activatedAt: input.observedAt })
  function resolve(employee: WorkforcePolicyImpactEmployee, policies: readonly WorkforcePolicyImpactRecord[]) {
    try { return resolveWorkforcePolicy({ workDate: draft.metadata.effectiveFrom, workdayStartedAt: scopeInstant,
      resolutionAt: input.observedAt, teamMembershipId: employee.membership?.id ?? null,
      teamIdAtWorkday: employee.membership?.teamId ?? null, policies }) }
    catch (error) {
      if (error instanceof WorkforcePolicyResolutionError && error.code === "WORKFORCE_POLICY_MISSING") return null
      return fail("WORKFORCE_POLICY_IMPACT_POLICY_AMBIGUOUS")
    }
  }
  type Group = { before: ReturnType<typeof checked>["metadata"] | null; count: number;
    fields: Array<{ field: typeof WORKFORCE_POLICY_COMPARISON_FIELDS[number]; before: number | null; after: number | null;
      changed: boolean; deltaSeconds: number | null }>; opaqueDefinitionChanged: boolean | null }
  const groups = new Map<string | null, Group>()
  const counts = { directoryEmployees: input.employees.length, selectedDraft: 0, unchangedSelection: 0,
    newlyCovered: 0, calculationChanged: 0, opaqueDefinitionChanged: 0, teamOverride: 0,
    outsideDraftTeam: 0, missingMembership: 0, noPolicyBefore: 0, noPolicyAfter: 0 }
  for (const employee of input.employees) {
    const before = resolve(employee, input.published), after = resolve(employee, hypothetical)
    if (!employee.membership) counts.missingMembership++
    if (!before) counts.noPolicyBefore++
    if (!after) counts.noPolicyAfter++
    if (input.draft.teamId !== null && employee.membership?.teamId !== input.draft.teamId) counts.outsideDraftTeam++
    if (input.draft.teamId === null && after?.scope === "TEAM") counts.teamOverride++
    if (after?.id !== input.draft.id) { counts.unchangedSelection++; continue }
    counts.selectedDraft++
    const previous = before ? records.get(before.id)! : null
    const fields = WORKFORCE_POLICY_COMPARISON_FIELDS.map(field => ({ field, before: previous?.values[field] ?? null,
      after: draft.values[field], changed: previous ? previous.values[field] !== draft.values[field] : true,
      deltaSeconds: previous?.values[field] == null || draft.values[field] === null ? null : draft.values[field] - previous.values[field]! }))
    const opaqueChanged = previous ? previous.opaque !== draft.opaque : null
    if (!before) counts.newlyCovered++
    if (before && fields.some(field => field.changed)) counts.calculationChanged++
    if (opaqueChanged) counts.opaqueDefinitionChanged++
    const key = before?.id ?? null, existing = groups.get(key)
    if (existing) existing.count++
    else groups.set(key, { before: previous?.metadata ?? null, count: 1, fields, opaqueDefinitionChanged: opaqueChanged })
  }
  return { schemaVersion: 1 as const,
    basis: "RECORDED_ACTIVE_DIRECTORY_WHAT_IF_NO_EMPLOYMENT_OR_ACTIVATION_GUARANTEE" as const,
    observedAt: input.observedAt.toISOString(), timezone: input.timezone, scopeInstant: scopeInstant.toISOString(),
    cohort: "CURRENT_ACTIVE_DIRECTORY_ALL_ROLES_NOT_FUTURE_EMPLOYMENT_ELIGIBILITY" as const,
    membershipBasis: "RECORDED_TIMELINE_AT_LOCAL_MIDNIGHT_NO_MUTABLE_TEAM_FALLBACK" as const,
    scope: window.scope, draft: draft.metadata, counts,
    groups: [...groups.values()].sort((left, right) => (left.before?.id ?? "").localeCompare(right.before?.id ?? "")),
    canonicalActivationRequired: true as const, guaranteedAtActivation: false as const,
    employeeIdentityReturned: false as const, opaqueDefinitionInterpretation: "HASH_VERIFIED_NOT_INTERPRETED" as const }
}
export type WorkforcePolicyEmployeeImpactPreview = ReturnType<typeof previewWorkforcePolicyEmployeeImpact>
