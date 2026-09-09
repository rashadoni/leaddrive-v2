import { mkdir, unlink, writeFile } from "node:fs/promises"
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withMtmRlsAuth, type MtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { requireMobileCapability } from "@/lib/mtm/mobile-capabilities"
import {
  createMobileDocumentStorageKey,
  mobileDocumentSha256,
  mobileDocumentStorageRoot,
  resolveMobileDocumentStoragePath,
  validateMobileDocument,
  validateMobileDocumentBytes,
} from "@/lib/mtm/mobile-document"
import { pharmacyPromotionHash } from "@/lib/mtm/pharmacy-promotion"
import { PharmacyPromotionEvidenceMetadataSchema } from "@/lib/mtm/pharmacy-promotion-validators"

type RouteContext = { params: Promise<{ id: string }> }

function actorFor(auth: MtmRlsAuth) {
  return resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
}

function executionScope(actor: Awaited<ReturnType<typeof actorFor>>) {
  return !actor || actor.scopedAgentIds === null ? {} : { agentId: { in: [...actor.scopedAgentIds] } }
}

const evidenceSelect = {
  id: true,
  executionId: true,
  submittedByAgentId: true,
  clientEvidenceId: true,
  requestHash: true,
  kind: true,
  contentHash: true,
  capturedAt: true,
  sourceObservedAt: true,
  sourceReceivedAt: true,
  metadata: true,
  createdAt: true,
  document: {
    select: {
      id: true,
      clientDocumentId: true,
      title: true,
      fileName: true,
      mimeType: true,
      sizeBytes: true,
      checksumSha256: true,
      deletedAt: true,
    },
  },
} satisfies Prisma.MtmPharmacyPromotionEvidenceSelect

type EvidenceRow = Prisma.MtmPharmacyPromotionEvidenceGetPayload<{
  select: typeof evidenceSelect
}>

function responseEvidence(id: string, evidence: EvidenceRow) {
  return {
    id: evidence.id,
    clientEvidenceId: evidence.clientEvidenceId,
    kind: evidence.kind,
    contentHash: evidence.contentHash,
    capturedAt: evidence.capturedAt,
    sourceObservedAt: evidence.sourceObservedAt,
    sourceReceivedAt: evidence.sourceReceivedAt,
    createdAt: evidence.createdAt,
    document: evidence.document ? {
      id: evidence.document.id,
      clientDocumentId: evidence.document.clientDocumentId,
      title: evidence.document.title,
      fileName: evidence.document.fileName,
      mimeType: evidence.document.mimeType,
      sizeBytes: evidence.document.sizeBytes,
      checksumSha256: evidence.document.checksumSha256,
      downloadUrl: `/api/v1/mtm/pharmacy-promotion-executions/${id}/evidence/${evidence.id}/download`,
    } : null,
  }
}

export const GET = withMtmRlsAuth<RouteContext>("mtm", "read", async (_req, auth, context) => {
  const actor = await actorFor(auth)
  if (!actor) return NextResponse.json({ error: "MTM agent is inactive", code: "MTM_AGENT_INACTIVE" }, { status: 403 })
  const { id } = await context.params
  const execution = await prisma.mtmPharmacyPromotionExecution.findFirst({
    where: { id, organizationId: auth.orgId, ...executionScope(actor) },
    select: { id: true },
  })
  if (!execution) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const evidence: EvidenceRow[] = await prisma.mtmPharmacyPromotionEvidence.findMany({
    where: { organizationId: auth.orgId, executionId: id },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: evidenceSelect,
  })
  return NextResponse.json({ success: true, data: evidence.map((entry) => responseEvidence(id, entry)) })
})

