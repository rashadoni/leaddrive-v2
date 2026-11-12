import { connectedCalendarsOf } from "@/lib/calendar/accounts"
import { connectedCalendarKey } from "@/lib/calendar/providers"
import type { Prisma } from "@prisma/client"
import { z } from "zod"
import { bookingDb as prisma } from "./db"
import { hashCanonicalJson } from "@/lib/event-platform/canonical-json"
import { findCommandReceipt, storeCommandReceipt } from "@/lib/event-platform/command-receipt"
import { organizationTimezone } from "@/lib/ticketing/customer-locale"
import { BookingCommandError } from "./command-error"
import { bookingHostWhere } from "./access"
import type { BookingAccess } from "./access"
import { computeSlots, defaultWeeklyHours, findSlot, parseWeeklyHours, type BookingRules } from "./availability"
import { readClosedDates } from "./closed-dates"
import { depositAfterCancel, depositPolicy, depositTransition } from "./deposit"
import { bookingCalendarBusy } from "./calendar-busy"
import { appendBookingEvent, ensureBookingBaseline, type BookingEvent } from "./events"
import { queueBookingEffects, ensureLegacyBinding } from "./integration-intents"

export const bookingCommandInput = z.object({
  operation: z.enum(["cancel", "reschedule", "outcome", "deposit"]),
  version: z.number().int().nonnegative(),
  idempotencyKey: z.string().min(16).max(100).regex(/^[a-zA-Z0-9_-]+$/),
  startsAt: z.string().datetime({ offset: true }).optional(),
  hostUserId: z.string().min(1).max(64).optional(),
  outcome: z.enum(["completed", "no_show"]).optional(),
  /** «The money arrived» / «we sent it back» — see the deposit branch below. */
  deposit: z.enum(["paid", "refunded"]).optional(),
  note: z.string().trim().max(2000).default(""),
  reason: z.string().trim().max(500).default(""),
  notifyCustomer: z.boolean().default(true),
}).strict()
export type BookingCommandInput = z.infer<typeof bookingCommandInput>

async function permitted(tx: Prisma.TransactionClient, access: BookingAccess, hostId: string) {
  if (access.administrator || hostId === access.userId) return true
  return Boolean(await tx.bookingCoordinatorGrant.findFirst({ where: { organizationId: access.orgId, coordinatorUserId: access.userId, hostUserId: hostId, canManage: true }, select: { id: true } }))
}

export function bookingRules(page: { durationMinutes: number; bufferMinutes: number; minNoticeMinutes: number; maxDaysAhead: number; weekly: unknown }, timezone: string, closedDates: readonly string[] = []): BookingRules {
  return { timezone, durationMinutes: page.durationMinutes, bufferMinutes: page.bufferMinutes, minNoticeMinutes: page.minNoticeMinutes, maxDaysAhead: page.maxDaysAhead, weekly: parseWeeklyHours(page.weekly) ?? defaultWeeklyHours(), closedDates }
}

