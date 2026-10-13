import { randomUUID } from "node:crypto"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { AttendanceDeliveryInputSchema, nextAttendanceDeliveryAt, type AttendanceDeliveryInput, type AttendanceDeliverySchedule, type AttendanceDeliveryReceipt } from "@/lib/mtm/attendance-delivery-contract"

export class AttendanceDeliveryError extends Error {
  constructor(public readonly code: string, public readonly status: number) { super(code) }
}
export type AttendanceScheduleRow = { id: string; organizationId: string; userId: string; input: Prisma.JsonValue; timezone: string; enabled: boolean; nextRunAt: Date; updatedAt: Date; archivedAt: Date | null }
export type AttendanceDeliveryRow = Omit<AttendanceDeliveryReceipt, "from" | "to" | "createdAt" | "completedAt"> & { organizationId: string; scheduleVersion: Date; from: Date; to: Date; createdAt: Date; completedAt: Date | null }
export function attendanceSchedule(row: AttendanceScheduleRow): AttendanceDeliverySchedule {
  return { ...AttendanceDeliveryInputSchema.parse(row.input), enabled: row.enabled, id: row.id, timezone: row.timezone, nextRunAt: row.nextRunAt.toISOString(), version: row.updatedAt.toISOString() }
}
const createSchema = z.object({ requestId: z.string().uuid(), input: AttendanceDeliveryInputSchema }).strict()
const updateSchema = z.object({ version: z.string().datetime(), input: AttendanceDeliveryInputSchema }).strict()
const removeSchema = z.object({ version: z.string().datetime() }).strict()
export async function readAttendanceDeliveries(organizationId: string, userId: string) {
  const [rows, receipts] = await Promise.all([
    prisma.$queryRaw<AttendanceScheduleRow[]>`SELECT * FROM "mtm_attendance_schedules" WHERE "organizationId" = ${organizationId} AND "userId" = ${userId} AND "archivedAt" IS NULL ORDER BY "createdAt", "id"`,
    prisma.$queryRaw<AttendanceDeliveryRow[]>`SELECT d.* FROM "mtm_attendance_deliveries" d JOIN "mtm_attendance_schedules" s ON s."id" = d."scheduleId" AND s."organizationId" = d."organizationId" WHERE s."organizationId" = ${organizationId} AND s."userId" = ${userId} ORDER BY d."createdAt" DESC, d."id" LIMIT 100`,
  ])
  return { schedules: rows.map(attendanceSchedule), receipts: receipts.map((row): AttendanceDeliveryReceipt => ({ id: row.id, scheduleId: row.scheduleId, recipient: row.recipient, from: row.from.toISOString().slice(0, 10), to: row.to.toISOString().slice(0, 10), status: row.status, createdAt: row.createdAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null, errorCode: row.errorCode })) }
}

