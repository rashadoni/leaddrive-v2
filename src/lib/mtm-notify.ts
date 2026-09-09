import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"

/**
 * Create an in-app notification for an MTM agent.
 * Non-blocking by convention — callers should `.catch()` to avoid letting
 * notification failures break the primary operation (visit, alert, task).
 *
 * The mobile app polls `/api/v1/mtm/mobile/notifications` (or web /api/v1/mtm/notifications)
 * to fetch unread items.
 */
export async function notifyAgent(params: {
  organizationId: string
  agentId: string
  title: string
  body?: string | null
  type?: "info" | "warning" | "alert" | "task"
  metadata?: Record<string, unknown>
}) {
  return prisma.mtmNotification.create({
    data: {
      organizationId: params.organizationId,
      agentId: params.agentId,
      title: params.title,
      body: params.body ?? null,
      type: params.type ?? "info",
      metadata: (params.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  })
}
