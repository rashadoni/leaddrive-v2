import { connectedCalendarsOf } from "@/lib/calendar/accounts"
import { connectedCalendarKey } from "@/lib/calendar/providers"
import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import type { Prisma } from "@prisma/client"
import { preloadTenantDataKeys } from "@/lib/crypto/tenant-data-keys"
import { bookingDb as prisma } from "./db"
import { hashCanonicalJson } from "@/lib/event-platform/canonical-json"
import { findCommandReceipt, storeCommandReceipt } from "@/lib/event-platform/command-receipt"
import { encryptForTenantBound, decryptForTenantBound } from "@/lib/crypto/tenant-pii-encryption"
import { appendBookingEvent } from "./events"
import { queueBookingEffects } from "./integration-intents"
import { assertBookingInterval, bookingRules } from "./commands"
import { BookingCommandError } from "./command-error"
import { computeSlots, findSlot } from "./availability"
import { hostService } from "./host-variants"
import { isGroupService, serviceCapacity } from "./group-service"
import { asksDeposit, depositDue, depositPolicy } from "./deposit"
import { addOnTotals, parseAddOns, selectedAddOns } from "./add-ons"
import { activeHosts, orgContext, loadBusyByHost, bookingCancelUrl, hashBookingToken, type BookingInput, type CreateBookingResult } from "./book"
import { bookingHostWhere, bookingScope } from "./access"
import type { BookingAccess } from "./access"

const digest = (value: string) => createHash("sha256").update(value).digest("hex")

/**
 * The picked customer, proven to belong to this organization. RLS already
 * scopes the read, and the explicit organizationId keeps the check honest if
 * this is ever called outside a tenant scope.
 */
async function resolveBookingClient(orgId: string, client: BookingInput["client"]) {
  if (!client) return null
  const row = client.type === "contact"
    ? await prisma.contact.findFirst({ where: { id: client.id, organizationId: orgId }, select: { id: true } })
    : await prisma.lead.findFirst({ where: { id: client.id, organizationId: orgId }, select: { id: true } })
  if (!row) throw new BookingCommandError("CLIENT_NOT_FOUND", 404)
  return { type: client.type, id: row.id }
}

