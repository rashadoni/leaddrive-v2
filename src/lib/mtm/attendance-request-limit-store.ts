import type { Prisma, PrismaClient } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { effectiveHiddenModules } from "@/lib/user-module-access"
import { capabilitySettingsFromTenantSettings, getTenantCapabilityDefinition, resolveTenantCapability, tenantModulesFromFields } from "@/lib/tenant-capabilities"
import { AttendanceRequestLimitsSchema, AttendanceRequestLimitsUpdateSchema, DEFAULT_ATTENDANCE_REQUEST_LIMITS, type AttendanceRequestLimits } from "@/lib/mtm/attendance-request-limits"
import { readAttendanceFeature } from "@/lib/mtm/attendance-feature"

const KEY = "attendanceRequestLimits"
const storedSchema = AttendanceRequestLimitsSchema.extend({ schemaVersion: z.literal(1) })
type ReadDb = Pick<PrismaClient, "mtmSetting">
export class AttendanceRequestLimitError extends AttendanceRequestError {}

/** Shared locks cover even an absent setting row; different employees can submit concurrently. */
export async function lockAttendanceRequestLimits(db: Prisma.TransactionClient, organizationId: string, mode: "read" | "write") {
  await db.$executeRaw`SELECT set_config('lock_timeout', '3s', true)`
  const key = `mtm-attendance-request-limits:${organizationId}`
  if (mode === "read") await db.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${key}, 0))`
  else await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`
}
export async function readAttendanceRequestLimits(organizationId: string, db: ReadDb = prisma): Promise<AttendanceRequestLimits> {
  const row = await db.mtmSetting.findUnique({ where: { organizationId_key: { organizationId, key: KEY } }, select: { value: true, updatedAt: true } })
  if (!row) return { ...DEFAULT_ATTENDANCE_REQUEST_LIMITS, version: null }
  const parsed = storedSchema.safeParse(row.value)
  if (!parsed.success) throw new AttendanceRequestLimitError("MTM_ATTENDANCE_REQUEST_LIMITS_INVALID_STORED", 409)
  return { monthlyMinutes: parsed.data.monthlyMinutes, monthlyRequests: parsed.data.monthlyRequests, version: row.updatedAt.toISOString() }
}

async function requireAdmin(tx: Prisma.TransactionClient, organizationId: string, userId: string) {
  const [user] = await tx.$queryRaw<{ role: string; hiddenModules: string[] }[]>`
    SELECT "role", "hiddenModules" FROM "users" WHERE "organizationId" = ${organizationId} AND "id" = ${userId}
    AND "isActive" AND "anonymizedAt" IS NULL FOR SHARE`
  if (!user || (user.role !== "admin" && user.role !== "superadmin") || effectiveHiddenModules(user.role, user.hiddenModules).includes("mtm")) {
    throw new AttendanceRequestLimitError("MTM_ATTENDANCE_ADMIN_REQUIRED", 403)
  }
  await tx.$queryRaw`SELECT "id" FROM "organizations" WHERE "id" = ${organizationId} FOR SHARE`
  const org = await tx.organization.findUnique({ where: { id: organizationId }, select: { plan: true, addons: true, features: true, modules: true, settings: true } })
  const definition = getTenantCapabilityDefinition("personnel")
  if (!org || !definition) throw new AttendanceRequestLimitError("MTM_ATTENDANCE_FORBIDDEN", 403)
  const settings = capabilitySettingsFromTenantSettings(org.settings)
  const capability = resolveTenantCapability(definition, { plan: org.plan, addons: org.addons, modules: tenantModulesFromFields(org), hidden: settings.hidden, requested: settings.requested })
  if (!capability.enabled || capability.status === "disabled") throw new AttendanceRequestLimitError("MTM_ATTENDANCE_FORBIDDEN", 403)
  if (!await readAttendanceFeature(tx, organizationId, { lock: true })) throw new AttendanceRequestLimitError("MTM_ATTENDANCE_DISABLED", 404)
}

/** Versioned replacement affects new submissions only; request snapshots remain immutable. */
export async function saveAttendanceRequestLimits(organizationId: string, actorUserId: string, value: unknown) {
  const parsed = AttendanceRequestLimitsUpdateSchema.safeParse(value)
  if (!parsed.success) throw new AttendanceRequestLimitError("MTM_ATTENDANCE_REQUEST_LIMITS_INVALID", 400)
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await lockAttendanceRequestLimits(tx, organizationId, "write")
    await requireAdmin(tx, organizationId, actorUserId)
    const old = await readAttendanceRequestLimits(organizationId, tx)
    if (old.version !== parsed.data.version) throw new AttendanceRequestLimitError("MTM_ATTENDANCE_REQUEST_LIMITS_CHANGED", 409)
    const { monthlyMinutes, monthlyRequests } = parsed.data
    if (old.monthlyMinutes === monthlyMinutes && old.monthlyRequests === monthlyRequests) return old
    const updatedAt = new Date(Math.max(Date.now(), old.version ? Date.parse(old.version) + 1 : 0))
    const setting = { schemaVersion: 1, monthlyMinutes, monthlyRequests }
    await tx.mtmSetting.upsert({ where: { organizationId_key: { organizationId, key: KEY } },
      create: { organizationId, key: KEY, value: setting, updatedAt }, update: { value: setting, updatedAt } })
    const next = { monthlyMinutes, monthlyRequests, version: updatedAt.toISOString() }
    await tx.mtmAuditLog.create({ data: { organizationId, actorUserId, action: "MTM_ATTENDANCE_REQUEST_LIMITS_UPDATED", entity: "mtm_setting", entityId: KEY,
      metadataKind: "mtm_attendance_request_limits", oldData: old, newData: next } })
    return next
  })
}
