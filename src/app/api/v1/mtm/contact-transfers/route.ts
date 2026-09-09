import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor, isAgentInRouteScope } from "@/lib/mtm/route-permissions"
import { canManageFieldMasterData } from "@/lib/mtm/field-scope"
import { ContactTransferExecuteSchema, parseBody } from "@/lib/mtm-validators"
import { buildContactTransferPreview, contactTransferRequestHash } from "@/lib/mtm/contact-transfer"

function utcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

function replayResponse(operation: { requestHash: string; status: string; result: unknown }, requestHash: string) {
  if (operation.requestHash !== requestHash) {
    return NextResponse.json({ error: "Idempotency key was already used for another request", code: "MTM_CONTACT_TRANSFER_IDEMPOTENCY_MISMATCH" }, { status: 409 })
  }
  if (operation.status !== "COMPLETED" || !operation.result) {
    return NextResponse.json({ error: "Transfer is still being processed", code: "MTM_CONTACT_TRANSFER_IN_PROGRESS" }, { status: 409 })
  }
  return NextResponse.json({ success: true, data: operation.result, idempotentReplay: true })
}

type StoredTransferRow = {
  contactId: string
  previousAssignmentId: string
  assignmentId: string
}

type StoredTransferResult = {
  operationId?: unknown
  effectiveFrom?: unknown
  sourceAgent?: unknown
  targetAgent?: unknown
  summary?: unknown
  transferred?: unknown
}

type TransferAssignmentProjection = {
  id: string
  contactId: string
  agentId: string
  effectiveFrom: Date
  effectiveTo: Date | null
  deletedAt: Date | null
}

function storedRows(value: unknown): StoredTransferRow[] {
  if (!Array.isArray(value)) return []
  return value.filter((row): row is StoredTransferRow => {
    if (!row || typeof row !== "object") return false
    const candidate = row as Record<string, unknown>
    return typeof candidate.contactId === "string"
      && typeof candidate.previousAssignmentId === "string"
      && typeof candidate.assignmentId === "string"
  })
}

function storedAgent(value: unknown): { id: string; name: string } | null {
  if (!value || typeof value !== "object") return null
  const candidate = value as Record<string, unknown>
  return typeof candidate.id === "string" && typeof candidate.name === "string"
    ? { id: candidate.id, name: candidate.name }
    : null
}

function storedCount(value: unknown): number {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : 0
}

