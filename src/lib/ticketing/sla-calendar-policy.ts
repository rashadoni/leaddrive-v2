import { Prisma } from "@prisma/client"
import { normalizeBusinessHoursSchedule, normalizeBusinessHoursHolidays } from "@/lib/inbox/business-hours"
import { addSlaWorkingMilliseconds, readSlaBusinessCalendar, SlaCalendarError } from "./sla-business-calendar"

export async function currentSlaCalendarSource(db: Prisma.TransactionClient, orgId: string) {
  const source = await db.businessHours.findUnique({
    where: { organizationId_channelType: { organizationId: orgId, channelType: "all" } },
  })
  if (!source?.isActive) return null
  return readSlaBusinessCalendar({
    version: 1, sourceId: source.id, capturedAt: new Date().toISOString(),
    sourceUpdatedAt: source.updatedAt.toISOString(), timezone: source.timezone,
    boundaryPolicy: "reject_ambiguous_or_missing",
    schedule: normalizeBusinessHoursSchedule(source.schedule),
    holidays: normalizeBusinessHoursHolidays(source.holidays),
  })
}

export async function prepareSlaCalendar(
  db: Prisma.TransactionClient,
  orgId: string,
  action: "preserve" | "capture" | "clear" | undefined,
  enabled: boolean,
  firstResponseHours: number,
  resolutionHours: number,
  expectedSourceUpdatedAt?: string,
  existing?: unknown,
) {
  if (action === "clear") return Prisma.DbNull
  const preserve = !action || action === "preserve"
  if (preserve && (!enabled || !existing)) return undefined
  if (!enabled) throw new SlaCalendarError("SLA_CALENDAR_INVALID")
  const snapshot = preserve ? readSlaBusinessCalendar(existing) : await currentSlaCalendarSource(db, orgId)
  if (!snapshot) throw new SlaCalendarError("SLA_CALENDAR_INVALID")
  if (!preserve && snapshot.sourceUpdatedAt !== expectedSourceUpdatedAt) throw new SlaCalendarError("SLA_CALENDAR_SOURCE_CHANGED")
  const now = new Date()
  addSlaWorkingMilliseconds(now, firstResponseHours * 3600000, snapshot)
  addSlaWorkingMilliseconds(now, resolutionHours * 3600000, snapshot)
  return preserve ? undefined : snapshot
}
