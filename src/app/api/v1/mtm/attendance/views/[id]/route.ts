import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { mutateAttendanceView } from "@/lib/mtm/attendance-view-api"

type Context = { params: Promise<{ id: string }> }
export const PATCH = withMtmAttendanceAuth<Context>("read", async (req, auth, ctx) => mutateAttendanceView(req, auth, (await ctx.params).id))
export const DELETE = withMtmAttendanceAuth<Context>("read", async (req, auth, ctx) => mutateAttendanceView(req, auth, (await ctx.params).id, true))
