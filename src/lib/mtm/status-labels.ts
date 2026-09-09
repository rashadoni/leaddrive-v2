/**
 * Status dictionary for the Route & Field module (field UX audit 2026-09-05,
 * task A5; Definition of Done rule 3).
 *
 * Enum values such as "CHECKED_OUT", "AGENT" or "WEEKEND" are identifiers,
 * never copy. Any value that reaches a screen is translated through the
 * `mtmStatus` namespace of messages/{az,ru,en}.json via these helpers; an
 * unknown value renders the neutral "not specified" label instead of the raw
 * identifier. The field app mirrors the same groups in
 * `MTMobileApp/src/lib/status-labels.ts`.
 */
export const MTM_STATUS_GROUPS = {
  visit: ["CHECKED_IN", "CHECKED_OUT", "CANCELLED"],
  visitOutcome: ["SUCCESSFUL", "PARTIAL", "NO_CONTACT", "RESCHEDULE"],
  customer: ["ACTIVE", "INACTIVE", "PROSPECT"],
  customerType: ["PHARMACY", "CLINIC", "DOCTOR", "STORE", "OTHER"],
  role: ["ADMIN", "MANAGER", "SUPERVISOR", "AGENT"],
  agentStatus: ["ACTIVE", "INACTIVE", "SUSPENDED"],
  route: ["DRAFT", "PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "INCOMPLETE"],
  task: ["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED", "OVERDUE"],
  dayKind: ["WORKING_DAY", "WEEKEND", "PUBLIC_HOLIDAY", "COMPANY_HOLIDAY", "EXCEPTION_WORKDAY", "MOVED_WORKDAY", "MOVED_DAY_OFF"],
  importJob: ["UPLOADED", "VALIDATING", "READY", "APPLYING", "COMPLETED", "COMPLETED_WITH_ERRORS", "FAILED", "ROLLED_BACK"],
  photo: ["PENDING", "APPROVED", "REJECTED"],
} as const

export type MtmStatusGroup = keyof typeof MTM_STATUS_GROUPS
export type MtmStatusValue<G extends MtmStatusGroup> = (typeof MTM_STATUS_GROUPS)[G][number]

export const MTM_STATUS_NAMESPACE = "mtmStatus"
export const MTM_STATUS_UNKNOWN_KEY = "unknown"

/** Translator scoped to `useTranslations("mtmStatus")`. */
export type MtmStatusTranslator = (key: string) => string

/** Key inside the `mtmStatus` namespace; `unknown` for anything outside the group. */
export function mtmStatusKey(group: MtmStatusGroup, value: string | null | undefined): string {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : ""
  return (MTM_STATUS_GROUPS[group] as readonly string[]).includes(normalized)
    ? `${group}.${normalized}`
    : MTM_STATUS_UNKNOWN_KEY
}

/** Translated label for an enum value; never the raw identifier. */
export function mtmStatusLabel(t: MtmStatusTranslator, group: MtmStatusGroup, value: string | null | undefined): string {
  return t(mtmStatusKey(group, value))
}

export function isMtmStatusValue<G extends MtmStatusGroup>(group: G, value: unknown): value is MtmStatusValue<G> {
  return typeof value === "string" && (MTM_STATUS_GROUPS[group] as readonly string[]).includes(value)
}
