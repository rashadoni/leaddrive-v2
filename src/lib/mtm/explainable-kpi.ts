export const MTM_KPI_FORMULA_VERSION = "SWM_PLAN_GPS_V1"

export type ExplainableKpiVisitType = "ALL" | "DOUBLE" | "INDEPENDENT"

export type ExplainableKpiFact = {
  visitId: string
  agentId: string
  agentName: string
  customerId: string
  customerName: string
  contactId: string | null
  routePointId: string | null
  date: string
  visitType: string
  brandIds: string[]
  completed: boolean
  gpsConfirmed: boolean
  gpsEvidenceState?: "CONFIRMED" | "MISSING_CHECK_IN" | "MISSING_CHECK_OUT" | "INVALID_CHECK_IN" | "INVALID_CHECK_OUT" | "MANUALLY_EXCLUDED"
  attributedAgentIds?: string[]
  attributedAgents?: Array<{ id: string; name: string }>
  sourceAgentId?: string | null
  sourceAgentName?: string | null
  adjustable?: boolean
}

export type ExplainableKpiPlanPoint = {
  routePointId: string
  routeId?: string
  agentId: string
  agentName: string
  customerId: string
  customerName: string
  contactId: string | null
  date: string
  visitType: string
  brandIds: string[]
  completed: boolean
  attributedAgentIds?: string[]
  attributedAgents?: Array<{ id: string; name: string }>
  sourceAgentId?: string | null
  sourceAgentName?: string | null
  adjustable?: boolean
}

export type ExplainableKpiAdjustment = {
  factType: "PLAN_POINT" | "GPS_VISIT"
  factId: string
  action: "EXCLUDE" | "RESTORE"
  reason: string
  createdAt: string
  actorAgentId: string | null
  auditId?: string
}

export type ExplainableKpiTrendGranularity = "DAY" | "WEEK" | "MONTH" | "QUARTER"

export type ExplainableKpiTrendPoint = {
  date: string
  planned: number
  completed: number
  visits: number
  gps: number
  planPercentage: number
  gpsPercentage: number
}

export function isValidKpiCoordinatePair(latitude: number | null | undefined, longitude: number | null | undefined): boolean {
  return typeof latitude === "number" && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
    typeof longitude === "number" && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180 &&
    (latitude !== 0 || longitude !== 0)
}

function ratio(numerator: number, denominator: number) {
  return {
    numerator,
    denominator,
    percentage: denominator > 0 ? Math.round((numerator / denominator) * 1_000) / 10 : 0,
  }
}

function trendBucketDate(date: string, granularity: ExplainableKpiTrendGranularity): string {
  if (granularity === "DAY") return date
  const value = new Date(`${date}T00:00:00.000Z`)
  if (granularity === "WEEK") {
    const day = value.getUTCDay()
    value.setUTCDate(value.getUTCDate() - (day === 0 ? 6 : day - 1))
  } else if (granularity === "MONTH") {
    value.setUTCDate(1)
  } else {
    value.setUTCMonth(Math.floor(value.getUTCMonth() / 3) * 3, 1)
  }
  return value.toISOString().slice(0, 10)
}

export function aggregateExplainableKpiTrend(
  points: ExplainableKpiTrendPoint[],
  granularity: ExplainableKpiTrendGranularity,
): ExplainableKpiTrendPoint[] {
  if (granularity === "DAY") return points
  const buckets = new Map<string, Omit<ExplainableKpiTrendPoint, "date" | "planPercentage" | "gpsPercentage">>()
  for (const point of points) {
    const date = trendBucketDate(point.date, granularity)
    const bucket = buckets.get(date) ?? { planned: 0, completed: 0, visits: 0, gps: 0 }
    bucket.planned += point.planned
    bucket.completed += point.completed
    bucket.visits += point.visits
    bucket.gps += point.gps
    buckets.set(date, bucket)
  }
  return [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, bucket]) => ({
      date,
      ...bucket,
      planPercentage: ratio(bucket.completed, bucket.planned).percentage,
      gpsPercentage: ratio(bucket.gps, bucket.visits).percentage,
    }))
}

