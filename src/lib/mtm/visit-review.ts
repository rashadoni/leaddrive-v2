export {
  DEFAULT_VISIT_GEOFENCE_RADIUS_METERS,
  effectiveGeofenceRadius,
  formatMtmDistance,
  placeCheck,
  visitPlaceSummary,
  VISIT_PLACE_VERDICT_MESSAGE_KEYS,
  type MtmDistanceUnitLabel,
  type PlaceCheck,
  type PlaceCheckState,
  type VisitPlaceInput,
  type VisitPlaceSummary,
  type VisitPlaceVerdict,
} from "@/lib/mtm/visit-place-check"

/**
 * Pure rules behind the office review of a field visit (/mtm/visits).
 *
 * The page used to show every viewer the agent's execution workspace, so a
 * supervisor opening a finished visit saw forms to fill in and nothing that
 * had actually happened. These helpers decide what a reviewer sees; they hold
 * no React and no Prisma so the API, the page and other MTM screens share one
 * answer.
 *
 * Exported API
 *
 * Place check — the single source for "was the visit recorded at the
 * customer?" on the web. It lives in `visit-place-check.ts` and is re-exported
 * here unchanged; other screens should call it instead of measuring on their
 * own:
 *
 * - `effectiveGeofenceRadius(customerRadius, organizationRadius)` — the radius
 *   the check-in is judged by: customer override (F-22), else the organization
 *   setting, else 100 m.
 * - `placeCheck(fix, pin, radiusMeters)` — one fix against the pin:
 *   `at_point` | `outside` | `no_gps` | `no_pin`, with the rounded distance.
 *   Both pairs go through `hasMtmCoordinates`, so (0, 0), half pairs and
 *   out-of-range values are "unknown", never a position in the Gulf of Guinea.
 * - `visitPlaceSummary(visit, organizationRadius)` — check-in and check-out
 *   together. Check-out is measured only for a `CHECKED_OUT` visit
 *   (`checkOutSkipped` says why it was not: `visit_open` or `not_checked_out`).
 *   `verdict` is one value for a table cell, worst fact first: `no_pin`,
 *   `outside`, `no_gps` (no usable fix at all), `checkin_gps_missing` (only the
 *   check-out fix exists), `checkout_gps_missing` (finished visit without a
 *   check-out fix), `at_point`.
 *
 * Review — `reviewActionRows`, `isOwnVisitExecution`, `visitStatusKey`,
 * `visitDurationMinutes`, `visitApiErrorKey` / `VISIT_API_ERROR_MESSAGE_KEYS`.
 *
 * Live refresh — `selectActiveVisitId`, `isVisitGoneResponse`,
 * `visitStillOpenFromResponse`: the rules that keep a background refresh from
 * switching or unmounting the workspace an agent is typing in.
 */

/**
 * Steps the field app cannot perform yet. A policy may still list them, but a
 * reviewer seeing "Presentation: not done" on every visit would read a gap in
 * the agent's work where there is only a gap in the product.
 *
 * `NEXT_ACTION` joined them on 2026-09-20: the field app dropped it in the
 * September audit (`RouteScreen` filters it out by name), so the row could
 * only ever read "not done". The owner's verdict on seeing it in the office
 * card was blunter than that.
 */
export const FIELD_APP_UNSUPPORTED_ACTIONS: ReadonlySet<string> = new Set(["PRESENTATION", "STOCK_CHECK", "CHECKLIST", "NEXT_ACTION"])

export interface ReviewRequirement {
  actionKey: string
  mode: string
  minCount: number
}

export interface ReviewActionResult {
  actionKey: string
  status: string
}

export interface ReviewActionRow {
  actionKey: string
  required: boolean
  minCount: number
  count: number
  done: boolean
}

/**
 * Read-only status rows for the review panel.
 *
 * Counting follows the server completion rule (COMPLETED or WAIVED results,
 * photos counted by the photos themselves) with one reviewer-facing addition:
 * the field app writes the agent's note into the visit itself, so a written
 * note counts as the visit note instead of reading "0/1" beside the note.
 */
