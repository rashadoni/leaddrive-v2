/**
 * The ad-conversions cron's pass, per active destination (Meta or GA4):
 *
 *  1. Queue — new leads and newly won deals since the destination was turned
 *     on (and never older than the platform accepts: Meta 7 days, GA4 72
 *     hours). (destination, event, record) is unique, so a record is queued
 *     once however often this runs.
 *  2. Send — waiting events: to Meta in one batch, to GA4 one per request.
 *     An event older than the platform's window, one whose record is gone, or
 *     (Meta only) one with nothing to match the person by is marked "skipped"
 *     with the reason instead of being sent: one bad event must never fail
 *     the batch.
 *
 * Which leads count: only inbound ones — a tracked form, a booking, the
 * website, Meta's own channels and WhatsApp. A cold call, a referral, an
 * exhibition list or an import is not an ad's doing, and teaching Meta that it
 * is would make it look for the wrong people. Every won deal counts: Meta
 * decides itself whether the buyer saw an ad.
 *
 * "Won" is the organization's own stage vocabulary — `Deal.stage` is free text
 * (CLAUDE.md: never hardcode stage names).
 */
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass, runWithTenant } from "@/lib/rls-context"
import { orgStageVocabulary } from "@/lib/deal-stage-vocabulary"
import { decimalToNumber } from "@/lib/prisma-decimal"
import { storedAttribution } from "./attribution"
import { decryptDestinationSecret } from "./destination"
import { buildMetaEvent, MAX_EVENT_AGE_MS, sendMetaEvents } from "./meta"
import { buildGa4Body, GA4_MAX_EVENT_AGE_MS, sendGa4Event } from "./ga4"

const INBOUND_SOURCES = new Set(["web_form", "website", "landing_page", "instagram", "facebook", "messenger", "whatsapp"])
const INBOUND_PREFIXES = ["form:", "booking:"]
const MAX_ATTEMPTS = 5
const BATCH = 200

export function isInboundLead(lead: { source: string | null; adAttribution: unknown }): boolean {
  if (storedAttribution(lead.adAttribution)) return true
  const source = (lead.source ?? "").trim().toLowerCase()
  return INBOUND_SOURCES.has(source) || INBOUND_PREFIXES.some((prefix) => source.startsWith(prefix))
}

type Destination = NonNullable<Awaited<ReturnType<typeof prisma.adConversionDestination.findFirst>>>

/** How old an event the platform still accepts: Meta 7 days, GA4 72 hours (each less a margin). */
const maxAge = (destination: Destination) => (destination.platform === "ga4" ? GA4_MAX_EVENT_AGE_MS : MAX_EVENT_AGE_MS)

async function queue(destination: Destination, now: Date): Promise<number> {
  const orgId = destination.organizationId
  const floor = new Date(now.getTime() - maxAge(destination))
  const since = destination.activatedAt && destination.activatedAt > floor ? destination.activatedAt : floor
  const rows: { eventName: string; entityType: string; entityId: string; eventTime: Date; recordLabel: string }[] = []

  if (destination.sendLeads) {
    const leads = await prisma.lead.findMany({
      where: { organizationId: orgId, createdAt: { gte: since } },
      select: { id: true, contactName: true, createdAt: true, source: true, adAttribution: true },
      take: 1000,
    })
    for (const lead of leads as { id: string; contactName: string; createdAt: Date; source: string | null; adAttribution: unknown }[]) {
      if (!isInboundLead(lead)) continue
      rows.push({ eventName: "lead", entityType: "lead", entityId: lead.id, eventTime: lead.createdAt, recordLabel: lead.contactName.slice(0, 120) })
    }
  }

  if (destination.sendWins) {
    const { wonStages } = await orgStageVocabulary(orgId)
    if (wonStages.length > 0) {
      const deals = await prisma.deal.findMany({
        where: {
          organizationId: orgId,
          stage: { in: wonStages },
          OR: [{ stageChangedAt: { gte: since } }, { stageChangedAt: null, updatedAt: { gte: since } }],
        },
        select: { id: true, name: true, valueAmount: true, currency: true, stageChangedAt: true, updatedAt: true },
        take: 1000,
      })
      for (const deal of deals as { id: string; name: string; valueAmount: unknown; currency: string; stageChangedAt: Date | null; updatedAt: Date }[]) {
        const amount = decimalToNumber(deal.valueAmount)
        rows.push({
          eventName: "purchase",
          entityType: "deal",
          entityId: deal.id,
          eventTime: deal.stageChangedAt ?? deal.updatedAt,
          recordLabel: `${deal.name} · ${amount.toLocaleString("en-US", { maximumFractionDigits: 2 }).replace(/,/g, " ")} ${deal.currency}`.slice(0, 160),
        })
      }
    }
  }

  if (rows.length === 0) return 0
  const created = await prisma.adConversionEvent.createMany({
    data: rows.map((row) => ({ ...row, organizationId: orgId, destinationId: destination.id })),
    skipDuplicates: true,
  })
  return created.count
}

