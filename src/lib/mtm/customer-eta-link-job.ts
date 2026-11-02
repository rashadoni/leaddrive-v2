import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass, runWithTenant } from "@/lib/rls-context"
import { withJobLease } from "@/lib/cron/job-lease"
import { getMtmSettings, MTM_SETTING_DEFAULTS } from "@/lib/mtm-settings"
import { coerceMtmBooleanSetting } from "@/lib/mtm/setting-values"
import { isTenantCapabilityEnabled } from "@/lib/tenant-capabilities"
import { generateOneTimeToken } from "@/lib/one-time-token"
import { formatTime } from "@/lib/format-date"
import { sendSms } from "@/lib/sms"
import { sendWhatsAppTemplate } from "@/lib/whatsapp"
import { roadTable } from "@/lib/mtm/road-router"
import { AGENT_LANGUAGE_SELECT, agentLanguage } from "@/lib/mtm/agent-language"
import { readLocationShareLinkPosition } from "@/lib/mtm/location-share-link-position"
import {
  buildLocationShareLinkUrl,
  locationShareLinkExpiresAt,
  locationShareLinkTimezone,
  locationShareLinkTodayWorkDate,
} from "@/lib/mtm/location-share-link"
import {
  CUSTOMER_ETA_WHATSAPP_TEMPLATE,
  customerEtaArrivesAt,
  customerEtaChannel,
  customerEtaCountryCode,
  customerEtaDue,
  customerEtaFailure,
  customerEtaLanguage,
  customerEtaRecipient,
  customerEtaSmsText,
  customerEtaWhatsAppVariables,
  nextCustomerEtaStop,
} from "@/lib/mtm/customer-eta-link"

/**
 * «Агент едет к вам»: the minute job that sends the links
 * (rules: customer-eta-link.ts).
 *
 * Why a job and not the check-out itself: a visit is closed by three sync
 * paths, a shift is started by another, and «he has set off» is none of those
 * moments exactly — it is the first minute in which he is on shift, free, his
 * phone reports where he is, and the next stop of his route has had no link.
 * One reader of that state is simpler than four writers remembering to ask,
 * and a minute is well inside «едет к вам».
 *
 * At most one message per stop, ever: the link's row is inserted before the
 * message goes, and the table keeps one row per stop (unique routePointId).
 * Two ticks that reach the same stop both try; one inserts, the other finds
 * the row and sends nothing. A tick that dies between the insert and the send
 * leaves the row PENDING and the customer without a message — never with two.
 */

export const CUSTOMER_ETA_LINK_JOB = "mtm-customer-eta-links"
const BATCH = 200
const DEADLINE_MS = 45_000

export interface CustomerEtaSenders {
  sendSms: typeof sendSms
  sendWhatsAppTemplate: typeof sendWhatsAppTemplate
  roadTable: typeof roadTable
}

const DEFAULT_SENDERS: CustomerEtaSenders = { sendSms, sendWhatsAppTemplate, roadTable }

export type CustomerEtaOutcome = "sent" | "failed" | "none"

/**
 * One agent of one organization, inside that organization's scope: sends the
 * link for the stop he is driving to, when it is due. Returns what happened.
 */
