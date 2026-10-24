import { createHash, randomUUID } from "node:crypto"
import type { Booking, EffectOutbox, Prisma } from "@prisma/client"
import { preloadTenantDataKeys } from "@/lib/crypto/tenant-data-keys"
import { bookingDb as prisma } from "./db"
import { runWithRlsBypass, runWithTenant } from "@/lib/rls-context"
import { withJobLease } from "@/lib/cron/job-lease"
import { createNotification, deliverNotificationPush } from "@/lib/notifications"
import { getGoogleCalendarClient } from "@/lib/google-calendar"
import { sendEmail } from "@/lib/email"
import { decryptForTenantBound } from "@/lib/crypto/tenant-pii-encryption"
import { bookingHostWhere } from "./access"
import { formatInTimezone } from "@/lib/timezone"

type Claimed = EffectOutbox & { leaseToken: string; providerRequestId: string }
const safeId = (prefix: string, org: string, id: string) => `${prefix}_${createHash("sha256").update(`${org}:${id}`).digest("hex").slice(0, 32)}`
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!)
function snapshot(row: Booking) {
  const value = row.snapshot as Record<string, unknown> | null
  return { locale: typeof value?.locale === "string" && ["az", "ru", "en"].includes(value.locale) ? value.locale as "az" | "ru" | "en" : "az" as const, title: typeof value?.title === "string" ? value.title : "Görüş", slug: typeof value?.slug === "string" ? value.slug : null, timezone: typeof value?.timezone === "string" ? value.timezone : "Asia/Baku", location: typeof value?.locationText === "string" ? value.locationText : "" }
}

async function claim(tx: Prisma.TransactionClient, effect: EffectOutbox): Promise<Claimed> {
  const leaseToken = randomUUID(), requestId = randomUUID()
  const row = await tx.effectOutbox.update({ where: { id: effect.id }, data: { status: "leased", attemptCount: { increment: 1 }, leaseToken, leaseOwner: "booking-worker", leaseExpiresAt: new Date(Date.now() + 60_000), providerRequestId: requestId } })
  await tx.effectAttempt.create({ data: { organizationId: row.organizationId, effectId: row.id, attemptNumber: row.attemptCount, leaseToken, requestId, outcome: "started", evidence: { kind: row.effectType } } })
  return row as Claimed
}

async function finish(tx: Prisma.TransactionClient, effect: Claimed, status: "succeeded" | "reconciliation_required", evidence: Prisma.InputJsonObject) {
  const current = await tx.effectOutbox.findFirst({ where: { id: effect.id, organizationId: effect.organizationId, status: "leased", leaseToken: effect.leaseToken } })
  if (!current) return false
  await tx.effectAttempt.create({ data: { organizationId: effect.organizationId, effectId: effect.id, attemptNumber: effect.attemptCount, leaseToken: effect.leaseToken, requestId: effect.providerRequestId, outcome: status, completedAt: new Date(), evidence } })
  await tx.effectOutbox.update({ where: { id: effect.id }, data: { status, leaseToken: null, leaseOwner: null, leaseExpiresAt: null, ...(status === "succeeded" ? { completedAt: new Date(), providerResult: evidence, lastError: null } : { reconciliationAt: new Date(), lastError: "DELIVERY_UNCONFIRMED" }) } })
  return true
}

