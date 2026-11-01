import { randomUUID } from "node:crypto"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withJobLease } from "@/lib/cron/job-lease"
import { runWithRlsBypass } from "@/lib/rls-context"
import { getTenantCapabilityAccess } from "@/lib/tenant-capability-access"
import { logMtmRouteObservability } from "@/lib/mtm/route-observability"
import { AGENT_LANGUAGE_SELECT, agentLanguage } from "@/lib/mtm/agent-language"
import { MTM_TEAM_MESSAGES_PUSH_CHANNEL, notifyAgents } from "@/lib/mtm/push-notify"
import { isRouteNoticeEvent, routeNotice, routeNoticeLocale } from "@/lib/mtm/route-notice"

const ROUTE_FIELD_CAPABILITY = "route-field"
const OUTBOX_LEASE_MS = 60_000
const OUTBOX_MAX_ATTEMPTS = 5
const OUTBOX_MAX_BATCH_SIZE = 100

export type MtmRouteNotificationType = "info" | "warning" | "alert" | "task"

export interface MtmRouteNotificationMessage {
  organizationId: string
  agentId: string
  /** Stable business-event identity, unique inside one tenant. */
  dedupeKey: string
  title: string
  body?: string | null
  type?: MtmRouteNotificationType
  metadata?: Record<string, unknown>
}

export interface MtmRouteNotificationOutboxDrainOptions {
  organizationId?: string
  now?: Date
  limit?: number
}

export interface MtmRouteNotificationOutboxDrainResult {
  examined: number
  claimed: number
  delivered: number
  suppressed: number
  deferred: number
  failed: number
}

type OutboxTransaction = Pick<Prisma.TransactionClient, "mtmRouteNotificationOutbox">

function validateMessage(message: MtmRouteNotificationMessage) {
  if (!message.organizationId || !message.agentId || !message.dedupeKey || !message.title) {
    throw new Error("MTM route notification outbox requires organization, agent, dedupe key, and title")
  }
}

/**
 * Call only from the business transaction that made the source change. The
 * no-op update preserves the first committed notification text and makes a
 * retried business request idempotent without rewriting delivery evidence.
 */
export async function enqueueMtmRouteNotification(
  tx: OutboxTransaction,
  message: MtmRouteNotificationMessage,
) {
  validateMessage(message)
  return tx.mtmRouteNotificationOutbox.upsert({
    where: {
      organizationId_dedupeKey: {
        organizationId: message.organizationId,
        dedupeKey: message.dedupeKey,
      },
    },
    create: {
      organizationId: message.organizationId,
      agentId: message.agentId,
      dedupeKey: message.dedupeKey,
      title: message.title,
      body: message.body ?? null,
      type: message.type ?? "info",
      metadata: message.metadata as Prisma.InputJsonValue | undefined,
    },
    update: {},
  })
}

function retryAt(now: Date, attempts: number): Date {
  const delayMs = Math.min(15 * 60_000, 15_000 * 2 ** Math.max(0, attempts - 1))
  return new Date(now.getTime() + delayMs)
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  return message.slice(0, 1_000)
}

function boundedLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 50
  return Math.min(OUTBOX_MAX_BATCH_SIZE, Math.max(1, Math.floor(value!)))
}

function outboxDrainOutcome(result: MtmRouteNotificationOutboxDrainResult): "DELIVERED" | "SUPPRESSED" | "DEFERRED" | "FAILED" | "EMPTY" {
  if (result.failed > 0) return "FAILED"
  if (result.deferred > 0 || (result.examined > 0 && result.claimed === 0)) return "DEFERRED"
  if (result.delivered > 0) return "DELIVERED"
  if (result.suppressed > 0) return "SUPPRESSED"
  return "EMPTY"
}

function oldestQueueAgeMs(candidates: Array<{ createdAt: Date }>, now: Date): number | null {
  const oldest = candidates.reduce<Date | null>((current, candidate) => {
    return current === null || candidate.createdAt < current ? candidate.createdAt : current
  }, null)
  return oldest ? Math.max(0, now.getTime() - oldest.getTime()) : null
}

/**
 * Materialize durable rows as existing in-app notifications. Claim leases are
 * compare-and-set; the `(organizationId, outboxId)` uniqueness constraint on
 * MtmNotification makes a crash between the upsert and DELIVERED mark safe.
 */
/**
 * A route published or changed is told in the agent's own language, with the
 * day and the number of visits (route-notice.ts), and pushed to his phone.
 * Any other route notice keeps the words it was queued with, and no push.
 */
async function routeNoticeWords(candidate: { organizationId: string; agentId: string; metadata: Prisma.JsonValue | null }) {
  const metadata = candidate.metadata && typeof candidate.metadata === "object" && !Array.isArray(candidate.metadata)
    ? candidate.metadata as Record<string, unknown>
    : null
  const event = metadata?.event
  const routeId = metadata?.routeId
  if (!isRouteNoticeEvent(event) || typeof routeId !== "string") return null
  const [agent, route] = await Promise.all([
    prisma.mtmAgent.findFirst({ where: { id: candidate.agentId, organizationId: candidate.organizationId }, select: AGENT_LANGUAGE_SELECT }),
    prisma.mtmRoute.findFirst({
      where: { id: routeId, organizationId: candidate.organizationId },
      select: { date: true, _count: { select: { points: { where: { deletedAt: null } } } } },
    }),
  ])
  if (!route) return null
  return {
    routeId,
    ...routeNotice({ locale: routeNoticeLocale(agentLanguage(agent)), event, routeDate: route.date, visitCount: route._count.points }),
  }
}

