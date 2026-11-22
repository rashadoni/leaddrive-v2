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
import { readableProductName } from "@/lib/pharmacy-orders/product-label"
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
/** Written out so the voice tools do not load the order line's modules; the test holds it equal. */
export const MISSED_PHONE_ORDERS_FEATURE = "pharmacy_phone_orders"
/** How much of the period's orders is read aloud; the rest is a count and the screen. */
const SPOKEN_ORDERS = 5
const SPOKEN_ORDER_ITEMS = 10
const SPOKEN_PRODUCT_LIMIT = 80
/** The pharmacy is what 1C or a manager says it is; any other name is the caller's word. */
const PHARMACY_KNOWN_BY = new Set(["phone_unique", "manager_selected"])

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

/**
 * The times a working day ends on this date, earliest first. A lunch break is
 * not an end. An interval cannot cross midnight, so a night shift is stored as
 * «22:00-23:59» and next day's «00:00-06:00»: its end is 06:00, not 23:59.
 */
function closesOn(date: string, schedule: BusinessHoursSchedule, holidays: BusinessHoursHoliday[]): string[] {
  const sorted = (day: string) => [...workingIntervals(day, schedule, holidays)]
    .sort((a, b) => a.start.localeCompare(b.start))
  const intervals = sorted(date)
  if (intervals.length === 0) return []
  const runsIntoNextDay = (interval: BusinessHoursInterval) => interval.end === "23:59"
    && sorted(shiftDate(date, 1))[0]?.start === "00:00"
  const closes: string[] = []
  const previous = sorted(shiftDate(date, -1)).at(-1)
  const tailOfNightShift = intervals[0].start === "00:00" && previous?.end === "23:59"
  if (tailOfNightShift && !runsIntoNextDay(intervals[0])) closes.push(intervals[0].end)
  const shift = tailOfNightShift ? intervals.slice(1) : intervals
  const last = shift.at(-1)
  if (last && !runsIntoNextDay(last)) closes.push(last.end)
  return closes
}

