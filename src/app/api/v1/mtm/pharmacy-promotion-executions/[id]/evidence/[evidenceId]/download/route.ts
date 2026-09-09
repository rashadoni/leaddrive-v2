import { readFile, stat } from "node:fs/promises"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { contentDispositionAttachment } from "@/lib/export/tabular"
import { mobileDocumentSha256, resolveMobileDocumentStoragePath } from "@/lib/mtm/mobile-document"
import { mtmMediaObjectReadFailureResponse } from "@/lib/mtm/media-object-http"
import { readCommittedMtmMediaObject, toMtmReservedMediaObject } from "@/lib/mtm/media-object-lifecycle"
import { mtmMediaObjectStorageSelect } from "@/lib/mtm/media-object-select"
import { withMtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"

type RouteContext = { params: Promise<{ id: string; evidenceId: string }> }

export const GET = withMtmRlsAuth<RouteContext>("mtm", "read", async (_req, auth, context) => {
  const { id, evidenceId } = await context.params
  if (!id || !evidenceId || id.length > 128 || evidenceId.length > 128) {
    return NextResponse.json({ error: "Invalid execution or evidence id" }, { status: 400 })
  }
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor) return NextResponse.json({ error: "MTM agent is inactive", code: "MTM_AGENT_INACTIVE" }, { status: 403 })

  try {
    const evidence = await prisma.mtmPharmacyPromotionEvidence.findFirst({
      where: {
        id: evidenceId,
        executionId: id,
        organizationId: auth.orgId,
        execution: actor.scopedAgentIds === null
          ? { organizationId: auth.orgId }
          : { organizationId: auth.orgId, agentId: { in: [...actor.scopedAgentIds] } },
      },
      select: {
        contentHash: true,
        document: {
          select: {
            id: true,
            fileName: true,
            mimeType: true,
            sizeBytes: true,
            checksumSha256: true,
            storageKey: true,
            deletedAt: true,
            mediaObject: { select: mtmMediaObjectStorageSelect },
          },
        },
      },
    })
    if (!evidence?.document || evidence.document.deletedAt) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    const document = evidence.document
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
        return NextResponse.json({ error: "Evidence file is unavailable" }, { status: 410 })
      }
      bytes = legacyBytes
    }
    if (bytes.byteLength !== document.sizeBytes) {
      return NextResponse.json({ error: "Evidence file is unavailable" }, { status: 410 })
    }
    const actualHash = mobileDocumentSha256(bytes)
    const evidenceHashMatches = /^[a-f0-9]{64}$/i.test(evidence.contentHash)
      && actualHash === evidence.contentHash.toLowerCase()
    const documentHashMatches = document.checksumSha256 === null
      || (/^[a-f0-9]{64}$/i.test(document.checksumSha256)
        && actualHash === document.checksumSha256.toLowerCase())
    if (!evidenceHashMatches || !documentHashMatches) {
      return NextResponse.json({
        error: "Evidence file failed integrity verification",
        code: "MTM_PHARMACY_EVIDENCE_INTEGRITY_MISMATCH",
      }, { status: 410 })
    }
    if (actor.agentId) {
      await prisma.mtmDocumentAssignment.updateMany({
        where: {
          organizationId: auth.orgId,
          documentId: document.id,
          agentId: actor.agentId,
          downloadedAt: null,
        },
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
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return NextResponse.json({ error: "Evidence file is unavailable" }, { status: 410 })
    }
    console.error("[MTM/pharmacy-promotion evidence download]", error)
    return NextResponse.json({ error: "Failed to download evidence" }, { status: 500 })
  }
})
