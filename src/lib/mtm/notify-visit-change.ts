/**
 * G (Creatio 10X roadmap — MTM Offline PWA) — push route-change events.
 *
 * When a MANAGER (or anyone other than the agent) reassigns or cancels a field
 * agent's visit, push the affected agent so their offline PWA / device learns
 * about the change. Reuses createNotification, which persists an in-app
 * notification AND fires a best-effort web push. Silent (returns false) when the
 * agent has no CRM user (native-app-only) or when the actor IS the agent.
 */
import { prisma } from "@/lib/prisma"
import { createNotification } from "@/lib/notifications"

export type MtmVisitChange = "assigned" | "unassigned" | "cancelled"

const MESSAGES: Record<MtmVisitChange, { type: "info" | "warning"; title: string; message: string }> = {
  assigned: { type: "info", title: "Вам назначен визит", message: "Менеджер назначил вам визит" },
  unassigned: { type: "info", title: "Визит переназначен", message: "Ваш визит передан другому агенту" },
  cancelled: { type: "warning", title: "Визит отменён", message: "Менеджер отменил ваш визит" },
}

/**
 * Notify the CRM user behind `agentId` about a visit change. Non-fatal: a
 * failure never breaks the mutation that triggered it. Returns true when a
 * notification was actually created.
 */
export async function notifyMtmAgentOfVisitChange(opts: {
  organizationId: string
  actorUserId: string | null
  agentId: string
  change: MtmVisitChange
  visitId: string
}): Promise<boolean> {
  try {
    const agent = await prisma.mtmAgent.findFirst({
      where: { id: opts.agentId, organizationId: opts.organizationId },
      select: { userId: true },
    })
    const userId = agent?.userId
    if (!userId) return false // native-app-only agent — no web push target
    if (userId === opts.actorUserId) return false // the agent changed it themselves

    const m = MESSAGES[opts.change]
    await createNotification({
      organizationId: opts.organizationId,
      userId,
      type: m.type,
      title: m.title,
      message: m.message,
      entityType: "mtm_visit",
      entityId: opts.visitId,
      push: true,
      kind: `mtm.visit.${opts.change}`,
    })
    return true
  } catch (e) {
    console.warn("[notifyMtmAgentOfVisitChange] failed (non-fatal):", e)
    return false
  }
}