/** Each owner gets ten private schedules; deletion keeps the delivery history. */
export async function saveAttendanceDelivery(args: { organizationId: string; userId: string; timezone: string; value: unknown; id?: string; remove?: boolean }) {
  const parsed = args.remove ? removeSchema.transform((value) => ({ kind: "remove" as const, ...value })).safeParse(args.value)
    : args.id ? updateSchema.transform((value) => ({ kind: "update" as const, ...value })).safeParse(args.value)
      : createSchema.transform((value) => ({ kind: "create" as const, ...value })).safeParse(args.value)
  if (!parsed.success || (args.remove && !args.id)) throw new AttendanceDeliveryError("MTM_ATTENDANCE_DELIVERY_INVALID", 400)
  const draft = parsed.data
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT set_config('lock_timeout', '3s', true)`
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-attendance-deliveries:${args.organizationId}:${args.userId}`}, 0))`
    const id = draft.kind === "create" ? `mtm_delivery_${args.userId}_${draft.requestId}` : args.id!
    const [existing] = await tx.$queryRaw<AttendanceScheduleRow[]>`SELECT * FROM "mtm_attendance_schedules" WHERE "organizationId" = ${args.organizationId} AND "userId" = ${args.userId} AND "id" = ${id} FOR UPDATE`
    if (draft.kind === "create" && existing) {
      if (existing.archivedAt || JSON.stringify(AttendanceDeliveryInputSchema.parse(existing.input)) !== JSON.stringify(draft.input)) throw new AttendanceDeliveryError("MTM_ATTENDANCE_DELIVERY_CHANGED", 409)
      return attendanceSchedule(existing)
    }
    const now = new Date(Math.max(Date.now(), existing ? existing.updatedAt.getTime() + 1 : 0))
    if (draft.kind === "create") {
      const [{ count }] = await tx.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM "mtm_attendance_schedules" WHERE "organizationId" = ${args.organizationId} AND "userId" = ${args.userId} AND "archivedAt" IS NULL`
      if (count >= 10n) throw new AttendanceDeliveryError("MTM_ATTENDANCE_DELIVERY_LIMIT", 409)
      const next = nextAttendanceDeliveryAt(draft.input.frequency, args.timezone, now)
      const [row] = await tx.$queryRaw<AttendanceScheduleRow[]>`INSERT INTO "mtm_attendance_schedules" ("id", "organizationId", "userId", "input", "timezone", "enabled", "nextRunAt", "updatedAt") VALUES (${id}, ${args.organizationId}, ${args.userId}, ${JSON.stringify(draft.input)}::jsonb, ${args.timezone}, ${draft.input.enabled}, ${next}, ${now}) RETURNING *`
      return attendanceSchedule(row)
    }
    if (!existing || existing.archivedAt) throw new AttendanceDeliveryError("MTM_ATTENDANCE_DELIVERY_NOT_FOUND", 404)
    if (existing.updatedAt.toISOString() !== draft.version) throw new AttendanceDeliveryError("MTM_ATTENDANCE_DELIVERY_CHANGED", 409)
    const input: AttendanceDeliveryInput = draft.kind === "remove" ? { ...AttendanceDeliveryInputSchema.parse(existing.input), enabled: false } : draft.input
    const next = nextAttendanceDeliveryAt(input.frequency, existing.timezone, now)
    const [row] = await tx.$queryRaw<AttendanceScheduleRow[]>`UPDATE "mtm_attendance_schedules" SET "input" = ${JSON.stringify(input)}::jsonb, "enabled" = ${input.enabled}, "nextRunAt" = ${next}, "updatedAt" = ${now}, "archivedAt" = ${draft.kind === "remove" ? now : null} WHERE "organizationId" = ${args.organizationId} AND "id" = ${id} RETURNING *`
    await tx.$executeRaw`UPDATE "mtm_attendance_deliveries" SET "status" = 'CANCELLED', "errorCode" = 'SCHEDULE_CHANGED', "completedAt" = ${now} WHERE "organizationId" = ${args.organizationId} AND "scheduleId" = ${id} AND "status" = 'PENDING'`
    return draft.kind === "remove" ? null : attendanceSchedule(row)
  })
}

/** Atomically advance the due time with durable, deduplicated recipient rows. */
export async function enqueueAttendanceDelivery(organizationId: string, id: string, now: Date) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT set_config('lock_timeout', '3s', true)`
    const [row] = await tx.$queryRaw<AttendanceScheduleRow[]>`SELECT * FROM "mtm_attendance_schedules" WHERE "organizationId" = ${organizationId} AND "id" = ${id} AND "enabled" AND "archivedAt" IS NULL AND "nextRunAt" <= ${now} FOR UPDATE`
    if (!row) return 0
    const schedule = attendanceSchedule(row)
    const { attendanceDeliveryConfig } = await import("@/lib/mtm/attendance-delivery-contract")
    const config = attendanceDeliveryConfig(schedule.config, schedule.frequency, row.timezone, now)
    const from = new Date(`${config.filters.from}T00:00:00Z`)
    const to = new Date(`${config.filters.to}T00:00:00Z`)
    let queued = 0
    for (const recipient of schedule.recipients) {
      queued += await tx.$executeRaw`INSERT INTO "mtm_attendance_deliveries" ("id", "organizationId", "scheduleId", "scheduleVersion", "recipient", "from", "to") VALUES (${randomUUID()}, ${organizationId}, ${id}, ${row.updatedAt}, ${recipient}, ${from}::date, ${to}::date) ON CONFLICT ("scheduleId", "from", "to", "recipient") DO NOTHING`
    }
    await tx.$executeRaw`UPDATE "mtm_attendance_schedules" SET "nextRunAt" = ${nextAttendanceDeliveryAt(schedule.frequency, row.timezone, now)} WHERE "organizationId" = ${organizationId} AND "id" = ${id}`
    return queued
  })
}
