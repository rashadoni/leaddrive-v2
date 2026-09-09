import { calculateDistance } from "@/lib/geo-utils"
import {
  addDateKeyDays,
  isDateKey,
  localDateKeyToUtc,
  startOfIsoWeekDateKey,
} from "@/lib/mtm/mobile-week"
import { dateInputValueInTimezone } from "@/lib/timezone"
import { isValidKpiCoordinatePair, MTM_KPI_FORMULA_VERSION } from "@/lib/mtm/explainable-kpi"

export type MobileKpiPeriodKind = "day" | "week" | "month"
export type MobileKpiSegment = "DOCTOR" | "PHARMACY" | "OTHER"

export type MobileKpiPeriod = {
  kind: MobileKpiPeriodKind
  anchor: string
  start: string
  endExclusive: string
  activityFrom: Date
  activityTo: Date
  routeFrom: Date
  routeTo: Date
}

export type MobileKpiRoutePoint = {
  id: string
  customerId: string
  contactId: string | null
  status: string
  customer: { name: string; objectType: string }
}

export type MobileKpiRoute = {
  id: string
  date: Date
  status: string
  points: MobileKpiRoutePoint[]
}

export type MobileKpiVisit = {
  id: string
  customerId: string
  contactId: string | null
  routePointId: string | null
  status: string
  checkInLat?: number | null
  checkInLng?: number | null
  checkOutLat?: number | null
  checkOutLng?: number | null
  gpsEvidenceExcluded?: boolean
  customer: { name: string; objectType: string }
}

export type MobileKpiTask = {
  id: string
  status: string
  dueDate: Date | null
  completedAt: Date | null
}

export type MobileKpiWorkday = {
  id: string
  workDate: Date
  status: string
  startedAt: Date
  pausedAt: Date | null
  completedAt: Date | null
  totalPausedSeconds: number
}

export type MobileKpiLocation = {
  latitude: number
  longitude: number
  accuracy: number | null
  recordedAt: Date
}

type Ratio = {
  numerator: number
  denominator: number
  percentage: number
}

type CoverageDetail = {
  subjectKey: string
  customerId: string
  contactId: string | null
  name: string
  segment: MobileKpiSegment
}

function ratio(numerator: number, denominator: number): Ratio {
  return {
    numerator,
    denominator,
    percentage: denominator > 0 ? Math.round((numerator / denominator) * 1_000) / 10 : 0,
  }
}

function nextMonth(dateKey: string): string {
  const year = Number(dateKey.slice(0, 4))
  const monthIndex = Number(dateKey.slice(5, 7)) - 1
  return new Date(Date.UTC(year, monthIndex + 1, 1)).toISOString().slice(0, 10)
}

function periodBounds(anchor: string, kind: MobileKpiPeriodKind): { start: string; endExclusive: string } {
  if (kind === "day") return { start: anchor, endExclusive: addDateKeyDays(anchor, 1) }
  if (kind === "week") {
    const start = startOfIsoWeekDateKey(anchor)
    return { start, endExclusive: addDateKeyDays(start, 7) }
  }
  const start = `${anchor.slice(0, 7)}-01`
  return { start, endExclusive: nextMonth(start) }
}

export function resolveMobileKpiPeriod(
  anchor: string,
  kind: MobileKpiPeriodKind,
  timezone: string,
): MobileKpiPeriod | null {
  if (!isDateKey(anchor)) return null
  const { start, endExclusive } = periodBounds(anchor, kind)
  return {
    kind,
    anchor,
    start,
    endExclusive,
    activityFrom: localDateKeyToUtc(start, timezone),
    activityTo: localDateKeyToUtc(endExclusive, timezone),
    routeFrom: new Date(`${start}T00:00:00.000Z`),
    routeTo: new Date(`${endExclusive}T00:00:00.000Z`),
  }
}

function subjectKey(customerId: string, contactId: string | null): string {
  return contactId ? `contact:${contactId}` : `customer:${customerId}`
}