async function subjectOf(orgId: string, event: { id: string; eventName: string; entityType: string; entityId: string; eventTime: Date }) {
  if (event.entityType === "lead") {
    const lead = await prisma.lead.findFirst({
      where: { id: event.entityId, organizationId: orgId },
      select: { email: true, phone: true, adAttribution: true },
    })
    if (!lead) return null
    return { email: lead.email, phone: lead.phone, attribution: storedAttribution(lead.adAttribution) }
  }
  const deal = await prisma.deal.findFirst({
    where: { id: event.entityId, organizationId: orgId },
    select: { contactId: true, valueAmount: true, currency: true, metadata: true },
  })
  if (!deal) return null
  const contact = deal.contactId
    ? await prisma.contact.findFirst({ where: { id: deal.contactId, organizationId: orgId }, select: { email: true, phone: true } })
    : null
  const metadata = (deal.metadata ?? {}) as Record<string, unknown>
  return {
    email: contact?.email ?? null,
    phone: contact?.phone ?? null,
    attribution: storedAttribution(metadata.adAttribution),
    value: decimalToNumber(deal.valueAmount),
    currency: deal.currency,
  }
}

async function send(destination: Destination, now: Date): Promise<{ sent: number; skipped: number; failed: number }> {
  const orgId = destination.organizationId
  const totals = { sent: 0, skipped: 0, failed: 0 }
  const waiting = await prisma.adConversionEvent.findMany({
    where: { organizationId: orgId, destinationId: destination.id, status: "pending" },
    orderBy: { eventTime: "asc" },
    take: BATCH,
  })
  // Back off a failing event: try again after 10, 20, 30 … minutes.
  const due = (waiting as { attempts: number; updatedAt: Date }[]).filter((event) =>
    event.attempts === 0 || now.getTime() - event.updatedAt.getTime() >= event.attempts * 10 * 60_000) as typeof waiting
  if (due.length === 0) return totals

  const skip = async (id: string, reason: string) => {
    await prisma.adConversionEvent.updateMany({ where: { id, organizationId: orgId, status: "pending" }, data: { status: "skipped", reason } })
    totals.skipped += 1
  }

  const ready: { id: string; attempts: number; payload: Record<string, unknown> }[] = []
  for (const event of due as { id: string; attempts: number; eventName: string; entityType: string; entityId: string; eventTime: Date }[]) {
    if (now.getTime() - event.eventTime.getTime() > maxAge(destination)) {
      await skip(event.id, "skip_too_old")
      continue
    }
    const subject = await subjectOf(orgId, event)
    if (!subject) {
      await skip(event.id, "skip_gone")
      continue
    }
    // GA4 needs no contact data — the visit id or a pseudonymous one — so it
    // never skips for «nothing to match by».
    const payload = destination.platform === "ga4"
      ? buildGa4Body({ eventName: event.eventName as "lead" | "purchase", eventTime: event.eventTime, entityId: `${event.entityType}:${event.entityId}`, attribution: subject.attribution, value: "value" in subject ? subject.value : undefined, currency: "currency" in subject ? subject.currency : undefined })
      : buildMetaEvent({
        eventId: `leaddrive:${event.entityType}:${event.entityId}`,
        eventName: event.eventName === "purchase" ? "Purchase" : "Lead",
        eventTime: event.eventTime,
        ...subject,
      })
    if (!payload) {
      await skip(event.id, "skip_no_match")
      continue
    }
    ready.push({ id: event.id, attempts: event.attempts, payload })
  }
  if (ready.length === 0) return totals

  // A name of its own: scripts/rls/find-context-gaps.py keys helpers by name,
  // and a prisma-writing «fail» taints the 249 calls of the 18 other «fail»s.
  const recordSendFailure = async (item: { id: string; attempts: number }, error: unknown) => {
    const reason = (error instanceof Error ? error.message : "Send failed").slice(0, 300)
    const attempts = item.attempts + 1
    await prisma.adConversionEvent.updateMany({
      where: { id: item.id, organizationId: orgId, status: "pending" },
      data: { attempts, reason, ...(attempts >= MAX_ATTEMPTS ? { status: "failed" } : {}) },
    })
    if (attempts >= MAX_ATTEMPTS) totals.failed += 1
  }

  if (destination.platform === "ga4") {
    // One person per request (client_id is per request), so each event stands alone.
    const apiSecret = decryptDestinationSecret(orgId, destination.secretCiphertext)
    for (const item of ready) {
      try {
        await sendGa4Event({ measurementId: destination.publicId, apiSecret, body: item.payload })
        await prisma.adConversionEvent.updateMany({
          where: { id: item.id, organizationId: orgId, status: "pending" },
          data: { status: "sent", sentAt: now, reason: null, attempts: { increment: 1 } },
        })
        totals.sent += 1
      } catch (error) {
        await recordSendFailure(item, error)
      }
    }
    return totals
  }

  try {
    await sendMetaEvents({
      pixelId: destination.publicId,
      accessToken: decryptDestinationSecret(orgId, destination.secretCiphertext),
      events: ready.map((item) => item.payload),
      testEventCode: destination.testEventCode,
    })
    await prisma.adConversionEvent.updateMany({
      where: { id: { in: ready.map((item) => item.id) }, organizationId: orgId, status: "pending" },
      data: { status: "sent", sentAt: now, reason: null, attempts: { increment: 1 } },
    })
    totals.sent += ready.length
  } catch (error) {
    for (const item of ready) await recordSendFailure(item, error)
  }
  return totals
}

/** One destination: queue, then send. Runs under its tenant scope. */
export async function processDestination(destination: Destination, now = new Date()) {
  const queued = await queue(destination, now)
  const result = await send(destination, now)
  return { queued, ...result }
}

/** The cron's whole pass. */
export async function runAdConversions(now = new Date()) {
  const destinations = await runWithRlsBypass(() =>
    prisma.adConversionDestination.findMany({ where: { isActive: true, consentConfirmedAt: { not: null }, platform: { in: ["meta", "ga4"] } } }),
  )
  const totals = { destinations: 0, queued: 0, sent: 0, skipped: 0, failed: 0 }
  for (const destination of destinations as Destination[]) {
    try {
      const result = await runWithTenant(destination.organizationId, () => processDestination(destination, now))
      totals.destinations += 1
      totals.queued += result.queued
      totals.sent += result.sent
      totals.skipped += result.skipped
      totals.failed += result.failed
    } catch (error) {
      console.error("[ad-conversions] destination failed", { destinationId: destination.id, error })
    }
  }
  return totals
}
