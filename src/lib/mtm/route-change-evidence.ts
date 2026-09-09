/**
 * Immutable, privacy-minimal evidence attached to a route change request.
 * It lives in the existing request payload so historical rows and the public
 * API stay compatible; no route state is derived from this evidence.
 */
export const MTM_ROUTE_CHANGE_EVIDENCE_SCHEMA_VERSION = 1 as const

export type MtmRouteChangeEvidenceType = "REMOVE_STOP" | "ADD_STOP" | "CONFLICT_OVERRIDE"

export type MtmRouteChangeEvidenceRoute = {
  id: string
  version: number
  publishedVersion: number | null
  status: string
  date: string
  totalPoints: number
  agentId: string | null
}

export type MtmRouteChangeEvidencePoint = {
  id: string
  customerId: string
  contactId: string | null
  orderIndex: number
  status: string
  plannedTime: string | null
  deletedAt: string | null
}

export type MtmRouteChangeEvidence = {
  schemaVersion: typeof MTM_ROUTE_CHANGE_EVIDENCE_SCHEMA_VERSION
  capturedAt: string
  before: {
    route: MtmRouteChangeEvidenceRoute
    routePoint: MtmRouteChangeEvidencePoint | null
  }
  proposed: {
    changeType: MtmRouteChangeEvidenceType
    routePointId: string | null
    target: { customerId: string; contactId: string | null } | null
  }
  outcomes: MtmRouteChangeEvidenceOutcome[]
}

export type MtmRouteChangeEvidenceOutcome = {
  decision: "APPROVED" | "REJECTED" | "NEEDS_INFO" | "RESCHEDULE"
  status: string
  recordedAt: string
  after: {
    route: MtmRouteChangeEvidenceRoute
    routePoint: MtmRouteChangeEvidencePoint | null
  }
  rescheduled: { routeId: string; routePointId: string; date: string } | null
}

type RouteInput = {
  id: string
  version: number
  publishedVersion?: number | null
  status: string
  date: Date | string
  totalPoints: number
  agentId: string | null
}

