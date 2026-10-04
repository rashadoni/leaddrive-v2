import type { WorkforcePolicyEmployeeImpactPreview } from "./policy-employee-impact-preview"

export type WorkforcePolicyImpactSource = {
  id: string; name: string; version: number; teamId: string | null; definitionHash: string; effectiveFrom: string
}
const fields = ["expectedWorkSeconds", "lateGraceSeconds", "undertimeToleranceSeconds", "overtimeThresholdSeconds", "longPauseThresholdSeconds"] as const
const counts = ["directoryEmployees", "selectedDraft", "unchangedSelection", "newlyCovered", "calculationChanged",
  "opaqueDefinitionChanged", "teamOverride", "outsideDraftTeam", "missingMembership", "noPolicyBefore", "noPolicyAfter"] as const
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v)
const exact = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).length === keys.length && keys.every(key => Object.hasOwn(v, key))
const identifier = (v: unknown): v is string => typeof v === "string" && !!v.trim() && v.length <= 191 && !/[\u0000-\u001f]/u.test(v)
const seconds = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0
const instant = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(v)
  && Number.isFinite(new Date(v).getTime()) && new Date(v).toISOString() === v
const date = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(v)
  && instant(v + "T00:00:00.000Z")
function metadata(v: unknown): v is WorkforcePolicyEmployeeImpactPreview["draft"] {
  return object(v) && exact(v, ["id", "name", "version", "effectiveFrom", "effectiveTo", "definitionHash"])
    && identifier(v.id) && typeof v.name === "string" && !!v.name.trim() && v.name.length <= 160
    && seconds(v.version) && v.version > 0 && date(v.effectiveFrom)
    && (v.effectiveTo === null || (date(v.effectiveTo) && v.effectiveTo >= v.effectiveFrom))
    && typeof v.definitionHash === "string" && /^[a-f0-9]{64}$/u.test(v.definitionHash)
}
function localParts(utc: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(utc))
  const get = (key: string) => parts.find(part => part.type === key)?.value
  return { day: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}:${get("second")}` }
}

/** Validate the selected recorded draft and aggregate invariants before display. No server code is imported at runtime. */
export function validWorkforcePolicyEmployeeImpactReceipt(value: unknown, source: WorkforcePolicyImpactSource): value is WorkforcePolicyEmployeeImpactPreview {
  if (!object(value) || !exact(value, ["schemaVersion", "basis", "observedAt", "timezone", "scopeInstant", "cohort", "membershipBasis",
    "scope", "draft", "counts", "groups", "canonicalActivationRequired", "guaranteedAtActivation", "employeeIdentityReturned", "opaqueDefinitionInterpretation"])
    || value.schemaVersion !== 1 || value.basis !== "RECORDED_ACTIVE_DIRECTORY_WHAT_IF_NO_EMPLOYMENT_OR_ACTIVATION_GUARANTEE"
    || value.cohort !== "CURRENT_ACTIVE_DIRECTORY_ALL_ROLES_NOT_FUTURE_EMPLOYMENT_ELIGIBILITY"
    || value.membershipBasis !== "RECORDED_TIMELINE_AT_LOCAL_MIDNIGHT_NO_MUTABLE_TEAM_FALLBACK"
    || value.canonicalActivationRequired !== true || value.guaranteedAtActivation !== false || value.employeeIdentityReturned !== false
    || value.opaqueDefinitionInterpretation !== "HASH_VERIFIED_NOT_INTERPRETED"
    || !instant(value.observedAt) || !instant(value.scopeInstant) || typeof value.timezone !== "string" || value.timezone.length > 100
    || !metadata(value.draft) || value.draft.id !== source.id || value.draft.version !== source.version || value.draft.name !== source.name
    || value.draft.effectiveFrom !== source.effectiveFrom || value.draft.definitionHash !== source.definitionHash.toLowerCase() || value.draft.effectiveTo !== null
    || !object(value.scope) || !exact(value.scope, ["kind", "teamId"]) || value.scope.teamId !== source.teamId
    || value.scope.kind !== (source.teamId === null ? "ORGANIZATION" : "TEAM")
    || !object(value.counts) || !exact(value.counts, counts) || !counts.every(key => seconds(value.counts && (value.counts as Record<string, unknown>)[key]))
    || !Array.isArray(value.groups) || value.groups.length > 100) return false
  try {
    const observed = localParts(value.observedAt, value.timezone), scope = localParts(value.scopeInstant, value.timezone)
    if (value.draft.effectiveFrom <= observed.day || scope.day !== value.draft.effectiveFrom || scope.time !== "00:00:00"
      || new Date(value.scopeInstant).getUTCMilliseconds() !== 0) return false
  } catch { return false }
  const c = value.counts as WorkforcePolicyEmployeeImpactPreview["counts"]
  if (c.directoryEmployees > 100 || counts.some(key => c[key] > c.directoryEmployees)
    || c.selectedDraft + c.unchangedSelection !== c.directoryEmployees || c.newlyCovered > c.selectedDraft || c.newlyCovered > c.noPolicyBefore
    || c.calculationChanged > c.selectedDraft - c.newlyCovered || c.opaqueDefinitionChanged > c.selectedDraft - c.newlyCovered
    || c.noPolicyAfter > c.unchangedSelection || c.teamOverride > c.unchangedSelection || c.outsideDraftTeam > c.unchangedSelection
    || (source.teamId === null ? c.outsideDraftTeam !== 0 : c.teamOverride !== 0 || c.outsideDraftTeam < c.missingMembership)) return false
  const ids = new Set<string | null>(), totals = { selected: 0, new: 0, calculation: 0, opaque: 0 }
  let afterValues: unknown[] | null = null
  for (const group of value.groups) {
    if (!object(group) || !exact(group, ["before", "count", "fields", "opaqueDefinitionChanged"])
      || (group.before !== null && (!metadata(group.before) || group.before.id === source.id))
      || !seconds(group.count) || group.count < 1 || group.count > 100 || !Array.isArray(group.fields) || group.fields.length !== fields.length
      || (group.before === null ? group.opaqueDefinitionChanged !== null : typeof group.opaqueDefinitionChanged !== "boolean")) return false
    const id = group.before === null ? null : group.before.id
    if (ids.has(id)) return false
    ids.add(id)
    for (const [index, field] of fields.entries()) {
      const row = group.fields[index]
      if (!object(row) || !exact(row, ["field", "before", "after", "changed", "deltaSeconds"]) || row.field !== field
        || !(seconds(row.after) || (field === "longPauseThresholdSeconds" && row.after === null))
        || (group.before === null ? row.before !== null : !(seconds(row.before) || (field === "longPauseThresholdSeconds" && row.before === null)))
        || row.changed !== (group.before === null || row.before !== row.after)
        || row.deltaSeconds !== (row.before === null || row.after === null ? null : (row.after as number) - (row.before as number))) return false
    }
    const after = group.fields.map(row => row.after)
    if (afterValues && after.some((v, index) => v !== afterValues![index])) return false
    afterValues = after
    totals.selected += group.count
    if (group.before === null) totals.new += group.count
    else if (group.fields.some(row => row.changed)) totals.calculation += group.count
    if (group.opaqueDefinitionChanged === true) totals.opaque += group.count
  }
  return totals.selected === c.selectedDraft && totals.new === c.newlyCovered
    && totals.calculation === c.calculationChanged && totals.opaque === c.opaqueDefinitionChanged
}
