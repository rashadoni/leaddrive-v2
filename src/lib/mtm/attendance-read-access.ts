import type { Prisma } from "@prisma/client"
import { checkPermission, type Role } from "@/lib/permissions"
import { effectiveHiddenModules } from "@/lib/user-module-access"
import { capabilitySettingsFromTenantSettings, getTenantCapabilityDefinition, resolveTenantCapability, tenantModulesFromFields } from "@/lib/tenant-capabilities"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import type { AttendanceReviewer } from "@/lib/mtm/attendance-request-decision"
import { resolveMtmRouteActor, type MtmRouteActor } from "@/lib/mtm/route-permissions"
import { readAttendanceFeature } from "@/lib/mtm/attendance-feature"

/** Recheck read authority within the very snapshot being exported. Middleware
 * actors are only an early boundary; they cannot preserve a revoked HR grant. */
export async function currentAttendanceReadActor(tx: Prisma.TransactionClient, reviewer: AttendanceReviewer): Promise<MtmRouteActor> {
  if (reviewer.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_RISK_FORBIDDEN", 403)
  const { organizationId, userId } = reviewer
  const [user] = await tx.$queryRaw<{ role: string; hiddenModules: string[]; mtmAttendanceAll: boolean }[]>`
    SELECT role,"hiddenModules","mtmAttendanceAll" FROM users WHERE "organizationId"=${organizationId} AND id=${userId}
      AND "isActive" AND "anonymizedAt" IS NULL FOR SHARE`
  if (!user || !checkPermission(user.role as Role, "mtm", "read") || effectiveHiddenModules(user.role, user.hiddenModules).includes("mtm")) throw new AttendanceRequestError("MTM_ATTENDANCE_RISK_FORBIDDEN", 403)
  await tx.$queryRaw`SELECT id FROM organizations WHERE id=${organizationId} FOR SHARE`
  const org = await tx.organization.findUnique({ where: { id: organizationId }, select: { plan: true, addons: true, features: true, modules: true, settings: true } })
  const definition = getTenantCapabilityDefinition("personnel")
  if (!org || !definition) throw new AttendanceRequestError("MTM_ATTENDANCE_RISK_FORBIDDEN", 403)
  const settings = capabilitySettingsFromTenantSettings(org.settings)
  const capability = resolveTenantCapability(definition, { plan: org.plan, addons: org.addons, modules: tenantModulesFromFields(org), hidden: settings.hidden, requested: settings.requested })
  if (!capability.enabled || capability.status === "disabled") throw new AttendanceRequestError("MTM_ATTENDANCE_RISK_FORBIDDEN", 403)
  if (!await readAttendanceFeature(tx, organizationId, { lock: true })) throw new AttendanceRequestError("MTM_ATTENDANCE_DISABLED", 404)
  if (user.mtmAttendanceAll === true) return { role: "MANAGER", agentId: null, scopedAgentIds: null }
  const actor = await resolveMtmRouteActor(tx, { organizationId, userId, webRole: user.role })
  if (!actor || actor.role === "AGENT" || (actor.role !== "ADMIN" && actor.scopedAgentIds === null)) throw new AttendanceRequestError("MTM_ATTENDANCE_RISK_FORBIDDEN", 403)
  return actor
}

