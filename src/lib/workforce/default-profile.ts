/**
 * Product-approved starting values for a tenant that deliberately configures
 * the independent Workforce HRM module. They are data, not an implicit
 * entitlement: legacy MTM compatibility must never manufacture a policy or a
 * default shift for an existing tenant.
 *
 * A later system provisioner must retain the version and source in its audit
 * record. Until then, the configuration workbench uses copies of these values
 * only to prefill a new, tenant-admin-authored draft.
 */
export const WORKFORCE_DEFAULT_PROFILE_VERSION = "baku-standard-v1"

export const WORKFORCE_DEFAULT_TIMEZONE = "Asia/Baku"

export const WORKFORCE_DEFAULT_POLICY_NAME = "LeadDrive standard workday — Baku"

export const WORKFORCE_DEFAULT_SHIFT_CODE = "LEADDRIVE_BAKU_0900_1800"

export const WORKFORCE_DEFAULT_SHIFT_NAME = "LeadDrive standard shift — Baku"

export const WORKFORCE_DEFAULT_POLICY_DEFINITION = {
  expectedWorkSeconds: 8 * 60 * 60,
  lateGraceSeconds: 15 * 60,
  // A tenant administrator can choose a tolerance before publishing. The
  // standard profile itself means exactly eight hours of recorded work.
  undertimeToleranceSeconds: 0,
  overtimeThresholdSeconds: 0,
  // A one-hour planned lunch is allowed; only a longer recorded pause is an
  // exception. Planned breaks remain schedule metadata, not auto-deductions.
  longPauseThresholdSeconds: 60 * 60,
} as const

export const WORKFORCE_DEFAULT_SHIFT_DEFINITION = {
  startTime: "09:00",
  endTime: "18:00",
  timezone: WORKFORCE_DEFAULT_TIMEZONE,
  // ISO weekday numbering: Monday through Friday.
  daysOfWeek: [1, 2, 3, 4, 5],
  plannedBreaks: [{ startTime: "13:00", endTime: "14:00" }],
} as const

export type WorkforceDefaultPolicyDefinition = {
  expectedWorkSeconds: number
  lateGraceSeconds: number
  undertimeToleranceSeconds: number
  overtimeThresholdSeconds: number
  longPauseThresholdSeconds: number | null
}

export type WorkforceDefaultShiftDefinition = {
  startTime: string
  endTime: string
  timezone: string
  daysOfWeek: number[]
  plannedBreaks: Array<{ startTime: string; endTime: string }>
}

/** Return a mutable definition suitable for a tenant-admin draft form. */
export function workforceDefaultPolicyDefinition(): WorkforceDefaultPolicyDefinition {
  return { ...WORKFORCE_DEFAULT_POLICY_DEFINITION }
}

/** Return a mutable definition without exposing the shared profile arrays. */
export function workforceDefaultShiftDefinition(): WorkforceDefaultShiftDefinition {
  return {
    ...WORKFORCE_DEFAULT_SHIFT_DEFINITION,
    daysOfWeek: [...WORKFORCE_DEFAULT_SHIFT_DEFINITION.daysOfWeek],
    plannedBreaks: WORKFORCE_DEFAULT_SHIFT_DEFINITION.plannedBreaks.map((plannedBreak) => ({ ...plannedBreak })),
  }
}
