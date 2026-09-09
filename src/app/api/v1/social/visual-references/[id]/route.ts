import { NextRequest, NextResponse } from "next/server"
import { logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { archiveVisualReference } from "@/lib/social/media-observations"

type RouteContext = { params: Promise<{ id: string }> }

export const DELETE = withRlsAuth("social", "write", async (_req: NextRequest, auth, context: RouteContext) => {
  const { id } = await context.params
  try {
    await archiveVisualReference(auth.orgId, id)
    logAudit(auth.orgId, "archive", "social_visual_reference", id, "archived")
    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not archive visual reference"
    return NextResponse.json({ error: message }, { status: message === "Visual reference not found" ? 404 : 400 })
  }
})
