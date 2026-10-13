import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { mutateAttendanceDelivery } from "@/lib/mtm/attendance-delivery-api"
type Context = { params: Promise<{ id: string }> }
export const PATCH = withMtmAttendanceAuth<Context>("read", async (req, auth, ctx) => mutateAttendanceDelivery(req, auth, (await ctx.params).id))
export const DELETE = withMtmAttendanceAuth<Context>("read", async (req, auth, ctx) => mutateAttendanceDelivery(req, auth, (await ctx.params).id, true))