function matchesVisitType(value: string, filter: ExplainableKpiVisitType): boolean {
  if (filter === "ALL") return true
  return value.toUpperCase() === filter
}

function matchesBrand(brandIds: string[], brandId: string | null): boolean {
  return !brandId || brandIds.includes(brandId)
}

export function buildExplainableKpi(input: {
  planPoints: ExplainableKpiPlanPoint[]
  visits: ExplainableKpiFact[]
  visitType: ExplainableKpiVisitType
  brandId: string | null
  generatedAt: Date
  adjustments?: ExplainableKpiAdjustment[]
  sourceUpdatedAt?: Date | null
  sourceFreshness?: "CURRENT" | "LATE" | "HISTORICAL" | "NO_SOURCE"
  completeness?: "COMPLETE" | "PARTIAL"
  workdays?: Array<{ id: string; agentId: string; date: string; state: string }>
  /** Routes-only tenants must not receive an implied attendance state. */
  includeWorkforce?: boolean
}) {
  const latestAdjustments = new Map<string, ExplainableKpiAdjustment>()
  const adjustmentHistory = [...(input.adjustments ?? [])].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt) || (a.auditId ?? "").localeCompare(b.auditId ?? ""))
  for (const adjustment of adjustmentHistory) {
    latestAdjustments.set(`${adjustment.factType}:${adjustment.factId}`, adjustment)
  }
  const excludedPlanIds = new Set([...latestAdjustments.values()]
    .filter((item) => item.factType === "PLAN_POINT" && item.action === "EXCLUDE")
    .map((item) => item.factId))
  // GPS_VISIT means "exclude this visit's GPS evidence from the numerator".
  // The completed visit deliberately remains in the denominator, so invalid
  // evidence can never improve the percentage by making the whole fact vanish.
  const excludedGpsEvidenceIds = new Set([...latestAdjustments.values()]
    .filter((item) => item.factType === "GPS_VISIT" && item.action === "EXCLUDE")
    .map((item) => item.factId))
  const matchingPlanPoints = input.planPoints.filter((item) =>
    matchesVisitType(item.visitType, input.visitType) && matchesBrand(item.brandIds, input.brandId),
  )
  const matchingVisits = input.visits.filter((item) =>
    matchesVisitType(item.visitType, input.visitType) && matchesBrand(item.brandIds, input.brandId),
  )
  const matchingFactKeys = new Set([
    ...matchingPlanPoints.map((item) => `PLAN_POINT:${item.routePointId}`),
    ...matchingVisits.map((item) => `GPS_VISIT:${item.visitId}`),
  ])
  const matchingAdjustmentHistory = adjustmentHistory.filter((item) =>
    matchingFactKeys.has(`${item.factType}:${item.factId}`),
  )
  const planPoints = matchingPlanPoints.filter((item) => !excludedPlanIds.has(item.routePointId))
  const visits = matchingVisits.map((item) => excludedGpsEvidenceIds.has(item.visitId)
    ? { ...item, gpsConfirmed: false, gpsEvidenceState: "MANUALLY_EXCLUDED" as const }
    : item)
  const completedPlan = planPoints.filter((item) => item.completed)
  const completedVisits = visits.filter((item) => item.completed)
  const gpsVisits = completedVisits.filter((item) => item.gpsConfirmed)
  const days = new Map<string, { planned: number; completed: number; visits: number; gps: number }>()
  const gpsDays = new Map<string, {
    agentId: string
    agentName: string
    date: string
    completedVisits: number
    gpsConfirmedVisits: number
    visitIds: string[]
    gpsEvidenceStates: Record<string, number>
    sourceAgents: Record<string, string>
  }>()
  const workdays = new Map((input.workdays ?? []).map((workday) => [`${workday.agentId}:${workday.date}`, workday]))

  for (const point of planPoints) {
    const row = days.get(point.date) ?? { planned: 0, completed: 0, visits: 0, gps: 0 }
    row.planned += 1
    if (point.completed) row.completed += 1
    days.set(point.date, row)
  }
  for (const visit of completedVisits) {
    const row = days.get(visit.date) ?? { planned: 0, completed: 0, visits: 0, gps: 0 }
    row.visits += 1
    if (visit.gpsConfirmed) row.gps += 1
    days.set(visit.date, row)
    const key = `${visit.agentId}:${visit.date}`
    const gpsDay = gpsDays.get(key) ?? {
      agentId: visit.agentId,
      agentName: visit.agentName,
      date: visit.date,
      completedVisits: 0,
      gpsConfirmedVisits: 0,
      visitIds: [],
      gpsEvidenceStates: {},
      sourceAgents: {},
    }
    gpsDay.completedVisits += 1
    if (visit.gpsConfirmed) gpsDay.gpsConfirmedVisits += 1
    gpsDay.visitIds.push(visit.visitId)
    if (visit.sourceAgentId && visit.sourceAgentName) {
      gpsDay.sourceAgents[visit.sourceAgentId] = visit.sourceAgentName
    }
    const evidenceState = visit.gpsEvidenceState ?? (visit.gpsConfirmed ? "CONFIRMED" : "MISSING_CHECK_IN")
    gpsDay.gpsEvidenceStates[evidenceState] = (gpsDay.gpsEvidenceStates[evidenceState] ?? 0) + 1
    gpsDays.set(key, gpsDay)
  }

  return {
    formula: {
      version: MTM_KPI_FORMULA_VERSION,
      generatedAt: input.generatedAt.toISOString(),
      sourceUpdatedAt: input.sourceUpdatedAt?.toISOString() ?? null,
      sourceFreshness: input.sourceFreshness ?? "NO_SOURCE",
      sourceFreshnessThresholdMinutes: 15,
      completeness: input.completeness ?? "COMPLETE",
      calculationState: "READY" as const,
      authoritative: (input.completeness ?? "COMPLETE") === "COMPLETE",
      planDefinition: "visited route points / non-draft, non-cancelled route points",
      gpsDefinition: "completed visits with check-in and check-out coordinates / completed visits",
      exclusions: ["draft routes", "cancelled routes", "cancelled visits", "soft-deleted records"],
      adjustments: matchingAdjustmentHistory,
    },
    plan: ratio(completedPlan.length, planPoints.length),
    gps: ratio(gpsVisits.length, completedVisits.length),
    totals: {
      planned: planPoints.length,
      completedPlan: completedPlan.length,
      completedVisits: completedVisits.length,
      gpsConfirmedVisits: gpsVisits.length,
    },
    trend: [...days.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, row]) => ({
      date,
      ...row,
      planPercentage: ratio(row.completed, row.planned).percentage,
      gpsPercentage: ratio(row.gps, row.visits).percentage,
    })),
    drilldown: {
      planNumerator: completedPlan,
      planDenominator: planPoints,
      gpsNumerator: gpsVisits,
      gpsDenominator: completedVisits,
      gpsDays: [...gpsDays.values()].map((day) => {
        const workday = workdays.get(`${day.agentId}:${day.date}`)
        return {
          ...day,
          sourceAgents: Object.entries(day.sourceAgents).map(([id, name]) => ({ id, name })),
          ...(input.includeWorkforce !== false ? {
            workdayId: workday?.id ?? null,
            workdayState: workday?.state ?? "NOT_RECORDED",
          } : {}),
          evidenceSource: "VISIT_COORDINATES" as const,
        }
      }).sort((left, right) => left.date.localeCompare(right.date) || left.agentName.localeCompare(right.agentName)),
      exclusions: {
        planPoints: matchingPlanPoints.filter((item) => excludedPlanIds.has(item.routePointId)),
        visits: matchingVisits.filter((item) => excludedGpsEvidenceIds.has(item.visitId)),
      },
    },
  }
}
