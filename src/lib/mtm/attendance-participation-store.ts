import { Prisma } from "@prisma/client"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import type { AttendanceParticipationEvent } from "@/lib/mtm/attendance-employee-contract"

/** Internal read only. Callers establish tenant and employee visibility first. */
export async function readAttendanceParticipationHistory(tx: Prisma.TransactionClient, organizationId: string, agentIds: readonly string[]): Promise<AttendanceParticipationEvent[]> {
  if (!agentIds.length) return []
  const rows = await tx.$queryRaw<Array<{ id: string; agentId: string; included: boolean; effectiveAt: Date }>>`
    SELECT id, "agentId", included, "effectiveAt" FROM mtm_attendance_participation_events
    WHERE "organizationId" = ${organizationId} AND "agentId" IN (${Prisma.join([...agentIds])})
    ORDER BY "effectiveAt", id LIMIT 100001`
  if (rows.length > 100000) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_TOO_LARGE", 422)
  return rows.map(row => ({ ...row, effectiveAt: row.effectiveAt.toISOString() }))
}