export const GET = withRouteFieldRlsAuth("read", async (req, auth) => {
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor || !canManageFieldMasterData(actor)) {
    return NextResponse.json({ error: "Forbidden", code: "MTM_CONTACT_TRANSFER_FORBIDDEN" }, { status: 403 })
  }

  const operationId = new URL(req.url).searchParams.get("operationId")?.trim() ?? ""
  if (!operationId || operationId.length > 128) {
    return NextResponse.json({ error: "operationId is required", code: "MTM_CONTACT_TRANSFER_OPERATION_REQUIRED" }, { status: 400 })
  }
  const operation = await prisma.mtmContactTransferOperation.findUnique({
    where: { organizationId_idempotencyKey: { organizationId: auth.orgId, idempotencyKey: operationId } },
    select: {
      idempotencyKey: true,
      sourceAgentId: true,
      targetAgentId: true,
      effectiveFrom: true,
      status: true,
      result: true,
      completedAt: true,
    },
  })
  if (!operation) {
    return NextResponse.json({ error: "Transfer operation was not found", code: "MTM_CONTACT_TRANSFER_NOT_FOUND" }, { status: 404 })
  }
  if (![operation.sourceAgentId, operation.targetAgentId].every((id) => isAgentInRouteScope(actor, id))) {
    return NextResponse.json({ error: "Agent is outside your scope", code: "MTM_CONTACT_TRANSFER_SCOPE_DENIED" }, { status: 403 })
  }
  if (operation.status !== "COMPLETED" || !operation.result || !operation.completedAt) {
    return NextResponse.json({ error: "Transfer is still being processed", code: "MTM_CONTACT_TRANSFER_IN_PROGRESS" }, { status: 409 })
  }

  const result = operation.result as StoredTransferResult
  const rows = storedRows(result.transferred)
  const assignmentIds = rows.flatMap((row) => [row.previousAssignmentId, row.assignmentId])
  const assignments: TransferAssignmentProjection[] = assignmentIds.length > 0
    ? await prisma.mtmContactAgentAssignment.findMany({
      where: { organizationId: auth.orgId, id: { in: assignmentIds } },
      select: {
        id: true,
        contactId: true,
        agentId: true,
        effectiveFrom: true,
        effectiveTo: true,
        deletedAt: true,
      },
    })
    : []
  const byId = new Map(assignments.map((assignment) => [assignment.id, assignment]))
  const effectiveTime = operation.effectiveFrom.getTime()
  const verified = rows.filter((row) => {
    const previous = byId.get(row.previousAssignmentId)
    const current = byId.get(row.assignmentId)
    return previous?.contactId === row.contactId
      && previous.agentId === operation.sourceAgentId
      && previous.effectiveTo?.getTime() === effectiveTime
      && previous.deletedAt === null
      && current?.contactId === row.contactId
      && current.agentId === operation.targetAgentId
      && current.effectiveFrom.getTime() === effectiveTime
      && current.deletedAt === null
  }).length
  const summary = result.summary && typeof result.summary === "object"
    ? result.summary as Record<string, unknown>
    : {}
  const expected = Math.max(rows.length, storedCount(summary.transferred))
  const mismatched = Math.max(0, expected - verified)
  const checkedAt = new Date().toISOString()

  return NextResponse.json({
    success: true,
    data: {
      operationId: operation.idempotencyKey,
      effectiveFrom: operation.effectiveFrom.toISOString().slice(0, 10),
      sourceAgent: storedAgent(result.sourceAgent),
      targetAgent: storedAgent(result.targetAgent),
      summary: {
        selected: storedCount(summary.selected),
        transferred: storedCount(summary.transferred),
        excluded: storedCount(summary.excluded),
      },
      reconciliation: {
        status: mismatched === 0 ? "VERIFIED" : "MISMATCH",
        expected,
        verified,
        mismatched,
        checkedAt,
      },
      completedAt: operation.completedAt.toISOString(),
    },
  })
})

