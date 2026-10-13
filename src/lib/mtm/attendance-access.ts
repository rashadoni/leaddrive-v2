import { prisma } from "@/lib/prisma"
import { getMtmSettings } from "@/lib/mtm-settings"
import { checkPermission, type Role } from "@/lib/permissions"
import { effectiveHiddenModules } from "@/lib/user-module-access"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"

/** Called inside the authenticated tenant context; never caches an opt-in. */
export async function getMtmAttendanceAccess(organizationId: string, userId: string, webRole: string) {
  const settings = await getMtmSettings(organizationId)
  if (settings.attendanceEnabled !== true) return { enabled: false as const }
  // This narrow grant does not change the user's role or Route & Field scope.
  // It is read from the database on every report/export/email, never a cookie.
  if (webRole !== "admin" && webRole !== "superadmin") {
    const [user] = await prisma.$queryRaw<{ mtmAttendanceAll: boolean; role: string; hiddenModules: string[] }[]>`
      SELECT "mtmAttendanceAll", "role", "hiddenModules" FROM "users"
      WHERE "organizationId" = ${organizationId} AND "id" = ${userId} AND "isActive" AND "anonymizedAt" IS NULL`
    if (user?.mtmAttendanceAll === true && checkPermission(user.role as Role, "mtm", "read") && !effectiveHiddenModules(user.role, user.hiddenModules).includes("mtm")) {
      return { enabled: true as const, settings, actor: { role: "MANAGER" as const, agentId: null, scopedAgentIds: null }, allEmployeesGrant: true }
    }
  }
  const actor = await resolveMtmRouteActor(prisma, { organizationId, userId, webRole })
  return { enabled: true as const, settings, actor: actor?.role === "AGENT" ? null : actor }
}
