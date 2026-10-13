import { randomUUID } from "node:crypto"
import type { PrismaClient } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import {
  AttendanceRuleInputSchema, attendanceRuleMinimumDate,
  type MtmAttendanceRule,
} from "@/lib/mtm/attendance-rules"

type RuleRow = Omit<MtmAttendanceRule, "effectiveFrom" | "createdAt"> & { effectiveFrom: Date; createdAt: Date }
function toRule(row: RuleRow): MtmAttendanceRule {
  return { ...row, effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10), createdAt: row.createdAt.toISOString() }
}

export class AttendanceRuleError extends Error {
  constructor(public readonly code: string, public readonly status: number) { super(code) }
}

export async function readAttendanceRules(organizationId: string, db: Pick<PrismaClient, "$queryRaw"> = prisma): Promise<MtmAttendanceRule[]> {
  const rows = await db.$queryRaw<RuleRow[]>`
    SELECT "id", "effectiveFrom", "timezone", "startTime", "endTime", "lunchMinutes", "lateGraceMinutes", "weekendDays", "createdBy", "createdAt"
    FROM "mtm_attendance_rules" WHERE "organizationId" = ${organizationId} ORDER BY "effectiveFrom" ASC`
  return rows.map(toRule)
}

/** Append under an organization lock: two editors cannot publish the same date. */
export async function createAttendanceRule(organizationId: string, userId: string, timezone: string, input: unknown) {
  const parsed = AttendanceRuleInputSchema.safeParse(input)
  if (!parsed.success) throw new AttendanceRuleError("MTM_ATTENDANCE_RULE_INVALID", 400)
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT set_config('lock_timeout', '3s', true)`
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-attendance-rules:${organizationId}`}, 0))`
    const versions = (await tx.$queryRaw<RuleRow[]>`
      SELECT "id", "effectiveFrom", "timezone", "startTime", "endTime", "lunchMinutes", "lateGraceMinutes", "weekendDays", "createdBy", "createdAt"
      FROM "mtm_attendance_rules" WHERE "organizationId" = ${organizationId} ORDER BY "effectiveFrom" ASC`).map(toRule)
    const minimum = attendanceRuleMinimumDate(versions, timezone)
    if (parsed.data.effectiveFrom < minimum) {
      throw new AttendanceRuleError("MTM_ATTENDANCE_RULE_FUTURE_REQUIRED", 409)
    }
    const rule = parsed.data
    const id = randomUUID()
    const rows = await tx.$queryRaw<RuleRow[]>`
      INSERT INTO "mtm_attendance_rules" ("id", "organizationId", "effectiveFrom", "timezone", "startTime", "endTime", "lunchMinutes", "lateGraceMinutes", "weekendDays", "createdBy")
      VALUES (${id}, ${organizationId}, ${new Date(`${rule.effectiveFrom}T00:00:00.000Z`)}::date, ${timezone}, ${rule.startTime}, ${rule.endTime}, ${rule.lunchMinutes}, ${rule.lateGraceMinutes}, ${rule.weekendDays}::int[], ${userId})
      RETURNING "id", "effectiveFrom", "timezone", "startTime", "endTime", "lunchMinutes", "lateGraceMinutes", "weekendDays", "createdBy", "createdAt"`
    return toRule(rows[0])
  })
}