export async function createStoredBooking(orgId: string, pageId: string, input: BookingInput, now: Date, access?: BookingAccess): Promise<CreateBookingResult> {
  if (!input.idempotencyKey || !input.recoverySecret) throw new BookingCommandError("REQUEST_IDENTITY_REQUIRED", 400)
  const identity = {
    organizationId: orgId, commandType: "booking.create",
    idempotencyKey: hashCanonicalJson({ orgId, pageId, principal: access?.userId ?? "public", key: input.idempotencyKey }),
    // The customer link is only in the hash when there is one, so every request
    // that carries none hashes byte for byte as it did before links existed —
    // a retry started before this shipped still replays instead of conflicting.
    requestHash: hashCanonicalJson({ pageId, startsAt: input.startsAt, name: input.name, phone: input.phone, email: input.email || null, note: input.note || null, hostUserId: input.hostUserId || null, ...(input.client ? { client: `${input.client.type}:${input.client.id}` } : {}) }),
  }
  const secretId = `booking_${identity.idempotencyKey}`
  async function replay(db: Prisma.TransactionClient | typeof prisma) {
    const receipt = await findCommandReceipt(db, identity)
    if (!receipt) return null
    if (access) {
      const storedId = (receipt.responseBody as { id?: unknown })?.id
      const visible = typeof storedId === "string" ? await db.booking.findFirst({ where: { AND: [bookingScope(access, true), { id: storedId }] }, select: { hostUserId: true } }) : null
      if (!visible || !access.administrator && visible.hostUserId !== access.userId && !await db.bookingCoordinatorGrant.findFirst({ where: { organizationId: orgId, coordinatorUserId: access.userId, hostUserId: visible.hostUserId, canManage: true }, select: { id: true } })) throw new BookingCommandError("NOT_FOUND", 404)
    }
    const secret = await db.bookingSecret.findFirst({ where: { id: secretId, organizationId: orgId } })
    const supplied = Buffer.from(digest(input.recoverySecret!), "hex")
    const expected = Buffer.from(secret?.recoveryHash ?? "00".repeat(32), "hex")
    if (!secret || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new BookingCommandError("INVALID_RECOVERY", 403)
    if (!secret.responseCipher || secret.responseExpiresAt <= new Date()) throw new BookingCommandError("CONFIRMATION_EXPIRED", 410)
    return JSON.parse(decryptForTenantBound(orgId, "booking_secrets", `${secretId}:response`, secret.responseCipher)) as CreateBookingResult
  }
  await preloadTenantDataKeys(orgId)
  const existing = await replay(prisma)
  if (existing) return existing
  // The customer this meeting is for, when a member of staff picked one the
  // CRM already has. Only a staff booking carries it — the public form has no
  // such field — and an id this organization does not own is refused rather
  // than dropped: a link silently lost reads on screen as a link made.
  const client = access ? await resolveBookingClient(orgId, input.client) : null
  const page = await prisma.bookingPage.findFirst({ where: { id: pageId, organizationId: orgId, isActive: true } })
  if (!page) return { ok: false, reason: "not_found" }
  const org = await orgContext(orgId)
  const hosts = await activeHosts(orgId, page.hostIds)
  const permitted = hosts.filter((host) => (!input.hostUserId || host.id === input.hostUserId) && (!access || access.writableHostIds === null || access.writableHostIds.includes(host.id)))
  if (!permitted.length) return { ok: false, reason: "taken" }
  // A master who takes longer over this service is offered their own times,
  // not the service's. With nobody named, the service's own duration stands —
  // exactly as before this existed.
  const chosenHostId = input.hostUserId && page.hostIds.includes(input.hostUserId) ? input.hostUserId : null
  // The extras are taken from the service, never from the request: an id the
  // service does not offer adds neither minutes nor money.
  const visitOf = (row: typeof page, hostId: string | null) => {
    const base = hostId
      ? hostService({ price: row.price === null ? null : String(row.price), durationMinutes: row.durationMinutes, hostVariants: row.hostVariants }, hostId)
      : { price: row.price === null ? null : String(row.price), durationMinutes: row.durationMinutes }
    const chosen = selectedAddOns(parseAddOns(row.addOns), input.addOnIds ?? [])
    return { ...addOnTotals(base, chosen), addOns: chosen }
  }
  const rules = { ...bookingRules(page, org.timezone, org.closedDates), durationMinutes: visitOf(page, chosenHostId).durationMinutes }
  const from = now, to = new Date(now.getTime() + (page.maxDaysAhead + 2) * 86400_000)
  const checkedAt = Date.now()
  // A customer-facing booking respects the holds of other conversations; a
  // staff one does not (see BusyOptions).
  // A class does not block itself: its seats share the hour, and whether one
  // is left is counted in the transaction below.
  const group = isGroupService(page)
  const busy = await loadBusyByHost(orgId, permitted.map((host) => host.id), from, to, org.timezone, {
    ...(access ? {} : { holds: { exceptConversationId: input.whatsapp?.conversationId ?? null } }),
    ...(group ? { exceptBookingPageId: pageId } : {}),
  })
  const slot = findSlot(computeSlots({ rules, hostIds: permitted.map((host) => host.id), busyByHost: busy, now }), input.startsAt)
  if (!slot) {
    if (busy.unavailableHostIds.size) throw new BookingCommandError("CALENDAR_UNAVAILABLE", 503)
    return { ok: false, reason: "taken" }
  }
  const calendarKeys = busy.calendarKeys
  const load = await prisma.booking.groupBy({ by: ["hostUserId"], where: { organizationId: orgId, hostUserId: { in: slot.hostIds }, status: "confirmed", startsAt: { gte: now } }, _count: { _all: true } })
  const count = (id: string) => load.find((row) => row.hostUserId === id)?._count._all ?? 0
  const candidates = [...slot.hostIds].sort((a, b) => count(a) - count(b) || page.hostIds.indexOf(a) - page.hostIds.indexOf(b))
  const token = randomBytes(24).toString("base64url")
  const startsAt = new Date(slot.startsAt), endsAt = new Date(slot.endsAt)
  for (const hostId of candidates) {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`booking-command:${orgId}:booking.create:${identity.idempotencyKey}`}))`
        const prior = await replay(tx)
        if (prior) return prior
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`booking-page:${orgId}:${pageId}`}))`
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`booking:${orgId}:${hostId}`}))`
        const currentPage = await tx.bookingPage.findFirst({ where: { id: pageId, organizationId: orgId, isActive: true } })
        const host = await tx.user.findFirst({ where: bookingHostWhere(orgId, [hostId]) })
        const connected = await connectedCalendarsOf(tx, hostId)
        if (!currentPage || currentPage.version !== page.version || !currentPage.hostIds.includes(hostId) || Date.now() - checkedAt > 15000 || connectedCalendarKey(connected) !== (calendarKeys.get(hostId) ?? "")) throw new BookingCommandError("AVAILABILITY_CHANGED")
        if (!host) throw new BookingCommandError("SLOT_TAKEN")
        if (group) {
          // One class, one master: the seats of a class that already started
          // selling belong to whoever is giving it.
          const seats = await tx.booking.findMany({
            where: { organizationId: orgId, bookingPageId: pageId, startsAt, status: "confirmed" },
            select: { hostUserId: true },
          })
          if (seats.length >= serviceCapacity(currentPage)) return { ok: false, reason: "taken" } as CreateBookingResult
          if (seats.length > 0 && seats[0].hostUserId !== hostId) throw new BookingCommandError("SLOT_TAKEN")
        }
        if (access && !access.administrator && hostId !== access.userId && !await tx.bookingCoordinatorGrant.findFirst({ where: { organizationId: orgId, coordinatorUserId: access.userId, hostUserId: hostId, canManage: true } })) throw new BookingCommandError("FORBIDDEN", 403)
        await assertBookingInterval(tx, orgId, hostId, startsAt, endsAt, currentPage.bufferMinutes, undefined, group ? pageId : undefined)
        // What this visit must leave, as the customer was shown it: the share
        // is taken of the price with this master's rate and the extras on it.
        const policy = depositPolicy(currentPage)
        const deposit = asksDeposit(policy) ? depositDue(policy, visitOf(currentPage, hostId).price) : null
        let row = await tx.booking.create({ data: {
          organizationId: orgId, bookingPageId: pageId, hostUserId: hostId, startsAt, endsAt,
          depositAmount: deposit === null ? null : deposit,
          depositStatus: deposit === null ? null : "awaiting",
          name: input.name, phone: input.phone, email: input.email || null, note: input.note || null,
          // Linked here, at creation: the effect worker files a lead only for a
          // meeting that has neither, so this is what stops the same customer
          // becoming a new lead on every visit.
          leadId: client?.type === "lead" ? client.id : null,
          contactId: client?.type === "contact" ? client.id : null,
          cancelTokenHash: hashBookingToken(token), secretId,
          source: access ? "staff" : input.whatsapp ? "whatsapp" : "public_link", createdBy: access?.userId ?? null,
          bufferBefore: currentPage.bufferMinutes, bufferAfter: currentPage.bufferMinutes,
          snapshot: { orgName: org.name, description: currentPage.description, locale: input.locale ?? "az", slug: currentPage.slug, title: currentPage.title, locationType: currentPage.locationType, locationText: currentPage.locationText, timezone: org.timezone, legacyDerived: false,
            // The price as it stood when the client agreed to it, for the master
            // who is taking them: a salon that raises a service tomorrow, or
            // charges differently per master, must not rewrite what yesterday
            // cost.
            price: visitOf(currentPage, hostId).price, priceCurrency: currentPage.priceCurrency, repeatCycleDays: currentPage.repeatCycleDays,
            // What the customer actually took, by name and price as they stood
            // that day: renaming an extra later must not rewrite this visit.
            addOns: visitOf(currentPage, hostId).addOns },
          adAttribution: input.attribution ? input.attribution as Prisma.InputJsonValue : undefined,
        } })
        const event = await appendBookingEvent(tx, row, "created", access?.userId ?? null)
        row = await tx.booking.update({ where: { id: row.id }, data: { version: event.version } })
        const result: CreateBookingResult = { ok: true, booking: { id: row.id, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), hostName: host.name, cancelUrl: bookingCancelUrl(token) } }
        await tx.bookingSecret.create({ data: { id: secretId, organizationId: orgId, recoveryHash: digest(input.recoverySecret!), responseExpiresAt: new Date(Date.now() + 86400_000), responseCipher: encryptForTenantBound(orgId, "booking_secrets", `${secretId}:response`, JSON.stringify(result)), deliveryCipher: encryptForTenantBound(orgId, "booking_secrets", `${secretId}:delivery`, JSON.stringify({ cancelUrl: result.booking.cancelUrl })) } })
        await queueBookingEffects(tx, row, event.eventId, { customerNotice: true, secretId })
        await storeCommandReceipt(tx, { ...identity, responseStatus: 201, responseBody: { id: row.id, secretId }, eventIds: [event.eventId] })
        return result
      })
    } catch (error) {
      if (error instanceof BookingCommandError && error.code === "SLOT_TAKEN") continue
      throw error
    }
  }
  return { ok: false, reason: "taken" }
}
