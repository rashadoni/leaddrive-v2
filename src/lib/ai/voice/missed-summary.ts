import type { Prisma } from "@prisma/client"

import { bookingScope, type BookingAccess } from "@/lib/booking/access"
import { accessibleCallWhere } from "@/lib/calls/access"
import {
  WEEKDAY_KEYS,
  isValidTimeZone,
  normalizeBusinessHoursHolidays,
  normalizeBusinessHoursSchedule,
  type BusinessHoursHoliday,
  type BusinessHoursInterval,
  type BusinessHoursSchedule,
} from "@/lib/inbox/business-hours"
import { visibleChannelWhere } from "@/lib/inbox/channel-access"
import { canRead, type Role } from "@/lib/permissions"
import { prisma } from "@/lib/prisma"
import { localDateTimeToUtc } from "@/lib/timezone"
import { readCallOutcome } from "@/lib/voice-agent/call-outcome"
import { isLineOrDemoCall } from "@/lib/voice-agent/line-or-demo-call"
import { voiceScopedWhere } from "./scoped-where"

/**
 * «Что я пропустил?» — what the AI took while nobody was at work
 * (owner, 2026-11-21).
 *
 * Every figure is a count of rows, and the period is part of the answer: «четыре
 * обращения» means nothing until it says since when. A part this person may not
 * see comes back as `null` and is named in `unavailable`, never as a zero: «0
 * звонков» to someone without telephony access would be a false statement.
 *
 * Only the calls have a verdict (qualified / not / needs a person), because only
 * calls are analysed that way; chats have the inbox AI's own qualification, and
 * no "did not fit" at all. The answer carries that so it cannot be said wrongly.
 */

export const MISSED_FALLBACK_HOURS = 16
const CLOSE_LOOKBACK_DAYS = 14
/** A period holding more than this is not read row by row: it says it was cut. */
const MAX_ROWS = 500
const SPOKEN_PEOPLE = 5
const SPOKEN_NAME_LIMIT = 60

export type BusinessHoursForPeriod = {
  channelType: string
  timezone: string
  schedule: unknown
  holidays: unknown
}

export type MissedPeriod = {
  from: Date
  to: Date
  timezone: string
  basis: "business_hours" | "last_16_hours"
}

function civilDate(at: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at)
}

function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

function workingIntervals(
  date: string,
  schedule: BusinessHoursSchedule,
  holidays: BusinessHoursHoliday[],
): BusinessHoursInterval[] {
  const holiday = holidays.find((item) => item.date === date)
  if (holiday) {
    if (holiday.intervals && holiday.intervals.length > 0) return holiday.intervals
    if (holiday.closed !== false) return []
  }
  const weekday = WEEKDAY_KEYS[(new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7]
  const day = schedule[weekday]
  return day?.enabled ? day.intervals ?? [] : []
}

/** When the last finished working day ended, or null when the schedule has none. */
function lastClose(now: Date, hours: BusinessHoursForPeriod): Date | null {
  const schedule = normalizeBusinessHoursSchedule(hours.schedule)
  const holidays = normalizeBusinessHoursHolidays(hours.holidays)
  const today = civilDate(now, hours.timezone)
  for (let back = 0; back <= CLOSE_LOOKBACK_DAYS; back += 1) {
    const date = shiftDate(today, -back)
    const intervals = workingIntervals(date, schedule, holidays)
    if (intervals.length === 0) continue
    // The day's LAST interval: a lunch break is not the end of the working day.
    const end = intervals.map((interval) => interval.end).sort().at(-1)!
    const closedAt = localDateTimeToUtc(`${date}T${end}`, hours.timezone)
    if (closedAt.getTime() <= now.getTime()) return closedAt
  }
  return null
}

function hasOwnSchedule(schedule: unknown): boolean {
  // normalizeBusinessHoursSchedule turns an empty object into 09:00-18:00, and
  // a period counted from a schedule nobody set would be stated as a fact.
  return Boolean(schedule)
    && typeof schedule === "object"
    && !Array.isArray(schedule)
    && WEEKDAY_KEYS.some((day) => day in (schedule as Record<string, unknown>))
}

/**
 * From the end of the last working day by the organization's hours; without
 * usable hours, the last 16 hours. Prefers the organization-wide row over the
 * telephony one, because the question is about the working day.
 */
export function resolveMissedPeriod(
  now: Date,
  rows: readonly BusinessHoursForPeriod[],
  fallbackTimezone: string,
): MissedPeriod {
  const hours = rows.find((row) => row.channelType === "all") ?? rows.find((row) => row.channelType === "voice")
  if (hours && hasOwnSchedule(hours.schedule) && isValidTimeZone(hours.timezone)) {
    const from = lastClose(now, hours)
    if (from) return { from, to: now, timezone: hours.timezone, basis: "business_hours" }
  }
  return {
    from: new Date(now.getTime() - MISSED_FALLBACK_HOURS * 3_600_000),
    to: now,
    timezone: fallbackTimezone,
    basis: "last_16_hours",
  }
}

export async function loadMissedPeriod(orgId: string, now: Date, fallbackTimezone: string): Promise<MissedPeriod> {
  const rows = await prisma.businessHours.findMany({
    where: voiceScopedWhere(orgId, { channelType: { in: ["all", "voice"] }, isActive: true }),
    select: { channelType: true, timezone: true, schedule: true, holidays: true },
  })
  return resolveMissedPeriod(now, rows, fallbackTimezone)
}

function spokenTime(at: Date, timezone: string): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at)
}

