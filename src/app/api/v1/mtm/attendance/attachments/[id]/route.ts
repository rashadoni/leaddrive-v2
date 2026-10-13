import { prisma } from "@/lib/prisma"
import { checkPermission, type Role } from "@/lib/permissions"
import { effectiveHiddenModules } from "@/lib/user-module-access"
import { resolveMtmRouteActor, canReviewMtmRouteRequest } from "@/lib/mtm/route-permissions"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { readAttendanceDocument } from "@/lib/mtm/attendance-attachment"
import { attendancePrivateHeaders, attendanceRequestFailure } from "@/lib/mtm/attendance-request-http"

type AttachmentContext = { params: Promise<{ id: string }> }

export const GET = withMtmAttendanceAuth<AttachmentContext>("read", async (_req, auth, ctx) => {
  try {
    const { id } = await ctx.params
    if (auth.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_DECISION_FORBIDDEN", 403)
    const user = await prisma.user.findFirst({ where: { id: auth.userId, organizationId: auth.orgId, isActive: true, anonymizedAt: null }, select: { role: true, hiddenModules: true } })
    if (!user || !checkPermission(user.role as Role, "mtm", "write") || effectiveHiddenModules(user.role, user.hiddenModules).includes("mtm")) throw new AttendanceRequestError("MTM_ATTENDANCE_DECISION_FORBIDDEN", 403)
    // A report-wide HR grant must not expose private medical documents.
    const actor = await resolveMtmRouteActor(prisma, { organizationId: auth.orgId, userId: auth.userId, webRole: user.role })
    const record = await prisma.mtmAttendanceAttachment.findFirst({ where: { id, organizationId: auth.orgId }, select: { agentId: true, agent: { select: { userId: true, status: true } } } })
    if (!actor || (actor.role !== "ADMIN" && actor.scopedAgentIds === null) || !record || record.agent.status !== "ACTIVE" || record.agent.userId === auth.userId || !canReviewMtmRouteRequest(actor, record.agentId)) throw new AttendanceRequestError("MTM_ATTENDANCE_DOCUMENT_UNAVAILABLE", 404)
    const file = await readAttendanceDocument({ organizationId: auth.orgId, actor }, id)
    return new Response(new Uint8Array(file.bytes), { headers: { ...attendancePrivateHeaders, "content-type": file.mimeType, "content-disposition": 'attachment; filename="document.jpg"' } })
  } catch (error) { return attendanceRequestFailure(error) }
})
