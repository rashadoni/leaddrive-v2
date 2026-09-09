import { readFile, stat } from "node:fs/promises"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { contentDispositionAttachment } from "@/lib/export/tabular"
import { resolveMobileDocumentStoragePath } from "@/lib/mtm/mobile-document"
import { mtmMediaObjectReadFailureResponse } from "@/lib/mtm/media-object-http"
import { readCommittedMtmMediaObject, toMtmReservedMediaObject } from "@/lib/mtm/media-object-lifecycle"
import { mtmMediaObjectStorageSelect } from "@/lib/mtm/media-object-select"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { withMtmRlsAuth } from "@/lib/with-mtm-rls-auth"

type RouteContext = { params: Promise<{ documentId: string }> }

function forbidden() {
  return NextResponse.json({ error: "Forbidden", code: "MTM_OPERATIONS_SCOPE_DENIED" }, { status: 403 })
}

export const GET = withMtmRlsAuth<RouteContext>("mtm", "read", async (_req, auth, { params }) => {
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor || actor.role === "AGENT") return forbidden()
  const { documentId } = await params
  if (!documentId || documentId.length > 128) {
    return NextResponse.json({ error: "Invalid documentId" }, { status: 400 })
  }

  try {
    const scopedAgentIds = actor.scopedAgentIds === null ? null : [...actor.scopedAgentIds]
    const document = await prisma.mtmDocument.findFirst({
      where: {
        id: documentId,
        organizationId: auth.orgId,
        deletedAt: null,
        ...(scopedAgentIds
          ? {
              OR: [
                { uploadedByUserId: auth.userId },
                ...(actor.agentId ? [{ uploadedByAgentId: actor.agentId }] : []),
                { assignments: { some: { agentId: { in: scopedAgentIds } } } },
              ],
            }
          : {}),
      },
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
    console.error("[MTM/operations/documents/download GET]", error)
    return NextResponse.json({ error: "Failed to download document" }, { status: 500 })
  }
})
