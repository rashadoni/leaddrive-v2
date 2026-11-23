import type { Prisma } from "@prisma/client"
import {
  agentActivityLocale,
  agentRouteNotice,
  agentVisitNotice,
  type AgentActivityEvent,
  type AgentActivityStop,
  type AgentActivityWords,
} from "@/lib/mtm/agent-activity-notice"
import { AGENT_LANGUAGE_SELECT, agentLanguage } from "@/lib/mtm/agent-language"
import { enqueueMtmRouteNotification } from "@/lib/mtm/route-notification-enqueue"

/**
 * Queues the manager's notice inside the transaction that made the change, so
 * a route or a visit that rolled back tells nobody and one that committed
 * cannot lose its notice. The outbox's dedupe key makes a resend silent.
 */
type ActivityTx = Pick<
  Prisma.TransactionClient,
  "mtmAgent" | "mtmContact" | "mtmCustomer" | "mtmRoutePoint" | "mtmRouteNotificationOutbox"
>

const CHAIN_LIMIT = 8
/** A phone that was offline for days must not wake the manager with old visits. */
const VISIT_NOTICE_MAX_AGE_MS = 24 * 60 * 60 * 1000
const MANAGING_ROLES = new Set(["MANAGER", "SUPERVISOR", "ADMIN"])

const CARD_SELECT = {
  id: true,
  name: true,
  role: true,
  status: true,
  managerId: true,
  phone: true,
  passwordHash: true,
  userId: true,
  fieldDeletedAt: true,
  ...AGENT_LANGUAGE_SELECT,
} as const

type Recipient = { id: string; language: string | null }

/**
 * Who hears about this agent: his manager. A manager whose card has no way in
 * (no phone, password or CRM login) would never read it, so the nearest manager
 * above him who can sign in hears too. Nobody further up gets every agent's day.
 */
export async function agentActivityAudience(
  tx: Pick<ActivityTx, "mtmAgent">,
  organizationId: string,
  agentId: string,
): Promise<{ agentName: string; recipients: Recipient[] } | null> {
  const agent = await tx.mtmAgent.findFirst({
    where: { id: agentId, organizationId },
    select: CARD_SELECT,
  })
  if (!agent || agent.role !== "AGENT") return null

  const recipients: Recipient[] = []
  const seen = new Set([agent.id])
  let nextId = agent.managerId
  for (let depth = 0; nextId && depth < CHAIN_LIMIT && !seen.has(nextId); depth += 1) {
    seen.add(nextId)
    const card = await tx.mtmAgent.findFirst({
      where: { id: nextId, organizationId },
      select: CARD_SELECT,
    })
    if (!card) break
    nextId = card.managerId
    if (card.status !== "ACTIVE" || card.fieldDeletedAt || !MANAGING_ROLES.has(card.role)) continue
    recipients.push({ id: card.id, language: agentLanguage(card) })
    if (card.phone?.trim() || card.passwordHash || card.userId) break
  }
  return recipients.length > 0 ? { agentName: agent.name, recipients } : null
}

async function enqueueWords(
  tx: ActivityTx,
  input: {
    organizationId: string
    agentId: string
    recipients: readonly Recipient[]
    event: AgentActivityEvent
    /** One business event; the recipient is appended. */
    dedupeKey: string
    reference: Record<string, string | number>
    words: (recipient: Recipient) => AgentActivityWords
  },
) {
  for (const recipient of input.recipients) {
    const words = input.words(recipient)
    await enqueueMtmRouteNotification(tx, {
      organizationId: input.organizationId,
      agentId: recipient.id,
      dedupeKey: `${input.dedupeKey}:${recipient.id}`,
      title: words.title,
      body: words.body,
      type: "info",
      metadata: {
        domain: "route",
        event: input.event,
        subjectAgentId: input.agentId,
        pushBody: words.pushBody,
        ...input.reference,
      },
    })
  }
}

const STOP_SELECT = {
  id: true,
  customer: { select: { name: true } },
  contact: { select: { displayName: true } },
} as const

function stopOf(point: { customer: { name: string }; contact: { displayName: string } | null }): AgentActivityStop {
  return { customerName: point.customer.name, contactName: point.contact?.displayName ?? null }
}

