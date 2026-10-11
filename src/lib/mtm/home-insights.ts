/**
 * The lower row of the MTM home screen: how much of the client base was
 * reached this month, whether this week's visits look like visits, and what
 * the organization has not set up yet.
 *
 * Owner 2026-10-11, asked what else the screen should carry «чтоб было
 * полезно», accepted these as a picture. Each answers a question a manager
 * of field representatives acts on:
 *
 * - the base: «whom are we not visiting» — the share of clients seen this
 *   month, by class once the organization classifies them, by specialty
 *   until then;
 * - the visits: «were they real» — recorded at the client, with a photo, and
 *   not suspiciously short or long;
 * - the setup: what keeps those figures from meaning anything (clients
 *   without a point on the map cannot be checked for place; clients all in one
 *   class cannot be prioritised).
 *
 * Pure: the route reads, this counts.
 */
import { visitPlaceSummary, type VisitPlaceInput } from "@/lib/mtm/visit-place-check"

/** A finished visit shorter than this is listed as «too short». The long threshold is the organization's `autoCheckoutMinutes`. */
export const MTM_SHORT_VISIT_MINUTES = 2
/** Groups a base card spells out; the rest are added up as «other». */
export const HOME_BASE_GROUPS_SHOWN = 4
export const HOME_BASE_OTHER_KEY = "__other__"

export type HomeBaseSubject = "contacts" | "customers"
/** What the bars are split by: the client class, a doctor's specialty, or an institution's type. */
export type HomeBaseGrouping = "class" | "specialty" | "type"

export interface HomeBaseGroup {
  key: string
  total: number
  visited: number
}

export interface HomeBase {
  subject: HomeBaseSubject
  grouping: HomeBaseGrouping
  total: number
  visited: number
  groups: HomeBaseGroup[]
}

/**
 * The base card's numbers. Classes are shown once they tell clients apart;
 * while every client sits in one class (the default «B» of a fresh import),
 * a bar per class would be one bar, so the split falls back to `secondary`.
 */
export function buildHomeBase(input: {
  subject: HomeBaseSubject
  byClass: readonly HomeBaseGroup[]
  /** By specialty for contacts, by type for institutions. */
  secondary: readonly HomeBaseGroup[]
  classOrder: readonly string[]
}): HomeBase | null {
  const classes = input.byClass.filter((group) => group.total > 0)
  const total = classes.reduce((sum, group) => sum + group.total, 0)
  if (total === 0) return null
  const visited = classes.reduce((sum, group) => sum + Math.min(group.visited, group.total), 0)
  const clamp = (group: HomeBaseGroup): HomeBaseGroup => ({ key: group.key, total: group.total, visited: Math.min(group.visited, group.total) })

  if (classes.length >= 2) {
    const rank = (key: string) => {
      const index = input.classOrder.indexOf(key)
      return index < 0 ? input.classOrder.length : index
    }
    return {
      subject: input.subject,
      grouping: "class",
      total,
      visited,
      groups: classes.map(clamp).sort((left, right) => rank(left.key) - rank(right.key) || left.key.localeCompare(right.key)),
    }
  }

  const ranked = input.secondary
    .filter((group) => group.total > 0)
    .map(clamp)
    .sort((left, right) => right.total - left.total || left.key.localeCompare(right.key))
  const shown = ranked.slice(0, HOME_BASE_GROUPS_SHOWN)
  const rest = ranked.slice(HOME_BASE_GROUPS_SHOWN)
  if (rest.length > 0) {
    shown.push({
      key: HOME_BASE_OTHER_KEY,
      total: rest.reduce((sum, group) => sum + group.total, 0),
      visited: rest.reduce((sum, group) => sum + group.visited, 0),
    })
  }
  return { subject: input.subject, grouping: input.subject === "contacts" ? "specialty" : "type", total, visited, groups: shown }
}

export interface HomeQualityVisit extends VisitPlaceInput {
  checkInAt: Date
  /** Minutes; null while the visit is open or when it was never measured. */
  duration: number | null
  photoCount: number
}