async function project(tx: Prisma.TransactionClient, row: Booking) {
  await tx.$executeRaw`SELECT set_config('app.booking_task_writer', 'on', true)`
  let leadId = row.leadId, taskId = row.taskId
  // A legacy missing link may represent an orphan created before the old HTTP request crashed.
  // Preserve that ambiguity instead of generating a second customer record.
  if (row.snapshot && !leadId && row.source !== "legacy") {
    const lead = await tx.lead.create({ data: { id: safeId("booking_lead", row.organizationId, row.id), organizationId: row.organizationId, contactName: row.name, phone: row.phone, email: row.email, source: `booking:${snapshot(row).slug ?? row.bookingPageId}`, sourceDetail: snapshot(row).title, status: "new", assignedTo: row.hostUserId, notes: row.note, adAttribution: row.adAttribution ? row.adAttribution as Prisma.InputJsonValue : undefined } })
    leadId = lead.id
  }
  if (row.snapshot && !taskId && row.source !== "legacy") {
    const task = await tx.task.create({ data: { id: safeId("booking_task", row.organizationId, row.id), organizationId: row.organizationId, title: `${snapshot(row).title} — ${row.name}`, description: row.note, assignedTo: row.hostUserId, dueDate: row.startsAt, priority: "high", ...(leadId ? { relatedType: "lead", relatedId: leadId } : {}) } })
    taskId = task.id
  }
  if (taskId) await tx.task.updateMany({ where: { id: taskId, organizationId: row.organizationId }, data: { dueDate: row.startsAt, assignedTo: row.hostUserId, status: row.status === "completed" ? "completed" : ["cancelled", "no_show"].includes(row.status) ? "cancelled" : "pending", completedAt: row.status === "completed" ? new Date() : null } })
  await tx.booking.update({ where: { id: row.id }, data: { leadId, taskId } })
}

