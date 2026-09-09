import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { isAgentInRouteScope, resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { canManageFieldMasterData } from "@/lib/mtm/field-scope"
import { ContactBulkAssignmentExecuteSchema, parseBody } from "@/lib/mtm-validators"
import {
  buildContactAssignmentPreview,
  contactAssignmentRequestHash,
} from "@/lib/mtm/contact-bulk-assignment"

function utcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

function replay(operation: { requestHash: string; status: string; result: unknown }, requestHash: string) {
  if (operation.requestHash !== requestHash) {
    return NextResponse.json({
      error: "Idempotency key was already used for another request",
      code: "MTM_CONTACT_ASSIGNMENT_IDEMPOTENCY_MISMATCH",
    }, { status: 409 })
  }
  if (operation.status !== "COMPLETED" || !operation.result) {
    return NextResponse.json({
      error: "Assignment is still being processed",
      code: "MTM_CONTACT_ASSIGNMENT_IN_PROGRESS",
    }, { status: 409 })
  }
  return NextResponse.json({ success: true, data: operation.result, idempotentReplay: true })
}

export const POST = withRouteFieldRlsAuth("write", async (req, auth) => {
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor || !canManageFieldMasterData(actor)) {
    return NextResponse.json({ error: "Forbidden", code: "MTM_CONTACT_ASSIGNMENT_FORBIDDEN" }, { status: 403 })
  }
  const parsed = parseBody(ContactBulkAssignmentExecuteSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const body = parsed.data
  if (body.targetAgentId && !isAgentInRouteScope(actor, body.targetAgentId)) {
    return NextResponse.json({
      error: "Agent is outside your scope",
      code: "MTM_CONTACT_ASSIGNMENT_SCOPE_DENIED",
    }, { status: 403 })
  }
  const requestHash = contactAssignmentRequestHash(body)
  const prior = await prisma.mtmContactAssignmentOperation.findUnique({
    where: {
      organizationId_idempotencyKey: {
        organizationId: auth.orgId,
        idempotencyKey: body.idempotencyKey,
      },
    },
    select: { requestHash: true, status: true, result: true },
  })
  if (prior) return replay(prior, requestHash)

  try {
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const effectiveFrom = utcDate(body.effectiveFrom)
      await tx.mtmContactAssignmentOperation.create({
        data: {
          organizationId: auth.orgId,
          idempotencyKey: body.idempotencyKey,
          requestHash,
          actorUserId: auth.userId || null,
          actorAgentId: actor.agentId,
          targetAgentId: body.targetAgentId ?? null,
          effectiveFrom,
          reason: body.reason,
          mode: body.mode,
          request: body as unknown as Prisma.InputJsonValue,
        },
      })
      const preview = await buildContactAssignmentPreview(tx, {
        organizationId: auth.orgId,
        contactIds: body.contactIds,
        mode: body.mode,
        targetAgentId: body.targetAgentId,
        effectiveFrom,
        actor,
      })
      if (preview.previewToken !== body.previewToken) throw new Error("STALE_PREVIEW")
      const eligible = preview.rows.filter((row) => row.assignable)
      if (eligible.length === 0) throw new Error("NOTHING_TO_ASSIGN")

      const changed: Array<{
        contactId: string
        endedAssignmentIds: string[]
        assignmentId: string | null
      }> = []
      for (const row of eligible) {
        const endedAssignmentIds: string[] = []
        for (const currentAssignmentId of row.currentAssignmentIds) {
          const ended = await tx.mtmContactAgentAssignment.updateMany({
            where: {
              id: currentAssignmentId,
              organizationId: auth.orgId,
              contactId: row.contactId,
              role: "PRIMARY",
              deletedAt: null,
              effectiveFrom: { lte: effectiveFrom },
              OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveFrom } }],
            },
            data: { effectiveTo: effectiveFrom, reason: body.reason },
          })
          if (ended.count !== 1) throw new Error("STALE_PREVIEW")
          endedAssignmentIds.push(currentAssignmentId)
        }
        let assignmentId: string | null = null
        if (body.mode === "ASSIGN" && body.targetAgentId) {
          const assignment = await tx.mtmContactAgentAssignment.create({
            data: {
              organizationId: auth.orgId,
              contactId: row.contactId,
              agentId: body.targetAgentId,
              role: "PRIMARY",
              effectiveFrom,
              source: "BULK_ASSIGNMENT",
              assignedBy: auth.userId || null,
              reason: body.reason,
            },
            select: { id: true },
          })
          assignmentId = assignment.id
        }
        changed.push({ contactId: row.contactId, endedAssignmentIds, assignmentId })
      }

      const response = {
        operationId: body.idempotencyKey,
        mode: body.mode,
        effectiveFrom: body.effectiveFrom,
        targetAgent: preview.targetAgent,
        summary: { ...preview.summary, changed: changed.length },
        changed,
        excluded: preview.rows.filter((row) => !row.assignable),
      }
      await tx.mtmContactAssignmentOperation.update({
        where: {
          organizationId_idempotencyKey: {
            organizationId: auth.orgId,
            idempotencyKey: body.idempotencyKey,
          },
        },
        data: {
          status: "COMPLETED",
          result: response as unknown as Prisma.InputJsonValue,
          completedAt: new Date(),
        },
      })
      await tx.mtmAuditLog.create({
        data: {
          organizationId: auth.orgId,
          agentId: actor.agentId,
          action: body.mode === "ASSIGN" ? "CONTACT_BULK_ASSIGN" : "CONTACT_BULK_UNASSIGN",
          entity: "contact_assignment_batch",
          entityId: body.idempotencyKey,
          metadataKind: "contact_bulk_assignment",
          oldData: { selected: preview.summary.selected } as Prisma.InputJsonValue,
          newData: {
            mode: body.mode,
            targetAgentId: body.targetAgentId ?? null,
            effectiveFrom: body.effectiveFrom,
            reason: body.reason,
            changed: changed.length,
            excluded: preview.summary.excluded,
            contactIds: changed.map((item) => item.contactId),
          } as Prisma.InputJsonValue,
          ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
            || req.headers.get("x-real-ip")
            || null,
          userAgent: req.headers.get("user-agent") || null,
        },
      })
      return response
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    if (error instanceof Error && error.message === "STALE_PREVIEW") {
      return NextResponse.json({
        error: "The preview is stale; review the latest conflicts",
        code: "MTM_CONTACT_ASSIGNMENT_STALE_PREVIEW",
      }, { status: 409 })
    }
    if (error instanceof Error && error.message === "NOTHING_TO_ASSIGN") {
      return NextResponse.json({
        error: "No selected contacts can be changed",
        code: "MTM_CONTACT_ASSIGNMENT_EMPTY",
      }, { status: 409 })
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const concurrent = await prisma.mtmContactAssignmentOperation.findUnique({
        where: {
          organizationId_idempotencyKey: {
            organizationId: auth.orgId,
            idempotencyKey: body.idempotencyKey,
          },
        },
        select: { requestHash: true, status: true, result: true },
      })
      if (concurrent) return replay(concurrent, requestHash)
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return NextResponse.json({
        error: "Assignments changed concurrently; refresh the preview",
        code: "MTM_CONTACT_ASSIGNMENT_CONFLICT",
      }, { status: 409 })
    }
    console.error("[MTM/contact-assignments POST]", error)
    return NextResponse.json({ error: "Failed to update contact assignments" }, { status: 500 })
  }
})
