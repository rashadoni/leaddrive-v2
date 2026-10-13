import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { readAttendanceDocument } from "@/lib/mtm/attendance-attachment"
import { attendancePrivateHeaders, attendanceRequestFailure } from "@/lib/mtm/attendance-request-http"

export const GET = withMtmAttendanceAuth<{ params: Promise<{ id: string }> }>("read", async (_req, auth, ctx) => {
  try {
    const { id } = await ctx.params
    const file = await readAttendanceDocument({ organizationId: auth.orgId, actor: auth.actor }, id)
    return new Response(new Uint8Array(file.bytes), { headers: { ...attendancePrivateHeaders, "content-type": file.mimeType, "content-disposition": 'attachment; filename="document.jpg"' } })
  } catch (error) { return attendanceRequestFailure(error) }
})