export const POST = withMtmRlsAuth<RouteContext>("mtm", "write", async (req, auth, context) => {
  if (auth.principal === "mobile") {
    const forbidden = requireMobileCapability(auth, "FIELD_EXECUTE")
    if (forbidden) return forbidden
  }
  const actor = await actorFor(auth)
  if (!actor) return NextResponse.json({ error: "MTM agent is inactive", code: "MTM_AGENT_INACTIVE" }, { status: 403 })
  if (actor.role !== "AGENT" || !actor.agentId) {
    return NextResponse.json({ error: "Field evidence is agent-only", code: "MTM_PHARMACY_FIELD_EXECUTE_DENIED" }, { status: 403 })
  }
  const { id } = await context.params
  const execution = await prisma.mtmPharmacyPromotionExecution.findFirst({
    where: { id, organizationId: auth.orgId, agentId: actor.agentId },
    select: { id: true, agentId: true, visitId: true, version: true, status: true },
  })
  if (!execution) return NextResponse.json({ error: "Not found" }, { status: 404 })

  let storagePath: string | null = null
  try {
    const formData = await req.formData()
    const file = formData.get("file")
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file is required", code: "MTM_PHARMACY_EVIDENCE_INVALID" }, { status: 400 })
    }
    const metadata = PharmacyPromotionEvidenceMetadataSchema.safeParse({
      clientEvidenceId: String(formData.get("clientEvidenceId") ?? ""),
      clientDocumentId: String(formData.get("clientDocumentId") ?? ""),
      operationId: String(formData.get("operationId") ?? ""),
      capturedAt: String(formData.get("capturedAt") ?? ""),
      checksumSha256: String(formData.get("checksumSha256") ?? ""),
      title: String(formData.get("title") ?? "") || undefined,
    })
    if (!metadata.success) {
      return NextResponse.json({
        error: metadata.error.issues[0]?.message ?? "Invalid evidence metadata",
        code: "MTM_PHARMACY_EVIDENCE_INVALID",
      }, { status: 400 })
    }
    const validated = validateMobileDocument(file)
    if (!validated.value) {
      return NextResponse.json({ error: validated.error, code: "MTM_PHARMACY_EVIDENCE_INVALID" }, { status: 400 })
    }
    const bytes = Buffer.from(await file.arrayBuffer())
    const byteError = validateMobileDocumentBytes(validated.value.mimeType, bytes)
    if (byteError) return NextResponse.json({ error: byteError, code: "MTM_PHARMACY_EVIDENCE_INVALID" }, { status: 400 })
    const contentHash = mobileDocumentSha256(bytes)
    if (contentHash !== metadata.data.checksumSha256.toLowerCase()) {
      return NextResponse.json({ error: "Evidence checksum mismatch", code: "MTM_PHARMACY_EVIDENCE_CHECKSUM_MISMATCH" }, { status: 409 })
    }
    const observedAt = new Date(metadata.data.capturedAt)
    const receivedAt = new Date()
    if (observedAt.getTime() > receivedAt.getTime() + 5 * 60_000) {
      return NextResponse.json({
        error: "Evidence capture time is more than five minutes in the future",
        code: "MTM_PHARMACY_SOURCE_TIME_INVALID",
      }, { status: 400 })
    }
    const requestHash = pharmacyPromotionHash({
      executionId: id,
      clientEvidenceId: metadata.data.clientEvidenceId,
      clientDocumentId: metadata.data.clientDocumentId,
      operationId: metadata.data.operationId,
      fileName: validated.value.fileName,
      mimeType: validated.value.mimeType,
      sizeBytes: bytes.byteLength,
      contentHash,
      capturedAt: observedAt.toISOString(),
      title: metadata.data.title ?? null,
    })
    const replay = await prisma.mtmPharmacyPromotionEvidence.findFirst({
      where: {
        organizationId: auth.orgId,
        submittedByAgentId: actor.agentId,
        clientEvidenceId: metadata.data.clientEvidenceId,
      },
      select: evidenceSelect,
    })
    if (replay) {
      if (
        replay.executionId !== id
        || replay.requestHash !== requestHash
        || replay.contentHash !== contentHash
        || replay.document?.clientDocumentId !== metadata.data.clientDocumentId
      ) {
        return NextResponse.json({ error: "Evidence replay mismatch", code: "MTM_PHARMACY_EVIDENCE_REPLAY_MISMATCH" }, { status: 409 })
      }
      if (replay.document?.deletedAt) {
        return NextResponse.json({ error: "Evidence document was deleted", code: "MTM_PHARMACY_EVIDENCE_TOMBSTONED" }, { status: 409 })
      }
      return NextResponse.json({ success: true, data: responseEvidence(id, replay), idempotent: true })
    }
    if (execution.status !== "DRAFT") {
      return NextResponse.json({
        error: "Evidence can only be added to a draft execution",
        code: "MTM_PHARMACY_EXECUTION_CHANGED",
      }, { status: 409 })
    }

    const storageKey = createMobileDocumentStorageKey()
    storagePath = resolveMobileDocumentStoragePath(storageKey)
    await mkdir(mobileDocumentStorageRoot(), { recursive: true })
    await writeFile(storagePath, bytes, { flag: "wx" })

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-pharmacy-evidence:${auth.orgId}:${actor.agentId}:${metadata.data.clientEvidenceId}`}, 0))`
      const currentActor = await resolveMtmRouteActor(tx as typeof prisma, {
        organizationId: auth.orgId,
        userId: auth.userId,
        webRole: auth.role,
        agentId: auth.agentId,
      })
      if (
        !currentActor
        || currentActor.role !== "AGENT"
        || !currentActor.agentId
        || currentActor.agentId !== actor.agentId
      ) {
        throw new Error("MTM_PHARMACY_FIELD_EXECUTE_DENIED")
      }
      const concurrent = await tx.mtmPharmacyPromotionEvidence.findFirst({
        where: {
          organizationId: auth.orgId,
          submittedByAgentId: currentActor.agentId,
          clientEvidenceId: metadata.data.clientEvidenceId,
        },
        select: evidenceSelect,
      })
      if (concurrent) {
        if (
          concurrent.executionId !== id
          || concurrent.requestHash !== requestHash
          || concurrent.contentHash !== contentHash
          || concurrent.document?.clientDocumentId !== metadata.data.clientDocumentId
        ) throw new Error("MTM_PHARMACY_EVIDENCE_REPLAY_MISMATCH")
        return { evidence: concurrent, idempotent: true }
      }
      const pinned = await tx.mtmPharmacyPromotionExecution.updateMany({
        where: {
          id,
          organizationId: auth.orgId,
          agentId: currentActor.agentId,
          status: "DRAFT",
          version: execution.version,
        },
        data: { version: { increment: 0 } },
      })
      if (pinned.count !== 1) throw new Error("MTM_PHARMACY_EXECUTION_CHANGED")
      const document = await tx.mtmDocument.create({
        data: {
          organizationId: auth.orgId,
          clientDocumentId: metadata.data.clientDocumentId,
          title: metadata.data.title ?? null,
          fileName: validated.value!.fileName,
          mimeType: validated.value!.mimeType,
          sizeBytes: bytes.byteLength,
          storageKey,
          checksumSha256: contentHash,
          uploadedByAgentId: currentActor.agentId,
          uploadedByUserId: auth.principal === "web" ? auth.userId : null,
          visitId: execution.visitId,
        },
      })
      await tx.mtmDocumentAssignment.create({
        data: {
          organizationId: auth.orgId,
          documentId: document.id,
          agentId: execution.agentId,
          assignedByUserId: auth.principal === "web" ? auth.userId : null,
          readAt: receivedAt,
        },
      })
      const evidence = await tx.mtmPharmacyPromotionEvidence.create({
        data: {
          organizationId: auth.orgId,
          executionId: id,
          submittedByAgentId: currentActor.agentId,
          clientEvidenceId: metadata.data.clientEvidenceId,
          requestHash,
          kind: "DOCUMENT",
          documentId: document.id,
          contentHash,
          capturedAt: observedAt,
          sourceObservedAt: observedAt,
          sourceReceivedAt: receivedAt,
          metadata: {
            operationId: metadata.data.operationId,
            clientDocumentId: metadata.data.clientDocumentId,
          },
        },
        select: evidenceSelect,
      })
      await tx.mtmPharmacyPromotionEvent.create({
        data: {
          organizationId: auth.orgId,
          executionId: id,
          evidenceId: evidence.id,
          eventType: "EVIDENCE_ADDED",
          fromState: "DRAFT",
          toState: "DRAFT",
          actorAgentId: currentActor.agentId,
          actorUserId: auth.principal === "web" ? auth.userId : null,
          sourceKey: `execution:${id}:evidence:${metadata.data.clientEvidenceId}`,
          requestHash,
          payload: { evidenceId: evidence.id, documentId: document.id, contentHash },
        },
      })
      await tx.mtmAuditLog.create({
        data: {
          organizationId: auth.orgId,
          agentId: currentActor.agentId,
          action: "PHARMACY_PROMOTION_EVIDENCE_ADDED",
          entity: "mtm_pharmacy_promotion_execution",
          entityId: id,
          metadataKind: "pharmacy_promotion_evidence",
          newData: { evidenceId: evidence.id, documentId: document.id, contentHash },
        },
      })
      return { evidence, idempotent: false }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    if (result.idempotent && storagePath) {
      await unlink(storagePath).catch(() => undefined)
      storagePath = null
    } else {
      storagePath = null
    }
    return NextResponse.json({
      success: true,
      data: responseEvidence(id, result.evidence),
      idempotent: result.idempotent,
    }, { status: result.idempotent ? 200 : 201 })
  } catch (error) {
    if (storagePath) await unlink(storagePath).catch(() => undefined)
    const code = error instanceof Error ? error.message : ""
    if (code === "MTM_PHARMACY_FIELD_EXECUTE_DENIED") {
      return NextResponse.json({ error: "Field evidence is agent-only", code }, { status: 403 })
    }
    if (code === "MTM_PHARMACY_EVIDENCE_REPLAY_MISMATCH" || code === "MTM_PHARMACY_EXECUTION_CHANGED") {
      return NextResponse.json({ error: "Evidence conflicts with current execution", code }, { status: 409 })
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({
        error: "Evidence document identity already belongs to another upload",
        code: "MTM_PHARMACY_EVIDENCE_DOCUMENT_CONFLICT",
      }, { status: 409 })
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return NextResponse.json({
        error: "Execution changed while evidence was being attached; retry with the same client evidence ID",
        code: "MTM_PHARMACY_EXECUTION_CHANGED",
      }, { status: 409 })
    }
    console.error("[MTM/pharmacy-promotion evidence]", error)
    return NextResponse.json({ error: "Evidence upload failed, retry", code: "MTM_PHARMACY_EVIDENCE_FAILED" }, { status: 500 })
  }
})