export function reviewActionRows(input: {
  requirements: readonly ReviewRequirement[]
  actionResults: readonly ReviewActionResult[]
  photoCount: number
  agentNote?: string | null
  resultNote?: string | null
}): ReviewActionRow[] {
  const counts = new Map<string, number>()
  for (const result of input.actionResults) {
    if (result.status === "COMPLETED" || result.status === "WAIVED") counts.set(result.actionKey, (counts.get(result.actionKey) ?? 0) + 1)
  }
  counts.set("PHOTO", Math.max(counts.get("PHOTO") ?? 0, input.photoCount))
  if ((input.agentNote?.trim() || input.resultNote?.trim()) && !counts.get("VISIT_NOTE")) counts.set("VISIT_NOTE", 1)

  return input.requirements
    .filter((requirement) => requirement.mode === "REQUIRED" || requirement.mode === "OPTIONAL")
    .map((requirement) => {
      const count = counts.get(requirement.actionKey) ?? 0
      const minCount = Math.max(1, requirement.minCount)
      return { actionKey: requirement.actionKey, required: requirement.mode === "REQUIRED", minCount, count, done: count >= minCount }
    })
    .filter((row) => !FIELD_APP_UNSUPPORTED_ACTIONS.has(row.actionKey) || row.count > 0)
    // An optional step with nothing behind it is not information. The demo
    // organization marks all five steps optional, so the card read as five
    // lines of "not done" under a visit where the agent had in fact shown a
    // presentation — while the field app, which lists required steps only,
    // had never offered those five. Optional stays visible once it carries a
    // result, because then it is evidence of work.
    .filter((row) => row.required || row.count > 0)
    .sort((left, right) => Number(right.required) - Number(left.required))
}

export interface VisitViewer {
  agentId: string | null
}

/**
 * The execution workspace (forms, photo upload, "complete visit") belongs to
 * the agent who is on the visit, and only while it is open. A manager,
 * supervisor or administrator — including one who is also an MTM agent —
 * reviews someone else's visit read-only: a photo uploaded from the office
 * would be recorded as the agent's evidence.
 */
export function isOwnVisitExecution(viewer: VisitViewer | null | undefined, visit: { agentId?: string | null; status: string } | null | undefined): boolean {
  return Boolean(
    viewer?.agentId
    && visit?.agentId
    && viewer.agentId === visit.agentId
    && visit.status === "CHECKED_IN",
  )
}

export type VisitStatusKey = "statusInProgress" | "statusCompleted" | "statusCancelled" | "statusUnknown"

export function visitStatusKey(status: string): VisitStatusKey {
  if (status === "CHECKED_IN") return "statusInProgress"
  if (status === "CHECKED_OUT") return "statusCompleted"
  if (status === "CANCELLED") return "statusCancelled"
  return "statusUnknown"
}

/** Whole minutes between check-in and check-out, preferring the stored duration. */
export function visitDurationMinutes(visit: { checkInAt: string | Date; checkOutAt?: string | Date | null; duration?: number | null }): number | null {
  if (typeof visit.duration === "number" && Number.isFinite(visit.duration)) return visit.duration
  if (!visit.checkOutAt) return null
  const minutes = Math.round((new Date(visit.checkOutAt).getTime() - new Date(visit.checkInAt).getTime()) / 60_000)
  return Number.isFinite(minutes) && minutes >= 0 ? minutes : null
}

/**
 * Localized message key (under mtmVisitWorkspace.errors) for a failed API
 * call. The `error` string of these endpoints is an English developer message
 * and must never reach a toast; unknown failures fall back to the caller's own
 * localized message.
 */