export async function prepareCustomerEtaLink(
  organizationId: string,
  agentId: string,
  now: Date,
  senders: CustomerEtaSenders = DEFAULT_SENDERS,
): Promise<CustomerEtaOutcome> {
  const settings = await getMtmSettings(organizationId)
  if (settings.customerEtaLinksEnabled !== true) return "none"
  const channel = customerEtaChannel(settings.customerEtaLinkChannel)
  const timezone = locationShareLinkTimezone(settings.timezone)

  const agent = await prisma.mtmAgent.findFirst({
    where: { id: agentId, organizationId, status: "ACTIVE", fieldDeletedAt: null },
    select: {
      name: true,
      ...AGENT_LANGUAGE_SELECT,
      organization: { select: { name: true, isActive: true, plan: true, addons: true, features: true, modules: true } },
    },
  })
  if (!agent || agent.organization.isActive !== true) return "none"
  if (!isTenantCapabilityEnabled("route-field", agent.organization)) return "none"

  // In a visit: he is not on his way to anybody.
  const open = await prisma.mtmVisit.findFirst({
    where: { organizationId, agentId, status: "CHECKED_IN", deletedAt: null },
    select: { id: true },
  })
  if (open) return "none"

  // What the customer's page would show — the same reads and the same rule.
  // Nothing to show (off shift, on a break, no fresh point): no message that
  // would open on «местоположение недоступно».
  const { position } = await readLocationShareLinkPosition({ organizationId, agentId, settings, now })
  if (position.state !== "AVAILABLE") return "none"

  const routes = await prisma.mtmRoute.findMany({
    where: {
      organizationId,
      agentId,
      date: locationShareLinkTodayWorkDate(now, timezone),
      status: { in: ["PLANNED", "IN_PROGRESS"] },
      deletedAt: null,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      points: {
        where: { deletedAt: null },
        select: { id: true, orderIndex: true, status: true, plannedTime: true, customerId: true, contactId: true },
      },
    },
  })

  for (const route of routes) {
    const lastVisit = await prisma.mtmVisit.findFirst({
      where: { organizationId, agentId, routeId: route.id, routePointId: { not: null }, deletedAt: null },
      orderBy: [{ checkInAt: "desc" }, { id: "desc" }],
      select: { routePointId: true },
    })
    const lastVisited = lastVisit ? route.points.find((point) => point.id === lastVisit.routePointId) : undefined
    const stop = nextCustomerEtaStop(route.points, lastVisited ? lastVisited.orderIndex : null)
    if (!stop) continue
    const point = route.points.find((candidate) => candidate.id === stop.id)!

    // One link per stop, ever — sent, failed or still being sent.
    const already = await prisma.mtmLocationShareLink.findFirst({ where: { organizationId, routePointId: point.id }, select: { id: true } })
    if (already) return "none"

    const customer = await prisma.mtmCustomer.findFirst({
      where: { id: point.customerId, organizationId, deletedAt: null },
      select: { id: true, latitude: true, longitude: true, phone: true },
    })
    if (!customer || customer.latitude == null || customer.longitude == null) return "none"
    const destination = { latitude: customer.latitude, longitude: customer.longitude }
    if (!customerEtaDue({ stop, agent: position, customer: destination, now })) return "none"

    const contact = point.contactId
      ? await prisma.mtmContact.findFirst({
          where: { id: point.contactId, organizationId, deletedAt: null },
          select: { mobilePhone: true, whatsappPhone: true, phone: true, workPhone: true },
        })
      : null
    const to = customerEtaRecipient(channel, contact, customer, customerEtaCountryCode(timezone))
    if (!to) return "none"

    const trip = await senders.roadTable([position, destination]).catch(() => null)
    const arrivesAt = customerEtaArrivesAt(trip?.seconds[0]?.[1], now)
    const locale = customerEtaLanguage(agentLanguage(agent))

    const { token, tokenHash } = generateOneTimeToken()
    const made = await claimCustomerEtaLink({
      organizationId,
      agentId,
      routePointId: point.id,
      customerId: customer.id,
      tokenHash,
      channel,
      now,
      expiresAt: locationShareLinkExpiresAt("day", now, timezone),
    })
    if (!made) return "none"

    const words = {
      organization: agent.organization.name,
      agent: agent.name,
      time: arrivesAt ? formatTime(arrivesAt, locale, { hour: "2-digit", minute: "2-digit", timeZone: timezone }) : null,
      url: buildLocationShareLinkUrl(token, locale),
    }
    let result: { success: boolean; error?: string }
    try {
      result = channel === "whatsapp"
        ? await senders.sendWhatsAppTemplate({
            to,
            templateName: CUSTOMER_ETA_WHATSAPP_TEMPLATE,
            // The template's language, named: without it a template that is
            // not in the synced table would go as en_US, which it is not.
            languageCode: locale,
            variables: customerEtaWhatsAppVariables(locale, words),
            organizationId,
          })
        : await senders.sendSms({ to, message: customerEtaSmsText(locale, words), organizationId })
    } catch (error) {
      result = { success: false, error: customerEtaFailure(error) }
    }

    // A message that did not go leaves a link nobody has: it is ended, so the
    // row says what happened and opens nothing.
    await prisma.mtmLocationShareLink.updateMany({
      where: { id: made, organizationId },
      data: result.success
        ? { deliveryStatus: "SENT" }
        : { deliveryStatus: "FAILED", deliveryError: customerEtaFailure(result.error), revokedAt: new Date() },
    })
    return result.success ? "sent" : "failed"
  }
  return "none"
}