type PointInput = {
  id: string
  customerId: string
  contactId?: string | null
  orderIndex?: number
  status: string
  plannedTime?: Date | string | null
  deletedAt?: Date | string | null
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function changeType(value: unknown): MtmRouteChangeEvidenceType | null {
  return value === "REMOVE_STOP" || value === "ADD_STOP" || value === "CONFLICT_OVERRIDE" ? value : null
}

function decision(value: unknown): MtmRouteChangeEvidenceOutcome["decision"] | null {
  return value === "APPROVED" || value === "REJECTED" || value === "NEEDS_INFO" || value === "RESCHEDULE" ? value : null
}

export function snapshotMtmRouteForChangeEvidence(route: RouteInput): MtmRouteChangeEvidenceRoute {
  return {
    id: route.id,
    version: route.version,
    publishedVersion: route.publishedVersion ?? null,
    status: route.status,
    date: iso(route.date) ?? "",
    totalPoints: route.totalPoints,
    agentId: route.agentId,
  }
}

export function snapshotMtmRoutePointForChangeEvidence(point: PointInput | null | undefined): MtmRouteChangeEvidencePoint | null {
  if (!point) return null
  return {
    id: point.id,
    customerId: point.customerId,
    contactId: point.contactId ?? null,
    orderIndex: point.orderIndex ?? -1,
    status: point.status,
    plannedTime: iso(point.plannedTime),
    deletedAt: iso(point.deletedAt),
  }
}

export function createMtmRouteChangeEvidence(input: {
  capturedAt?: Date
  changeType: MtmRouteChangeEvidenceType
  route: RouteInput
  routePoint?: PointInput | null
  target?: { customerId: string; contactId?: string | null } | null
}): MtmRouteChangeEvidence {
  return {
    schemaVersion: MTM_ROUTE_CHANGE_EVIDENCE_SCHEMA_VERSION,
    capturedAt: (input.capturedAt ?? new Date()).toISOString(),
    before: {
      route: snapshotMtmRouteForChangeEvidence(input.route),
      routePoint: snapshotMtmRoutePointForChangeEvidence(input.routePoint),
    },
    proposed: {
      changeType: input.changeType,
      routePointId: input.routePoint?.id ?? null,
      target: input.target
        ? { customerId: input.target.customerId, contactId: input.target.contactId ?? null }
        : null,
    },
    outcomes: [],
  }
}

/** Preserve legacy caller payload fields, replacing any client-supplied evidence. */
export function attachMtmRouteChangeEvidence(payload: unknown, evidence: MtmRouteChangeEvidence): Record<string, unknown> {
  return { ...record(payload), evidence }
}

/**
 * Old rows deliberately remain untouched. Consumers can distinguish them from
 * evidence-bearing rows instead of mistaking a decision-time read for the
 * state that existed when the request was submitted.
 */
export function readMtmRouteChangeEvidence(payload: unknown): {
  legacySnapshot: boolean
  evidence: MtmRouteChangeEvidence | null
} {
  const candidate = record(record(payload).evidence)
  const before = record(candidate.before)
  const proposed = record(candidate.proposed)
  if (
    candidate.schemaVersion !== MTM_ROUTE_CHANGE_EVIDENCE_SCHEMA_VERSION
    || typeof candidate.capturedAt !== "string"
    || !isRouteSnapshot(before.route)
    || !changeType(proposed.changeType)
    || !Array.isArray(candidate.outcomes)
    || !candidate.outcomes.every(isOutcome)
  ) {
    return { legacySnapshot: true, evidence: null }
  }
  return { legacySnapshot: false, evidence: candidate as unknown as MtmRouteChangeEvidence }
}

export function appendMtmRouteChangeEvidenceOutcome(input: {
  payload: unknown
  decision: MtmRouteChangeEvidenceOutcome["decision"]
  status: string
  recordedAt: Date
  route: RouteInput
  routePoint?: PointInput | null
  rescheduled?: MtmRouteChangeEvidenceOutcome["rescheduled"]
}): Record<string, unknown> | null {
  const current = readMtmRouteChangeEvidence(input.payload)
  if (!current.evidence) return null
  const outcome: MtmRouteChangeEvidenceOutcome = {
    decision: input.decision,
    status: input.status,
    recordedAt: input.recordedAt.toISOString(),
    after: {
      route: snapshotMtmRouteForChangeEvidence(input.route),
      routePoint: snapshotMtmRoutePointForChangeEvidence(input.routePoint),
    },
    rescheduled: input.rescheduled ?? null,
  }
  return {
    ...record(input.payload),
    evidence: {
      ...current.evidence,
      outcomes: [...current.evidence.outcomes, outcome],
    },
  }
}

function isRouteSnapshot(value: unknown): value is MtmRouteChangeEvidenceRoute {
  const candidate = record(value)
  return typeof candidate.id === "string"
    && typeof candidate.version === "number"
    && (typeof candidate.publishedVersion === "number" || candidate.publishedVersion === null)
    && typeof candidate.status === "string"
    && typeof candidate.date === "string"
    && typeof candidate.totalPoints === "number"
    && (typeof candidate.agentId === "string" || candidate.agentId === null)
}

function isPointSnapshot(value: unknown): value is MtmRouteChangeEvidencePoint | null {
  if (value === null) return true
  const candidate = record(value)
  return typeof candidate.id === "string"
    && typeof candidate.customerId === "string"
    && (typeof candidate.contactId === "string" || candidate.contactId === null)
    && typeof candidate.orderIndex === "number"
    && typeof candidate.status === "string"
    && (typeof candidate.plannedTime === "string" || candidate.plannedTime === null)
    && (typeof candidate.deletedAt === "string" || candidate.deletedAt === null)
}

function isOutcome(value: unknown): value is MtmRouteChangeEvidenceOutcome {
  const candidate = record(value)
  const after = record(candidate.after)
  const rescheduled = candidate.rescheduled
  return decision(candidate.decision) !== null
    && typeof candidate.status === "string"
    && typeof candidate.recordedAt === "string"
    && isRouteSnapshot(after.route)
    && isPointSnapshot(after.routePoint)
    && (
      rescheduled === null
      || (
        typeof record(rescheduled).routeId === "string"
        && typeof record(rescheduled).routePointId === "string"
        && typeof record(rescheduled).date === "string"
      )
    )
}
