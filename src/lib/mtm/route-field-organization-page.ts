import { DecryptError, decryptToken, encryptToken } from "@/lib/secure-token"

const CURSOR_PURPOSE = "mtm-route-field-organization-page"
export const ROUTE_FIELD_ORGANIZATION_PAGE_TTL_MS = 15 * 60 * 1_000
export const ROUTE_FIELD_ORGANIZATION_PAGE_MAX_LENGTH = 2_048

export type RouteFieldOrganizationPageContext = {
  organizationId: string
  agentId: string
  asOf: string
  search: string
  objectType: string | null
  organizationKind: string | null
}

type RouteFieldOrganizationPageCursor = RouteFieldOrganizationPageContext & {
  v: 1
  lastName: string
  lastId: string
  exp: number
}

export class RouteFieldOrganizationPageCursorError extends Error {
  constructor() {
    super("MTM_ROUTE_FIELD_ORGANIZATION_PAGE_INVALID")
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string"
}

function isCursor(value: unknown): value is RouteFieldOrganizationPageCursor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const cursor = value as Record<string, unknown>
  return cursor.v === 1
    && isNonEmptyString(cursor.organizationId)
    && isNonEmptyString(cursor.agentId)
    && isNonEmptyString(cursor.asOf)
    && typeof cursor.search === "string"
    && isNullableString(cursor.objectType)
    && isNullableString(cursor.organizationKind)
    && typeof cursor.lastName === "string"
    && isNonEmptyString(cursor.lastId)
    && typeof cursor.exp === "number"
    && Number.isSafeInteger(cursor.exp)
}

/**
 * Stateless encrypted page token for the Route Field organization catalog.
 * The token binds its keyset position to the exact tenant, AGENT and fixed
 * filters so callers cannot replay a page under another route scope.
 */
export function issueRouteFieldOrganizationPage(
  context: RouteFieldOrganizationPageContext,
  last: { name: string; id: string },
  nowMs = Date.now(),
): string {
  return encryptToken(JSON.stringify({
    v: 1,
    ...context,
    lastName: last.name,
    lastId: last.id,
    exp: nowMs + ROUTE_FIELD_ORGANIZATION_PAGE_TTL_MS,
  } satisfies RouteFieldOrganizationPageCursor), CURSOR_PURPOSE)
}

export function readRouteFieldOrganizationPage(
  token: string,
  expected: RouteFieldOrganizationPageContext,
  nowMs = Date.now(),
): RouteFieldOrganizationPageCursor {
  if (
    token.length === 0
    || token.length > ROUTE_FIELD_ORGANIZATION_PAGE_MAX_LENGTH
    || !token.startsWith("v1:")
  ) throw new RouteFieldOrganizationPageCursorError()

  let decoded: unknown
  try {
    decoded = JSON.parse(decryptToken(token, CURSOR_PURPOSE))
  } catch (error) {
    if (error instanceof DecryptError || error instanceof SyntaxError) {
      throw new RouteFieldOrganizationPageCursorError()
    }
    throw error
  }
  if (!isCursor(decoded)) throw new RouteFieldOrganizationPageCursorError()
  if (decoded.exp <= nowMs) throw new RouteFieldOrganizationPageCursorError()
  if (
    decoded.organizationId !== expected.organizationId
    || decoded.agentId !== expected.agentId
    || decoded.asOf !== expected.asOf
    || decoded.search !== expected.search
    || decoded.objectType !== expected.objectType
    || decoded.organizationKind !== expected.organizationKind
  ) throw new RouteFieldOrganizationPageCursorError()
  return decoded
}
