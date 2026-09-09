import { DecryptError, decryptToken, encryptToken } from "@/lib/secure-token"

const CURSOR_PURPOSE = "mtm-route-field-contact-page"
export const ROUTE_FIELD_CONTACT_PAGE_TTL_MS = 15 * 60 * 1_000
export const ROUTE_FIELD_CONTACT_PAGE_MAX_LENGTH = 2_048

export type RouteFieldContactPageContext = {
  organizationId: string
  agentId: string
  asOf: string
  search: string
}

type RouteFieldContactPageCursor = RouteFieldContactPageContext & {
  v: 1
  lastDisplayName: string
  lastId: string
  exp: number
}

export class RouteFieldContactPageCursorError extends Error {
  constructor() {
    super("MTM_ROUTE_FIELD_CONTACT_PAGE_INVALID")
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function isCursor(value: unknown): value is RouteFieldContactPageCursor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const cursor = value as Record<string, unknown>
  return cursor.v === 1
    && isNonEmptyString(cursor.organizationId)
    && isNonEmptyString(cursor.agentId)
    && isNonEmptyString(cursor.asOf)
    && typeof cursor.search === "string"
    && typeof cursor.lastDisplayName === "string"
    && isNonEmptyString(cursor.lastId)
    && typeof cursor.exp === "number"
    && Number.isSafeInteger(cursor.exp)
}

/**
 * Stateless encrypted page token for the short-lived Route Field catalog.
 * It exposes neither the sort key nor the tenant/agent/search binding and is
 * invalidated on the next field-work date.
 */
export function issueRouteFieldContactPage(
  context: RouteFieldContactPageContext,
  last: { displayName: string; id: string },
  nowMs = Date.now(),
): string {
  return encryptToken(JSON.stringify({
    v: 1,
    ...context,
    lastDisplayName: last.displayName,
    lastId: last.id,
    exp: nowMs + ROUTE_FIELD_CONTACT_PAGE_TTL_MS,
  } satisfies RouteFieldContactPageCursor), CURSOR_PURPOSE)
}

export function readRouteFieldContactPage(
  token: string,
  expected: RouteFieldContactPageContext,
  nowMs = Date.now(),
): RouteFieldContactPageCursor {
  if (
    token.length === 0
    || token.length > ROUTE_FIELD_CONTACT_PAGE_MAX_LENGTH
    || !token.startsWith("v1:")
  ) throw new RouteFieldContactPageCursorError()

  let decoded: unknown
  try {
    decoded = JSON.parse(decryptToken(token, CURSOR_PURPOSE))
  } catch (error) {
    if (error instanceof DecryptError || error instanceof SyntaxError) {
      throw new RouteFieldContactPageCursorError()
    }
    throw error
  }
  if (!isCursor(decoded)) throw new RouteFieldContactPageCursorError()
  if (decoded.exp <= nowMs) throw new RouteFieldContactPageCursorError()
  if (
    decoded.organizationId !== expected.organizationId
    || decoded.agentId !== expected.agentId
    || decoded.asOf !== expected.asOf
    || decoded.search !== expected.search
  ) throw new RouteFieldContactPageCursorError()
  return decoded
}
