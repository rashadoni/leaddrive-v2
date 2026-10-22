import { readFile, stat } from "node:fs/promises"
import { NextResponse } from "next/server"
import { contentDispositionAttachment } from "@/lib/export/tabular"
import { prisma } from "@/lib/prisma"
import { resolveMobileDocumentStoragePath, storedMobileDocumentBytes } from "@/lib/mtm/mobile-document"
import { mtmMediaObjectReadFailureResponse } from "@/lib/mtm/media-object-http"
import { readCommittedMtmMediaObject, toMtmReservedMediaObject } from "@/lib/mtm/media-object-lifecycle"
import { mtmMediaObjectStorageSelect } from "@/lib/mtm/media-object-select"
import { resolveMtmProductAccess } from "@/lib/mtm/product-access"
import { withRouteFieldWebRlsAuth } from "@/lib/with-mtm-rls-auth"

type RouteContext = { params: Promise<{ id: string }> }

/**
 * GET /api/v1/mtm/products/:id/presentation — the product's presentation file,
 * as the agent gets it in the app.
 *
 * The catalog screen listed a product's file by name and nothing more: who
 * uploaded a deck could not look at it again from the web (owner, 2026-10-15:
 * «нужно подтянуть интуитивность и интерактивность»). Whoever is shown the
 * product in the catalog may download its file; the rule is the catalog's own
 * (`resolveMtmProductAccess`), not the operations screen's.
 */
export const GET = withRouteFieldWebRlsAuth<RouteContext>("read", async (_req, auth, { params }) => {
  const { id } = await params
  if (!id || id.length > 128) return NextResponse.json({ error: "Invalid product id" }, { status: 400 })
  const access = await resolveMtmProductAccess(auth)
  if (!access) {
    return NextResponse.json({ error: "MTM access required", code: "MTM_AGENT_ACCESS_REQUIRED" }, { status: 403 })
  }
  const product = await prisma.mtmProduct.findFirst({
    // A deleted presentation left the catalog; its showings stay in the visits.
    where: { id, organizationId: auth.orgId, deletedAt: null },
    select: {
      groupId: true,
      document: {
        select: {
          fileName: true,
          mimeType: true,
          sizeBytes: true,
          storageKey: true,
          deletedAt: true,
          mediaObject: { select: mtmMediaObjectStorageSelect },
        },
      },
    },
  })
  // A product outside the user's groups is answered as one that does not exist.
  if (!product || !access.visibleIds.has(product.groupId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  const document = product.document
  if (!document || document.deletedAt) {
    return NextResponse.json({ error: "Presentation file is unavailable", code: "MTM_PRODUCT_PRESENTATION_UNAVAILABLE" }, { status: 410 })
  }

  try {
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
        return NextResponse.json({ error: "Presentation file is unavailable", code: "MTM_PRODUCT_PRESENTATION_UNAVAILABLE" }, { status: 410 })
      }
      bytes = plainBytes
    }
    if (bytes.byteLength !== document.sizeBytes) {
      return NextResponse.json({ error: "Presentation file is unavailable", code: "MTM_PRODUCT_PRESENTATION_UNAVAILABLE" }, { status: 410 })
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
      return NextResponse.json({ error: "Presentation file is unavailable", code: "MTM_PRODUCT_PRESENTATION_UNAVAILABLE" }, { status: 410 })
    }
    console.error("[MTM/products/presentation GET]", error)
    return NextResponse.json({ error: "Failed to read the presentation" }, { status: 500 })
  }
})
