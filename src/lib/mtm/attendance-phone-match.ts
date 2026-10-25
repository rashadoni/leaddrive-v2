import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import type { AttendanceReviewer } from "./attendance-request-decision"
import { AttendanceRequestError } from "./attendance-request-contract"
import { requireAttendanceEmployeeAdmin } from "./attendance-employee-store"
import { isAttendanceTrackedCard } from "./attendance-tracking"
import { findPhoneOwner } from "./mobile-login-phone"
import { AttendancePhoneMatchInput, type AttendancePhoneMatch } from "./attendance-phone-match-contract"

/** Administrator-only explanation of a refused creation, never enrollment or
 * permission to merge people. Include technical cards hidden from HR's list. */
export async function readAttendancePhoneMatch(actor: AttendanceReviewer, raw: unknown): Promise<AttendancePhoneMatch> {
  const parsed = AttendancePhoneMatchInput.safeParse(raw)
  if (!parsed.success) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_PHONE_INVALID", 400)
  if (actor.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_ADMIN_REQUIRED", 403)
  return prisma.$transaction(async tx => {
    await requireAttendanceEmployeeAdmin(tx, actor)
    const owner = await findPhoneOwner(tx, actor.organizationId, parsed.data.phone)
    if (owner.kind !== "found") return { kind: owner.kind }
    const card = await tx.mtmAgent.findFirst({
      where: { organizationId: actor.organizationId, id: owner.agentId, status: "ACTIVE" },
      select: { id: true, name: true, role: true, attendanceParticipant: true, attendanceIncludedFrom: true,
        auditLogs: { where: { organizationId: actor.organizationId, metadataKind: "mtm_attendance_employment", OR: [
          { action: { in: ["MTM_ATTENDANCE_EMPLOYEE_CREATED", "MTM_ATTENDANCE_EMPLOYEE_ENROLLED"] } },
          { action: "MTM_ATTENDANCE_EMPLOYMENT_RECORDED", newData: { path: ["kind"], equals: "HIRE" } },
        ] }, select: { id: true }, take: 1 },
      },
    })
    if (!card) return { kind: "none" }
    if (!isAttendanceTrackedCard(card)) return { kind: "other", name: card.name }
    return { kind: "attendance", agentId: card.id, name: card.name,
      enrolled: card.attendanceIncludedFrom === null || card.auditLogs.length > 0 }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15_000 })
}
