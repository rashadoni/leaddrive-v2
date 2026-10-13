import type { Prisma } from "@prisma/client"
import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { prisma } from "@/lib/prisma"
import { readAttendanceDocument } from "@/lib/mtm/attendance-attachment"
import { requireAttendanceReviewer } from "@/lib/mtm/attendance-request-decision"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { attendancePrivateHeaders, attendanceRequestFailure } from "@/lib/mtm/attendance-request-http"

type AttachmentContext = { params: Promise<{ id: string }> }

export const GET = withMtmAttendanceAuth<AttachmentContext>("read", async (_req, auth, ctx) => {
  try {
    const { id } = await ctx.params
    // A report-wide HR grant alone must never open medical documents.
    const actor = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const record = await tx.mtmAttendanceAttachment.findFirst({ where: { id, organizationId: auth.orgId }, select: { agentId: true } })
      if (!record) throw new AttendanceRequestError("MTM_ATTENDANCE_DOCUMENT_UNAVAILABLE", 404)
      const access = await requireAttendanceReviewer(tx, { organizationId: auth.orgId, userId: auth.userId, principalType: auth.principalType }, record.agentId)
      return access.actor
    })
    const file = await readAttendanceDocument({ organizationId: auth.orgId, actor }, id)
    return new Response(new Uint8Array(file.bytes), { headers: { ...attendancePrivateHeaders, "content-type": file.mimeType, "content-disposition": 'attachment; filename="document.jpg"' } })
  } catch (error) { return attendanceRequestFailure(error) }
})
