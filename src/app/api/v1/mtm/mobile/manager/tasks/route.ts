import { z } from "zod"
import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { requireMobileCapability } from "@/lib/mtm/mobile-capabilities"
import { resolveAgentScope } from "@/lib/mtm/territory-scope"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { getMtmSettings } from "@/lib/mtm-settings"
import { isValidTimezone } from "@/lib/timezone"
import { isQuickTaskDueChoice, quickTaskDueDate } from "@/lib/mtm/task-quick-due"
import { notifyAgentOfAssignedTask } from "@/lib/mtm/task-assigned-notify"
import { agentsReachableByPush } from "@/lib/mtm/agent-task-glance"

/**
 * «Дать задачу» on the manager's phone (owner, 2026-10-20: «чтоб была
 * возможность создавать задачи менеджерам через приложение»; mockup approved
 * with «Давай»). Three fields, as in the panel: whom, what, and a day —
 * «today», «tomorrow», «none» or a date, turned into an instant by the same
 * rule the panel uses (task-quick-due.ts).
 *
 * The task is the panel's task: the same row, the same CREATED event, the same
 * audit, and the agent hears of it the same way (task-assigned-notify.ts).
 * Only an active agent in the manager's scope, never the manager himself.
 *
 * A phone on a bad network sends again when the answer is lost. The same text
 * to the same agent within two minutes is the same task: answered, not doubled.
 */

const CreateSchema = z.object({
  agentId: z.string().trim().min(1).max(128),
  title: z.string().trim().min(1).max(200),
  due: z.string().trim().min(1).max(10),
}).strict()

const REPLAY_WINDOW_MS = 2 * 60 * 1000

function refuse(status: number, code: string, error: string) {
  return NextResponse.json({ success: false, error, code }, { status })
}

/** POST /api/v1/mtm/mobile/manager/tasks — the manager gives an agent a task. */
export const POST = withMobileRls(async (req, auth) => {
  const forbidden = requireMobileCapability(auth, "TEAM_DECIDE")
  if (forbidden) return forbidden

  const parsed = CreateSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success || !isQuickTaskDueChoice(parsed.data.due)) {
    return refuse(400, "MTM_TASK_INVALID", "Choose the agent, write the task and its day")
  }
  const body = parsed.data

  try {
    if (body.agentId === auth.agentId) return refuse(403, "MTM_TASK_SCOPE_DENIED", "Choose an agent of your team")
    const scope = await resolveAgentScope(prisma, {
      organizationId: auth.orgId,
      agentId: auth.agentId,
      role: auth.role as "ADMIN" | "MANAGER" | "SUPERVISOR" | "AGENT",
    })
    if (scope.agentIds !== null && !scope.agentIds.includes(body.agentId)) {
      return refuse(403, "MTM_TASK_SCOPE_DENIED", "Choose an agent of your team")
    }
    const agent = await prisma.mtmAgent.findFirst({
      where: { id: body.agentId, organizationId: auth.orgId, status: "ACTIVE" },
      select: { id: true, name: true },
    })
    if (!agent) return refuse(403, "MTM_TASK_SCOPE_DENIED", "Choose an agent of your team")

    const settings = await getMtmSettings(auth.orgId)
    const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
    const now = new Date()
    let dueDate: Date | null
    try {
      dueDate = quickTaskDueDate(body.due, now, timezone)
    } catch {
      return refuse(400, "MTM_TASK_DUE_IN_PAST", "The day has already passed")
    }

    const pushReady = (await agentsReachableByPush(prisma, auth.orgId, [agent.id])).has(agent.id)
    const answer = (task: { id: string; title: string; dueDate: Date | null }, status: number) =>
      NextResponse.json({ success: true, data: { task: { id: task.id, title: task.title, dueDate: task.dueDate }, agent, pushReady } }, { status })

    const replay = await prisma.mtmTask.findFirst({
      where: {
        organizationId: auth.orgId,
        agentId: agent.id,
        title: body.title,
        deletedAt: null,
        createdAt: { gte: new Date(now.getTime() - REPLAY_WINDOW_MS) },
        events: { some: { type: "CREATED", evidence: { path: ["actorAgentId"], equals: auth.agentId } } },
      },
      select: { id: true, title: true, dueDate: true },
    })
    if (replay) return answer(replay, 200)

    const task = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const created = await tx.mtmTask.create({
        data: { organizationId: auth.orgId, agentId: agent.id, title: body.title, priority: "MEDIUM", dueDate },
        select: { id: true, title: true, dueDate: true },
      })
      await tx.mtmTaskEvent.create({
        data: {
          organizationId: auth.orgId,
          taskId: created.id,
          agentId: agent.id,
          type: "CREATED",
          occurredAt: now,
          toStatus: "PENDING",
          evidence: { kind: "MTM_TASK_CREATED", actorAgentId: auth.agentId, actorRole: auth.role, actorName: auth.name, channel: "mobile" },
        },
      })
      return created
    })

    await writeMtmAudit({
      organizationId: auth.orgId,
      agentId: agent.id,
      action: "TASK_CREATE",
      entity: "task",
      entityId: task.id,
      metadataKind: "task_create",
      newData: { title: task.title, dueDate: task.dueDate, priority: "MEDIUM", channel: "mobile" },
      req,
    }).catch((error) => console.warn("[MTM/mobile/manager/tasks POST] audit failed", error))

    await notifyAgentOfAssignedTask({
      organizationId: auth.orgId,
      taskId: task.id,
      agentId: agent.id,
      taskTitle: task.title,
      dueDate: task.dueDate,
      timezone,
      giverAgentId: auth.agentId,
      giverName: auth.name,
    }).catch((error) => console.warn("[MTM/mobile/manager/tasks POST] agent notice failed", error))

    return answer(task, 201)
  } catch (error) {
    console.error("[MTM/mobile/manager/tasks POST]", error)
    return refuse(500, "MTM_TASK_UNAVAILABLE", "Failed to give the task")
  }
}, { requiredCapability: "route-field" })
