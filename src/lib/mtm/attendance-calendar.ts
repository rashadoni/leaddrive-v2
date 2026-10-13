import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { currentDateKey, isDateKey } from "@/lib/mtm/mobile-week"
import { attendanceRuleForDate, MTM_ATTENDANCE_BASELINE_RULE } from "@/lib/mtm/attendance-rules"
import { readAttendanceRules } from "@/lib/mtm/attendance-rule-store"
import { lockWorkforceCalendarConfigurationDates } from "@/lib/workforce/calendar-configuration"

export const AttendanceCalendarInputSchema = z.object({
  date: z.string().refine(isDateKey),
  kind: z.enum(["PUBLIC_HOLIDAY", "COMPANY_HOLIDAY", "EXCEPTION_WORKDAY"]),
  name: z.string().trim().min(1).max(160),
  id: z.string().min(1).max(191).optional(),
  version: z.string().datetime().optional(),
}).strict().refine((input) => Boolean(input.id) === Boolean(input.version))
export const AttendanceCalendarDeleteSchema = z.object({
  id: z.string().min(1).max(191), version: z.string().datetime(),
}).strict()
export class AttendanceCalendarError extends Error {
  constructor(public readonly code: string, public readonly status: number) { super(code) }
}

/** The latest civil today prevents a timezone change from reopening yesterday. */
export async function attendanceCalendarToday(organizationId: string, timezone: string, now = new Date()) {
  const rules = await readAttendanceRules(organizationId)
  return [timezone, MTM_ATTENDANCE_BASELINE_RULE.timezone, ...rules.map((rule) => rule.timezone)]
    .map((zone) => currentDateKey(now, zone)).sort().at(-1)!
}

const calendarSelect = {
  id: true, date: true, kind: true, name: true, updatedAt: true, movedToDate: true,
} as const
const serialize = (row: { id: string; date: Date; kind: string; name: string | null; updatedAt: Date; movedToDate: Date | null }) => ({
  id: row.id, date: row.date.toISOString().slice(0, 10), kind: row.kind, name: row.name,
  updatedAt: row.updatedAt.toISOString(), canEdit: row.movedToDate === null && !row.kind.startsWith("MOVED_"),
})

export async function readAttendanceCalendar(organizationId: string, from: string, to: string) {
  return (await prisma.mtmWorkCalendarDay.findMany({
    where: { organizationId, teamId: null, agentId: null, deletedAt: null,
      date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } },
    select: calendarSelect, orderBy: [{ date: "asc" }, { id: "asc" }],
  })).map(serialize)
}

/**
 * Future-only edits retain the previous row and write the audit atomically.
 * Uses the same calendar date lock as the retained Workforce writers; paired
 * moved-day rows stay under their own atomic workflow and cannot be split here.
 */
export async function saveAttendanceCalendar(input: {
  organizationId: string; userId: string; timezone: string; value: unknown; remove?: boolean
}) {
  const parsed = input.remove ? AttendanceCalendarDeleteSchema.safeParse(input.value) : AttendanceCalendarInputSchema.safeParse(input.value)
  if (!parsed.success) throw new AttendanceCalendarError("MTM_ATTENDANCE_CALENDAR_INVALID", 400)
  const draft = parsed.data
  const today = await attendanceCalendarToday(input.organizationId, input.timezone)
  return prisma.$transaction(async (tx) => {
    const old = draft.id ? await tx.mtmWorkCalendarDay.findFirst({
      where: { id: draft.id, organizationId: input.organizationId, teamId: null, agentId: null, deletedAt: null },
    }) : null
    if (draft.id && !old) throw new AttendanceCalendarError("MTM_ATTENDANCE_CALENDAR_CHANGED", 409)
    const date = "date" in draft ? draft.date : old!.date.toISOString().slice(0, 10)
    if (date <= today || (old && old.date.toISOString().slice(0, 10) <= today)) {
      throw new AttendanceCalendarError("MTM_ATTENDANCE_CALENDAR_PAST", 409)
    }
    if (old && (old.movedToDate || old.kind.startsWith("MOVED_"))) throw new AttendanceCalendarError("MTM_ATTENDANCE_CALENDAR_PAIRED", 409)
    await lockWorkforceCalendarConfigurationDates({ db: tx, organizationId: input.organizationId,
      dates: [...new Set([date, ...(old ? [old.date.toISOString().slice(0, 10)] : [])])] })
    const dateValue = new Date(`${date}T00:00:00Z`)
    if (old) {
      const retired = await tx.mtmWorkCalendarDay.updateMany({
        where: { id: old.id, organizationId: input.organizationId, updatedAt: new Date(draft.version!), deletedAt: null },
        data: { deletedAt: new Date(), updatedBy: input.userId },
      })
      if (retired.count !== 1) throw new AttendanceCalendarError("MTM_ATTENDANCE_CALENDAR_CHANGED", 409)
    }
    if (!input.remove && await tx.mtmWorkCalendarDay.findFirst({
      where: { organizationId: input.organizationId, teamId: null, agentId: null, deletedAt: null, date: dateValue }, select: { id: true },
    })) throw new AttendanceCalendarError("MTM_ATTENDANCE_CALENDAR_EXISTS", 409)
    const rules = await readAttendanceRules(input.organizationId, tx)
    const rule = attendanceRuleForDate(rules, date)
    const created = "kind" in draft ? await tx.mtmWorkCalendarDay.create({ data: {
      organizationId: input.organizationId, date: dateValue, kind: draft.kind, name: draft.name,
      // Calendar attendance edits do not silently reschedule existing routes.
      routePlanningAllowed: old?.routePlanningAllowed ?? !rule.weekendDays.includes(dateValue.getUTCDay()),
      source: "ADMIN", createdBy: input.userId, updatedBy: input.userId,
    }, select: calendarSelect }) : null
    await tx.mtmAuditLog.create({ data: {
      organizationId: input.organizationId, actorUserId: input.userId,
      action: input.remove ? "MTM_ATTENDANCE_CALENDAR_REMOVED" : old ? "MTM_ATTENDANCE_CALENDAR_CHANGED" : "MTM_ATTENDANCE_CALENDAR_ADDED",
      entity: "work_calendar_day", entityId: created?.id ?? old!.id, metadataKind: "mtm_attendance_calendar",
      oldData: old ? { id: old.id, date: old.date.toISOString().slice(0, 10), kind: old.kind, name: old.name } : undefined,
      newData: created ? { id: created.id, date, kind: created.kind, name: created.name } : undefined,
    } })
    return created ? serialize(created) : null
  })
}
