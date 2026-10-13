import { prisma } from "@/lib/prisma"
import { getMtmSettings } from "@/lib/mtm-settings"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"

/** Called inside the authenticated tenant context; never caches an opt-in. */
export async function getMtmAttendanceAccess(organizationId: string, userId: string, webRole: string) {
  const settings = await getMtmSettings(organizationId)
  if (settings.attendanceEnabled !== true) return { enabled: false as const }
  const actor = await resolveMtmRouteActor(prisma, { organizationId, userId, webRole })
  return { enabled: true as const, settings, actor: actor?.role === "AGENT" ? null : actor }
}