export async function drainMtmRouteNotificationOutbox(
  options: MtmRouteNotificationOutboxDrainOptions = {},
): Promise<MtmRouteNotificationOutboxDrainResult> {
  const startedAt = Date.now()
  const now = options.now ?? new Date()
  const limit = boundedLimit(options.limit)
  const where: Prisma.MtmRouteNotificationOutboxWhereInput = {
    ...(options.organizationId ? { organizationId: options.organizationId } : {}),
    availableAt: { lte: now },
    OR: [
      { status: "PENDING", leaseUntil: null },
      { status: "PENDING", leaseUntil: { lt: now } },
      { status: "PROCESSING", leaseUntil: { lt: now } },
    ],
  }
  const candidates = await prisma.mtmRouteNotificationOutbox.findMany({
    where,
    orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }],
    take: limit,
  })
  const result: MtmRouteNotificationOutboxDrainResult = {
    examined: candidates.length,
    claimed: 0,
    delivered: 0,
    suppressed: 0,
    deferred: 0,
    failed: 0,
  }

  for (const candidate of candidates) {
    const leaseToken = randomUUID()
    const leaseUntil = new Date(now.getTime() + OUTBOX_LEASE_MS)
    const claimed = await prisma.mtmRouteNotificationOutbox.updateMany({
      where: {
        id: candidate.id,
        availableAt: { lte: now },
        OR: [
          { status: "PENDING", leaseUntil: null },
          { status: "PENDING", leaseUntil: { lt: now } },
          { status: "PROCESSING", leaseUntil: { lt: now } },
        ],
      },
      data: {
        status: "PROCESSING",
        leaseToken,
        leaseUntil,
        attempts: { increment: 1 },
      },
    })
    if (claimed.count !== 1) continue
    result.claimed++

    try {
      const capability = await getTenantCapabilityAccess(candidate.organizationId, ROUTE_FIELD_CAPABILITY)
      if (!capability.allowed) {
        const suppressed = await prisma.mtmRouteNotificationOutbox.updateMany({
          where: { id: candidate.id, status: "PROCESSING", leaseToken },
          data: {
            status: "SUPPRESSED",
            leaseToken: null,
            leaseUntil: null,
            suppressedAt: now,
            lastError: `Tenant capability ${ROUTE_FIELD_CAPABILITY} is not enabled`,
          },
        })
        if (suppressed.count === 1) result.suppressed++
        else result.deferred++
        continue
      }

      const words = await routeNoticeWords(candidate)
      const delivered = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.mtmNotification.upsert({
          where: {
            organizationId_outboxId: {
              organizationId: candidate.organizationId,
              outboxId: candidate.id,
            },
          },
          create: {
            organizationId: candidate.organizationId,
            agentId: candidate.agentId,
            outboxId: candidate.id,
            title: words?.title ?? candidate.title,
            body: words?.body ?? candidate.body,
            type: candidate.type,
            metadata: candidate.metadata === null ? Prisma.JsonNull : candidate.metadata as Prisma.InputJsonValue,
          },
          update: {},
        })
        const marked = await tx.mtmRouteNotificationOutbox.updateMany({
          where: { id: candidate.id, status: "PROCESSING", leaseToken },
          data: {
            status: "DELIVERED",
            leaseToken: null,
            leaseUntil: null,
            deliveredAt: now,
            lastError: null,
          },
        })
        return marked.count === 1
      })
      if (delivered) result.delivered++
      else result.deferred++
      if (delivered && words) {
        // The bell line is written; a push that fails takes nothing back.
        await notifyAgents({
          client: prisma,
          organizationId: candidate.organizationId,
          agentIds: [candidate.agentId],
          title: words.title,
          body: words.body,
          data: { routeId: words.routeId },
          channelId: MTM_TEAM_MESSAGES_PUSH_CHANNEL,
        }).catch(() => undefined)
      }
    } catch (error) {
      const attempts = candidate.attempts + 1
      const exhausted = attempts >= OUTBOX_MAX_ATTEMPTS
      const recovered = await prisma.mtmRouteNotificationOutbox.updateMany({
        where: { id: candidate.id, status: "PROCESSING", leaseToken },
        data: {
          status: exhausted ? "FAILED" : "PENDING",
          leaseToken: null,
          leaseUntil: null,
          availableAt: exhausted ? candidate.availableAt : retryAt(now, attempts),
          lastError: safeError(error),
        },
      }).catch(() => ({ count: 0 }))
      if (recovered.count !== 1) result.deferred++
      else if (exhausted) result.failed++
      else result.deferred++
    }
  }

  logMtmRouteObservability({
    operation: "ROUTE_NOTIFICATION_OUTBOX_DRAIN",
    outcome: outboxDrainOutcome(result),
    durationMs: Date.now() - startedAt,
    rowCount: result.examined,
    queueAgeMs: oldestQueueAgeMs(candidates, now),
    outbox: {
      claimed: result.claimed,
      delivered: result.delivered,
      suppressed: result.suppressed,
      deferred: result.deferred,
      failed: result.failed,
    },
  })
  return result
}

/** Cron wrapper is intentionally separate from producer transactions. */
export function runMtmRouteNotificationOutboxJob() {
  return runWithRlsBypass(() =>
    withJobLease(
      { name: "mtm-route-notification-outbox", ttlMs: 5 * 60_000 },
      () => drainMtmRouteNotificationOutbox(),
    ),
  )
}
