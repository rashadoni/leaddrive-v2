import type { Prisma } from "@prisma/client"
import type { MtmRouteActor } from "@/lib/mtm/route-permissions"
import { isAgentInRouteScope } from "@/lib/mtm/route-permissions"

export type MtmTaskAccessTarget = {
  agentId: string
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "OVERDUE"
}

export function isMtmTaskManager(actor: MtmRouteActor): boolean {
  return actor.role === "ADMIN" || actor.role === "MANAGER" || actor.role === "SUPERVISOR"
}

export function canViewMtmTask(actor: MtmRouteActor, target: Pick<MtmTaskAccessTarget, "agentId">): boolean {
  if (actor.role === "AGENT") return actor.agentId === target.agentId
  return isAgentInRouteScope(actor, target.agentId)
}

export function canManageMtmTask(actor: MtmRouteActor, target: MtmTaskAccessTarget): boolean {
  return isMtmTaskManager(actor) && target.status !== "COMPLETED" && target.status !== "CANCELLED" && canViewMtmTask(actor, target)
}

export function canExecuteMtmTask(actor: MtmRouteActor, target: MtmTaskAccessTarget): boolean {
  return actor.agentId === target.agentId && target.status !== "COMPLETED" && target.status !== "CANCELLED"
}

export function mtmTaskScopeWhere(actor: MtmRouteActor): Prisma.MtmTaskWhereInput {
  if (actor.scopedAgentIds === null) return {}
  return { agentId: { in: [...actor.scopedAgentIds] } }
}

export function mtmTaskCapabilities(actor: MtmRouteActor, target?: MtmTaskAccessTarget) {
  const manager = isMtmTaskManager(actor)
  const visible = target ? canViewMtmTask(actor, target) : true
  const terminal = target ? target.status === "COMPLETED" || target.status === "CANCELLED" : false
  const own = target ? actor.agentId === target.agentId : actor.role === "AGENT"

  return {
    canCreate: manager || actor.agentId !== null,
    canEditMetadata: visible && manager && !terminal,
    canExecute: visible && own && !terminal,
    canDelete: visible && manager && !terminal,
    canReview: visible && manager && target?.status === "COMPLETED",
    canDuplicate: visible && manager,
    canComment: visible,
    // Evidence is append-only and may arrive after an offline completion.
    canUploadEvidence: visible,
    canBulkReassign: manager,
  }
}

export function mtmTaskVersionConflict(task: unknown) {
  return {
    error: "Task was changed by another request",
    code: "MTM_TASK_VERSION_CONFLICT",
    task,
  }
}

export function mtmTaskIsTerminal(status: MtmTaskAccessTarget["status"]): boolean {
  return status === "COMPLETED" || status === "CANCELLED"
}
