import { readFile, stat } from "node:fs/promises"
import { NextResponse } from "next/server"
import { contentDispositionAttachment } from "@/lib/export/tabular"
import { prisma } from "@/lib/prisma"
import { resolveMobileDocumentStoragePath, storedMobileDocumentBytes } from "@/lib/mtm/mobile-document"
import { mtmMediaObjectReadFailureResponse } from "@/lib/mtm/media-object-http"
import { readCommittedMtmMediaObject, toMtmReservedMediaObject } from "@/lib/mtm/media-object-lifecycle"
import { mtmMediaObjectStorageSelect } from "@/lib/mtm/media-object-select"
import { resolveOrganizationDetailAccess } from "@/lib/mtm/organization-detail-access"
import { withRouteFieldRlsAuth } from "@/lib/with-mtm-rls-auth"

type RouteContext = { params: Promise<{ id: string; documentId: string }> }

export const GET = withRouteFieldRlsAuth<RouteContext>("read", async (_req, auth, { params }) => {
  const { id, documentId } = await params
  const { actor, customer } = await resolveOrganizationDetailAccess(auth, id)
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  if (!customer) return NextResponse.json({ error: "Not found" }, { status: 404 })
  try {
    const document = await prisma.mtmDocument.findFirst({
      where: { id: documentId, organizationId: auth.orgId, customerId: id, deletedAt: null },
      select: { fileName: true, mimeType: true, sizeBytes: true, storageKey: true, mediaObject: { select: mtmMediaObjectStorageSelect } },
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
      const [fileStat, storedBytes] = await Promise.all([stat(filePath), readFile(filePath)])
      // An encrypted file is larger on disk than the recorded plain size, so the
      // plain size is compared after decoding.
      const plainBytes = storedMobileDocumentBytes(auth.orgId, { isFile: fileStat.isFile(), size: fileStat.size }, storedBytes)
      if (!plainBytes || plainBytes.byteLength !== document.sizeBytes) {
        return NextResponse.json({ error: "Document file is unavailable" }, { status: 410 })
      }
      bytes = plainBytes
    }
    if (bytes.byteLength !== document.sizeBytes) {
      return NextResponse.json({ error: "Document file is unavailable" }, { status: 410 })
    }
    return new NextResponse(bytes as unknown as BodyInit, {
      headers: {
        "Content-Type": document.mimeType,
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": contentDispositionAttachment(document.fileName),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return NextResponse.json({ error: "Document file is unavailable" }, { status: 410 })
    }
    throw error
  }
})