export async function runBookingCommand(access: BookingAccess, id: string, input: BookingCommandInput) {
  const initial = await prisma.booking.findFirst({ where: { id, organizationId: access.orgId } })
  if (!initial || access.hostIds !== null && !access.hostIds.includes(initial.hostUserId)) throw new BookingCommandError("NOT_FOUND", 404)
  const page = await prisma.bookingPage.findFirst({ where: { id: initial.bookingPageId, organizationId: access.orgId } })
  if (!page) throw new BookingCommandError("NOT_FOUND", 404)
  const hostId = input.hostUserId ?? initial.hostUserId
  if (access.writableHostIds !== null && (!access.writableHostIds.includes(initial.hostUserId) || input.operation === "reschedule" && !access.writableHostIds.includes(hostId))) throw new BookingCommandError("FORBIDDEN", 403)
  const identity = {
    organizationId: access.orgId, commandType: `booking.${input.operation}`,
    idempotencyKey: hashCanonicalJson({ principal: access.userId, bookingId: id, key: input.idempotencyKey }),
    requestHash: hashCanonicalJson(JSON.parse(JSON.stringify(input))),
  }
  // Replay is authorized before it bypasses the external calendar. Fresh grants are checked again in the transaction.
  const prior = await findCommandReceipt(prisma, identity)
  if (prior) return prior.responseBody as { id: string; version: number }
  const org = await prisma.organization.findUnique({ where: { id: access.orgId }, select: { settings: true } })
  const timezone = organizationTimezone(org?.settings) || "Asia/Baku"
  // A day the salon is closed is closed for a move too, not only for a new booking.
  const closedDates = readClosedDates(org?.settings).map((entry) => entry.date)
  let preflight: Awaited<ReturnType<typeof bookingCalendarBusy>> | null = null
  if (input.operation === "reschedule") {
    if (!input.startsAt) throw new BookingCommandError("INVALID_INPUT", 400)
    if (!page.hostIds.includes(hostId) || !await prisma.user.findFirst({ where: bookingHostWhere(access.orgId, [hostId]), select: { id: true } })) throw new BookingCommandError("INVALID_HOST", 400)
    const start = new Date(input.startsAt)
    preflight = await bookingCalendarBusy(access.orgId, hostId, new Date(start.getTime() - 4 * 3600_000), new Date(start.getTime() + (page.durationMinutes + 240) * 60_000), id)
  }
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`booking-command:${access.orgId}:${identity.commandType}:${identity.idempotencyKey}`}))`
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`booking-page:${access.orgId}:${page.id}`}))`
    for (const host of [...new Set([initial.hostUserId, hostId])].sort()) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`booking:${access.orgId}:${host}`}))`
    await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${id} AND "organizationId" = ${access.orgId} FOR UPDATE`
    let row = await tx.booking.findFirst({ where: { id, organizationId: access.orgId } })
    if (!row || !await permitted(tx, access, row.hostUserId)) throw new BookingCommandError("NOT_FOUND", 404)
    if (input.operation === "reschedule" && !await permitted(tx, access, hostId)) throw new BookingCommandError("FORBIDDEN", 403)
    const receipt = await findCommandReceipt(tx, identity)
    if (receipt) return receipt.responseBody as { id: string; version: number }
    if (row.version !== input.version || row.hostUserId !== initial.hostUserId) throw new BookingCommandError("VERSION_CONFLICT")
    const now = new Date()
    let change: Prisma.BookingUpdateInput
    let type: BookingEvent
    if (input.operation === "cancel") {
      if (row.status === "cancelled") return { id, version: row.version }
      if (row.status !== "confirmed" || row.startsAt <= now) throw new BookingCommandError("INVALID_STATE")
      // Cancel in time and a paid deposit is owed back; cancel late, or never
      // turn up, and it is kept. Money is not sent anywhere from here — the
      // visit only says what is owed, and a person pays it.
      const depositStatus = depositAfterCancel(row, depositPolicy(page).freeHours, now)
      change = {
        status: "cancelled", cancelledAt: now, cancellationReason: input.reason || null,
        ...(depositStatus ? { depositStatus } : {}),
      }
      type = "cancelled"
    } else if (input.operation === "outcome") {
      if (!input.outcome || row.status === "cancelled" || row.endsAt > now) throw new BookingCommandError("INVALID_STATE")
      if (row.status !== "confirmed") {
        const coordinator = access.administrator || await tx.bookingCoordinatorGrant.findFirst({ where: { organizationId: access.orgId, coordinatorUserId: access.userId, hostUserId: row.hostUserId, canManage: true } })
        if (!coordinator || !input.reason) throw new BookingCommandError("CORRECTION_REQUIRES_REASON", 403)
      }
      change = { status: input.outcome, outcomeNote: input.note || null }; type = row.status === "confirmed" ? input.outcome : "outcome_corrected"
    } else if (input.operation === "deposit") {
      // The deposit is money, so the card may only say what actually happened
      // to it: «received» from awaiting, «sent back» from a refund the salon
      // owes. Everything else is refused rather than rewritten — including a
      // second press of the same button. A cancelled visit is on purpose still
      // open to this: owing the money back is exactly what cancelling left.
      if (!input.deposit) throw new BookingCommandError("INVALID_INPUT", 400)
      const next = depositTransition(row.depositStatus, input.deposit)
      if (!next) throw new BookingCommandError("INVALID_STATE")
      change = { depositStatus: next, ...(next === "paid" ? { depositPaidAt: now } : {}) }
      type = next === "paid" ? "deposit_paid" : "deposit_refunded"
    } else {
      if (row.status !== "confirmed" || row.startsAt <= now || !preflight || !input.startsAt) throw new BookingCommandError("INVALID_STATE")
      const currentPage = await tx.bookingPage.findFirst({ where: { id: page.id, organizationId: access.orgId } })
      // A meeting on a room moves on that room's own time, not on the time of
      // the master who owns it in the record (src/lib/booking/book.ts).
      const chairId = row.resourceId ?? hostId
      const onResource = Boolean(row.resourceId)
      const currentHost = await tx.user.findFirst({ where: bookingHostWhere(access.orgId, [hostId]), select: { id: true } })
      const connected = onResource ? [] : await connectedCalendarsOf(tx, hostId)
      if (!currentPage || currentPage.version !== page.version || Date.now() - preflight.checkedAt > 15000 || (!onResource && connectedCalendarKey(connected) !== preflight.accountKey)) throw new BookingCommandError("AVAILABILITY_CHANGED")
      if (onResource ? !currentPage.resourceIds.includes(chairId) : (!currentHost || !currentPage.hostIds.includes(hostId))) throw new BookingCommandError("INVALID_HOST", 400)
      const rules = bookingRules(currentPage, timezone, closedDates)
      if (!findSlot(computeSlots({ rules, hostIds: [chairId], busyByHost: new Map([[chairId, preflight.intervals]]), now }), input.startsAt)) throw new BookingCommandError("SLOT_TAKEN")
      const startsAt = new Date(input.startsAt), endsAt = new Date(startsAt.getTime() + currentPage.durationMinutes * 60_000)
      await assertBookingInterval(tx, access.orgId, chairId, startsAt, endsAt, currentPage.bufferMinutes, id, undefined, onResource)
      change = { startsAt, endsAt, hostUser: { connect: { organizationId_id: { organizationId: access.orgId, id: hostId } } }, bufferBefore: currentPage.bufferMinutes, bufferAfter: currentPage.bufferMinutes }
      type = "rescheduled"
    }
    await ensureLegacyBinding(tx, row)
    row = await ensureBookingBaseline(tx, row)
    row = await tx.booking.update({ where: { id }, data: change })
    const event = await appendBookingEvent(tx, row, type, access.userId === "customer" ? null : access.userId)
    row = await tx.booking.update({ where: { id }, data: { version: event.version } })
    if (input.reason || input.operation === "outcome" && input.note) await tx.bookingChangeNote.create({ data: { eventId: event.eventId, organizationId: access.orgId, bookingId: id, data: { reason: input.reason, note: input.operation === "outcome" ? input.note : "" } } })
    // The deposit changes no time, no master and no place, so it sends no
    // effects: the calendar has nothing new to hold, and a confirmation email
    // saying «подтверждено» for the third time is how a salon teaches its
    // clients to ignore its mail. The ledger event above is the record.
    // A move starts the reminders over: the marks say «this meeting has been
    // reminded», not «this hour has», so without clearing them a client who
    // already had the day-before reminder for Tuesday gets none for Thursday
    // and turns up on Tuesday. Their «I am coming» was about the old hour too.
    if (type === "rescheduled") await tx.bookingReminder.deleteMany({ where: { organizationId: access.orgId, bookingId: id } })
    if (input.operation !== "deposit") await queueBookingEffects(tx, row, event.eventId, {
      customerNotice: input.notifyCustomer, secretId: row.secretId ?? undefined,
      // …but never back at the client who did it themselves: a cancellation
      // from their own link, or from the «Ləğv etmək» button on a reminder,
      // is already answered in that conversation. Telling them again that
      // their visit is off reads as a second, different cancellation — and
      // when the agent moves a visit it cancels the old one, so the client
      // would hear «booked» and «cancelled» in the same breath.
      customerChange: input.notifyCustomer && access.userId !== "customer" && (type === "cancelled" || type === "rescheduled"),
    })
    const result = { id, version: row.version }
    await storeCommandReceipt(tx, { ...identity, responseStatus: 200, responseBody: result, eventIds: [event.eventId] })
    return result
  })
}

