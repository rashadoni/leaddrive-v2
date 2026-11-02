import { NextRequest, NextResponse } from "next/server"
import type { AuthResult } from "@/lib/api-auth"
import { withPersonnelWebRlsAuth } from "@/lib/with-mtm-rls-auth"
import { getMtmAttendanceAccess } from "@/lib/mtm/attendance-access"

type Access = Extract<Awaited<ReturnType<typeof getMtmAttendanceAccess>>, { enabled: true }>
export type AttendanceAuth = AuthResult & Omit<Access, "actor"> & { actor: NonNullable<Access["actor"]> }

/** Feature, tenant capability, RBAC and employee scope share one boundary. */
export function withMtmAttendanceAuth<C = unknown>(
  action: "read" | "write",
  handler: (req: NextRequest, auth: AttendanceAuth, ctx: C) => Promise<Response>,
) {
  return withPersonnelWebRlsAuth<C>(action, async (req, auth, ctx) => {
    const access = await getMtmAttendanceAccess(auth.orgId, auth.userId, auth.role)
    if (!access.enabled) {
      return NextResponse.json({ error: "Not found", code: "MTM_ATTENDANCE_DISABLED" }, { status: 404 })
    }
    if (!access.actor) {
      return NextResponse.json({ error: "Forbidden", code: "MTM_ATTENDANCE_FORBIDDEN" }, { status: 403 })
    }
    return handler(req, { ...auth, ...access, actor: access.actor }, ctx)
  })
}
