import { mkdir, unlink, writeFile } from "node:fs/promises"
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { writeMtmAudit } from "@/lib/mtm-audit"
import {
  createMobileDocumentStorageKey,
  mobileDocumentSha256,
  mobileDocumentStorageRoot,
  resolveMobileDocumentStoragePath,
  validateMobileDocument,
  validateMobileDocumentBytes,
} from "@/lib/mtm/mobile-document"
import { withRouteFieldRlsAuth, type MtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { mtmTaskScopeWhere } from "@/lib/mtm/task-access"

type RouteContext = { params: Promise<{ id: string }> }

const documentSelect = {
  id: true,
  clientDocumentId: true,
  title: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  checksumSha256: true,
  uploadedByAgentId: true,
  uploadedByUserId: true,
  taskId: true,
  storageKey: true,
  createdAt: true,
  deletedAt: true,
} satisfies Prisma.MtmDocumentSelect

type SelectedDocument = Prisma.MtmDocumentGetPayload<{ select: typeof documentSelect }>

function matchesUpload(
  document: SelectedDocument,
  facts: { taskId: string; title: string | null; fileName: string; mimeType: string; sizeBytes: number; checksumSha256: string },
): boolean {
  return document.taskId === facts.taskId
    && document.title === facts.title
    && document.fileName === facts.fileName
    && document.mimeType === facts.mimeType
    && document.sizeBytes === facts.sizeBytes
    && document.checksumSha256 === facts.checksumSha256
}

async function actorAndTask(auth: MtmRlsAuth, id: string) {
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor) return { actor: null, task: null }
  const task = await prisma.mtmTask.findFirst({
    where: { id, organizationId: auth.orgId, deletedAt: null, ...mtmTaskScopeWhere(actor) },
    select: { id: true, agentId: true, status: true, version: true },
  })
  return { actor, task }
}

export const GET = withRouteFieldRlsAuth<RouteContext>("read", async (_req, auth, { params }) => {
  const { id } = await params
  const { actor, task } = await actorAndTask(auth, id)
  if (!actor) return NextResponse.json({ error: "MTM agent is inactive", code: "MTM_AGENT_INACTIVE" }, { status: 403 })
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const documents = await prisma.mtmDocument.findMany({
    where: { organizationId: auth.orgId, taskId: id, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      clientDocumentId: true,
      title: true,
      fileName: true,
      mimeType: true,
      sizeBytes: true,
      checksumSha256: true,
      uploadedByAgentId: true,
      uploadedByUserId: true,
      createdAt: true,
    },
  })
  return NextResponse.json({
    success: true,
    data: {
      documents: documents.map((document) => ({
        ...document,
        downloadUrl: `/api/v1/mtm/tasks/${id}/documents/${document.id}/download`,
      })),
    },
  })
})

