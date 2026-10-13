import { withMobileRls } from "@/lib/with-mobile-rls"
import { readAttendanceDocument } from "@/lib/mtm/attendance-attachment"
import { attendancePrivateHeaders, attendanceRequestFailure } from "@/lib/mtm/attendance-request-http"

type AttachmentContext = { params: Promise<{ id: string }> }

export const GET = withMobileRls<AttachmentContext>(async (_req, auth, ctx) => {
  try {
    const { id } = await ctx.params
    const file = await readAttendanceDocument({ organizationId: auth.orgId, self: { organizationId: auth.orgId, agentId: auth.agentId, role: auth.role } }, id)
    return new Response(new Uint8Array(file.bytes), { headers: { ...attendancePrivateHeaders, "content-type": file.mimeType, "content-disposition": 'attachment; filename="document.jpg"' } })
  } catch (error) { return attendanceRequestFailure(error) }
}, { requiredCapability: "route-field" })
