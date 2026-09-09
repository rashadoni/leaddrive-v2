import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { VisitResultSchema, parseBody } from "@/lib/mtm-validators"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { mutableVisitWhere } from "@/lib/mtm/visit-scope"
import { writeMtmAudit } from "@/lib/mtm-audit"

type ResultActionKey = "VISIT_NOTE" | "FEEDBACK" | "NEXT_ACTION"
type RequirementRow = { id: string; actionKey: ResultActionKey; mode: "REQUIRED" | "OPTIONAL" | "HIDDEN" }

class VisitMutationFenceError extends Error {}

export const PUT = withRouteFieldRlsAuth("write", async (
  req,
  auth,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params
  const parsed = parseBody(VisitResultSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor) return NextResponse.json({ error: "MTM agent access required", code: "MTM_AGENT_ACCESS_REQUIRED" }, { status: 403 })

  const visit = await prisma.mtmVisit.findFirst({
    where: mutableVisitWhere(actor, auth.orgId, { id }),
    select: {
      id: true,
      agentId: true,
      customerId: true,
      status: true,
      requirementSnapshot: { select: { requirements: { select: { id: true, actionKey: true, mode: true } } } },
    },
  })
  if (!visit) return NextResponse.json({ error: "Visit not found", code: "MTM_VISIT_NOT_FOUND" }, { status: 404 })
  if (visit.status !== "CHECKED_IN") {
    return NextResponse.json({ error: "Visit is not active", code: "MTM_VISIT_NOT_ACTIVE" }, { status: 409 })
  }

  const requirementRows = (visit.requirementSnapshot?.requirements ?? []) as RequirementRow[]
  const requirements = new Map<ResultActionKey, RequirementRow>(requirementRows.map((item) => [item.actionKey, item]))
  const completedByAgentId = actor.agentId ?? visit.agentId
  const submittedActions = [
    ...(parsed.data.finalNote || parsed.data.discussedTopics.length ? ["VISIT_NOTE"] : []),
    ...(parsed.data.feedback ? ["FEEDBACK"] : []),
    ...(parsed.data.nextAction ? ["NEXT_ACTION"] : []),
  ]
  const hiddenAction = submittedActions.find((actionKey) => requirements.get(actionKey as ResultActionKey)?.mode === "HIDDEN")
  if (hiddenAction) {
    return NextResponse.json({ error: "Action is hidden for this visit", code: "MTM_VISIT_ACTION_HIDDEN", actionKey: hiddenAction }, { status: 403 })
  }

  let result
  try {
    result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // The update itself is the lock/fence: tenant, current primary-agent
      // scope, id, and active state are all re-evaluated atomically before any
      // action result or follow-up task can be written.
      const visitUpdate = await tx.mtmVisit.updateMany({
        where: mutableVisitWhere(actor, auth.orgId, { id, status: "CHECKED_IN" }),
        data: {
          outcome: parsed.data.outcome,
          potential: parsed.data.potential,
          resultNotes: parsed.data.finalNote || null,
          nextActionDueAt: parsed.data.nextAction ? new Date(parsed.data.nextAction.dueDate) : null,
        },
      })
      if (visitUpdate.count !== 1) throw new VisitMutationFenceError()

      const updatedVisit = await tx.mtmVisit.findFirst({
        where: mutableVisitWhere(actor, auth.orgId, { id }),
      })
      if (!updatedVisit) throw new VisitMutationFenceError()

      async function upsertAction(actionKey: ResultActionKey, evidence: Prisma.InputJsonValue) {
        const requirement = requirements.get(actionKey)
        const existing = await tx.mtmVisitActionResult.findFirst({
          where: { organizationId: auth.orgId, visitId: id, actionKey },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        })
        if (existing) {
          const actionUpdate = await tx.mtmVisitActionResult.updateMany({
            where: { id: existing.id, organizationId: auth.orgId, visitId: id, actionKey },
            data: { status: "COMPLETED", evidence, completedByAgentId, completedAt: new Date() },
          })
          if (actionUpdate.count !== 1) throw new VisitMutationFenceError()
          return
        }
        await tx.mtmVisitActionResult.create({
          data: {
            organizationId: auth.orgId,
            visitId: id,
            requirementId: requirement?.id ?? null,
            actionKey,
            status: "COMPLETED",
            evidence,
            completedByAgentId,
            completedAt: new Date(),
          },
        })
      }

      async function clearAction(actionKey: ResultActionKey) {
        await tx.mtmVisitActionResult.updateMany({
          where: { organizationId: auth.orgId, visitId: id, actionKey },
          data: {
            status: "PENDING",
            evidence: Prisma.JsonNull,
            completedByAgentId: null,
            completedAt: null,
          },
        })
      }

      if (parsed.data.finalNote || parsed.data.discussedTopics.length) {
        await upsertAction("VISIT_NOTE", { finalNote: parsed.data.finalNote ?? null, discussedTopics: parsed.data.discussedTopics })
      } else {
        await clearAction("VISIT_NOTE")
      }
      if (parsed.data.feedback) await upsertAction("FEEDBACK", { feedback: parsed.data.feedback })
      else await clearAction("FEEDBACK")

      let nextActionTask = null
      const sourceKey = `visit-next-action:${id}`
      if (parsed.data.nextAction) {
        await upsertAction("NEXT_ACTION", parsed.data.nextAction)
        const existingTask = await tx.mtmTask.findFirst({
          where: { organizationId: auth.orgId, sourceKey },
          select: { id: true, visitId: true, deletedAt: true },
        })
        if (existingTask) {
          // sourceKey is unique per tenant. Never let a corrupt/caller-created
          // collision redirect this visit result into another or deleted task.
          if (existingTask.visitId !== id || existingTask.deletedAt !== null) {
            throw new VisitMutationFenceError()
          }
          const taskUpdate = await tx.mtmTask.updateMany({
            where: { id: existingTask.id, organizationId: auth.orgId, visitId: id, sourceKey, deletedAt: null },
            data: {
              agentId: updatedVisit.agentId,
              customerId: updatedVisit.customerId,
              visitId: id,
              title: parsed.data.nextAction.title,
              dueDate: new Date(parsed.data.nextAction.dueDate),
              priority: parsed.data.nextAction.priority ?? "MEDIUM",
              status: "PENDING",
              completedAt: null,
            },
          })
          if (taskUpdate.count !== 1) throw new VisitMutationFenceError()
          nextActionTask = await tx.mtmTask.findFirst({
            where: { id: existingTask.id, organizationId: auth.orgId, visitId: id, sourceKey, deletedAt: null },
          })
          if (!nextActionTask) throw new VisitMutationFenceError()
        } else {
          nextActionTask = await tx.mtmTask.create({
            data: {
              organizationId: auth.orgId,
              agentId: updatedVisit.agentId,
              customerId: updatedVisit.customerId,
              visitId: id,
              sourceKey,
              title: parsed.data.nextAction.title,
              dueDate: new Date(parsed.data.nextAction.dueDate),
              priority: parsed.data.nextAction.priority ?? "MEDIUM",
              status: "PENDING",
            },
          })
        }
      } else {
        await clearAction("NEXT_ACTION")
        const existingTask = await tx.mtmTask.findFirst({
          where: { organizationId: auth.orgId, sourceKey },
          select: { id: true, visitId: true, deletedAt: true },
        })
        if (existingTask) {
          if (existingTask.visitId !== id || existingTask.deletedAt !== null) {
            throw new VisitMutationFenceError()
          }
          const taskUpdate = await tx.mtmTask.updateMany({
            where: { id: existingTask.id, organizationId: auth.orgId, visitId: id, sourceKey, deletedAt: null },
            data: {
              agentId: updatedVisit.agentId,
              customerId: updatedVisit.customerId,
              visitId: id,
              status: "CANCELLED",
              completedAt: null,
            },
          })
          if (taskUpdate.count !== 1) throw new VisitMutationFenceError()
          nextActionTask = await tx.mtmTask.findFirst({
            where: { id: existingTask.id, organizationId: auth.orgId, visitId: id, sourceKey, deletedAt: null },
          })
          if (!nextActionTask) throw new VisitMutationFenceError()
        }
      }
      return { visit: updatedVisit, nextActionTask }
    })
  } catch (error) {
    if (error instanceof VisitMutationFenceError) {
      return NextResponse.json({ error: "Visit changed while saving", code: "MTM_VISIT_MUTATION_CONFLICT" }, { status: 409 })
    }
    throw error
  }

  await writeMtmAudit({
    organizationId: auth.orgId,
    agentId: completedByAgentId,
    action: "VISIT_RESULT_UPDATE",
    entity: "visit",
    entityId: id,
    metadataKind: "visit_result",
    newData: { outcome: parsed.data.outcome, potential: parsed.data.potential, hasNextAction: Boolean(parsed.data.nextAction) },
    req,
  }).catch((error) => console.warn("[MTM/visits/[id]/result PUT] audit failed", error))

  return NextResponse.json({ success: true, data: result })
})
