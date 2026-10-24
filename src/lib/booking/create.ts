import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import type { Prisma } from "@prisma/client"
import { preloadTenantDataKeys } from "@/lib/crypto/tenant-data-keys"
import { prisma } from "@/lib/prisma"
import { hashCanonicalJson } from "@/lib/event-platform/canonical-json"
import { findCommandReceipt, storeCommandReceipt } from "@/lib/event-platform/command-receipt"
import { encryptForTenantBound, decryptForTenantBound } from "@/lib/crypto/tenant-pii-encryption"
import { appendBookingEvent } from "./events"
import { queueBookingEffects } from "./integration-intents"
import { assertBookingInterval, bookingRules } from "./commands"
import { BookingCommandError } from "./command-error"
import { computeSlots, findSlot } from "./availability"
import { activeHosts, orgContext, loadBusyByHost, bookingCancelUrl, hashBookingToken, type BookingInput, type CreateBookingResult } from "./book"
import { bookingHostWhere } from "./access"
import type { BookingAccess } from "./access"

const digest = (value: string) => createHash("sha256").update(value).digest("hex")

export async function createStoredBooking(orgId: string, pageId: string, input: BookingInput, now: Date, access?: BookingAccess): Promise<CreateBookingResult> {
  if (!input.idempotencyKey || !input.recoverySecret) throw new BookingCommandError("REQUEST_IDENTITY_REQUIRED", 400)
  const identity = {
    organizationId: orgId, commandType: "booking.create",
    idempotencyKey: hashCanonicalJson({ orgId, pageId, principal: access?.userId ?? "public", key: input.idempotencyKey }),
    requestHash: hashCanonicalJson({ pageId, startsAt: input.startsAt, name: input.name, phone: input.phone, email: input.email || null, note: input.note || null, hostUserId: input.hostUserId || null }),
  }
  const secretId = `booking_${identity.idempotencyKey}`
  async function replay(db: Prisma.TransactionClient | typeof prisma) {
    const receipt = await findCommandReceipt(db, identity)
    if (!receipt) return null
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
  const page = await prisma.bookingPage.findFirst({ where: { id: pageId, organizationId: orgId, isActive: true } })
  if (!page) return { ok: false, reason: "not_found" }
  const org = await orgContext(orgId)
  const hosts = await activeHosts(orgId, page.hostIds)
  const permitted = hosts.filter((host) => (!input.hostUserId || host.id === input.hostUserId) && (!access || access.writableHostIds === null || access.writableHostIds.includes(host.id)))
  if (!permitted.length) return { ok: false, reason: "taken" }
  const from = now, to = new Date(now.getTime() + (page.maxDaysAhead + 2) * 86400_000)
  const busy = await loadBusyByHost(orgId, permitted.map((host) => host.id), from, to)
  const checkedAt = Date.now()
  const slot = findSlot(computeSlots({ rules: bookingRules(page, org.timezone), hostIds: permitted.map((host) => host.id), busyByHost: busy, now }), input.startsAt)
  if (!slot) {
    if (busy.unavailableHostIds.size) throw new BookingCommandError("CALENDAR_UNAVAILABLE", 503)
    return { ok: false, reason: "taken" }
  }
  const accounts = await prisma.account.findMany({ where: { userId: { in: slot.hostIds }, provider: { in: ["google-calendar", "google"] } }, select: { id: true, userId: true }, orderBy: { provider: "asc" } })
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
        const account = await tx.account.findFirst({ where: { userId: hostId, provider: { in: ["google-calendar", "google"] } }, select: { id: true }, orderBy: { provider: "asc" } })
        if (!currentPage || currentPage.version !== page.version || !currentPage.hostIds.includes(hostId) || Date.now() - checkedAt > 15000 || account?.id !== accounts.find((row) => row.userId === hostId)?.id) throw new BookingCommandError("AVAILABILITY_CHANGED")
        if (!host) throw new BookingCommandError("SLOT_TAKEN")
        if (access && !access.administrator && hostId !== access.userId && !await tx.bookingCoordinatorGrant.findFirst({ where: { organizationId: orgId, coordinatorUserId: access.userId, hostUserId: hostId, canManage: true } })) throw new BookingCommandError("FORBIDDEN", 403)
        await assertBookingInterval(tx, orgId, hostId, startsAt, endsAt, currentPage.bufferMinutes)
        let row = await tx.booking.create({ data: {
          organizationId: orgId, bookingPageId: pageId, hostUserId: hostId, startsAt, endsAt,
          name: input.name, phone: input.phone, email: input.email || null, note: input.note || null,
          cancelTokenHash: hashBookingToken(token), secretId,
          source: access ? "staff" : "public_link", createdBy: access?.userId ?? null,
          bufferBefore: currentPage.bufferMinutes, bufferAfter: currentPage.bufferMinutes,
          snapshot: { locale: input.locale ?? "az", slug: currentPage.slug, title: currentPage.title, locationType: currentPage.locationType, locationText: currentPage.locationText, timezone: org.timezone, legacyDerived: false },
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
