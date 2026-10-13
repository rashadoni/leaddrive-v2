import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { AttendanceDayKindsSchema, AttendanceDayKindsUpdateSchema, defaultAttendanceDayKinds, type AttendanceDayCatalogue } from "@/lib/mtm/attendance-day-kinds"

import az from "../../../messages/az.json"
import ru from "../../../messages/ru.json"
import en from "../../../messages/en.json"
const defaultItems = () => defaultAttendanceDayKinds((key) => ({
  az: (az.mtmAttendance as Record<string, unknown>)[`dayKindName${key}`] as string,
  ru: (ru.mtmAttendance as Record<string, unknown>)[`dayKindName${key}`] as string,
  en: (en.mtmAttendance as Record<string, unknown>)[`dayKindName${key}`] as string,
}))
// Outside public defaults: absent from legacy settings and mobile bootstrap.
const KEY = "attendanceDayKinds"
type Db = Pick<Prisma.TransactionClient, "mtmSetting">
export class AttendanceDayKindError extends Error {
  constructor(public readonly code: string, public readonly status: number) { super(code) }
}
export async function readAttendanceDayKinds(organizationId: string, db: Db = prisma): Promise<AttendanceDayCatalogue> {
  const row = await db.mtmSetting.findUnique({ where: { organizationId_key: { organizationId, key: KEY } }, select: { value: true, updatedAt: true } })
  if (!row) return { items: AttendanceDayKindsSchema.parse(defaultItems()), version: null }
  // Invalid stored data is an error, never a silent reset of a customer's codes.
  return { items: AttendanceDayKindsSchema.parse(row.value), version: row.updatedAt.toISOString() }
}
export async function saveAttendanceDayKinds(organizationId: string, actorUserId: string, value: unknown) {
  const parsed = AttendanceDayKindsUpdateSchema.safeParse(value)
  if (!parsed.success) throw new AttendanceDayKindError("MTM_ATTENDANCE_DAY_KINDS_INVALID", 400)
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT set_config('lock_timeout', '3s', true)`
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-attendance-day-kinds:${organizationId}`}, 0))`
    const old = await readAttendanceDayKinds(organizationId, tx)
    if (old.version !== parsed.data.version) throw new AttendanceDayKindError("MTM_ATTENDANCE_DAY_KINDS_CHANGED", 409)
    // Keys never disappear: archived kinds retain their identity for requests,
    // decisions and closed-month snapshots which may reference them later.
    if (old.items.some((item) => !parsed.data.items.some((next) => next.key === item.key))) throw new AttendanceDayKindError("MTM_ATTENDANCE_DAY_KINDS_ARCHIVE_REQUIRED", 400)
    if (JSON.stringify(old.items) === JSON.stringify(parsed.data.items)) return old
    const updatedAt = new Date(Math.max(Date.now(), old.version ? Date.parse(old.version) + 1 : 0))
    await tx.mtmSetting.upsert({ where: { organizationId_key: { organizationId, key: KEY } },
      create: { organizationId, key: KEY, value: parsed.data.items as Prisma.InputJsonValue, updatedAt },
      update: { value: parsed.data.items as Prisma.InputJsonValue, updatedAt },
    })
    await tx.mtmAuditLog.create({ data: { organizationId, actorUserId, action: "MTM_ATTENDANCE_DAY_KINDS_UPDATED", entity: "mtm_setting", entityId: KEY,
      metadataKind: "mtm_attendance_day_kinds", oldData: { items: old.items, version: old.version }, newData: { items: parsed.data.items, version: updatedAt.toISOString() } } })
    return { items: parsed.data.items, version: updatedAt.toISOString() }
  })
}
