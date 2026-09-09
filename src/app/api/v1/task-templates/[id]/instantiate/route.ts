import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

/**
 * Bump `usageCount` on a template — Roadmap #21.
 *
 * The actual task creation happens via POST /api/v1/tasks (the client
 * copies fields from the template, runs variable substitution, then
 * submits a normal create payload). This endpoint exists purely to
 * track template popularity for the picker's sort-by-usage UI.
 *
 * Visibility: anyone who can see the template (own + shared) can bump
 * its counter — instantiating a shared template still attributes usage
 * against the template itself, not just the owner.
 */
export const POST = withRlsAuth("tasks", "write", async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const userId = auth.userId
  const { id } = await params

  try {
    const result = await prisma.taskTemplate.updateMany({
      where: {
        id,
        organizationId: orgId,
        OR: [{ userId }, { isShared: true }],
      },
      data: { usageCount: { increment: 1 } },
    })

    if (result.count === 0) {
      return NextResponse.json({ error: "Template not found or not accessible" }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (e) {
    console.error("[task-templates instantiate]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
