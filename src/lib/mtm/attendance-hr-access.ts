import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { checkPermission, type Role } from "@/lib/permissions"
import { effectiveHiddenModules } from "@/lib/user-module-access"

export class AttendanceHrAccessError extends Error {
  constructor(public readonly code: string, public readonly status: number) { super(code) }
}
export type AttendanceHrUser = { id: string; name: string; role: string; isActive: boolean; allEmployees: boolean; canGrant: boolean; version: string }
type UserRow = { id: string; name: string; role: string; isActive: boolean; mtmAttendanceAll: boolean; hiddenModules: string[]; updatedAt: Date }
const adminRole = (role: string) => role === "admin" || role === "superadmin"
function serialize(row: UserRow): AttendanceHrUser {
  return { id: row.id, name: row.name, role: row.role, isActive: row.isActive, allEmployees: row.mtmAttendanceAll,
    canGrant: row.isActive && checkPermission(row.role as Role, "mtm", "read") && !effectiveHiddenModules(row.role, row.hiddenModules).includes("mtm"), version: row.updatedAt.toISOString() }
}
export async function readAttendanceHrUsers(organizationId: string, search: string) {
  // Escape LIKE metacharacters; a search for '_' is a literal name search.
  const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`
  const users = await prisma.$queryRaw<UserRow[]>`
    SELECT "id", "name", "role", "isActive", "mtmAttendanceAll", "hiddenModules", "updatedAt" FROM "users"
    WHERE "organizationId" = ${organizationId} AND "anonymizedAt" IS NULL AND "role" NOT IN ('admin','superadmin') AND "name" ILIKE ${pattern}
    ORDER BY "name", "id" LIMIT 51`
  return { users: users.slice(0, 50).map(serialize), hasMore: users.length > 50 }
}
const changeSchema = z.object({ allEmployees: z.boolean(), version: z.string().datetime() }).strict()

/** Admin mutation and audit are one transaction; old sessions see revocation immediately. */
export async function changeAttendanceHrAccess(organizationId: string, actorUserId: string, userId: string, value: unknown) {
  const parsed = changeSchema.safeParse(value)
  if (!parsed.success) throw new AttendanceHrAccessError("MTM_ATTENDANCE_HR_INVALID", 400)
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT set_config('lock_timeout', '3s', true)`
    const [old] = await tx.$queryRaw<UserRow[]>`SELECT "id", "name", "role", "isActive", "mtmAttendanceAll", "hiddenModules", "updatedAt" FROM "users" WHERE "organizationId" = ${organizationId} AND "id" = ${userId} AND "anonymizedAt" IS NULL FOR UPDATE`
    if (!old) throw new AttendanceHrAccessError("MTM_ATTENDANCE_HR_NOT_FOUND", 404)
    if (adminRole(old.role)) throw new AttendanceHrAccessError("MTM_ATTENDANCE_HR_ADMIN_AUTOMATIC", 409)
    if (old.updatedAt.toISOString() !== parsed.data.version) throw new AttendanceHrAccessError("MTM_ATTENDANCE_HR_CHANGED", 409)
    const current = serialize(old)
    if (parsed.data.allEmployees && !current.canGrant) throw new AttendanceHrAccessError("MTM_ATTENDANCE_HR_UNAVAILABLE", 409)
    if (old.mtmAttendanceAll === parsed.data.allEmployees) return current
    const updatedAt = new Date(Math.max(Date.now(), old.updatedAt.getTime() + 1))
    const [row] = await tx.$queryRaw<UserRow[]>`UPDATE "users" SET "mtmAttendanceAll" = ${parsed.data.allEmployees}, "updatedAt" = ${updatedAt} WHERE "organizationId" = ${organizationId} AND "id" = ${userId} RETURNING "id", "name", "role", "isActive", "mtmAttendanceAll", "hiddenModules", "updatedAt"`
    await tx.mtmAuditLog.create({ data: {
      organizationId, actorUserId, action: parsed.data.allEmployees ? "MTM_ATTENDANCE_HR_GRANTED" : "MTM_ATTENDANCE_HR_REVOKED",
      entity: "user", entityId: userId, metadataKind: "mtm_attendance_access",
      oldData: { allEmployees: old.mtmAttendanceAll }, newData: { allEmployees: parsed.data.allEmployees },
    } })
    return serialize(row)
  })
}