function segment(contactId: string | null, objectType: string): MobileKpiSegment {
  if (contactId || objectType === "DOCTOR") return "DOCTOR"
  if (objectType === "PHARMACY") return "PHARMACY"
  return "OTHER"
}

function workedSeconds(workday: MobileKpiWorkday, now: Date): number {
  const end = workday.completedAt ?? now
  const currentPause = workday.status === "PAUSED" && workday.pausedAt
    ? Math.max(0, Math.floor((end.getTime() - workday.pausedAt.getTime()) / 1_000))
    : 0
  const elapsed = Math.max(0, Math.floor((end.getTime() - workday.startedAt.getTime()) / 1_000))
  return Math.max(0, elapsed - workday.totalPausedSeconds - currentPause)
}

function travelDistance(locations: MobileKpiLocation[]): number {
  let meters = 0
  for (let index = 1; index < locations.length; index += 1) {
    meters += calculateDistance(
      locations[index - 1].latitude,
      locations[index - 1].longitude,
      locations[index].latitude,
      locations[index].longitude,
    )
  }
  return Math.round(meters)
}

export function buildMobileKpi(input: {
  routes: MobileKpiRoute[]
  visits: MobileKpiVisit[]
  tasks: MobileKpiTask[]
  workdays: MobileKpiWorkday[]
  locations: MobileKpiLocation[]
  totalLocationCount: number
  locationsTruncated: boolean
  timezone: string
  today: string
  now: Date
  planPointExclusionIds?: string[]
  completeness?: "COMPLETE" | "PARTIAL"
  adjustments?: Array<{
    factType: "PLAN_POINT" | "GPS_VISIT"
    factId: string
    action: "EXCLUDE" | "RESTORE"
    reason: string
    createdAt: string
    auditId?: string
  }>
}) {
  const completedVisitRoutePoints = new Set(
    input.visits.flatMap((visit) =>
      visit.status === "CHECKED_OUT" && visit.routePointId ? [visit.routePointId] : [],
    ),
  )
  const plannedSubjects = new Map<string, CoverageDetail>()
  const coveredSubjects = new Set<string>()
  const missedStopIds: string[] = []
  const excludedPlanPointIds = new Set(input.planPointExclusionIds ?? [])
  let plannedStops = 0
  let completedPlannedStops = 0

  for (const route of input.routes) {
    const routeDate = route.date.toISOString().slice(0, 10)
    for (const point of route.points) {
      const key = subjectKey(point.customerId, point.contactId)
      plannedSubjects.set(key, {
        subjectKey: key,
        customerId: point.customerId,
        contactId: point.contactId,
        name: point.customer.name,
        segment: segment(point.contactId, point.customer.objectType),
      })
      const completed = point.status === "VISITED" || completedVisitRoutePoints.has(point.id)
      if (completed) {
        coveredSubjects.add(key)
      } else if (routeDate < input.today) {
        missedStopIds.push(point.id)
      }
      // PLAN_POINT adjustments belong only to the explainable Plan formula.
      // Coverage and the SWM-15 missed-stop queue remain grounded in the raw
      // route, so a manager decision cannot silently rewrite other metrics.
      if (!excludedPlanPointIds.has(point.id)) {
        plannedStops += 1
        if (completed) completedPlannedStops += 1
      }
    }
  }

  const completedVisits = input.visits.filter((visit) => visit.status === "CHECKED_OUT")
  const gpsConfirmedVisits = completedVisits.filter((visit) =>
    !visit.gpsEvidenceExcluded &&
    isValidKpiCoordinatePair(visit.checkInLat, visit.checkInLng) &&
    isValidKpiCoordinatePair(visit.checkOutLat, visit.checkOutLng),
  )
  for (const visit of completedVisits) {
    const key = subjectKey(visit.customerId, visit.contactId)
    if (plannedSubjects.has(key)) coveredSubjects.add(key)
  }
  const unplannedCompleted = completedVisits.filter((visit) =>
    !plannedSubjects.has(subjectKey(visit.customerId, visit.contactId)),
  )

  const coverage = (kind?: MobileKpiSegment) => {
    const subjects = [...plannedSubjects.values()].filter((item) => !kind || item.segment === kind)
    const covered = subjects.filter((item) => coveredSubjects.has(item.subjectKey))
    return {
      ...ratio(covered.length, subjects.length),
      uncovered: subjects.filter((item) => !coveredSubjects.has(item.subjectKey)),
    }
  }

  const completedTasks = input.tasks.filter((task) => task.status === "COMPLETED")
  const overdueCutoff = Math.min(input.now.getTime(), new Date(`${input.today}T23:59:59.999Z`).getTime())
  const overdueTasks = input.tasks.filter((task) =>
    task.status === "OVERDUE" || (
      task.dueDate != null &&
      task.dueDate.getTime() < overdueCutoff &&
      task.status !== "COMPLETED" &&
      task.status !== "CANCELLED"
    ),
  )

  const locationDays = new Set(
    input.locations.map((location) => dateInputValueInTimezone(location.recordedAt, input.timezone)),
  )
  const workdayDates = input.workdays.map((workday) => workday.workDate.toISOString().slice(0, 10))
  const workdaysWithGps = workdayDates.filter((date) => locationDays.has(date))
  const accuracyValues = input.locations.flatMap((location) => location.accuracy == null ? [] : [location.accuracy])
  const lastLocation = input.locations.at(-1) ?? null

  return {
    formula: {
      version: MTM_KPI_FORMULA_VERSION,
      planDefinition: "visited route points / non-draft, non-cancelled route points",
      gpsDefinition: "completed visits with check-in and check-out coordinates / completed visits",
      adjustments: input.adjustments ?? [],
      sourceFreshnessThresholdMinutes: 15,
      completeness: input.completeness ?? "COMPLETE",
      authoritative: (input.completeness ?? "COMPLETE") === "COMPLETE",
    },
    visits: {
      planned: plannedStops,
      completedPlanned: completedPlannedStops,
      completedTotal: completedVisits.length,
      unplannedCompleted: unplannedCompleted.length,
      missed: missedStopIds.length,
      fulfillment: ratio(completedPlannedStops, plannedStops),
    },
    coverage: {
      overall: coverage(),
      doctors: coverage("DOCTOR"),
      pharmacies: coverage("PHARMACY"),
      other: coverage("OTHER"),
    },
    tasks: {
      assigned: input.tasks.length,
      completed: completedTasks.length,
      overdue: overdueTasks.length,
      completion: ratio(completedTasks.length, input.tasks.length),
      overdueIds: overdueTasks.map((task) => task.id),
    },
    gps: {
      workdays: input.workdays.length,
      workdaysWithGps: workdaysWithGps.length,
      dayCoverage: ratio(workdaysWithGps.length, input.workdays.length),
      visitConfirmation: ratio(gpsConfirmedVisits.length, completedVisits.length),
      points: input.totalLocationCount,
      distanceMeters: input.locationsTruncated ? null : travelDistance(input.locations),
      workedSeconds: input.workdays.reduce((sum, workday) => sum + workedSeconds(workday, input.now), 0),
      averageAccuracyMeters: accuracyValues.length > 0
        ? Math.round((accuracyValues.reduce((sum, value) => sum + value, 0) / accuracyValues.length) * 10) / 10
        : null,
      lastRecordedAt: lastLocation?.recordedAt.toISOString() ?? null,
      truncated: input.locationsTruncated,
      daysWithoutPoints: workdayDates.filter((date) => !locationDays.has(date)),
    },
    drilldown: {
      missedStopIds,
      unplannedVisitIds: unplannedCompleted.map((visit) => visit.id),
    },
  }
}
