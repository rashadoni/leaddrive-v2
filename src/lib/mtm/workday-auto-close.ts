import type { Prisma } from "@prisma/client"
import {
  applyMtmWorkdayEvent,
  lockMtmWorkdayTransitions,
  MTM_WORKDAY_AUTO_CLOSE_EVENT_KEY_PREFIX,
  WORKFORCE_ATTENDANCE_REVIEW_POLICY_VERSION,
  WORKFORCE_WORKDAY_CURRENT_SCHEMA_VERSION,
} from "@/lib/mtm/workday"
import { writeWorkforceWorkdayAuditInTransaction } from "@/lib/workforce/workday-audit"
import { AGENT_LANGUAGE_SELECT, agentLanguage } from "@/lib/mtm/agent-language"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { localDateTimeToUnambiguousUtc } from "@/lib/timezone"

/**
 * A forgotten field workday closes itself at the company's hour.
 *
 * Client (Zeytun, Seymur Məmmədov), 2026-11-21: «Misal üçün saat 8-də
 * bağlansın əgər əllə bağlanmayıbsa… Sabaha kimi açıq qalmasın boş yerə». Not
 * after the last client of the route: agents add clients outside it. On
 * production 9 of his 11 days stayed open past their date, one of them from
 * Friday to Tuesday, and 19 433 of 24 400 GPS points were recorded after 20:00
 * of the day they belonged to — personal time. The owner's answer: «Да, делай».
 * This replaces, for a company that switches it on, the rule of 2026-09-21
 * that only the worker closes the day.
 *
 * What the switch does and does not do:
 * - off by default, one company at a time;
 * - only the days of field staff. Whoever is in the HR timesheet
 *   (`attendanceParticipant`, office employees) closes the day himself: there
 *   the finish time is a payroll fact;
 * - never a day dated before the switch was turned on, and nothing earlier
 *   than that moment: turning it on is not a rewrite of history;
 * - a visit in progress holds the close until the visit ends;
 * - a day the employee came back to («İşə qayıt»), or began after the hour, is
 *   closed at the end of its date, so that nothing stays open until morning;
 *   the same limit ends the wait for a visit that was forgotten open;
 * - a shift planned to end later than the hour closes at its planned end.
 */
export const WORKDAY_AUTO_CLOSE_ENABLED_KEY = "workdayAutoCloseEnabled"
export const WORKDAY_AUTO_CLOSE_HOUR_KEY = "workdayAutoCloseHour"
/** When it was switched on; written by the settings route, never by a client. */
export const WORKDAY_AUTO_CLOSE_SINCE_KEY = "workdayAutoCloseSince"

export const WORKDAY_AUTO_CLOSE_NOTE = "Closed automatically at the company's end-of-day hour"

export type WorkdayAutoCloseFacts = {
  workDateKey: string
  timezone: string
  hour: number
  enabledAt: Date
  startedAt: Date
  /** The newest journal event: the close may not be recorded before it. */
  lastEventAt: Date | null
  /** The employee returned to this day after it was closed. */
  returned: boolean
  plannedEndAt: Date | null
  /** A visit begun in this day is still open. */
  visitOpen: boolean
  /** When the latest visit of this day was closed. */
  lastCheckOutAt: Date | null
  now: Date
}

function later(...values: Array<Date | null | undefined>): Date {
  return new Date(Math.max(...values.flatMap((value) => value ? [value.getTime()] : [])))
}

/** The moment to record as the end of this day, or null while it is not due. */
export function workdayAutoCloseAt(facts: WorkdayAutoCloseFacts): Date | null {
  const { workDateKey, timezone, hour, enabledAt, startedAt, lastEventAt, returned, plannedEndAt, visitOpen, lastCheckOutAt, now } = facts
  const hourAt = localDateTimeToUnambiguousUtc(`${workDateKey}T${String(hour).padStart(2, "0")}:00`, timezone)
  const endOfDate = localDateTimeToUnambiguousUtc(`${workDateKey}T23:59`, timezone)
  const scheduled = returned || startedAt.getTime() >= hourAt.getTime() ? endOfDate : hourAt
  const due = later(scheduled, plannedEndAt, enabledAt)
  if (now.getTime() < due.getTime()) return null

  // However long a forgotten visit stays open, the day ends with its date.
  const lastCall = later(endOfDate, plannedEndAt, enabledAt)
  if (visitOpen && now.getTime() < lastCall.getTime()) return null

  // The journal's instants strictly increase, and a finished day must end
  // after it began: one second after whatever happened last. A visit closed
  // after the day's date belongs to no part of this day.
  const afterLastEvent = new Date(later(lastEventAt, startedAt).getTime() + 1_000)
  const visitEnd = !visitOpen && lastCheckOutAt && lastCheckOutAt.getTime() <= lastCall.getTime() ? lastCheckOutAt : null
  const closeAt = later(visitOpen ? lastCall : due, visitEnd, afterLastEvent)
  // An event stamped by a phone running ahead of the server: wait for it.
  return closeAt.getTime() > now.getTime() ? null : closeAt
}

type Locale = "az" | "ru" | "en"

