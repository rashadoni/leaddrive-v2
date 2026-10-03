import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { isAgentInRouteScope, resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { canManageFieldMasterData } from "@/lib/mtm/field-scope"
import { ContactBulkAssignmentExecuteSchema, parseBody } from "@/lib/mtm-validators"
import {
  CONTACT_ASSIGNMENT_NOTHING_TO_ASSIGN,
  CONTACT_ASSIGNMENT_STALE_PREVIEW,
  contactAssignmentRequestHash,
  executeContactAssignment,
} from "@/lib/mtm/contact-bulk-assignment"

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
    const result = await prisma.$transaction((tx: Prisma.TransactionClient) => executeContactAssignment(tx, {
      organizationId: auth.orgId,
      actor,
      actorUserId: auth.userId || null,
      request: body,
      requestHash,
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
        || req.headers.get("x-real-ip")
        || null,
      userAgent: req.headers.get("user-agent") || null,
    }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    if (error instanceof Error && error.message === CONTACT_ASSIGNMENT_STALE_PREVIEW) {
      return NextResponse.json({
        error: "The preview is stale; review the latest conflicts",
        code: "MTM_CONTACT_ASSIGNMENT_STALE_PREVIEW",
      }, { status: 409 })
    }
    if (error instanceof Error && error.message === CONTACT_ASSIGNMENT_NOTHING_TO_ASSIGN) {
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
