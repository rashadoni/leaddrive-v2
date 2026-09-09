import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireMtmMobileMediaAccess } from "@/lib/mtm/mobile-media-guard"
import { withMobileRls } from "@/lib/with-mobile-rls"

type DocumentAssignmentRow = {
  id: string
  required: boolean
  assignedAt: Date
  expiresAt: Date | null
  readAt: Date | null
  downloadedAt: Date | null
  document: {
    id: string
    clientDocumentId: string | null
    title: string | null
    fileName: string
    mimeType: string
    sizeBytes: number
    checksumSha256: string | null
    uploadedByAgentId: string | null
    visitId: string | null
    taskId: string | null
    createdAt: Date
    visit: { id: string; customer: { id: string; name: string } } | null
    task: { id: string; title: string } | null
  }
}

export const GET = withMobileRls(async (req, auth) => {
  const forbidden = await requireMtmMobileMediaAccess(auth)
  if (forbidden) return forbidden

  const { searchParams } = new URL(req.url)
  const includeExpired = searchParams.get("scope") === "all"
  const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit")) || 100))
  const now = new Date()

  try {
    const assignments = await prisma.mtmDocumentAssignment.findMany({
      where: {
        organizationId: auth.orgId,
        agentId: auth.agentId,
        document: { deletedAt: null },
        ...(!includeExpired ? { OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] } : {}),
      },
      orderBy: [{ required: "desc" }, { assignedAt: "desc" }],
      take: limit,
      select: {
        id: true,
        required: true,
        assignedAt: true,
        expiresAt: true,
        readAt: true,
        downloadedAt: true,
        document: {
          select: {
            id: true,
            clientDocumentId: true,
            title: true,
            fileName: true,
            mimeType: true,
            sizeBytes: true,
            checksumSha256: true,
            uploadedByAgentId: true,
            visitId: true,
            taskId: true,
            createdAt: true,
            visit: {
              select: { id: true, customer: { select: { id: true, name: true } } },
            },
            task: { select: { id: true, title: true } },
          },
        },
      },
    })

    return NextResponse.json({
      success: true,
      data: {
        documents: (assignments as DocumentAssignmentRow[]).map((assignment) => ({
          ...assignment.document,
          assignment: {
            id: assignment.id,
            required: assignment.required,
            assignedAt: assignment.assignedAt,
            expiresAt: assignment.expiresAt,
            readAt: assignment.readAt,
            downloadedAt: assignment.downloadedAt,
          },
          expired: Boolean(assignment.expiresAt && assignment.expiresAt < now),
          downloadUrl: `/api/v1/mtm/mobile/documents/${assignment.document.id}/download`,
        })),
        capabilities: { upload: true, offlineDownload: true, maxUploadBytes: 25 * 1024 * 1024 },
      },
    })
  } catch (error) {
    console.error("[MTM/mobile/documents GET]", error)
    return NextResponse.json({ error: "Failed to load documents" }, { status: 500 })
  }
})
