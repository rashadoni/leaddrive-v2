import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withSocialMonitoringMutationFence } from "@/lib/social/with-monitoring-mutation-fence"

const patchSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"]),
  assignedTo: z.string().min(1).nullable().optional(),
})

type RouteContext = { params: Promise<{ id: string }> }

export const PATCH = withSocialMonitoringMutationFence("social", "write", async (req: NextRequest, auth, context: RouteContext) => {
  const { id } = await context.params
  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid task" }, { status: 400 })
  if (parsed.data.assignedTo) {
    const assignee = await prisma.user.findFirst({
      where: { id: parsed.data.assignedTo, organizationId: auth.orgId, isActive: true },
      select: { id: true },
    })
    if (!assignee) return NextResponse.json({ error: "Assignee not found in this organization" }, { status: 400 })
  }
  const updated = await prisma.manualEngagementTask.updateMany({
    where: { organizationId: auth.orgId, id },
    data: {
      status: parsed.data.status,
      ...(parsed.data.assignedTo !== undefined ? { assignedTo: parsed.data.assignedTo } : {}),
      ...(parsed.data.status === "COMPLETED" ? { completedBy: auth.userId, completedAt: new Date() } : { completedBy: null, completedAt: null }),
    },
  })
  if (updated.count !== 1) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ success: true })
})
