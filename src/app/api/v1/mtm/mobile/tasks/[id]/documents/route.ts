import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { hasMobileCapability } from "@/lib/mtm/mobile-capabilities"
import { resolveAgentScope } from "@/lib/mtm/territory-scope"

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Task evidence/files (SWM-14 read side). Lists the documents attached to a task
 * (MtmDocument.taskId). The assignee sees their own task's files; a TEAM_READ
 * manager sees files for any task owned by an agent in their scope. Upload
 * (camera capture) is a separate, device-gated path via /mobile/documents/upload.
 */
export const GET = withMobileRls<RouteContext>(async (_req, auth, { params }) => {
  const { id } = await params

  const task = await prisma.mtmTask.findFirst({
    where: { id, organizationId: auth.orgId, deletedAt: null },
    select: { id: true, agentId: true },
  })
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Access: own task, or a team manager whose scope includes the task's agent.
  const isOwn = task.agentId === auth.agentId
  if (!isOwn) {
    if (!hasMobileCapability(auth.role, "TEAM_READ")) {
      return NextResponse.json({ error: "Forbidden", code: "MTM_TASK_SCOPE_DENIED" }, { status: 403 })
    }
    const scope = await resolveAgentScope(prisma, {
      organizationId: auth.orgId,
      agentId: auth.agentId,
      role: auth.role as "ADMIN" | "MANAGER" | "SUPERVISOR" | "AGENT",
    })
    if (scope.agentIds !== null && !scope.agentIds.includes(task.agentId)) {
      return NextResponse.json({ error: "Forbidden", code: "MTM_TASK_SCOPE_DENIED" }, { status: 403 })
    }
  }

  const documents = await prisma.mtmDocument.findMany({
    where: { taskId: id, organizationId: auth.orgId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      title: true,
      fileName: true,
      mimeType: true,
      sizeBytes: true,
      uploadedByAgentId: true,
      createdAt: true,
    },
  })

  return NextResponse.json({ success: true, data: { documents } })
})