const ERROR_CODE_KEYS: Record<string, string> = {
  MTM_AGENT_ACCESS_REQUIRED: "accessRequired",
  MTM_AGENT_NOT_FOUND: "accessRequired",
  MTM_PHOTO_AGENT_OUT_OF_SCOPE: "accessRequired",
  MTM_VISIT_NOT_FOUND: "visitNotFound",
  MTM_VISIT_NOT_ACTIVE: "visitNotActive",
  MTM_VISIT_STATUS_INVALID: "visitNotActive",
  MTM_VISIT_REQUIREMENTS_INCOMPLETE: "requirementsIncomplete",
  MTM_VISIT_ACTION_HIDDEN: "actionHidden",
  MTM_VISIT_ACTION_WAIVER_FORBIDDEN: "actionHidden",
  MTM_VISIT_MUTATION_CONFLICT: "changedElsewhere",
  MTM_VISIT_ACTION_ID_CONFLICT: "changedElsewhere",
  MTM_PHOTO_ID_CONFLICT: "changedElsewhere",
  MAX_PHOTOS_REACHED: "photoLimit",
  MTM_MOBILE_MEDIA_PAYLOAD_TOO_LARGE: "photoTooLarge",
  MTM_TASK_VERSION_REQUIRED: "taskChanged",
  MTM_TASK_VERSION_CONFLICT: "taskChanged",
  MTM_TASK_STATUS_CONFLICT: "taskChanged",
  MTM_TASK_IMMUTABLE: "taskClosed",
  MTM_TASK_EXECUTION_DENIED: "taskNotYours",
  MTM_TASK_EDIT_DENIED: "taskEditDenied",
  MTM_TASK_SCOPE_DENIED: "taskNotYours",
  MTM_TASK_REVIEW_REQUIRED: "taskReviewRequired",
}

const STATUS_FALLBACK_KEYS: Record<number, string> = {
  401: "accessRequired",
  403: "accessRequired",
  404: "visitNotFound",
  413: "photoTooLarge",
  415: "photoType",
  429: "tooManyRequests",
  400: "invalidInput",
  422: "invalidInput",
}

/** Every message key visitApiErrorKey can return; each must exist in all locales. */
export const VISIT_API_ERROR_MESSAGE_KEYS: readonly string[] = [...new Set([...Object.values(ERROR_CODE_KEYS), ...Object.values(STATUS_FALLBACK_KEYS)])]

export function visitApiErrorKey(status: number, body: unknown): string | null {
  const code = body && typeof body === "object" && typeof (body as { code?: unknown }).code === "string"
    ? (body as { code: string }).code
    : null
  if (code && ERROR_CODE_KEYS[code]) return ERROR_CODE_KEYS[code]
  return STATUS_FALLBACK_KEYS[status] ?? null
}

/**
 * Which of the viewer's own open visits the execution workspace shows.
 *
 * The visit already on screen wins while it is still open: a background
 * refresh must never switch (and so remount, losing unsaved input) the
 * workspace. Only when it is gone does the focused visit, then the first open
 * one, take over.
 */
export function selectActiveVisitId(input: {
  ownOpenVisitIds: readonly string[]
  currentId: string | null
  focusedId: string | null
}): string | null {
  const open = new Set(input.ownOpenVisitIds)
  if (input.currentId && open.has(input.currentId)) return input.currentId
  if (input.focusedId && open.has(input.focusedId)) return input.focusedId
  return input.ownOpenVisitIds[0] ?? null
}

/** Only these answers mean "this visit is not there for you"; a 5xx or a network error means "try again later". */
export function isVisitGoneResponse(httpStatus: number): boolean {
  return httpStatus === 403 || httpStatus === 404
}

/**
 * Whether the visit behind the workspace is still open, from a GET
 * /api/v1/mtm/visits/:id answer. Unknown (transient failure) keeps it open:
 * the workspace closes only when the server says the visit ended or is gone.
 */
export function visitStillOpenFromResponse(httpStatus: number, body: unknown): boolean {
  if (isVisitGoneResponse(httpStatus)) return false
  const data = body && typeof body === "object" ? (body as { success?: unknown; data?: { status?: unknown } }) : null
  if (httpStatus < 200 || httpStatus >= 300 || data?.success !== true || typeof data.data?.status !== "string") return true
  return data.data.status === "CHECKED_IN"
}