export const POST = withRouteFieldRlsAuth("write", async (req, auth) => {
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor || !canManageFieldMasterData(actor)) {
    return NextResponse.json({ error: "Forbidden", code: "MTM_CONTACT_TRANSFER_FORBIDDEN" }, { status: 403 })
  }
  const parsed = parseBody(ContactTransferExecuteSchema, await req.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const body = parsed.data
  if (![body.sourceAgentId, body.targetAgentId].every((id) => isAgentInRouteScope(actor, id))) {
    return NextResponse.json({ error: "Agent is outside your scope", code: "MTM_CONTACT_TRANSFER_SCOPE_DENIED" }, { status: 403 })
  }

  const requestHash = contactTransferRequestHash(body)
  const prior = await prisma.mtmContactTransferOperation.findUnique({
    where: { organizationId_idempotencyKey: { organizationId: auth.orgId, idempotencyKey: body.idempotencyKey } },
    select: { requestHash: true, status: true, result: true },
  })
  if (prior) return replayResponse(prior, requestHash)

  try {
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const effectiveFrom = utcDate(body.effectiveFrom)
      await tx.mtmContactTransferOperation.create({
        data: {
          organizationId: auth.orgId,
          idempotencyKey: body.idempotencyKey,
          requestHash,
          actorUserId: auth.userId || null,
          actorAgentId: actor.agentId,
          sourceAgentId: body.sourceAgentId,
          targetAgentId: body.targetAgentId,
          effectiveFrom,
          reason: body.reason,
          request: body as unknown as Prisma.InputJsonValue,
        },
      })

      const preview = await buildContactTransferPreview(tx, {
        organizationId: auth.orgId,
        contactIds: body.contactIds,
        sourceAgentId: body.sourceAgentId,
        targetAgentId: body.targetAgentId,
        effectiveFrom,
        actor,
      })
      if (preview.previewToken !== body.previewToken) throw new Error("STALE_PREVIEW")
      const transferable = preview.rows.filter((row) => row.transferable && row.currentAssignmentId)
      if (transferable.length === 0) throw new Error("NOTHING_TO_TRANSFER")

      const transferred: Array<{ contactId: string; previousAssignmentId: string; assignmentId: string }> = []
      for (const row of transferable) {
        const ended = await tx.mtmContactAgentAssignment.updateMany({
          where: {
            id: row.currentAssignmentId!,
            organizationId: auth.orgId,
            contactId: row.contactId,
            agentId: body.sourceAgentId,
            role: "PRIMARY",
            deletedAt: null,
            effectiveFrom: { lte: effectiveFrom },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveFrom } }],
          },
          data: { effectiveTo: effectiveFrom, reason: body.reason },
        })
        if (ended.count !== 1) throw new Error("STALE_PREVIEW")
        const assignment = await tx.mtmContactAgentAssignment.create({
          data: {
            organizationId: auth.orgId,
            contactId: row.contactId,
            agentId: body.targetAgentId,
            role: "PRIMARY",
            effectiveFrom,
            effectiveTo: null,
            source: "BULK_TRANSFER",
            assignedBy: auth.userId || null,
            reason: body.reason,
          },
          select: { id: true },
        })
        transferred.push({ contactId: row.contactId, previousAssignmentId: row.currentAssignmentId!, assignmentId: assignment.id })
      }

      const response = {
        operationId: body.idempotencyKey,
        effectiveFrom: body.effectiveFrom,
        sourceAgent: preview.sourceAgent,
        targetAgent: preview.targetAgent,
        summary: { ...preview.summary, transferred: transferred.length },
        transferred,
        excluded: preview.rows.filter((row) => !row.transferable),
      }
      await tx.mtmContactTransferOperation.update({
        where: { organizationId_idempotencyKey: { organizationId: auth.orgId, idempotencyKey: body.idempotencyKey } },
        data: { status: "COMPLETED", result: response as unknown as Prisma.InputJsonValue, completedAt: new Date() },
      })
      await tx.mtmAuditLog.create({
        data: {
          organizationId: auth.orgId,
          agentId: actor.agentId,
          action: "CONTACT_BULK_TRANSFER",
          entity: "contact_assignment_batch",
          entityId: body.idempotencyKey,
          metadataKind: "contact_bulk_transfer",
          oldData: { sourceAgentId: body.sourceAgentId } as Prisma.InputJsonValue,
          newData: {
            targetAgentId: body.targetAgentId,
            effectiveFrom: body.effectiveFrom,
            reason: body.reason,
            selected: preview.summary.selected,
            transferred: transferred.length,
            excluded: preview.summary.excluded,
            contactIds: transferred.map((item) => item.contactId),
          } as Prisma.InputJsonValue,
          ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null,
          userAgent: req.headers.get("user-agent") || null,
        },
      })
      return response
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    if (error instanceof Error && error.message === "STALE_PREVIEW") {
      return NextResponse.json({ error: "The preview is stale; review the latest conflicts", code: "MTM_CONTACT_TRANSFER_STALE_PREVIEW" }, { status: 409 })
    }
    if (error instanceof Error && error.message === "NOTHING_TO_TRANSFER") {
      return NextResponse.json({ error: "No selected contacts can be transferred", code: "MTM_CONTACT_TRANSFER_EMPTY" }, { status: 409 })
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const concurrent = await prisma.mtmContactTransferOperation.findUnique({
        where: { organizationId_idempotencyKey: { organizationId: auth.orgId, idempotencyKey: body.idempotencyKey } },
        select: { requestHash: true, status: true, result: true },
      })
      if (concurrent) return replayResponse(concurrent, requestHash)
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return NextResponse.json({ error: "Ownership changed while transferring; refresh the preview", code: "MTM_CONTACT_TRANSFER_CONFLICT" }, { status: 409 })
    }
    console.error("[MTM/contact-transfers POST]", error)
    return NextResponse.json({ error: "Failed to transfer contacts" }, { status: 500 })
  }
})