export type MissedSummary = {
  period: {
    from: string
    to: string
    fromLocal: string
    toLocal: string
    timezone: string
    basis: MissedPeriod["basis"]
  }
  /** Calls plus chats the AI handled, over the parts this person can see. */
  handled: number
  calls: {
    handled: number
    qualified: number
    notQualified: number
    needsHuman: number
    /** Analysis was unavailable or the call predates the verdict. */
    noVerdict: number
  } | null
  chats: { handled: number; qualified: number } | null
  /** Meetings the WhatsApp AI booked in the period, within this person's booking access. */
  booked: number | null
  askedForYou: { count: number; people: Array<{ name: string | null; at: string }> } | null
  unavailable: Array<"calls" | "chats" | "bookings">
  /** True when a part held more rows than are read: its figures are a lower bound. */
  truncated: boolean
  means: {
    handled: string
    notQualified: string
    booked: string
  }
}

type CallRow = {
  id: string
  consentAudit: Prisma.JsonValue
  insights: Prisma.JsonValue
  leadId: string | null
  contactId: string | null
  createdAt: Date
}

async function readCalls(input: {
  orgId: string
  userId: string
  role: Role
  period: MissedPeriod
  hiddenChannelIds: ReadonlySet<string>
}) {
  const { orgId, userId, role, period } = input
  const visible = visibleChannelWhere(input.hiddenChannelIds) as Prisma.CallLogWhereInput | undefined
  const rows = await prisma.callLog.findMany({
    where: {
      AND: [
        voiceScopedWhere(orgId, {
          direction: "inbound",
          provider: "asterisk",
          conversationOutcome: "customer_spoke",
          createdAt: { gte: period.from, lt: period.to },
          OR: [{ callMode: "ai" }, { handoffState: { not: null } }],
        }),
        accessibleCallWhere(role, userId),
        ...(visible ? [visible] : []),
      ],
    },
    select: { id: true, consentAudit: true, insights: true, leadId: true, contactId: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: MAX_ROWS + 1,
  }) as CallRow[]
  const truncated = rows.length > MAX_ROWS
  const calls = rows.slice(0, MAX_ROWS).filter((row) => !isLineOrDemoCall(row.consentAudit))

  const totals = { handled: calls.length, qualified: 0, notQualified: 0, needsHuman: 0, noVerdict: 0 }
  const forYou: Array<{ row: CallRow; callerName: string | null }> = []
  for (const row of calls) {
    const stored = readCallOutcome(row.insights)
    if (stored.outcome === "qualified") totals.qualified += 1
    else if (stored.outcome === "not_qualified") totals.notQualified += 1
    else if (stored.outcome === "needs_human") totals.needsHuman += 1
    else totals.noVerdict += 1
    if (stored.requestedEmployee?.match === "matched" && stored.requestedEmployee.userId === userId) {
      forYou.push({ row, callerName: stored.callerName })
    }
  }

  const spoken = forYou.slice(0, SPOKEN_PEOPLE)
  const leadIds = canRead(role, "leads")
    ? spoken.map(({ row }) => row.leadId).filter((id): id is string => Boolean(id))
    : []
  const contactIds = canRead(role, "contacts")
    ? spoken.map(({ row }) => row.contactId).filter((id): id is string => Boolean(id))
    : []
  const [leads, contacts] = await Promise.all([
    leadIds.length
      ? prisma.lead.findMany({
          where: voiceScopedWhere(orgId, { id: { in: leadIds } }),
          select: { id: true, contactName: true },
        })
      : Promise.resolve([]),
    contactIds.length
      ? prisma.contact.findMany({
          where: voiceScopedWhere(orgId, { id: { in: contactIds } }),
          select: { id: true, fullName: true },
        })
      : Promise.resolve([]),
  ])
  const leadName = new Map((leads as Array<{ id: string; contactName: string }>).map((lead) => [lead.id, lead.contactName]))
  const contactName = new Map((contacts as Array<{ id: string; fullName: string }>).map((contact) => [contact.id, contact.fullName]))
  const people = spoken.map(({ row, callerName }) => {
    const name = (row.contactId ? contactName.get(row.contactId) : undefined)
      ?? (row.leadId ? leadName.get(row.leadId) : undefined)
      ?? callerName
    // The name a caller gave is free text read aloud; a phone number used as a
    // lead's name is not something to say either.
    const clean = name?.replace(/[\r\n\t]+/g, " ").trim().slice(0, SPOKEN_NAME_LIMIT) || null
    return { name: clean && /\p{L}/u.test(clean) ? clean : null, at: spokenTime(row.createdAt, period.timezone) }
  })
  return { totals, askedForYou: { count: forYou.length, people }, truncated }
}

const AI_AUTHORED: Prisma.ChannelMessageWhereInput[] = [
  { metadata: { path: ["aiAutoReply"], equals: true } },
  { metadata: { path: ["aiGenerated"], equals: true } },
  { metadata: { path: ["authorType"], equals: "ai" } },
]

async function readChats(input: {
  orgId: string
  period: MissedPeriod
  hiddenChannelIds: ReadonlySet<string>
}) {
  const { orgId, period } = input
  const window = { gte: period.from, lt: period.to }
  const visible = visibleChannelWhere(input.hiddenChannelIds) as Prisma.ChannelMessageWhereInput | undefined
  const answered = await prisma.channelMessage.findMany({
    where: {
      AND: [
        voiceScopedWhere(orgId, {
          direction: "outbound",
          conversationId: { not: null },
          createdAt: window,
          OR: AI_AUTHORED,
        }),
        ...(visible ? [visible] : []),
      ],
    },
    select: { conversationId: true, metadata: true },
    distinct: ["conversationId"],
    take: MAX_ROWS + 1,
  }) as Array<{ conversationId: string | null; metadata: Prisma.JsonValue }>
  let truncated = answered.length > MAX_ROWS
  const answeredIds = answered.slice(0, MAX_ROWS).flatMap((row) => {
    const metadata = row.metadata as Record<string, unknown> | null
    // The demo's own WhatsApp bot talks to prospects, not to this business's customers.
    return row.conversationId && metadata?.sentVia !== "demo_ai" ? [row.conversationId] : []
  })
  // An AI reminder to somebody who said nothing in this period is not an
  // enquiry it took; imported history is not something that happened overnight.
  const wrote = answeredIds.length
    ? await prisma.channelMessage.findMany({
        where: voiceScopedWhere(orgId, {
          direction: "inbound",
          conversationId: { in: answeredIds },
          createdAt: window,
          historyImportedAt: null,
        }),
        select: { conversationId: true },
        distinct: ["conversationId"],
      }) as Array<{ conversationId: string | null }>
    : []
  const conversationIds = wrote.flatMap((row) => (row.conversationId ? [row.conversationId] : []))

  const conversations = conversationIds.length
    ? await prisma.socialConversation.findMany({
        where: voiceScopedWhere(orgId, { id: { in: conversationIds } }),
        select: { metadata: true },
      }) as Array<{ metadata: Prisma.JsonValue }>
    : []
  const qualified = conversations.filter(({ metadata }) => {
    const row = metadata as Record<string, unknown> | null
    if (typeof row?.qualificationLeadId !== "string" || typeof row.qualifiedAt !== "string") return false
    const at = Date.parse(row.qualifiedAt)
    return at >= period.from.getTime() && at < period.to.getTime()
  }).length

  // The website chat keeps its messages in its own table.
  const botSessions = await prisma.webChatMessage.findMany({
    where: voiceScopedWhere(orgId, { fromRole: "bot", createdAt: window }),
    select: { sessionId: true },
    distinct: ["sessionId"],
    take: MAX_ROWS + 1,
  }) as Array<{ sessionId: string }>
  truncated ||= botSessions.length > MAX_ROWS
  const sessionIds = botSessions.slice(0, MAX_ROWS).map((row) => row.sessionId)
  const visitors = sessionIds.length
    ? await prisma.webChatMessage.findMany({
        where: voiceScopedWhere(orgId, { fromRole: "visitor", sessionId: { in: sessionIds }, createdAt: window }),
        select: { sessionId: true },
        distinct: ["sessionId"],
      }) as Array<{ sessionId: string }>
    : []

  return { handled: conversationIds.length + visitors.length, qualified, truncated }
}

export async function buildMissedSummary(input: {
  orgId: string
  userId: string
  role: Role
  period: MissedPeriod
  canSeeCalls: boolean
  canSeeChats: boolean
  booking: BookingAccess | null
  hiddenChannelIds: ReadonlySet<string>
}): Promise<MissedSummary> {
  const { orgId, userId, role, period } = input
  const [calls, chats, booked] = await Promise.all([
    input.canSeeCalls
      ? readCalls({ orgId, userId, role, period, hiddenChannelIds: input.hiddenChannelIds })
      : Promise.resolve(null),
    input.canSeeChats
      ? readChats({ orgId, period, hiddenChannelIds: input.hiddenChannelIds })
      : Promise.resolve(null),
    input.booking
      ? prisma.booking.count({
          where: {
            AND: [
              bookingScope(input.booking),
              { source: "whatsapp", status: { not: "cancelled" }, createdAt: { gte: period.from, lt: period.to } },
            ],
          },
        })
      : Promise.resolve(null),
  ])
  const unavailable: MissedSummary["unavailable"] = [
    ...(calls ? [] : ["calls" as const]),
    ...(chats ? [] : ["chats" as const]),
    ...(booked === null ? ["bookings" as const] : []),
  ]
  return {
    period: {
      from: period.from.toISOString(),
      to: period.to.toISOString(),
      fromLocal: spokenTime(period.from, period.timezone),
      toLocal: spokenTime(period.to, period.timezone),
      timezone: period.timezone,
      basis: period.basis,
    },
    handled: (calls?.totals.handled ?? 0) + (chats?.handled ?? 0),
    calls: calls?.totals ?? null,
    chats: chats ? { handled: chats.handled, qualified: chats.qualified } : null,
    booked,
    askedForYou: calls?.askedForYou ?? null,
    unavailable,
    truncated: Boolean(calls?.truncated || chats?.truncated),
    means: {
      handled: "incoming calls the AI answered where the customer spoke, plus chats where the customer wrote and the AI replied, inside the period; pharmacy-line and demo calls are not counted",
      notQualified: "known for calls only; chats have no such verdict, so never say how many chats did not fit",
      booked: "meetings the WhatsApp AI booked in the period and that are not cancelled; the AI does not book during phone calls",
    },
  }
}
