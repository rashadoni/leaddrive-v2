import type { Prisma } from "@prisma/client"

/**
 * Putting a route notice in the outbox, and nothing else. Apart from the drain
 * (route-notification-outbox.ts) on purpose: the drain brings the logger, whose
 * development transport needs a package that is not installed, and a request
 * handler that only queues a notice must not load it. Importing the drain into
 * the phone's sync route made every sync answer 500 under `next dev`.
 */
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
