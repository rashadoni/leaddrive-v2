import { readFile, stat } from "node:fs/promises"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { contentDispositionAttachment } from "@/lib/export/tabular"
import { resolveMobileDocumentStoragePath } from "@/lib/mtm/mobile-document"
import { mtmMediaObjectReadFailureResponse } from "@/lib/mtm/media-object-http"
import { readCommittedMtmMediaObject, toMtmReservedMediaObject } from "@/lib/mtm/media-object-lifecycle"
import { mtmMediaObjectStorageSelect } from "@/lib/mtm/media-object-select"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { mtmTaskScopeWhere } from "@/lib/mtm/task-access"

type RouteContext = { params: Promise<{ id: string; documentId: string }> }

export const GET = withRouteFieldRlsAuth<RouteContext>("read", async (_req, auth, { params }) => {
  const { id, documentId } = await params
  if (!id || !documentId || id.length > 128 || documentId.length > 128) {
    return NextResponse.json({ error: "Invalid task or document id" }, { status: 400 })
  }

  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor) return NextResponse.json({ error: "MTM agent is inactive", code: "MTM_AGENT_INACTIVE" }, { status: 403 })

  try {
    const task = await prisma.mtmTask.findFirst({
      where: { id, organizationId: auth.orgId, deletedAt: null, ...mtmTaskScopeWhere(actor) },
      select: { id: true },
    })
    if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const document = await prisma.mtmDocument.findFirst({
      where: { id: documentId, taskId: id, organizationId: auth.orgId, deletedAt: null },
      select: {
        id: true,
        fileName: true,
        mimeType: true,
        sizeBytes: true,
        storageKey: true,
        mediaObject: { select: mtmMediaObjectStorageSelect },
      },
    })
    if (!document) return NextResponse.json({ error: "Not found" }, { status: 404 })

    let bytes: Buffer
    if (document.mediaObject) {
      try {
        bytes = await readCommittedMtmMediaObject({ mediaObject: toMtmReservedMediaObject(document.mediaObject) })
      } catch (error) {
        const response = mtmMediaObjectReadFailureResponse(error)
        if (response) return response
        throw error
      }
    } else {
      const filePath = resolveMobileDocumentStoragePath(document.storageKey)
      const [fileStat, legacyBytes] = await Promise.all([stat(filePath), readFile(filePath)])
      if (!fileStat.isFile() || fileStat.size !== document.sizeBytes) {
        return NextResponse.json({ error: "Document file is unavailable" }, { status: 410 })
      }
      bytes = legacyBytes
    }
    if (bytes.byteLength !== document.sizeBytes) {
      return NextResponse.json({ error: "Document file is unavailable" }, { status: 410 })
    }

    if (actor.agentId) {
      await prisma.mtmDocumentAssignment.updateMany({
        where: { organizationId: auth.orgId, documentId, agentId: actor.agentId, downloadedAt: null },
        data: { downloadedAt: new Date() },
      })
    }

    return new NextResponse(bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": document.mimeType,
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": contentDispositionAttachment(document.fileName),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code
    if (code === "ENOENT") return NextResponse.json({ error: "Document file is unavailable" }, { status: 410 })
    console.error("[MTM/tasks/[id]/documents/[documentId]/download GET]", error)
    return NextResponse.json({ error: "Failed to download document" }, { status: 500 })
  }
})
