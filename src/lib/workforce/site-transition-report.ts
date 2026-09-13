const MAX_TRANSITION_CLAIMS = 5_000
const IDENTIFIER = /^[A-Za-z0-9_-]{1,191}$/
const KINDS = new Set(["ARRIVAL", "DEPARTURE"])
const REVIEW_STATES = new Set(["LEGACY_UNKNOWN", "NOT_REQUIRED", "PENDING_REVIEW"])

export type WorkforceSiteTransitionReportRow = {
  agentId: string
  workdayId: string
  segmentId: string
  siteId: string
  kind: "ARRIVAL" | "DEPARTURE"
  claimedAt: Date
  attendanceReviewState: "LEGACY_UNKNOWN" | "NOT_REQUIRED" | "PENDING_REVIEW"
}

type TransitionCounts = {
  claims: number
  arrivals: number
  departures: number
  completedSegments: number
  incompleteSegments: number
  pendingReviewClaims: number
  legacyUnknownClaims: number
}

export type WorkforceSiteTransitionReport = {
  source: "APPEND_ONLY_SITE_TRANSITION_CLAIMS"
  summary: TransitionCounts & { employees: number; sites: number }
  bySite: Array<TransitionCounts & { siteId: string }>
  byEmployee: Array<TransitionCounts & { agentId: string }>
  boundaries: {
    physicalPresence: "CLAIMS_ARE_NOT_PHYSICAL_PRESENCE"
    rawLocation: "EXCLUDED_FROM_TRANSITION_REPORT"
    proofDetails: "EXCLUDED_FROM_TRANSITION_REPORT"
    payroll: "NOT_A_PAYROLL_INPUT"
  }
}

export class WorkforceSiteTransitionReportError extends Error {
  readonly code = "WORKFORCE_SITE_TRANSITION_REPORT_INPUT_INVALID"
}

type SegmentPair = {
  agentId: string
  siteId: string
  arrival: boolean
  departure: boolean
}

function emptyCounts(): TransitionCounts {
  return {
    claims: 0,
    arrivals: 0,
    departures: 0,
    completedSegments: 0,
    incompleteSegments: 0,
    pendingReviewClaims: 0,
    legacyUnknownClaims: 0,
  }
}

function increment(current: number): number {
  const next = current + 1
  if (!Number.isSafeInteger(next)) throw new WorkforceSiteTransitionReportError()
  return next
}

function validateRow(row: WorkforceSiteTransitionReportRow): void {
  if (
    !IDENTIFIER.test(row.agentId)
    || !IDENTIFIER.test(row.workdayId)
    || !IDENTIFIER.test(row.segmentId)
    || !IDENTIFIER.test(row.siteId)
    || !KINDS.has(row.kind)
    || !REVIEW_STATES.has(row.attendanceReviewState)
    || !(row.claimedAt instanceof Date)
    || !Number.isFinite(row.claimedAt.getTime())
  ) {
    throw new WorkforceSiteTransitionReportError()
  }
}

function appendClaim(counts: TransitionCounts, row: WorkforceSiteTransitionReportRow): void {
  counts.claims = increment(counts.claims)
  if (row.kind === "ARRIVAL") counts.arrivals = increment(counts.arrivals)
  else counts.departures = increment(counts.departures)
  if (row.attendanceReviewState === "PENDING_REVIEW") {
    counts.pendingReviewClaims = increment(counts.pendingReviewClaims)
  }
  if (row.attendanceReviewState === "LEGACY_UNKNOWN") {
    counts.legacyUnknownClaims = increment(counts.legacyUnknownClaims)
  }
}

function appendPair(counts: TransitionCounts, pair: SegmentPair): void {
  if (pair.arrival && pair.departure) counts.completedSegments = increment(counts.completedSegments)
  else counts.incompleteSegments = increment(counts.incompleteSegments)
}

/**
 * Aggregates append-only scheduled site-transition claims without reading or
 * exposing coordinates, QR/device proof, employee text or evidence verdicts.
 * A complete arrival/departure pair is workflow completeness, never a claim
 * that the employee was physically present at the site.
 */
export function buildWorkforceSiteTransitionReport(
  rows: readonly WorkforceSiteTransitionReportRow[],
): WorkforceSiteTransitionReport {
  if (!Array.isArray(rows) || rows.length > MAX_TRANSITION_CLAIMS) {
    throw new WorkforceSiteTransitionReportError()
  }

  const employees = new Set<string>()
  const sites = new Set<string>()
  const pairs = new Map<string, SegmentPair>()
  const summary = emptyCounts()
  const bySite = new Map<string, TransitionCounts>()
  const byEmployee = new Map<string, TransitionCounts>()

  for (const row of rows) {
    validateRow(row)
    employees.add(row.agentId)
    sites.add(row.siteId)
    appendClaim(summary, row)
    const site = bySite.get(row.siteId) ?? emptyCounts()
    appendClaim(site, row)
    bySite.set(row.siteId, site)
    const employee = byEmployee.get(row.agentId) ?? emptyCounts()
    appendClaim(employee, row)
    byEmployee.set(row.agentId, employee)

    const pairKey = `${row.agentId}\u0000${row.workdayId}\u0000${row.segmentId}\u0000${row.siteId}`
    const pair = pairs.get(pairKey) ?? {
      agentId: row.agentId,
      siteId: row.siteId,
      arrival: false,
      departure: false,
    }
    if ((row.kind === "ARRIVAL" && pair.arrival) || (row.kind === "DEPARTURE" && pair.departure)) {
      throw new WorkforceSiteTransitionReportError()
    }
    if (row.kind === "ARRIVAL") pair.arrival = true
    else pair.departure = true
    pairs.set(pairKey, pair)
  }

  for (const pair of pairs.values()) {
    appendPair(summary, pair)
    appendPair(bySite.get(pair.siteId)!, pair)
    appendPair(byEmployee.get(pair.agentId)!, pair)
  }

  return {
    source: "APPEND_ONLY_SITE_TRANSITION_CLAIMS",
    summary: { employees: employees.size, sites: sites.size, ...summary },
    bySite: [...bySite.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([siteId, counts]) => ({ siteId, ...counts })),
    byEmployee: [...byEmployee.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([agentId, counts]) => ({ agentId, ...counts })),
    boundaries: {
      physicalPresence: "CLAIMS_ARE_NOT_PHYSICAL_PRESENCE",
      rawLocation: "EXCLUDED_FROM_TRANSITION_REPORT",
      proofDetails: "EXCLUDED_FROM_TRANSITION_REPORT",
      payroll: "NOT_A_PAYROLL_INPUT",
    },
  }
}
