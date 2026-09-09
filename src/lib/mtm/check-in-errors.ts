import { NextResponse } from "next/server"

/**
 * Check-in error contract (field UX audit 2026-09-05, task A6).
 *
 * One vocabulary for both ways a visit is opened: the interactive
 * `POST /api/v1/mtm/visits` and the offline `visits.create` operation of
 * `POST /api/v1/mtm/mobile/sync/push`. The interactive route answers with an
 * HTTP status and `{ error, code, ...details }`; the offline route answers per
 * operation with `status: "conflict"` and `serverData: { code, ...details }`.
 * Clients branch on `code` only and localize the text themselves — the
 * `error` string is an English developer message, never UI copy.
 *
 * The identifiers keep the `MTM_*` names the installed field app already maps
 * in its sync center; the audit plan's short names are the aliases below.
 */
export const MTM_CHECK_IN_ERROR = {
  /** Plan alias CUSTOMER_MISSING: the customer is not visible to this agent. */
  CUSTOMER_MISSING: "MTM_VISIT_CUSTOMER_NOT_FOUND",
  /** Plan alias NO_COORDINATES: the customer has no stored coordinates; a check-in is refused for everyone (owner decision 2). */
  NO_COORDINATES: "MTM_VISIT_CUSTOMER_NO_COORDINATES",
  /** Plan alias ACTIVE_VISIT: the agent already has an open visit. */
  ACTIVE_VISIT: "MTM_VISIT_ALREADY_ACTIVE",
  /** Plan alias TOO_FAR: the agent is outside the customer geofence; details carry distanceMeters and geofenceRadius. */
  TOO_FAR: "MTM_VISIT_OUT_OF_ZONE",
  /** Plan alias ROUTE_MISMATCH: the route point is not pending on an active route the agent executes. */
  ROUTE_POINT_NOT_AVAILABLE: "MTM_ROUTE_POINT_NOT_AVAILABLE",
  /** Plan alias ROUTE_MISMATCH: the route point already has an open visit. */
  ROUTE_POINT_ALREADY_ACTIVE: "MTM_ROUTE_POINT_ALREADY_ACTIVE",
  /** Plan alias ROUTE_MISMATCH: the visit target differs from the route point target. */
  ROUTE_TARGET_MISMATCH: "MTM_ROUTE_TARGET_MISMATCH",
  /** Plan alias ROUTE_MISMATCH: the customer/contact pair is not a valid route target on the check-in date. */
  ROUTE_TARGET_INVALID: "MTM_ROUTE_TARGET_INVALID",
  /** The contact is not active at this customer. */
  CONTACT_MISSING: "MTM_VISIT_CONTACT_NOT_FOUND",
  /** `force` was requested by a role that may not override the geofence. */
  FORCE_FORBIDDEN: "MTM_VISIT_FORCE_FORBIDDEN",
} as const

export type MtmCheckInErrorCode = (typeof MTM_CHECK_IN_ERROR)[keyof typeof MTM_CHECK_IN_ERROR]

export const MTM_CHECK_IN_ERROR_CODES: readonly MtmCheckInErrorCode[] = Object.values(MTM_CHECK_IN_ERROR)

/** Developer-facing message per code. Kept stable: clients must not parse it. */
export const MTM_CHECK_IN_ERROR_MESSAGE: Record<MtmCheckInErrorCode, string> = {
  MTM_VISIT_CUSTOMER_NOT_FOUND: "Customer not found",
  MTM_VISIT_CUSTOMER_NO_COORDINATES: "Customer has no coordinates; ask a manager to set them before checking in",
  MTM_VISIT_ALREADY_ACTIVE: "Another visit is already in progress",
  MTM_VISIT_OUT_OF_ZONE: "Agent is outside the customer geofence",
  MTM_ROUTE_POINT_NOT_AVAILABLE: "Route point is not available to this agent",
  MTM_ROUTE_POINT_ALREADY_ACTIVE: "Route point already has an active visit",
  MTM_ROUTE_TARGET_MISMATCH: "Visit target does not match the route point",
  MTM_ROUTE_TARGET_INVALID: "Visit target is not valid on the check-in date",
  MTM_VISIT_CONTACT_NOT_FOUND: "Contact is not active at this customer",
  MTM_VISIT_FORCE_FORBIDDEN: "Force check-in requires SUPERVISOR/MANAGER/ADMIN role",
}

/** HTTP status of the interactive route. The offline route always answers 200 with a per-operation conflict. */
export const MTM_CHECK_IN_ERROR_STATUS: Record<MtmCheckInErrorCode, 400 | 403 | 404 | 409 | 422> = {
  MTM_VISIT_CUSTOMER_NOT_FOUND: 404,
  MTM_VISIT_CUSTOMER_NO_COORDINATES: 422,
  MTM_VISIT_ALREADY_ACTIVE: 409,
  MTM_VISIT_OUT_OF_ZONE: 400,
  MTM_ROUTE_POINT_NOT_AVAILABLE: 409,
  MTM_ROUTE_POINT_ALREADY_ACTIVE: 409,
  MTM_ROUTE_TARGET_MISMATCH: 409,
  MTM_ROUTE_TARGET_INVALID: 400,
  MTM_VISIT_CONTACT_NOT_FOUND: 404,
  MTM_VISIT_FORCE_FORBIDDEN: 403,
}

export type MtmCheckInErrorDetails = Record<string, unknown>

export function checkInErrorBody(code: MtmCheckInErrorCode, details: MtmCheckInErrorDetails = {}) {
  return { error: MTM_CHECK_IN_ERROR_MESSAGE[code], code, ...details }
}

/** Interactive route: `{ error, code, ...details }` with the contract's HTTP status. */
export function checkInErrorResponse(code: MtmCheckInErrorCode, details: MtmCheckInErrorDetails = {}) {
  return NextResponse.json(checkInErrorBody(code, details), { status: MTM_CHECK_IN_ERROR_STATUS[code] })
}

/** Offline route: the `error` string and `serverData` of a per-operation conflict. */
export function checkInConflict(code: MtmCheckInErrorCode, details: MtmCheckInErrorDetails = {}) {
  return { errorMsg: MTM_CHECK_IN_ERROR_MESSAGE[code], serverData: { code, ...details } }
}

/** Maps a `throw new Error(code)` from inside the check-in transaction back to the contract; unknown messages return null. */
export function checkInErrorFromThrown(error: unknown): MtmCheckInErrorCode | null {
  if (!(error instanceof Error)) return null
  return (MTM_CHECK_IN_ERROR_CODES as readonly string[]).includes(error.message)
    ? (error.message as MtmCheckInErrorCode)
    : null
}
