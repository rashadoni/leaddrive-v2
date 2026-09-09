import { DecryptError, decryptToken, encryptToken } from "@/lib/secure-token"

const CURSOR_PURPOSE = "mtm-route-field-planning-target-page"
export const ROUTE_FIELD_PLANNING_TARGET_PAGE_TTL_MS = 15 * 60 * 1_000
export const ROUTE_FIELD_PLANNING_TARGET_PAGE_MAX_LENGTH = 2_048

export type RouteFieldPlanningTargetKind = "organization" | "contact"
export type RouteFieldPlanningTargetPagePhase = "organization" | "direct" | "customer"

export type RouteFieldPlanningTargetPageContext = {
  organizationId: string
  agentId: string
  date: string
  kind: RouteFieldPlanningTargetKind
  search: string
  objectType: string | null
  organizationKind: string | null
}

type RouteFieldPlanningTargetPageCursor = RouteFieldPlanningTargetPageContext & {
  v: 1
  phase: RouteFieldPlanningTargetPagePhase
  lastName: string | null
  lastId: string | null
  exp: number
}

export class RouteFieldPlanningTargetPageCursorError extends Error {
  constructor() {
    super("MTM_ROUTE_FIELD_PLANNING_TARGET_PAGE_INVALID")
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string"
}

function isPhaseForKind(phase: unknown, kind: unknown): phase is RouteFieldPlanningTargetPagePhase {
  return (kind === "organization" && phase === "organization")
    || (kind === "contact" && (phase === "direct" || phase === "customer"))
}

function isCursor(value: unknown): value is RouteFieldPlanningTargetPageCursor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const cursor = value as Record<string, unknown>
  const hasPosition = (cursor.lastName === null && cursor.lastId === null)
    || (typeof cursor.lastName === "string" && isNonEmptyString(cursor.lastId))
  return cursor.v === 1
    && isNonEmptyString(cursor.organizationId)
    && isNonEmptyString(cursor.agentId)
    && isNonEmptyString(cursor.date)
    && (cursor.kind === "organization" || cursor.kind === "contact")
    && isPhaseForKind(cursor.phase, cursor.kind)
    && typeof cursor.search === "string"
    && isNullableString(cursor.objectType)
    && isNullableString(cursor.organizationKind)
    && hasPosition
    && typeof cursor.exp === "number"
    && Number.isSafeInteger(cursor.exp)
}

/**
 * Stateless encrypted keyset cursor for bounded Route Field planner lookups.
 * It binds the position to the exact tenant, AGENT, route date and picker
 * filters. Contact phases stay disjoint: direct assignments are scanned before
 * customer assignments, so an ambiguous directly-assigned contact can never
 * fall through into a narrower workplace projection.
 */
export function issueRouteFieldPlanningTargetPage(
  context: RouteFieldPlanningTargetPageContext,
  continuation: {
    phase: RouteFieldPlanningTargetPagePhase
    last?: { name: string; id: string } | null
  },
  nowMs = Date.now(),
): string {
  if (!isPhaseForKind(continuation.phase, context.kind)) {
    throw new Error("MTM_ROUTE_FIELD_PLANNING_TARGET_CURSOR_PHASE_INVALID")
  }
  return encryptToken(JSON.stringify({
    v: 1,
    ...context,
    phase: continuation.phase,
    lastName: continuation.last?.name ?? null,
    lastId: continuation.last?.id ?? null,
    exp: nowMs + ROUTE_FIELD_PLANNING_TARGET_PAGE_TTL_MS,
  } satisfies RouteFieldPlanningTargetPageCursor), CURSOR_PURPOSE)
}

export function readRouteFieldPlanningTargetPage(
  token: string,
  expected: RouteFieldPlanningTargetPageContext,
  nowMs = Date.now(),
): RouteFieldPlanningTargetPageCursor {
  if (
    token.length === 0
    || token.length > ROUTE_FIELD_PLANNING_TARGET_PAGE_MAX_LENGTH
    || !token.startsWith("v1:")
  ) throw new RouteFieldPlanningTargetPageCursorError()

  let decoded: unknown
  try {
    decoded = JSON.parse(decryptToken(token, CURSOR_PURPOSE))
  } catch (error) {
    if (error instanceof DecryptError || error instanceof SyntaxError) {
      throw new RouteFieldPlanningTargetPageCursorError()
    }
    throw error
  }
  if (!isCursor(decoded)) throw new RouteFieldPlanningTargetPageCursorError()
  if (decoded.exp <= nowMs) throw new RouteFieldPlanningTargetPageCursorError()
  if (
    decoded.organizationId !== expected.organizationId
    || decoded.agentId !== expected.agentId
    || decoded.date !== expected.date
    || decoded.kind !== expected.kind
    || decoded.search !== expected.search
    || decoded.objectType !== expected.objectType
    || decoded.organizationKind !== expected.organizationKind
  ) throw new RouteFieldPlanningTargetPageCursorError()
  return decoded
}
