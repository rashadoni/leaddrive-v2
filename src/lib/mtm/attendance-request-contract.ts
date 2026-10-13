import { z } from "zod"
import { addDateKeyDays, isDateKey } from "@/lib/mtm/mobile-week"
import { AttendanceDayKindSchema } from "@/lib/mtm/attendance-day-kinds"

export const ATTENDANCE_REQUEST_KINDS = ["ANNUAL_LEAVE", "SICK_LEAVE", "TIME_OFF", "HOURLY_ABSENCE", "BUSINESS_TRIP", "REMOTE_WORK", "OVERTIME", "TIME_CORRECTION"] as const
const date = z.string().refine(isDateKey)
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
export const AttendanceRequestInputSchema = z.object({
  clientRequestId: z.string().uuid(),
  kind: z.enum(ATTENDANCE_REQUEST_KINDS),
  unit: z.enum(["DAYS", "HOURS"]),
  startDate: date,
  endDate: date,
  startTime: time.optional(),
  endTime: time.optional(),
  reason: z.string().trim().min(3).max(1000),
  attachmentIds: z.array(z.string().uuid()).max(3).default([]),
}).strict().superRefine((input, ctx) => {
  if (input.endDate < input.startDate || (isDateKey(input.startDate) && input.endDate > addDateKeyDays(input.startDate, 365))) {
    ctx.addIssue({ code: "custom", path: ["endDate"], message: "MTM_ATTENDANCE_REQUEST_DATE_RANGE" })
  }
  if (input.unit === "HOURS") {
    if (input.startDate !== input.endDate || !input.startTime || !input.endTime || input.endTime <= input.startTime) {
      ctx.addIssue({ code: "custom", path: ["endTime"], message: "MTM_ATTENDANCE_REQUEST_TIME_RANGE" })
    }
  } else if (input.startTime || input.endTime || input.kind === "HOURLY_ABSENCE" || input.kind === "OVERTIME" || input.kind === "TIME_CORRECTION") {
    ctx.addIssue({ code: "custom", path: ["unit"], message: "MTM_ATTENDANCE_REQUEST_HOURS_REQUIRED" })
  }
  if (new Set(input.attachmentIds).size !== input.attachmentIds.length) {
    ctx.addIssue({ code: "custom", path: ["attachmentIds"], message: "MTM_ATTENDANCE_REQUEST_ATTACHMENTS_INVALID" })
  }
})
export type AttendanceRequestInput = z.infer<typeof AttendanceRequestInputSchema>
export const AttendanceCorrectionBasisSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("MISSING"), workDate: date }).strict(),
  z.object({ kind: z.literal("WORKDAY"), facts: z.object({
    id: z.string().min(1), workDate: date, status: z.enum(["STARTED", "PAUSED", "COMPLETED"]),
    startedAt: z.string().datetime(), pausedAt: z.string().datetime().nullable(), completedAt: z.string().datetime().nullable(),
    totalPausedSeconds: z.number().int().nonnegative(),
  }).strict() }).strict(),
])
export type AttendanceCorrectionBasis = z.infer<typeof AttendanceCorrectionBasisSchema>
export const AttendanceRequestDetailsSchema = z.object({
  version: z.literal(1),
  kind: z.enum([...ATTENDANCE_REQUEST_KINDS, "HR_RECORD"]),
  unit: z.enum(["DAYS", "HOURS"]),
  startTime: time.nullable(), endTime: time.nullable(),
  timezone: z.string().min(1).max(100),
  dayKind: AttendanceDayKindSchema,
  attachmentIds: z.array(z.string().uuid()).max(3),
  submissionHash: z.string().regex(/^[a-f0-9]{64}$/),
  correctionBasis: AttendanceCorrectionBasisSchema.optional(),
  recording: z.object({ userId: z.string().min(1), operationId: z.string().uuid() }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  if ((value.kind === "HR_RECORD") !== (value.recording !== undefined)) {
    ctx.addIssue({ code: "custom", path: ["recording"], message: "MTM_ATTENDANCE_HR_RECORD_INVALID" })
  }
  if ((value.kind === "TIME_CORRECTION") !== (value.correctionBasis !== undefined)) {
    ctx.addIssue({ code: "custom", path: ["correctionBasis"], message: "MTM_ATTENDANCE_CORRECTION_BASIS_INVALID" })
  }
})
export type AttendanceRequestDetails = z.infer<typeof AttendanceRequestDetailsSchema>
export type AttendanceRequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED"
export type AttendanceRequestDto = {
  id: string; clientRequestId: string; agentId: string; status: AttendanceRequestStatus
  startDate: string; endDate: string; reason: string; submittedAt: string
  decisionNote: string | null; decidedAt: string | null; cancelledAt: string | null; version: string
  details: Omit<AttendanceRequestDetails, "submissionHash" | "recording">
}
export class AttendanceRequestError extends Error {
  constructor(public readonly code: string, public readonly status: number = 409) { super(code) }
}

type Window = { startDate: string; endDate: string; unit: "DAYS" | "HOURS"; startTime?: string | null; endTime?: string | null }
/** Half-open hourly windows let 09–10 and 10–11 coexist; whole days occupy the entire date. */
export function attendanceRequestWindowsOverlap(left: Window, right: Window): boolean {
  if (left.endDate < right.startDate || right.endDate < left.startDate) return false
  if (left.unit === "DAYS" || right.unit === "DAYS") return true
  return (left.startTime ?? "00:00") < (right.endTime ?? "24:00") && (right.startTime ?? "00:00") < (left.endTime ?? "24:00")
}
export function attendanceRequestMinutes(input: Pick<AttendanceRequestInput, "unit" | "startTime" | "endTime">): number {
  if (input.unit !== "HOURS" || !input.startTime || !input.endTime) return 0
  const minute = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3))
  return minute(input.endTime) - minute(input.startTime)
}