/** One record at a time; local projection and attempt completion commit atomically. */
export async function drainBookingEffects(orgId: string, limit = 20, deadline = Date.now() + 45_000) {
  await preloadTenantDataKeys(orgId)
  await cleanBookingSecrets(orgId)
  let processed = 0
  for (let index = 0; index < Math.min(limit, 50) && Date.now() < deadline; index++) {
    let processingId: string | undefined
    let failures = 0
    let work
    try {
      work = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<EffectOutbox[]>`
        SELECT * FROM effect_outbox WHERE "organizationId" = ${orgId} AND "effectType" LIKE 'booking.%' AND "executionMode" = 'live'
        AND ((status = 'pending' AND "availableAt" <= CURRENT_TIMESTAMP) OR (status = 'leased' AND "leaseExpiresAt" < CURRENT_TIMESTAMP))
        ORDER BY "createdAt", id LIMIT 1
      `
      let effect = rows[0]
      if (!effect) return null
      const identity = effect.payload as { bookingId: string }
      await tx.$queryRaw`SELECT id FROM bookings WHERE "organizationId" = ${orgId} AND id = ${identity.bookingId} FOR UPDATE`
      await tx.$queryRaw`SELECT id FROM effect_outbox WHERE "organizationId" = ${orgId} AND id = ${effect.id}::uuid FOR UPDATE`
      const fresh = await tx.effectOutbox.findFirst({ where: { id: effect.id, organizationId: orgId } })
      if (!fresh || fresh.status !== effect.status || fresh.leaseToken !== effect.leaseToken) return { done: true as const }
      effect = fresh
      processingId = effect.id
      failures = Number(effect.lastError?.match(/^LOCAL_FAILURE_(\d+)$/)?.[1] ?? 0)
      if (effect.status === "leased") {
        const started = await tx.effectAttempt.findFirst({ where: { effectId: effect.id, organizationId: orgId, attemptNumber: effect.attemptCount, outcome: "started" } })
        if (started) await finish(tx, effect as Claimed, "reconciliation_required", { reason: "expired_started_attempt" })
        else await tx.effectOutbox.update({ where: { id: effect.id }, data: { status: "pending", leaseToken: null, leaseOwner: null, leaseExpiresAt: null, providerRequestId: null } })
        return { done: true as const }
      }
      const payload = effect.payload as { bookingId: string; version: number; bindingId?: string; secretId?: string }
      await tx.$queryRaw`SELECT id FROM bookings WHERE "organizationId" = ${orgId} AND id = ${payload.bookingId} FOR UPDATE`
      const row = await tx.booking.findFirst({ where: { organizationId: orgId, id: payload.bookingId } })
      if (!row) return null
      if (effect.effectType === "booking.calendar" && payload.bindingId) {
        const blocked = await tx.effectOutbox.findFirst({ where: { organizationId: orgId, destination: payload.bindingId, id: { not: effect.id }, status: { in: ["leased", "reconciliation_required", "definitely_failed"] } }, select: { id: true } })
        if (blocked) {
          await tx.effectOutbox.update({ where: { id: effect.id }, data: { availableAt: new Date(Date.now() + 60_000) } })
          return { done: true as const }
        }
      }
      const claimed = await claim(tx, effect)
      if (payload.version !== row.version) {
        await finish(tx, claimed, "succeeded", { noOp: true, reason: "superseded_before_send" })
        return { done: true as const }
      }
      if (effect.effectType === "booking.calendar" && payload.bindingId) {
        const binding = await tx.bookingIntegrationBinding.findFirst({ where: { id: payload.bindingId, organizationId: orgId, bookingId: row.id } })
        if (binding?.state === "reconciliation_required" || binding?.accountId === "unavailable") {
          await finish(tx, claimed, "reconciliation_required", { reason: "calendar_identity_unverified" })
          return { done: true as const }
        }
      }
      if (effect.effectType === "booking.project") {
        await project(tx, row)
        await finish(tx, claimed, "succeeded", { localProjection: true })
        return { done: true as const }
      }
      if (effect.effectType === "booking.notify") {
        const data = snapshot(row)
        const when = formatInTimezone(row.startsAt, data.timezone, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }, data.locale)
        const notification = await createNotification({ client: tx, idempotencyKey: `booking:${row.id}:${row.version}`, organizationId: orgId, userId: row.hostUserId, entityType: "booking", entityId: row.id, type: row.status === "cancelled" ? "warning" : "info", title: `${data.title} · ${when}`, message: deliveryCopy(row).status })
        if (!notification) throw new Error("booking notification persistence failed")
        await finish(tx, claimed, "succeeded", { notification: true })
        return { done: true as const }
      }
      return { done: false as const, effect: claimed, row, payload }
    })
    } catch {
      if (!processingId) throw new Error("BOOKING_WORKER_DATABASE_FAILED")
      await prisma.effectOutbox.updateMany({ where: { id: processingId, organizationId: orgId, status: "pending" }, data: { lastError: `LOCAL_FAILURE_${Math.min(failures + 1, 20)}`, availableAt: new Date(Date.now() + Math.min(3600, 60 * 2 ** Math.min(failures, 6)) * 1000) } })
      continue
    }
    if (!work) break
    processed++
    if (work.done) continue
    const { effect, row, payload } = work
    try {
      if (effect.effectType === "booking.calendar" && payload.bindingId) {
        const binding = await prisma.bookingIntegrationBinding.findFirst({ where: { id: payload.bindingId, organizationId: orgId, bookingId: row.id } })
        if (!binding) throw new Error("missing binding")
        const calendar = await getGoogleCalendarClient(binding.hostUserId, binding.accountId)
        const data = snapshot(row)
        let skippedCreate = false
        if (binding.desiredState === "absent") {
          if (binding.providerEventId) {
            try { await calendar.events.delete({ calendarId: binding.calendarId, eventId: binding.providerEventId, sendUpdates: "none" }, { timeout: 8000 }) }
            catch (error) { if ((error as { code?: number }).code !== 404 && (error as { code?: number }).code !== 410) throw error }
          }
        } else {
          const body = { summary: `${data.title} — ${row.name}`, description: row.note || undefined, location: data.location, start: { dateTime: row.startsAt.toISOString() }, end: { dateTime: row.endsAt.toISOString() }, extendedProperties: { private: { leaddriveBooking: row.id } } }
          try { await calendar.events.update({ calendarId: binding.calendarId, eventId: binding.providerEventId!, sendUpdates: "none", requestBody: body }, { timeout: 8000 }) }
          catch (error) {
            if ((error as { code?: number }).code !== 404) throw error
            if (row.endsAt <= new Date()) skippedCreate = true
            else await calendar.events.insert({ calendarId: binding.calendarId, sendUpdates: "none", requestBody: { ...body, id: binding.providerEventId! } }, { timeout: 8000 })
          }
        }
        await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM bookings WHERE "organizationId" = ${orgId} AND id = ${row.id} FOR UPDATE`
          if (await finish(tx, effect, "succeeded", { bindingId: binding.id, noOp: skippedCreate })) {
            await tx.bookingIntegrationBinding.update({ where: { id: binding.id }, data: { appliedVersion: payload.version, ...(binding.desiredVersion === payload.version ? { state: skippedCreate ? "unavailable" : "synced" } : {}) } })
            if (binding.desiredState === "present" && !skippedCreate) await tx.booking.updateMany({ where: { id: row.id, organizationId: orgId, hostUserId: binding.hostUserId, version: payload.version }, data: { googleEventId: binding.providerEventId } })
          }
        })
      } else if (effect.effectType === "booking.push") {
        const host = await prisma.user.findFirst({ where: bookingHostWhere(orgId, [row.hostUserId]), select: { id: true } })
        if (host) await boundedDelivery(deliverNotificationPush({ organizationId: orgId, userId: host.id, title: snapshot(row).title, message: deliveryCopy(row).status, entityType: "booking", entityId: row.id, kind: row.status === "cancelled" ? "booking.cancelled" : "booking.created" }))
        await prisma.$transaction((tx) => finish(tx, effect, "succeeded", { bestEffortPushAttempted: Boolean(host) }))
      } else if (effect.effectType === "booking.email" || effect.effectType === "booking.host-email") {
        const hostNotice = effect.effectType === "booking.host-email"
        const host = hostNotice ? await prisma.user.findFirst({ where: bookingHostWhere(orgId, [row.hostUserId]), select: { email: true } }) : null
        const recipient = hostNotice ? host?.email : row.email
        if (!recipient || !hostNotice && row.status !== "cancelled" && row.startsAt <= new Date()) {
          await prisma.$transaction((tx) => finish(tx, effect, "succeeded", { noOp: true, reason: "message_expired" })); continue
        }
        const data = snapshot(row)
        const when = formatInTimezone(row.startsAt, data.timezone, { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }, data.locale)
        let cancelUrl: string | null = null
        if (payload.secretId && row.status === "confirmed") {
          const secret = await prisma.bookingSecret.findFirst({ where: { id: payload.secretId, organizationId: orgId } })
          if (secret?.deliveryCipher) cancelUrl = JSON.parse(decryptForTenantBound(orgId, "booking_secrets", `${secret.id}:delivery`, secret.deliveryCipher)).cancelUrl
        }
        const copy = deliveryCopy(row)
        const status = copy.status
        const result = await boundedDelivery(sendEmail({ organizationId: orgId, transactional: true, to: recipient, subject: `${status} · ${data.title} · ${when}`, html: `${hostNotice ? "" : `<p>${escapeHtml(row.name)},</p>`}<p><strong>${escapeHtml(status)}</strong></p><p>${escapeHtml(data.title)}<br>${escapeHtml(when)} (${escapeHtml(data.timezone)})</p>${data.location ? `<p>${escapeHtml(data.location)}</p>` : ""}${hostNotice ? `<p><a href="${escapeHtml((process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || process.env.NEXTAUTH_URL || "").replace(/\/$/, "") + `/meetings?booking=${encodeURIComponent(row.id)}`)}">${escapeHtml(copy.open)}</a></p>` : cancelUrl ? `<p><a href="${escapeHtml(cancelUrl)}">${escapeHtml(copy.cancel)}</a></p>` : ""}` }))
        if (!result.success) throw new Error("email result unconfirmed")
        await prisma.$transaction((tx) => finish(tx, effect, "succeeded", { delivered: true }))
      } else throw new Error("unsupported booking effect")
    } catch {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM bookings WHERE "organizationId" = ${orgId} AND id = ${row.id} FOR UPDATE`
        await finish(tx, effect, "reconciliation_required", { reason: "provider_result_unconfirmed" })
        if (payload.bindingId) await tx.bookingIntegrationBinding.updateMany({ where: { id: payload.bindingId, organizationId: orgId }, data: { state: "reconciliation_required" } })
      })
    }
  }
  return processed
}

