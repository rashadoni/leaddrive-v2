/**
 * Appointments by phone: what the AI on a call may do in the organization's
 * «Встречи».
 *
 * Owner, 2026-11-22 («Давай» on the plan): a clinic or a salon sells the same
 * thing its competitors do — the caller says «запишите меня завтра на 11», and
 * the appointment is in the calendar when the call ends. Until this file the
 * phone agent of a tenant without a catalog could only take a request in
 * words: it had no tools at all.
 *
 * The rules are the public booking link's, not new ones: the service's hours,
 * the host's calendar, the notice and the horizon, and the database's own
 * refusal of a second meeting on one chair (createStoredBooking). The phone
 * adds three things of its own:
 *  - the organization and the caller's number come from the CALL, never from
 *    the model's arguments;
 *  - a service that asks for a deposit is not offered: nobody can pay on a
 *    call, and the public link holds such a time only against the money;
 *  - a cancel reaches only a meeting booked on the caller's own number.
 *
 * Everything the model reads back is short on purpose. Each tool answer stays
 * in the call's context and is billed again on every later turn (measured
 * 2026-11-22: about 0.007 AZN a minute per 1,000 tokens of fixed text), so
 * there are no ids, no ISO instants and no more than eight times in an answer.
 *
 * Every function here must run inside the call's tenant scope (runWithTenant).
 */
import { z } from "zod"

import { IdempotencyConflictError } from "@/lib/event-platform/errors"
import { hmacToken } from "@/lib/secure-token"
import { dateInputValueInTimezone, localDateTimeToUnambiguousUtc } from "@/lib/timezone"
import { normalizeLineNumber } from "@/lib/voip/line-numbers"
import { bookableChairs, orgContext, publicBookingView } from "@/lib/booking/book"
import { BookingCommandError } from "@/lib/booking/command-error"
import { cancelStoredBooking } from "@/lib/booking/commands"
import { createStoredBooking } from "@/lib/booking/create"
import { bookingDb as prisma } from "@/lib/booking/db"
import { asksDeposit, depositPolicy } from "@/lib/booking/deposit"

import { BOOK_TOOL, CANCEL_TOOL, clockIn, FIND_TOOL, PHONE_SERVICES_MAX, weekdayOf, type PhoneService } from "./prompt"

/** Free times in one answer. */
const TIMES_MAX = 8
const TIMES_AFTER_TAKEN = 3

export type BookingToolContext = {
  organizationId: string
  /** The call's row: one appointment per service and time for one call. */
  callLogId: string
  /** The number the caller rang from, as the station reported it; null when hidden. */
  callerNumber: string | null
  /** The services this call was told about at its start (the call's own record). */
  services: readonly Pick<PhoneService, "code" | "pageId">[]
  now: Date
}

export type ToolResult = Record<string, unknown>

/**
 * The services a phone call may book: active, with somebody to take the
 * meeting, and asking no deposit. In the order they were created, as the
 * WhatsApp agent lists them.
 */
export async function loadPhoneServices(organizationId: string): Promise<PhoneService[]> {
  const pages = await prisma.bookingPage.findMany({
    where: { organizationId, isActive: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, title: true, durationMinutes: true, price: true, priceCurrency: true, hostIds: true, resourceIds: true,
      depositAmount: true, depositPercent: true, depositFreeHours: true },
  })
  const services: PhoneService[] = []
  for (const page of pages) {
    if (services.length >= PHONE_SERVICES_MAX) break
    if (asksDeposit(depositPolicy(page))) continue
    if ((await bookableChairs(organizationId, page)).length === 0) continue
    const title = page.title.replace(/\s+/gu, " ").trim().slice(0, 80)
    if (!title) continue
    services.push({ code: `s${services.length + 1}`, pageId: page.id, title, minutes: page.durationMinutes,
      price: page.price === null ? null : String(page.price), currency: page.priceCurrency ?? null })
  }
  return services
}

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u)
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u)
const findArgs = z.object({ service: z.string().min(1).max(8), date: dateSchema })
const bookArgs = z.object({ service: z.string().min(1).max(8), date: dateSchema, time: timeSchema,
  name: z.string().trim().min(1).max(160), phone: z.string().trim().min(5).max(32).optional() })
const cancelArgs = z.object({ date: dateSchema, time: timeSchema.optional() })

const invalid = (): ToolResult => ({ status: "invalid_request" })
const unavailable = (): ToolResult => ({ status: "unavailable" })

/** A few of the day's times across the whole day, not its first eight: «после обеда» must be among them. */
function sample<T>(items: readonly T[], max: number): T[] {
  if (items.length <= max) return [...items]
  return Array.from({ length: max }, (_, index) => items[Math.round(index * (items.length - 1) / (max - 1))])
}

/** The free days of a service exactly as its public page offers them, or null when the page is gone. */
async function freeDays(ctx: BookingToolContext, pageId: string) {
  const view = await publicBookingView(ctx.organizationId, pageId, ctx.now)
  return view ? { timezone: view.page.timezone, days: view.days } : null
}

async function findFreeTimes(ctx: BookingToolContext, raw: unknown): Promise<ToolResult> {
  const args = findArgs.safeParse(raw)
  const service = args.success ? ctx.services.find((item) => item.code === args.data.service) : undefined
  if (!args.success || !service) return invalid()
  const free = await freeDays(ctx, service.pageId)
  if (!free) return unavailable()
  const times = (day: { slots: { startsAt: string }[] }, max: number) => sample(day.slots, max).map((slot) => clockIn(slot.startsAt, free.timezone))
  const day = free.days.find((item) => item.date === args.data.date)
  if (day) return { date: day.date, weekday: weekdayOf(day.date), times: times(day, TIMES_MAX) }
  // Nothing that day: the nearest day that has something, so one call answers «а когда тогда?».
  const next = free.days.find((item) => item.date > args.data.date) ?? free.days[0]
  return { date: args.data.date, times: [],
    ...(next ? { next: { date: next.date, weekday: weekdayOf(next.date), times: times(next, TIMES_AFTER_TAKEN + 1) } } : {}) }
}

