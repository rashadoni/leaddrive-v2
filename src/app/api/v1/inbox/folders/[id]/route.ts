import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withInboxSessionWrite } from "@/lib/inbox/route-auth"

/**
 * Phase 5 — DELETE /api/v1/inbox/folders/[id]
 *
 * Removes a team folder (org-scoped) and orphans any conversations that
 * referenced it (folderId → null = "no folder"), since there's no FK.
 */
export const DELETE = withInboxSessionWrite(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  try {
    const folder = await prisma.inboxFolder.findFirst({
      where: { id, organizationId: orgId },
      select: { name: true },
    })
    if (!folder) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (folder.name === "Gözləmədə") {
      return NextResponse.json({ error: "System folder cannot be deleted" }, { status: 409 })
    }
    const result = await prisma.inboxFolder.deleteMany({ where: { id, organizationId: orgId } })

    await prisma.socialConversation.updateMany({
      where: { organizationId: orgId, folderId: id },
      data: { folderId: null },
    })
    return NextResponse.json({ success: true, data: { deleted: id } })
  } catch (e) {
    console.error("[inbox folders DELETE]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
