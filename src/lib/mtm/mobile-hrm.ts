import { addDateKeyDays, isDateKey } from "@/lib/mtm/mobile-week"

export type MobileHrmRequestType = "LEAVE" | "ABSENCE" | "TIME_CORRECTION"

export type MobileHrmRequestCreateInput = {
  id: string
  clientRequestId: string
  type: MobileHrmRequestType
  startDate: Date
  endDate: Date
  startDateKey: string
  endDateKey: string
  correctionWorkdayId: string | null
  requestedStartAt: Date | null
  requestedEndAt: Date | null
  reason: string
  submittedAt: Date
}

export type MobileHrmRequestCancelInput = {
  id: string
  cancelledAt: Date
}

const HRM_TYPES = new Set<MobileHrmRequestType>(["LEAVE", "ABSENCE", "TIME_CORRECTION"])
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000

function validId(value: unknown, minimum = 1): value is string {
  return typeof value === "string" && value.trim().length >= minimum && value.length <= 128
}

function parseTimestamp(value: unknown, now: Date, allowFuture = false): Date | null {
  const parsed = typeof value === "string" || typeof value === "number"
    ? new Date(value)
    : new Date(Number.NaN)
  if (Number.isNaN(parsed.getTime())) return null
  if (!allowFuture && parsed.getTime() > now.getTime() + MAX_CLOCK_SKEW_MS) return null
  return parsed
}

export function parseMobileHrmRequestCreate(
  data: unknown,
  now = new Date(),
): { input: MobileHrmRequestCreateInput | null; error: string | null } {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { input: null, error: "HRM request data must be an object" }
  }
  const value = data as Record<string, unknown>
  if (!validId(value.id)) return { input: null, error: "id is required" }
  if (!validId(value.clientRequestId, 8)) {
    return { input: null, error: "clientRequestId must be 8..128 characters" }
  }
  if (typeof value.type !== "string" || !HRM_TYPES.has(value.type as MobileHrmRequestType)) {
    return { input: null, error: "Invalid HRM request type" }
  }
  if (!isDateKey(value.startDate) || !isDateKey(value.endDate)) {
    return { input: null, error: "startDate and endDate must use YYYY-MM-DD" }
  }
  if (value.endDate < value.startDate || value.endDate > addDateKeyDays(value.startDate, 366)) {
    return { input: null, error: "HRM request date range must be 366 days or fewer" }
  }
  const reason = typeof value.reason === "string" ? value.reason.trim() : ""
  if (reason.length < 3 || reason.length > 1000) {
    return { input: null, error: "Reason must be 3..1000 characters" }
  }
  const submittedAt = parseTimestamp(value.submittedAt, now)
  if (!submittedAt) {
    return { input: null, error: "Valid submittedAt is required and cannot be in the future" }
  }

  const type = value.type as MobileHrmRequestType
  let correctionWorkdayId: string | null = null
  let requestedStartAt: Date | null = null
  let requestedEndAt: Date | null = null
  if (type === "TIME_CORRECTION") {
    if (!validId(value.correctionWorkdayId)) {
      return { input: null, error: "correctionWorkdayId is required for time correction" }
    }
    correctionWorkdayId = value.correctionWorkdayId.trim()
    requestedStartAt = value.requestedStartAt == null
      ? null
      : parseTimestamp(value.requestedStartAt, now, true)
    requestedEndAt = value.requestedEndAt == null
      ? null
      : parseTimestamp(value.requestedEndAt, now, true)
    if (!requestedStartAt && !requestedEndAt) {
      return { input: null, error: "Requested start or end time is required for time correction" }
    }
    if (value.requestedStartAt != null && !requestedStartAt) {
      return { input: null, error: "requestedStartAt is invalid" }
    }
    if (value.requestedEndAt != null && !requestedEndAt) {
      return { input: null, error: "requestedEndAt is invalid" }
    }
    if (requestedStartAt && requestedEndAt && requestedEndAt <= requestedStartAt) {
      return { input: null, error: "Requested end time must be after start time" }
    }
  }

  return {
    input: {
      id: value.id.trim(),
      clientRequestId: value.clientRequestId.trim(),
      type,
      startDate: new Date(`${value.startDate}T00:00:00.000Z`),
      endDate: new Date(`${value.endDate}T00:00:00.000Z`),
      startDateKey: value.startDate,
      endDateKey: value.endDate,
      correctionWorkdayId,
      requestedStartAt,
      requestedEndAt,
      reason,
      submittedAt,
    },
    error: null,
  }
}

export function parseMobileHrmRequestCancel(
  data: unknown,
  now = new Date(),
): { input: MobileHrmRequestCancelInput | null; error: string | null } {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { input: null, error: "HRM cancellation data must be an object" }
  }
  const value = data as Record<string, unknown>
  if (!validId(value.id)) return { input: null, error: "id is required" }
  const cancelledAt = parseTimestamp(value.cancelledAt, now)
  if (!cancelledAt) {
    return { input: null, error: "Valid cancelledAt is required and cannot be in the future" }
  }
  return { input: { id: value.id.trim(), cancelledAt }, error: null }
}