/** The three free times of that day nearest the one asked for; of two equally near, the later: a caller who wanted 11 can rarely come earlier. */
function nearest(slots: readonly { startsAt: string }[], wanted: Date, timezone: string): string[] {
  const away = (slot: { startsAt: string }) => Math.abs(Date.parse(slot.startsAt) - wanted.getTime())
  return [...slots].sort((a, b) => away(a) - away(b) || Date.parse(b.startsAt) - Date.parse(a.startsAt))
    .slice(0, TIMES_AFTER_TAKEN).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)).map((slot) => clockIn(slot.startsAt, timezone))
}

const booked = (date: string, time: string): ToolResult => ({ status: "booked", date, weekday: weekdayOf(date), time })

async function bookAppointment(ctx: BookingToolContext, raw: unknown): Promise<ToolResult> {
  const args = bookArgs.safeParse(raw)
  const service = args.success ? ctx.services.find((item) => item.code === args.data.service) : undefined
  if (!args.success || !service) return invalid()
  // The call's own number; a dictated one only when the caller's is hidden.
  const phone = ctx.callerNumber ?? normalizeLineNumber(args.data.phone)
  if (!phone) return { status: "need_phone" }
  const org = await orgContext(ctx.organizationId)
  let startsAt: Date
  try { startsAt = localDateTimeToUnambiguousUtc(`${args.data.date}T${args.data.time}`, org.timezone) } catch { return invalid() }
  const { date, time } = args.data
  // This number already holds this very time of this service: the answer is the
  // meeting it has, whether the first answer was lost on the way or the model
  // asked again with the name spelt differently. Never a second row.
  const held = () => prisma.booking.findFirst({
    where: { organizationId: ctx.organizationId, bookingPageId: service.pageId, startsAt, phone, status: "confirmed" }, select: { id: true } })
  if (await held()) return booked(date, time)
  const taken = async (): Promise<ToolResult> => {
    const free = await freeDays(ctx, service.pageId).catch(() => null)
    const day = free?.days.find((item) => item.date === date)
    return { status: "taken", date, times: day && free ? nearest(day.slots, startsAt, free.timezone) : [] }
  }
  try {
    const identity = `${ctx.organizationId}:${ctx.callLogId}:${service.pageId}:${startsAt.toISOString()}`
    const result = await createStoredBooking(ctx.organizationId, service.pageId, {
      locale: "az",
      // One command per call, service and time: the same request again replays its receipt.
      idempotencyKey: `phone-call:${ctx.callLogId}:${service.pageId}:${startsAt.toISOString()}`,
      recoverySecret: hmacToken(identity, "booking-phone-call"),
      startsAt: startsAt.toISOString(), name: args.data.name, phone,
      phoneCall: { callLogId: ctx.callLogId },
    }, ctx.now)
    if (result.ok) return booked(date, time)
    return result.reason === "taken" ? taken() : unavailable()
  } catch (error) {
    if (error instanceof IdempotencyConflictError) return (await held()) ? booked(date, time) : unavailable()
    if (error instanceof BookingCommandError) {
      if (error.code === "AVAILABILITY_CHANGED" || error.code === "SLOT_TAKEN") return (await held()) ? booked(date, time) : taken()
      // A host's calendar that cannot be read blocks the booking, as on the public page.
      return unavailable()
    }
    throw error
  }
}

async function cancelAppointment(ctx: BookingToolContext, raw: unknown): Promise<ToolResult> {
  const args = cancelArgs.safeParse(raw)
  if (!args.success) return invalid()
  // Nothing identifies a caller with a hidden number: the administrator cancels for them.
  if (!ctx.callerNumber) return { status: "none" }
  const org = await orgContext(ctx.organizationId)
  const upcoming = await prisma.booking.findMany({
    where: { organizationId: ctx.organizationId, status: "confirmed", startsAt: { gt: ctx.now } },
    orderBy: { startsAt: "asc" }, take: 2000,
    select: { id: true, phone: true, startsAt: true, bookingPage: { select: { title: true } } },
  })
  const mine = upcoming.filter((row) => normalizeLineNumber(row.phone) === ctx.callerNumber)
    .map((row) => ({ id: row.id, date: dateInputValueInTimezone(row.startsAt, org.timezone), time: clockIn(row.startsAt, org.timezone), service: row.bookingPage.title }))
    .filter((row) => row.date === args.data.date && (!args.data.time || row.time === args.data.time))
  if (mine.length === 0) return { status: "none" }
  if (mine.length > 1) return { status: "several", appointments: mine.slice(0, 4).map(({ date, time, service }) => ({ date, time, service: service.slice(0, 60) })) }
  const outcome = await cancelStoredBooking(ctx.organizationId, mine[0].id)
  return outcome === "cancelled" || outcome === "already" ? { status: "cancelled", date: mine[0].date, time: mine[0].time } : { status: "none" }
}

/** One tool call of a booking call. Throws only on what is not the caller's doing (the database). */
export async function runBookingTool(ctx: BookingToolContext, name: string, args: unknown): Promise<ToolResult> {
  if (name === FIND_TOOL) return findFreeTimes(ctx, args)
  if (name === BOOK_TOOL) return bookAppointment(ctx, args)
  if (name === CANCEL_TOOL) return cancelAppointment(ctx, args)
  return invalid()
}