export async function runBookingEffectWorker() {
  return withJobLease({ name: "booking-effects", ttlMs: 120_000 }, async () => {
    const cursor = await prisma.systemJobCursor.findUnique({ where: { name: "booking-effects" } })
    let organizations = await runWithRlsBypass(() => prisma.organization.findMany({ where: { isActive: true, ...(cursor?.cursor ? { id: { gt: cursor.cursor } } : {}) }, select: { id: true }, orderBy: { id: "asc" }, take: 10 }))
    if (!organizations.length && cursor?.cursor) organizations = await runWithRlsBypass(() => prisma.organization.findMany({ where: { isActive: true }, select: { id: true }, orderBy: { id: "asc" }, take: 10 }))
    let processed = 0, failedOrganizations = 0
    const deadline = Date.now() + 45_000
    let last: string | null = null
    for (const org of organizations) {
      if (Date.now() >= deadline) break
      try { processed += await runWithTenant(org.id, () => drainBookingEffects(org.id, 20, deadline)) }
      catch { failedOrganizations++; console.warn("[booking-effects] tenant processing failed", { organizationId: org.id, code: "PROCESSING_FAILED" }) }
      last = org.id
    }
    await prisma.systemJobCursor.upsert({ where: { name: "booking-effects" }, create: { name: "booking-effects", cursor: last }, update: { cursor: organizations.length < 10 ? null : last } })
    return { processed, failedOrganizations }
  })
}


