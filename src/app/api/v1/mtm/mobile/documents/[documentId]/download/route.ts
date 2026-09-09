import { readFile, stat } from "node:fs/promises"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { contentDispositionAttachment } from "@/lib/export/tabular"
import { resolveMobileDocumentStoragePath } from "@/lib/mtm/mobile-document"
import { requireMtmMobileMediaAccess } from "@/lib/mtm/mobile-media-guard"
import { mtmMediaObjectReadFailureResponse } from "@/lib/mtm/media-object-http"
import { readCommittedMtmMediaObject, toMtmReservedMediaObject } from "@/lib/mtm/media-object-lifecycle"
import { withMobileRls } from "@/lib/with-mobile-rls"

type RouteContext = { params: Promise<{ documentId: string }> }

export const GET = withMobileRls<RouteContext>(async (_req, auth, { params }) => {
  const forbidden = await requireMtmMobileMediaAccess(auth)
  if (forbidden) return forbidden

  const { documentId } = await params
  if (!documentId || documentId.length > 128) {
    return NextResponse.json({ error: "Invalid documentId" }, { status: 400 })
  }

  try {
    const document = await prisma.mtmDocument.findFirst({
      where: {
        id: documentId,
        organizationId: auth.orgId,
        deletedAt: null,
        OR: [
          { uploadedByAgentId: auth.agentId },
          { assignments: { some: { agentId: auth.agentId } } },
          {
            messages: {
              some: {
                thread: {
                  participants: { some: { agentId: auth.agentId, archivedAt: null } },
                },
              },
            },
          },
        ],
      },
      select: {
        id: true,
        fileName: true,
        mimeType: true,
        sizeBytes: true,
        storageKey: true,
        mediaObject: {
          select: {
            id: true,
            organizationId: true,
            kind: true,
            state: true,
            provider: true,
            bucketName: true,
            objectKey: true,
            checksumSha256: true,
            sizeBytes: true,
            mimeType: true,
            encryptionKeyId: true,
            retentionUntil: true,
            legalHold: true,
            photoId: true,
            documentId: true,
          },
        },
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

    await prisma.mtmDocumentAssignment.updateMany({
      where: { organizationId: auth.orgId, documentId, agentId: auth.agentId, downloadedAt: null },
      data: { downloadedAt: new Date() },
    })

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
    console.error("[MTM/mobile/documents/download GET]", error)
    return NextResponse.json({ error: "Failed to download document" }, { status: 500 })
  }
})
