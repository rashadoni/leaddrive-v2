import type { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { hashCanonicalJson } from "@/lib/event-platform/canonical-json"
import { findCommandReceipt, storeCommandReceipt } from "@/lib/event-platform/command-receipt"
import { organizationTimezone } from "@/lib/ticketing/customer-locale"
import { BookingCommandError } from "./command-error"
import { bookingHostWhere } from "./access"
import type { BookingAccess } from "./access"
import { computeSlots, defaultWeeklyHours, findSlot, parseWeeklyHours, type BookingRules } from "./availability"
import { bookingCalendarBusy } from "./calendar-busy"
import { appendBookingEvent, ensureBookingBaseline, type BookingEvent } from "./events"
import { queueBookingEffects, ensureLegacyBinding } from "./integration-intents"

export const bookingCommandInput = z.object({
  operation: z.enum(["cancel", "reschedule", "outcome"]),
  version: z.number().int().nonnegative(),
  idempotencyKey: z.string().min(16).max(100).regex(/^[a-zA-Z0-9_-]+$/),
  startsAt: z.string().datetime({ offset: true }).optional(),
  hostUserId: z.string().min(1).max(64).optional(),
  outcome: z.enum(["completed", "no_show"]).optional(),
  note: z.string().trim().max(2000).default(""),
  reason: z.string().trim().max(500).default(""),
  notifyCustomer: z.boolean().default(true),
}).strict()
export type BookingCommandInput = z.infer<typeof bookingCommandInput>

async function permitted(tx: Prisma.TransactionClient, access: BookingAccess, hostId: string) {
  if (access.administrator || hostId === access.userId) return true
  return Boolean(await tx.bookingCoordinatorGrant.findFirst({ where: { organizationId: access.orgId, coordinatorUserId: access.userId, hostUserId: hostId, canManage: true }, select: { id: true } }))
}

export function bookingRules(page: { durationMinutes: number; bufferMinutes: number; minNoticeMinutes: number; maxDaysAhead: number; weekly: unknown }, timezone: string): BookingRules {
  return { timezone, durationMinutes: page.durationMinutes, bufferMinutes: page.bufferMinutes, minNoticeMinutes: page.minNoticeMinutes, maxDaysAhead: page.maxDaysAhead, weekly: parseWeeklyHours(page.weekly) ?? defaultWeeklyHours() }
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
      change = { status: "cancelled", cancelledAt: now, cancellationReason: input.reason || null }; type = "cancelled"
    } else if (input.operation === "outcome") {
      if (!input.outcome || row.status === "cancelled" || row.endsAt > now) throw new BookingCommandError("INVALID_STATE")
      if (row.status !== "confirmed") {
        const coordinator = access.administrator || await tx.bookingCoordinatorGrant.findFirst({ where: { organizationId: access.orgId, coordinatorUserId: access.userId, hostUserId: row.hostUserId, canManage: true } })
        if (!coordinator || !input.reason) throw new BookingCommandError("CORRECTION_REQUIRES_REASON", 403)
      }
      change = { status: input.outcome, outcomeNote: input.note || null }; type = row.status === "confirmed" ? input.outcome : "outcome_corrected"
    } else {
      if (row.status !== "confirmed" || row.startsAt <= now || !preflight || !input.startsAt) throw new BookingCommandError("INVALID_STATE")
      const currentPage = await tx.bookingPage.findFirst({ where: { id: page.id, organizationId: access.orgId } })
      const currentHost = await tx.user.findFirst({ where: bookingHostWhere(access.orgId, [hostId]), select: { id: true } })
      const account = await tx.account.findFirst({ where: { userId: hostId, provider: { in: ["google-calendar", "google"] } }, select: { id: true }, orderBy: { provider: "desc" } })
      if (!currentPage || currentPage.version !== page.version || Date.now() - preflight.checkedAt > 15000 || account?.id !== (preflight.accountId ?? undefined)) throw new BookingCommandError("AVAILABILITY_CHANGED")
      if (!currentHost || !currentPage.hostIds.includes(hostId)) throw new BookingCommandError("INVALID_HOST", 400)
      const rules = bookingRules(currentPage, timezone)
      if (!findSlot(computeSlots({ rules, hostIds: [hostId], busyByHost: new Map([[hostId, preflight.intervals]]), now }), input.startsAt)) throw new BookingCommandError("SLOT_TAKEN")
      const startsAt = new Date(input.startsAt), endsAt = new Date(startsAt.getTime() + currentPage.durationMinutes * 60_000)
      await assertBookingInterval(tx, access.orgId, hostId, startsAt, endsAt, currentPage.bufferMinutes, id)
      change = { startsAt, endsAt, hostUserId: hostId, bufferBefore: currentPage.bufferMinutes, bufferAfter: currentPage.bufferMinutes }
      type = "rescheduled"
    }
    await ensureLegacyBinding(tx, row)
    row = await ensureBookingBaseline(tx, row)
    row = await tx.booking.update({ where: { id }, data: change })
    const event = await appendBookingEvent(tx, row, type, access.userId === "customer" ? null : access.userId)
    row = await tx.booking.update({ where: { id }, data: { version: event.version } })
    if (input.reason || input.operation === "outcome" && input.note) await tx.bookingChangeNote.create({ data: { eventId: event.eventId, organizationId: access.orgId, bookingId: id, data: { reason: input.reason, note: input.operation === "outcome" ? input.note : "" } } })
    await queueBookingEffects(tx, row, event.eventId, { customerNotice: input.notifyCustomer, secretId: row.secretId ?? undefined })
    const result = { id, version: row.version }
    await storeCommandReceipt(tx, { ...identity, responseStatus: 200, responseBody: result, eventIds: [event.eventId] })
    return result
  })
}

/** Both old and new buffers matter; host advisory locks must be held by the caller. */
export async function assertBookingInterval(tx: Prisma.TransactionClient, orgId: string, hostId: string, start: Date, end: Date, buffer: number, exceptId?: string) {
  const clashes = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM bookings WHERE "organizationId" = ${orgId} AND "hostUserId" = ${hostId} AND status = 'confirmed'
    AND (${exceptId ?? null}::text IS NULL OR id <> ${exceptId ?? null})
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