export interface HomeQuality {
  visits: number
  /** Check-in and check-out both within the client's zone. */
  atPlace: number
  /** At least one of them recorded away from the client. */
  awayFromPlace: number
  /** No client pin or no GPS fix: the place cannot be judged. */
  placeUnknown: number
  withPhoto: number
  tooLong: number
  tooShort: number
  longMinutes: number
  shortMinutes: number
}

/**
 * This week's visits, judged. Place is the one rule every web page uses
 * (`visitPlaceSummary`). A visit still open past the long threshold counts as
 * long by the clock; a finished one by its recorded duration.
 */
export function buildHomeQuality(
  visits: readonly HomeQualityVisit[],
  options: { now: Date; organizationRadius: number; longMinutes: number; shortMinutes?: number },
): HomeQuality {
  const shortMinutes = options.shortMinutes ?? MTM_SHORT_VISIT_MINUTES
  const longMinutes = Math.max(shortMinutes + 1, options.longMinutes)
  const quality: HomeQuality = { visits: visits.length, atPlace: 0, awayFromPlace: 0, placeUnknown: 0, withPhoto: 0, tooLong: 0, tooShort: 0, longMinutes, shortMinutes }
  for (const visit of visits) {
    const verdict = visitPlaceSummary(visit, options.organizationRadius).verdict
    if (verdict === "at_point") quality.atPlace += 1
    else if (verdict === "outside") quality.awayFromPlace += 1
    else quality.placeUnknown += 1
    if (visit.photoCount > 0) quality.withPhoto += 1
    const open = visit.status === "CHECKED_IN"
    const minutes = open ? Math.floor((options.now.getTime() - visit.checkInAt.getTime()) / 60_000) : visit.duration
    if (minutes !== null && minutes > longMinutes) quality.tooLong += 1
    else if (!open && visit.status === "CHECKED_OUT" && minutes !== null && minutes < shortMinutes) quality.tooShort += 1
  }
  return quality
}

export type HomeSetupKind = "customersWithoutPin" | "contactsUnclassified" | "noVisitNorms"

export interface HomeSetupStep {
  kind: HomeSetupKind
  count: number
  total: number
}

/**
 * What is left to set up before the figures mean something. Listed only while
 * there is something to do; an organization that has done it sees no strip.
 */
export function buildHomeSetup(input: {
  customersTotal: number
  customersWithoutPin: number
  contactsTotal: number
  /** How many different classes the clients are spread over. */
  contactClassesInUse: number
  fieldContactsEnabled: boolean
  coveragePolicies: number
}): HomeSetupStep[] {
  const steps: HomeSetupStep[] = []
  if (input.customersTotal > 0 && input.customersWithoutPin > 0) {
    steps.push({ kind: "customersWithoutPin", count: input.customersWithoutPin, total: input.customersTotal })
  }
  if (input.fieldContactsEnabled && input.contactsTotal > 0 && input.contactClassesInUse <= 1) {
    steps.push({ kind: "contactsUnclassified", count: input.contactsTotal, total: input.contactsTotal })
  }
  if (input.coveragePolicies === 0 && input.customersTotal + input.contactsTotal > 0) {
    steps.push({ kind: "noVisitNorms", count: 0, total: 0 })
  }
  return steps
}

export interface HomeRecentVisit {
  id: string
  /** ISO instant of the check-in. */
  at: string
  customerName: string | null
  agentName: string | null
  /** Minutes; null while the visit is open. */
  durationMinutes: number | null
  flag: "short" | "long" | null
}

export function recentVisitFlag(visit: { status: string; duration: number | null }, thresholds: { longMinutes: number; shortMinutes?: number }): "short" | "long" | null {
  if (visit.duration === null) return null
  if (visit.duration > thresholds.longMinutes) return "long"
  if (visit.status === "CHECKED_OUT" && visit.duration < (thresholds.shortMinutes ?? MTM_SHORT_VISIT_MINUTES)) return "short"
  return null
}

export interface MtmHomeInsights {
  timezone: string
  today: string
  /** First day of the month the base is counted for. */
  monthStart: string
  /** Monday of the week the visits are judged for. */
  weekStart: string
  base: HomeBase | null
  quality: HomeQuality | null
  setup: HomeSetupStep[]
  recentVisits: HomeRecentVisit[]
}