/** The agent published his own route, or changed one already published. */
export async function enqueueAgentRouteActivity(
  tx: ActivityTx,
  input: {
    organizationId: string
    agentId: string
    routeId: string
    version: number
    routeDate: Date
    event: "agent_route_published" | "agent_route_updated"
    /** For a change: the stops that stayed and the ones taken out. */
    keptPointIds?: readonly string[]
    removedPointIds?: readonly string[]
  },
): Promise<void> {
  const audience = await agentActivityAudience(tx, input.organizationId, input.agentId)
  if (!audience) return
  const current = await tx.mtmRoutePoint.findMany({
    where: { organizationId: input.organizationId, routeId: input.routeId, deletedAt: null },
    orderBy: { orderIndex: "asc" },
    select: STOP_SELECT,
  })
  const kept = new Set(input.keptPointIds ?? [])
  const added = input.event === "agent_route_updated" ? current.filter((point) => !kept.has(point.id)) : []
  const removed = input.removedPointIds?.length
    ? await tx.mtmRoutePoint.findMany({
        where: { organizationId: input.organizationId, routeId: input.routeId, id: { in: [...input.removedPointIds] } },
        orderBy: { orderIndex: "asc" },
        select: STOP_SELECT,
      })
    : []
  await enqueueWords(tx, {
    organizationId: input.organizationId,
    agentId: input.agentId,
    recipients: audience.recipients,
    event: input.event,
    dedupeKey: `agent-activity:route:${input.routeId}:${input.version}:${input.event}`,
    reference: { activityRouteId: input.routeId, routeVersion: input.version },
    words: (recipient) => agentRouteNotice({
      locale: agentActivityLocale(recipient.language),
      event: input.event,
      agentName: audience.agentName,
      routeDate: input.routeDate,
      stops: current.map(stopOf),
      added: added.map(stopOf),
      removed: removed.map(stopOf),
    }),
  })
}

/**
 * The agent checked in somewhere his route did not send him next: a client who
 * is not on it, or a stop ahead of one still waiting. Starting the next stop
 * tells nobody; that is the route the manager already read.
 */
export async function enqueueAgentVisitActivity(
  tx: ActivityTx,
  input: {
    organizationId: string
    agentId: string
    visitId: string
    customerId: string
    contactId: string | null
    routePointId: string | null
    routeId: string | null
    checkInAt: Date
    timezone: string
    distanceMeters?: number | null
    now?: Date
  },
): Promise<void> {
  const now = input.now ?? new Date()
  if (now.getTime() - input.checkInAt.getTime() > VISIT_NOTICE_MAX_AGE_MS) return

  let event: "agent_visit_off_route" | "agent_visit_out_of_order" = "agent_visit_off_route"
  let expectedStop: AgentActivityStop | null = null
  if (input.routePointId && input.routeId) {
    const point = await tx.mtmRoutePoint.findFirst({
      where: { id: input.routePointId, organizationId: input.organizationId },
      select: { orderIndex: true },
    })
    if (!point) return
    const waiting = await tx.mtmRoutePoint.findFirst({
      where: {
        organizationId: input.organizationId,
        routeId: input.routeId,
        id: { not: input.routePointId },
        deletedAt: null,
        status: "PENDING",
        orderIndex: { lt: point.orderIndex },
      },
      orderBy: { orderIndex: "asc" },
      select: STOP_SELECT,
    })
    if (!waiting) return
    event = "agent_visit_out_of_order"
    expectedStop = stopOf(waiting)
  }

  const audience = await agentActivityAudience(tx, input.organizationId, input.agentId)
  if (!audience) return
  const [customer, contact] = await Promise.all([
    tx.mtmCustomer.findFirst({
      where: { id: input.customerId, organizationId: input.organizationId },
      select: { name: true, address: true },
    }),
    input.contactId
      ? tx.mtmContact.findFirst({
          where: { id: input.contactId, organizationId: input.organizationId },
          select: { displayName: true },
        })
      : Promise.resolve(null),
  ])
  if (!customer) return
  await enqueueWords(tx, {
    organizationId: input.organizationId,
    agentId: input.agentId,
    recipients: audience.recipients,
    event,
    dedupeKey: `agent-activity:visit:${input.visitId}`,
    reference: { activityVisitId: input.visitId },
    words: (recipient) => agentVisitNotice({
      locale: agentActivityLocale(recipient.language),
      event,
      agentName: audience.agentName,
      stop: { customerName: customer.name, contactName: contact?.displayName ?? null },
      address: customer.address,
      at: input.checkInAt,
      timezone: input.timezone,
      distanceMeters: input.distanceMeters,
      expectedStop,
    }),
  })
}