/** When the last finished working day ended, or null when the schedule has none. */
function lastClose(now: Date, hours: BusinessHoursForPeriod): Date | null {
  const schedule = normalizeBusinessHoursSchedule(hours.schedule)
  const holidays = normalizeBusinessHoursHolidays(hours.holidays)
  const today = civilDate(now, hours.timezone)
  for (let back = 0; back <= CLOSE_LOOKBACK_DAYS; back += 1) {
    const date = shiftDate(today, -back)
    for (const end of closesOn(date, schedule, holidays).reverse()) {
      const closedAt = localDateTimeToUtc(`${date}T${end}`, hours.timezone)
      if (closedAt.getTime() <= now.getTime()) return closedAt
    }
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

export type MissedPhoneOrder = {
  /** The number people see on the order, TS-1234. */
  order: string
  at: string
  pharmacy: string | null
  /** False: the caller only named this pharmacy, nobody has confirmed it. */
  pharmacyConfirmed: boolean
  status: "awaiting_review" | "confirmed"
  amount: number
  currency: string
  /** Catalog names only. What the caller said for a line is never read aloud. */
  items: Array<{ product: string; quantity: number; unit: string; amount: number | null }>
  moreItems: number
  /** Lines the catalog did not recognize: a manager has to pick the product. */
  itemsNotIdentified: number
}

export type MissedPhoneOrders = {
  count: number
  /** Orders holding a line with no price: their amount covers the priced lines only. */
  ordersWithUnpricedLines: number
  /** One row per currency, never added together: the CRM has no exchange rates. */
  totals: Array<{ currency: string; orders: number; amount: number }>
  /** The newest orders of the period, so a follow-up question has an answer. */
  orders: MissedPhoneOrder[]
  moreOrders: number
}

/** `absent`: the organization has no phone orders. `denied`: it has, this person may not read them. */
export type MissedPhoneOrdersAccess = "absent" | "denied" | "allowed"

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
  /** Whose meetings `booked` covers: everybody's, or this person's and the hosts they were granted. */
  bookedScope: "all_hosts" | "own_and_granted" | null
  askedForYou: { count: number; people: Array<{ name: string | null; at: string }> } | null
  /** Orders the AI took on the phone. The key is missing for an organization without phone orders. */
  phoneOrders?: MissedPhoneOrders | null
  unavailable: Array<"calls" | "chats" | "bookings" | "phoneOrders">
  /** True when a part held more rows than are read: its figures are a lower bound. */
  truncated: boolean
  means: {
    handled: string
    notQualified: string
    booked: string
    phoneOrders?: string
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
    // Generated replies only: the greeting, a survey link and the escalation
    // notice are also written as "bot", and none of them is the AI answering.
    where: voiceScopedWhere(orgId, {
      fromRole: "bot",
      createdAt: window,
      metadata: { path: ["aiGenerated"], equals: true },
    }),
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

/**
 * Orders finished on the call inside the period. Not a broken-off call (the
 * caller never confirmed it), not one that was cancelled or rejected, and not
 * the owner's rehearsal calls, which are marked `test_call`.
 */
async function readPhoneOrders(orgId: string, period: MissedPeriod): Promise<MissedPhoneOrders> {
  const where = voiceScopedWhere(orgId, {
    finishedOnCallAt: { gte: period.from, lt: period.to },
    status: { not: "rejected" },
    pharmacyIdentification: { not: "test_call" },
  })
  const [groups, ordersWithUnpricedLines, newest] = await Promise.all([
    prisma.pharmacyPhoneOrder.groupBy({
      by: ["currency"],
      where,
      _count: { _all: true },
      _sum: { totalAmount: true },
      orderBy: { currency: "asc" },
    }) as Promise<Array<{ currency: string; _count: { _all: number }; _sum: { totalAmount: unknown } }>>,
    prisma.pharmacyPhoneOrder.count({ where: { ...where, lines: { some: { lineTotal: null } } } }) as Promise<number>,
    prisma.pharmacyPhoneOrder.findMany({
      where,
      orderBy: [{ finishedOnCallAt: "desc" }, { number: "desc" }],
      take: SPOKEN_ORDERS,
      select: {
        number: true,
        status: true,
        finishedOnCallAt: true,
        totalAmount: true,
        currency: true,
        pharmacyName: true,
        pharmacyIdentification: true,
        company: { select: { name: true } },
        // `spokenText` is left out on purpose: it is free text from whoever
        // called, and this answer is read by a model that can act on words.
        lines: {
          orderBy: { position: "asc" },
          select: { status: true, productName: true, quantity: true, unit: true, lineTotal: true },
        },
      },
    }) as Promise<PhoneOrderRow[]>,
  ])
  const totals = groups.map((row) => ({
    currency: row.currency,
    orders: row._count._all,
    amount: Number(String(row._sum.totalAmount ?? 0)),
  }))
  const count = totals.reduce((sum, row) => sum + row.orders, 0)
  return {
    count,
    ordersWithUnpricedLines,
    totals,
    orders: newest.map((row) => spokenPhoneOrder(row, period.timezone)),
    moreOrders: Math.max(0, count - newest.length),
  }
}

type PhoneOrderRow = {
  number: number
  status: string
  finishedOnCallAt: Date
  totalAmount: unknown
  currency: string
  pharmacyName: string | null
  pharmacyIdentification: string
  company: { name: string } | null
  lines: Array<{ status: string; productName: string | null; quantity: number; unit: string; lineTotal: unknown }>
}

function spokenPhoneOrder(row: PhoneOrderRow, timezone: string): MissedPhoneOrder {
  const known = row.lines.filter((line) => line.status === "resolved" && line.productName)
  const pharmacy = (row.company?.name ?? row.pharmacyName)?.replace(/[\r\n\t]+/g, " ").trim().slice(0, SPOKEN_NAME_LIMIT)
  return {
    order: `TS-${row.number}`,
    at: spokenTime(row.finishedOnCallAt, timezone),
    pharmacy: pharmacy || null,
    pharmacyConfirmed: PHARMACY_KNOWN_BY.has(row.pharmacyIdentification),
    status: row.status === "confirmed" ? "confirmed" : "awaiting_review",
    amount: Number(String(row.totalAmount)),
    currency: row.currency,
    items: known.slice(0, SPOKEN_ORDER_ITEMS).map((line) => ({
      product: readableProductName(line.productName!).slice(0, SPOKEN_PRODUCT_LIMIT),
      quantity: line.quantity,
      unit: line.unit.replace(/[^\p{L}]/gu, "").slice(0, 16),
      amount: line.lineTotal === null ? null : Number(String(line.lineTotal)),
    })),
    moreItems: Math.max(0, known.length - SPOKEN_ORDER_ITEMS),
    itemsNotIdentified: row.lines.length - known.length,
  }
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
  phoneOrders: MissedPhoneOrdersAccess
}): Promise<MissedSummary> {
  const { orgId, userId, role, period } = input
  const [calls, chats, booked, phoneOrders] = await Promise.all([
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
    input.phoneOrders === "allowed" ? readPhoneOrders(orgId, period) : Promise.resolve(null),
  ])
  const unavailable: MissedSummary["unavailable"] = [
    ...(calls ? [] : ["calls" as const]),
    ...(chats ? [] : ["chats" as const]),
    ...(booked === null ? ["bookings" as const] : []),
    ...(input.phoneOrders === "denied" ? ["phoneOrders" as const] : []),
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
    bookedScope: input.booking ? (input.booking.hostIds === null ? "all_hosts" : "own_and_granted") : null,
    askedForYou: calls?.askedForYou ?? null,
    ...(input.phoneOrders === "absent" ? {} : { phoneOrders }),
    unavailable,
    truncated: Boolean(calls?.truncated || chats?.truncated),
    means: {
      handled: "incoming calls the AI answered where the customer spoke, plus chats where the customer wrote and the AI replied, inside the period; pharmacy-line and demo calls are not counted",
      notQualified: "known for calls only; chats have no such verdict, so never say how many chats did not fit",
      booked: "meetings the WhatsApp AI booked in the period and that are not cancelled; the AI does not book during phone calls. When bookedScope is own_and_granted, say the figure covers only the hosts this user can see",
      ...(input.phoneOrders === "absent" ? {} : {
        phoneOrders: "orders the AI took on the phone and the caller confirmed on the call, not rejected; reported apart from handled, never added to it. Say each currency's amount separately and never add currencies. When ordersWithUnpricedLines is above zero, say those orders have lines without a price, so the amount covers only the priced lines. `orders` holds the newest orders: use it to answer which pharmacy, which products and how many. status awaiting_review means a manager has not checked it yet. When pharmacyConfirmed is false, say the caller only named that pharmacy. When moreOrders or moreItems is above zero, say the rest is on the phone orders screen",
      }),
    },
  }
}