/** Both old and new buffers matter; host advisory locks must be held by the caller. */
/**
 * `sameClassPageId` is the one exception: the other seats of the very same
 * class, at the very same instant. They are not a clash — they are the class.
 * Everything else this host has that hour still is.
 */
/**
 * Nobody is in two places at once — and neither is a room.
 *
 * `resource` says which column holds the chair: a master's meetings are their
 * own (`hostUserId`), a room's are the room's (`resourceId`). A room booking
 * also carries a host for the record, so asking by host alone would find
 * clashes that are not clashes and miss the ones that are.
 */
export async function assertBookingInterval(tx: Prisma.TransactionClient, orgId: string, hostId: string, start: Date, end: Date, buffer: number, exceptId?: string, sameClassPageId?: string, resource = false) {
  const clashes = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM bookings WHERE "organizationId" = ${orgId}
    AND (${resource}::boolean AND "resourceId" = ${hostId} OR NOT ${resource}::boolean AND "hostUserId" = ${hostId} AND "resourceId" IS NULL)
    AND status = 'confirmed'
    AND (${exceptId ?? null}::text IS NULL OR id <> ${exceptId ?? null})
    AND NOT (${sameClassPageId ?? null}::text IS NOT NULL AND "bookingPageId" = ${sameClassPageId ?? null} AND "startsAt" = ${start})
    AND "startsAt" < ${new Date(end.getTime() + 240 * 60_000)} AND "endsAt" > ${new Date(start.getTime() - 240 * 60_000)}
    AND "startsAt" < ${end} + (GREATEST("bufferBefore", ${buffer}) * INTERVAL '1 minute')
    AND "endsAt" > ${start} - (GREATEST("bufferAfter", ${buffer}) * INTERVAL '1 minute') LIMIT 1
  `
  if (clashes.length) throw new BookingCommandError("SLOT_TAKEN")
}

/** Public cancellation keeps its existing capability and never depends on calendar availability. */
export async function cancelStoredBooking(orgId: string, id: string): Promise<"cancelled" | "already" | "past" | "not_found"> {
  const row = await prisma.booking.findFirst({ where: { organizationId: orgId, id } })
  if (!row) return "not_found"
  if (row.status === "cancelled") return "already"
  if (row.startsAt <= new Date() || row.status !== "confirmed") return "past"
  const access: BookingAccess = { orgId, userId: "customer", administrator: true, hostIds: null, writableHostIds: null, phoneRestricted: false }
  try {
    await runBookingCommand(access, id, { operation: "cancel", version: row.version, idempotencyKey: `cancel_${row.cancelTokenHash}`, note: "", reason: "", notifyCustomer: true })
    return "cancelled"
  } catch (error) {
    if (error instanceof BookingCommandError && error.code === "VERSION_CONFLICT") {
      const fresh = await prisma.booking.findFirst({ where: { organizationId: orgId, id } })
      if (fresh?.status === "cancelled") return "already"
    }
    throw error
  }
}