/**
 * Inserts the link's row, PENDING, while the switch is on — the switch read
 * FOR SHARE, so the save that switches it off (PUT /api/v1/mtm/settings, which
 * ends every bot link in the same transaction) either waits for this row or
 * comes first and is read here as «off». Null when there is nothing to send:
 * switched off, or another tick took this stop.
 */
async function claimCustomerEtaLink(input: {
  organizationId: string
  agentId: string
  routePointId: string
  customerId: string
  tokenHash: string
  channel: "sms" | "whatsapp"
  now: Date
  expiresAt: Date
}): Promise<string | null> {
  try {
    return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const kept = await tx.$queryRaw<{ value: unknown }[]>`
        SELECT "value" FROM "mtm_settings"
        WHERE "organizationId" = ${input.organizationId}
          AND "key" = 'customerEtaLinksEnabled'
        FOR SHARE
      `
      if (coerceMtmBooleanSetting(kept[0]?.value, MTM_SETTING_DEFAULTS.customerEtaLinksEnabled) !== true) return null
      const row = await tx.mtmLocationShareLink.create({
        data: {
          organizationId: input.organizationId,
          agentId: input.agentId,
          tokenHash: input.tokenHash,
          createdBy: null,
          createdAt: input.now,
          expiresAt: input.expiresAt,
          purpose: "CUSTOMER_ETA",
          routePointId: input.routePointId,
          customerId: input.customerId,
          deliveryChannel: input.channel,
          deliveryStatus: "PENDING",
        },
        select: { id: true },
      })
      return row.id
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return null
    throw error
  }
}

/**
 * One tick: every agent on shift in an organization that switched the links
 * on. A handful of agents per organization that wants it, each a few reads;
 * the deadline keeps one slow provider from holding the minute.
 */
export async function executeCustomerEtaLinkJob(now = new Date(), senders: CustomerEtaSenders = DEFAULT_SENDERS) {
  const started = Date.now()
  // A shift of «today» in some organization's zone is never older than
  // yesterday's UTC date; which one is today is the position rule's to say.
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1))
  const candidates = await prisma.$queryRaw<{ organizationId: string; agentId: string }[]>`
    SELECT DISTINCT w."organizationId", w."agentId"
    FROM mtm_agent_workdays w
    JOIN organizations o ON o.id = w."organizationId" AND o."isActive"
    WHERE w.status = 'STARTED' AND w."workDate" >= ${since}::date
      AND EXISTS (
        SELECT 1 FROM mtm_settings s
        WHERE s."organizationId" = w."organizationId" AND s.key = 'customerEtaLinksEnabled' AND s.value = 'true'::jsonb
      )
    ORDER BY w."organizationId", w."agentId"
    LIMIT ${BATCH}`
  let processed = 0, sent = 0, failed = 0, errors = 0
  for (const candidate of candidates) {
    if (Date.now() - started >= DEADLINE_MS) break
    try {
      const outcome = await runWithTenant(candidate.organizationId, () =>
        prepareCustomerEtaLink(candidate.organizationId, candidate.agentId, now, senders))
      if (outcome === "sent") sent++
      if (outcome === "failed") failed++
    } catch {
      // No names, numbers or identifiers in worker logs.
      console.error("[MTM Cron] customer ETA link failed")
      errors++
    }
    processed++
  }
  return { scanned: candidates.length, processed, sent, failed, errors }
}

export function runCustomerEtaLinkJob() {
  return runWithRlsBypass(() => withJobLease({ name: CUSTOMER_ETA_LINK_JOB, ttlMs: 120_000 }, () => executeCustomerEtaLinkJob()))
}