async function boundedDelivery<T>(delivery: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([delivery, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("delivery timeout")), 10000) })])
  } finally { if (timer) clearTimeout(timer) }
}


async function cleanBookingSecrets(orgId: string) {
  const expired = await prisma.bookingSecret.findMany({ where: { organizationId: orgId, responseExpiresAt: { lt: new Date() }, responseCipher: { not: null } }, select: { id: true }, take: 50 })
  if (expired.length) await prisma.bookingSecret.updateMany({ where: { organizationId: orgId, id: { in: expired.map((row) => row.id) } }, data: { responseCipher: null } })
  await prisma.$executeRaw`
    UPDATE booking_secrets SET "deliveryCipher" = NULL WHERE "organizationId" = ${orgId} AND id IN (
      SELECT s.id FROM booking_secrets s JOIN bookings b ON b."secretId" = s.id AND b."organizationId" = s."organizationId"
      WHERE s."organizationId" = ${orgId} AND s."deliveryCipher" IS NOT NULL AND b."endsAt" < CURRENT_TIMESTAMP - INTERVAL '2 days'
      AND NOT EXISTS (SELECT 1 FROM effect_outbox e WHERE e."organizationId" = ${orgId} AND e."effectType" = 'booking.email' AND e.payload->>'secretId' = s.id AND e.status NOT IN ('succeeded', 'dead'))
      ORDER BY s."createdAt" LIMIT 50
    )
  `
}


function deliveryCopy(row: Booking) {
  const copy = {
    az: { confirmed: "Görüş təsdiqlənib", cancelled: "Görüş ləğv edilib", completed: "Görüş baş tutub", no_show: "Müştəri gəlməyib", open: "Görüşü aç", cancel: "Görüşü ləğv et" },
    ru: { confirmed: "Встреча подтверждена", cancelled: "Встреча отменена", completed: "Встреча состоялась", no_show: "Клиент не пришёл", open: "Открыть встречу", cancel: "Отменить встречу" },
    en: { confirmed: "Meeting confirmed", cancelled: "Meeting cancelled", completed: "Meeting completed", no_show: "Client did not attend", open: "Open meeting", cancel: "Cancel meeting" },
  }[snapshot(row).locale]
  return { ...copy, status: copy[row.status as "confirmed" | "cancelled" | "completed" | "no_show"] ?? copy.confirmed }
}
