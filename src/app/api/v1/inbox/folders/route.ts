import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { withInboxSessionWrite } from "@/lib/inbox/route-auth"
import { normalizeInboxFolderName } from "@/lib/inbox-folder-name"

/**
 * Phase 5 — team folders for the inbox.
 *
 * GET  /api/v1/inbox/folders  → list (org-scoped, by sortOrder)
 * POST /api/v1/inbox/folders  → create { name, color? }
 */

export const GET = withRlsAuth("inbox", "read", async (_req, { orgId }) => {
  try {
    const folders = await prisma.inboxFolder.findMany({
      where: { organizationId: orgId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    })
    return NextResponse.json({ success: true, data: folders })
  } catch (e) {
    console.error("[inbox folders GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const POST = withInboxSessionWrite(async (req, { orgId }) => {
  const body = await req.json()

  const name = normalizeInboxFolderName(body.name)
  if (!name) return NextResponse.json({ error: "Invalid folder name" }, { status: 400 })

  try {
    const folder = await prisma.inboxFolder.create({
      data: {
        organizationId: orgId,
        name,
        color: typeof body.color === "string" ? body.color : null,
      },
    })
    return NextResponse.json({ success: true, data: folder }, { status: 201 })
  } catch (e) {
    console.error("[inbox folders POST]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