const COPY: Record<Locale, { title: string; body: (time: string) => string; comeBack: string }> = {
  az: {
    title: "İş günü avtomatik bağlandı",
    body: (time) => `Saat ${time}: gününüz bağlandı, yeriniz artıq qeydə alınmır.`,
    comeBack: " İşə davam edirsinizsə, «İşə qayıt» düyməsini basın.",
  },
  ru: {
    title: "Рабочий день закрыт автоматически",
    body: (time) => `${time}: день закрыт, ваше местоположение больше не записывается.`,
    comeBack: " Если вы ещё работаете, нажмите «Вернуться к работе».",
  },
  en: {
    title: "Workday closed automatically",
    body: (time) => `${time}: your day was closed and your location is no longer recorded.`,
    comeBack: " If you are still working, tap “Return to work”.",
  },
}

function clock(value: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timezone }).format(value)
}

export type WorkdayAutoCloseNotice = { agentId: string; workdayId: string; title: string; body: string }

/**
 * One day, under the same lock every other workday writer takes, so the
 * employee's own «End day» and this cannot both apply. Everything is read again
 * inside it: the list the job walks is already old by the time it gets here.
 */
export async function closeMtmWorkdayIfDue(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; agentId: string; workdayId: string; timezone: string; hour: number; enabledAt: Date; now: Date },
): Promise<WorkdayAutoCloseNotice | null> {
  const { organizationId, agentId, workdayId, timezone, hour, enabledAt, now } = input
  const scope = { organizationId, agentId }
  await lockMtmWorkdayTransitions(tx, scope)

  const day = await tx.mtmAgentWorkday.findFirst({
    where: { id: workdayId, organizationId, agentId },
    select: {
      id: true, status: true, workDate: true, startedAt: true,
      workforceShiftSnapshot: { select: { plannedEndAt: true } },
      agent: { select: { role: true, attendanceParticipant: true, ...AGENT_LANGUAGE_SELECT } },
    },
  })
  if (!day || day.status === "COMPLETED") return null
  if (day.agent.role === "EMPLOYEE" || day.agent.attendanceParticipant) return null
  const workDateKey = day.workDate.toISOString().slice(0, 10)

  const [events, openVisit, lastVisit] = await Promise.all([
    tx.mtmAgentWorkdayEvent.findMany({
      where: { organizationId, agentId, workdayId },
      select: { type: true, occurredAt: true },
    }),
    tx.mtmVisit.findFirst({
      where: { organizationId, agentId, status: "CHECKED_IN", deletedAt: null, checkInAt: { gte: day.startedAt } },
      select: { id: true },
    }),
    tx.mtmVisit.findFirst({
      where: { organizationId, agentId, deletedAt: null, checkInAt: { gte: day.startedAt }, checkOutAt: { not: null, lte: now } },
      orderBy: { checkOutAt: "desc" },
      select: { checkOutAt: true },
    }),
  ])
  const closeAt = workdayAutoCloseAt({
    workDateKey,
    timezone,
    hour,
    enabledAt,
    startedAt: day.startedAt,
    lastEventAt: events.reduce<Date | null>((latest, event) => !latest || event.occurredAt > latest ? event.occurredAt : latest, null),
    returned: events.some((event) => event.type === "REOPEN"),
    plannedEndAt: day.workforceShiftSnapshot?.plannedEndAt ?? null,
    visitOpen: Boolean(openVisit),
    lastCheckOutAt: lastVisit?.checkOutAt ?? null,
    now,
  })
  if (!closeAt) return null

  // A day the employee came back to can be closed a second time.
  const finishes = events.filter((event) => event.type === "FINISH").length
  const workdayInput = {
    action: "FINISH" as const,
    workdayId,
    clientEventId: `${MTM_WORKDAY_AUTO_CLOSE_EVENT_KEY_PREFIX}${workdayId}:${finishes}`,
    occurredAt: closeAt,
    claimedAt: closeAt,
    capturedAt: closeAt,
    queuedAt: null,
    serverReceivedAt: now,
    schemaVersion: WORKFORCE_WORKDAY_CURRENT_SCHEMA_VERSION,
    attendanceReview: { state: "NOT_REQUIRED" as const, reasonCode: null, policyVersion: WORKFORCE_ATTENDANCE_REVIEW_POLICY_VERSION, claimAgeSeconds: 0 },
    workDateKey,
    latitude: null,
    longitude: null,
    accuracy: null,
    note: WORKDAY_AUTO_CLOSE_NOTE,
  }
  const applied = await applyMtmWorkdayEvent(tx, scope, workdayInput, {
    afterEvent: async ({ workday, event, beforeWorkday }) => {
      await writeWorkforceWorkdayAuditInTransaction(tx, { scope, workdayInput, beforeWorkday, workday, event, channel: "system" })
    },
  })
  if (applied.status !== "ok") {
    console.warn("[mtm/workday-auto-close] not closed:", applied.code)
    return null
  }

  const language = agentLanguage(day.agent)
  const copy = COPY[language === "ru" || language === "en" ? language : "az"]
  // «Back to work» exists only on the day's own date.
  const canComeBack = currentDateKey(now, timezone) === workDateKey
  const body = `${copy.body(clock(closeAt, timezone))}${canComeBack ? copy.comeBack : ""}`
  await tx.mtmNotification.create({
    data: { organizationId, agentId, title: copy.title, body, type: "info", metadata: { workdayId, workdayAutoClosed: true } },
  })
  return { agentId, workdayId, title: copy.title, body }
}