export const POST = withRouteFieldRlsAuth<RouteContext>("write", async (req, auth, { params }) => {
  const { id } = await params
  const { actor, task } = await actorAndTask(auth, id)
  if (!actor) return NextResponse.json({ error: "MTM agent is inactive", code: "MTM_AGENT_INACTIVE" }, { status: 403 })
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 })

  let storagePath: string | null = null
  let replayFacts: Parameters<typeof matchesUpload>[1] | null = null
  let clientDocumentId = ""
  try {
    const formData = await req.formData()
    const file = formData.get("file")
    clientDocumentId = String(formData.get("clientDocumentId") ?? "").trim()
    const title = String(formData.get("title") ?? "").trim() || null
    const claimedTaskId = String(formData.get("taskId") ?? "").trim()
    if (!(file instanceof File)) return NextResponse.json({ error: "file is required" }, { status: 400 })
    if (clientDocumentId.length < 8 || clientDocumentId.length > 128) {
      return NextResponse.json({ error: "clientDocumentId must be 8..128 characters" }, { status: 400 })
    }
    if (title && title.length > 200) return NextResponse.json({ error: "title must be 200 characters or fewer" }, { status: 400 })
    if (claimedTaskId && claimedTaskId !== id) {
      return NextResponse.json({ error: "Multipart taskId does not match route", code: "MTM_DOCUMENT_TASK_MISMATCH" }, { status: 409 })
    }

    const validated = validateMobileDocument(file)
    if (!validated.value) return NextResponse.json({ error: validated.error }, { status: 400 })
    const bytes = Buffer.from(await file.arrayBuffer())
    const contentError = validateMobileDocumentBytes(validated.value.mimeType, bytes)
    if (contentError) return NextResponse.json({ error: contentError }, { status: 400 })
    replayFacts = {
      taskId: id,
      title,
      fileName: validated.value.fileName,
      mimeType: validated.value.mimeType,
      sizeBytes: bytes.byteLength,
      checksumSha256: mobileDocumentSha256(bytes),
    }

    const replay = await prisma.mtmDocument.findFirst({
      where: { organizationId: auth.orgId, clientDocumentId },
      select: documentSelect,
    })
    if (replay) {
      if (!matchesUpload(replay, replayFacts)) {
        return NextResponse.json({ error: "clientDocumentId was used with different task/file facts", code: "MTM_DOCUMENT_REPLAY_MISMATCH" }, { status: 409 })
      }
      if (replay.deletedAt) return NextResponse.json({ error: "The idempotent upload was deleted", code: "MTM_DOCUMENT_TOMBSTONED" }, { status: 409 })
      const { storageKey: _storageKey, deletedAt: _deletedAt, ...response } = replay
      return NextResponse.json({ success: true, data: { ...response, idempotent: true } })
    }

    const storageKey = createMobileDocumentStorageKey()
    storagePath = resolveMobileDocumentStoragePath(storageKey)
    await mkdir(mobileDocumentStorageRoot(), { recursive: true })
    await writeFile(storagePath, bytes, { flag: "wx" })

    const occurredAt = new Date()
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-task-document:${auth.orgId}:${clientDocumentId}`}, 0))`
      const existing = await tx.mtmDocument.findFirst({
        where: { organizationId: auth.orgId, clientDocumentId },
        select: documentSelect,
      })
      if (existing) {
        if (!matchesUpload(existing, replayFacts!)) throw new Error("MTM_DOCUMENT_REPLAY_MISMATCH")
        if (existing.deletedAt) throw new Error("MTM_DOCUMENT_TOMBSTONED")
        return { document: existing, idempotent: true }
      }

      // Lock/fence the current owner and version without changing task core.
      // `increment: 0` yields an UPDATE row lock but keeps offline execution
      // expectedVersion stable while append-only evidence catches up.
      const pinned = await tx.mtmTask.updateMany({
        where: {
          id,
          organizationId: auth.orgId,
          agentId: task.agentId,
          version: task.version,
          deletedAt: null,
        },
        data: { version: { increment: 0 } },
      })
      if (pinned.count !== 1) throw new Error("MTM_TASK_SCOPE_CHANGED")

      const document = await tx.mtmDocument.create({
        data: {
          organizationId: auth.orgId,
          clientDocumentId,
          title,
          fileName: replayFacts!.fileName,
          mimeType: replayFacts!.mimeType,
          sizeBytes: replayFacts!.sizeBytes,
          storageKey,
          checksumSha256: replayFacts!.checksumSha256,
          uploadedByAgentId: actor.agentId,
          uploadedByUserId: auth.principal === "web" ? auth.userId : null,
          taskId: id,
        },
        select: documentSelect,
      })
      await tx.mtmDocumentAssignment.create({
        data: {
          organizationId: auth.orgId,
          documentId: document.id,
          agentId: task.agentId,
          assignedByUserId: auth.principal === "web" ? auth.userId : null,
          required: false,
          readAt: actor.agentId === task.agentId ? occurredAt : null,
        },
      })
      await tx.mtmTaskEvent.create({
        data: {
          organizationId: auth.orgId,
          taskId: id,
          agentId: task.agentId,
          clientEventId: `document:${clientDocumentId}`,
          type: "EVIDENCE_ADDED",
          occurredAt,
          fromStatus: task.status,
          toStatus: task.status,
          evidence: {
            kind: "MTM_TASK_DOCUMENT",
            documentId: document.id,
            clientDocumentId,
            fileName: replayFacts!.fileName,
            mimeType: replayFacts!.mimeType,
            sizeBytes: replayFacts!.sizeBytes,
            checksumSha256: replayFacts!.checksumSha256,
            actorAgentId: actor.agentId,
            actorRole: actor.role,
            actorName: auth.name,
          } as Prisma.InputJsonValue,
        },
      })
      return { document, idempotent: false }
    })

    if (result.idempotent && storagePath) {
      await unlink(storagePath).catch(() => undefined)
      storagePath = null
    }
    const { storageKey: _storageKey, deletedAt: _deletedAt, ...response } = result.document
    if (!result.idempotent) {
      storagePath = null
      await writeMtmAudit({
        organizationId: auth.orgId,
        agentId: task.agentId,
        action: "TASK_UPDATE",
        entity: "task",
        entityId: id,
        metadataKind: "task_evidence_added",
        newData: {
          documentId: result.document.id,
          clientDocumentId,
          checksumSha256: replayFacts.checksumSha256,
        },
        req,
      }).catch((error) => console.warn("[MTM/tasks/[id]/documents POST] audit failed", error))
    }
    return NextResponse.json({ success: true, data: { ...response, idempotent: result.idempotent } }, { status: result.idempotent ? 200 : 201 })
  } catch (error) {
    if (storagePath) await unlink(storagePath).catch(() => undefined)
    if (error instanceof Error && (error.message === "MTM_DOCUMENT_REPLAY_MISMATCH" || error.message === "MTM_DOCUMENT_TOMBSTONED")) {
      return NextResponse.json({ error: "Document replay conflicts with the original upload", code: error.message }, { status: 409 })
    }
    if (error instanceof Error && error.message === "MTM_TASK_SCOPE_CHANGED") {
      return NextResponse.json({ error: "Task changed concurrently; retry upload", code: error.message }, { status: 409 })
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && replayFacts) {
      const existing = await prisma.mtmDocument.findFirst({
        where: { organizationId: auth.orgId, clientDocumentId },
        select: documentSelect,
      }).catch(() => null)
      if (existing && !existing.deletedAt && matchesUpload(existing, replayFacts)) {
        const { storageKey: _storageKey, deletedAt: _deletedAt, ...response } = existing
        return NextResponse.json({ success: true, data: { ...response, idempotent: true } })
      }
    }
    console.error("[MTM/tasks/[id]/documents POST]", error)
    return NextResponse.json({ error: "Document upload failed, retry" }, { status: 500 })
  }
})
