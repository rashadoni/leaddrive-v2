import { isDateKey } from "@/lib/mtm/mobile-week"
import { workforcePolicySnapshotValues } from "@/lib/workforce/policy-definition"
import type { WorkforcePolicyComparisonRecord } from "@/lib/workforce/policy-version-comparison"

export const WORKFORCE_POLICY_WINDOW_LIMIT = 100
export class WorkforcePolicyWindowPreviewError extends Error {
  constructor(readonly code:
    | "WORKFORCE_POLICY_WINDOW_INPUT_INVALID"
    | "WORKFORCE_POLICY_WINDOW_SCOPE_INVALID"
    | "WORKFORCE_POLICY_WINDOW_RECORD_INVALID"
    | "WORKFORCE_POLICY_WINDOW_INTEGRITY_INVALID"
    | "WORKFORCE_POLICY_WINDOW_LIMIT_EXCEEDED"
    | "WORKFORCE_POLICY_WINDOW_NOT_FUTURE_DRAFT"
    | "WORKFORCE_POLICY_WINDOW_CONFLICT",
  ) { super(code) }
}

const fail = (code: WorkforcePolicyWindowPreviewError["code"]): never => { throw new WorkforcePolicyWindowPreviewError(code) }
const identifier = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0
  && value.length <= 191 && !/[\u0000-\u001f]/u.test(value)
function dateKey(value: Date): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())
    || value.toISOString().slice(11) !== "00:00:00.000Z" || !isDateKey(value.toISOString().slice(0, 10))) {
    return fail("WORKFORCE_POLICY_WINDOW_RECORD_INVALID")
  }
  return value.toISOString().slice(0, 10)
}
function checked(record: WorkforcePolicyComparisonRecord) {
  if (!record || !identifier(record.id) || !identifier(record.organizationId)
    || (record.teamId !== null && !identifier(record.teamId))
    || !Number.isSafeInteger(record.version) || record.version < 1
    || !["DRAFT", "ACTIVE", "RETIRED"].includes(record.status)
    || typeof record.name !== "string" || !record.name.trim() || record.name.length > 160) {
    return fail("WORKFORCE_POLICY_WINDOW_RECORD_INVALID")
  }
  const effectiveFrom = dateKey(record.effectiveFrom)
  const effectiveTo = record.effectiveTo === null ? null : dateKey(record.effectiveTo)
  if (effectiveTo !== null && effectiveTo < effectiveFrom) return fail("WORKFORCE_POLICY_WINDOW_RECORD_INVALID")
  try { workforcePolicySnapshotValues(record) } catch { return fail("WORKFORCE_POLICY_WINDOW_INTEGRITY_INVALID") }
  // Definition contents, tenant identity and author/employee data are never returned.
  return { id: record.id, name: record.name, version: record.version, effectiveFrom, effectiveTo }
}

/** A bounded recorded-window projection. It never approves or performs activation. */
export function previewWorkforcePolicyFutureWindow(input: {
  organizationId: string
  currentDate: string
  draft: WorkforcePolicyComparisonRecord
  published: readonly WorkforcePolicyComparisonRecord[]
}) {
  if (!identifier(input.organizationId) || typeof input.currentDate !== "string" || !isDateKey(input.currentDate) || !Array.isArray(input.published)) {
    return fail("WORKFORCE_POLICY_WINDOW_INPUT_INVALID")
  }
  // The caller fetches limit+1 in a coherent snapshot. Never project a partial scope.
  if (input.published.length > WORKFORCE_POLICY_WINDOW_LIMIT) return fail("WORKFORCE_POLICY_WINDOW_LIMIT_EXCEEDED")
  if (input.draft?.organizationId !== input.organizationId || input.published.some(row => (
    !row || row.organizationId !== input.organizationId || row.teamId !== input.draft.teamId
  ))) return fail("WORKFORCE_POLICY_WINDOW_SCOPE_INVALID")
  const draft = checked(input.draft)
  if (input.draft.status !== "DRAFT" || draft.effectiveFrom <= input.currentDate || draft.effectiveTo !== null) {
    return fail("WORKFORCE_POLICY_WINDOW_NOT_FUTURE_DRAFT")
  }
  const windows = input.published.map(row => {
    if (row.status !== "ACTIVE") return fail("WORKFORCE_POLICY_WINDOW_RECORD_INVALID")
    return checked(row)
  }).sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom) || left.id.localeCompare(right.id))
  if (new Set([draft.id, ...windows.map(row => row.id)]).size !== windows.length + 1
    || new Set([draft.version, ...windows.map(row => row.version)]).size !== windows.length + 1) {
    return fail("WORKFORCE_POLICY_WINDOW_RECORD_INVALID")
  }
  for (let index = 1; index < windows.length; index++) {
    const previous = windows[index - 1]
    if (previous.effectiveTo === null || previous.effectiveTo >= windows[index].effectiveFrom) {
      return fail("WORKFORCE_POLICY_WINDOW_CONFLICT")
    }
  }
  const spanning = windows.filter(row => row.effectiveFrom <= draft.effectiveFrom
    && (row.effectiveTo === null || row.effectiveTo >= draft.effectiveFrom))
  // Match the unchanged canonical future-only writer: no later window, gap or empty predecessor.
  if (spanning.length > 1 || windows.some(row => row.effectiveFrom > draft.effectiveFrom)
    || (spanning.length === 0 && windows.length > 0)) return fail("WORKFORCE_POLICY_WINDOW_CONFLICT")
  const previousDate = new Date(`${draft.effectiveFrom}T00:00:00.000Z`)
  previousDate.setUTCDate(previousDate.getUTCDate() - 1)
  const projectedClose = previousDate.toISOString().slice(0, 10)
  const predecessor = spanning[0] ?? null
  if (predecessor && predecessor.effectiveFrom > projectedClose) return fail("WORKFORCE_POLICY_WINDOW_CONFLICT")
  return {
    basis: "RECORDED_SCOPE_WINDOWS_ONLY_NO_EMPLOYEE_IMPACT_OR_APPROVAL" as const,
    currentDate: input.currentDate,
    scope: { kind: input.draft.teamId === null ? "ORGANIZATION" as const : "TEAM" as const, teamId: input.draft.teamId },
    draft,
    recordedWindows: windows,
    predecessor: predecessor ? { ...predecessor, projectedEffectiveTo: projectedClose } : null,
    projectedWindow: { effectiveFrom: draft.effectiveFrom, effectiveTo: null },
    canonicalActivationRequired: true as const,
    guaranteedAtActivation: false as const,
  }
}
export type WorkforcePolicyFutureWindowPreview = ReturnType<typeof previewWorkforcePolicyFutureWindow>
