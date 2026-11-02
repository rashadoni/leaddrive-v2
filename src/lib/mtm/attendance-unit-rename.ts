import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { AttendanceUnitRenameSchema } from "@/lib/mtm/attendance-unit-rename-contract"
import type { AttendanceReviewer } from "@/lib/mtm/attendance-request-decision"
import { lockAttendanceUnitNames, requireAttendanceEmployeeAdmin } from "@/lib/mtm/attendance-employee-store"

/**
 * Renaming a department (departament) or a section (şöbə, an MTM team) after
 * it was created (owner, 2026-11-02: «нет редактирования названия который уже
 * был создан… если будет ошибка то исправить уже нет варианта»; mockup
 * approved with «Давай, делай»). The same administrator who may create them on
 * an employee card may rename them; the new name reaches every card, the
 * timesheet and the reports, which read the name from the unit.
 *
 * A name typed on a card is matched to an existing unit by name
 * (`resolveAttendanceUnit`), so a rename may not make two units answer to one
 * name: another department of that name, or a section of that name in the
 * same department, refuses it. A section outside any department stands in the
 * same list as every department's sections, so it collides with any namesake.
 */
export async function renameAttendanceUnit(actor: AttendanceReviewer, raw: unknown) {
  const parsed = AttendanceUnitRenameSchema.safeParse(raw)
  if (!parsed.success) throw new AttendanceRequestError("MTM_ATTENDANCE_UNIT_INVALID", 400)
  const input = parsed.data, organizationId = actor.organizationId
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await requireAttendanceEmployeeAdmin(tx, actor)
    await lockAttendanceUnitNames(tx, organizationId)
    const sameName = { equals: input.name, mode: "insensitive" as const }
    let before: string
    if (input.kind === "DEPARTMENT") {
      const department = await tx.mtmDepartment.findFirst({ where: { organizationId, id: input.id }, select: { name: true } })
      if (!department) throw new AttendanceRequestError("MTM_ATTENDANCE_UNIT_NOT_FOUND", 404)
      if (await tx.mtmDepartment.findFirst({ where: { organizationId, id: { not: input.id }, name: sameName }, select: { id: true } })) {
        throw new AttendanceRequestError("MTM_ATTENDANCE_UNIT_NAME_TAKEN")
      }
      before = department.name
      if (before !== input.name) await tx.mtmDepartment.update({ where: { organizationId_id: { organizationId, id: input.id } }, data: { name: input.name } })
    } else {
      const section = await tx.mtmTeam.findFirst({ where: { organizationId, id: input.id }, select: { name: true, departmentId: true } })
      if (!section) throw new AttendanceRequestError("MTM_ATTENDANCE_UNIT_NOT_FOUND", 404)
      const namesakes = await tx.mtmTeam.findMany({ where: { organizationId, id: { not: input.id }, name: sameName }, select: { departmentId: true }, take: 50 })
      if (namesakes.some(other => !other.departmentId || !section.departmentId || other.departmentId === section.departmentId)) {
        throw new AttendanceRequestError("MTM_ATTENDANCE_UNIT_NAME_TAKEN")
      }
      before = section.name
      if (before !== input.name) await tx.mtmTeam.update({ where: { organizationId_id: { organizationId, id: input.id } }, data: { name: input.name } })
    }
    // An unchanged name writes nothing, not even a journal row.
    if (before !== input.name) {
      await tx.mtmAuditLog.create({ data: { organizationId, actorUserId: actor.userId, entity: input.kind === "DEPARTMENT" ? "mtm_department" : "mtm_team", entityId: input.id,
        action: "MTM_ATTENDANCE_UNIT_RENAMED", metadataKind: "mtm_attendance_unit", oldData: { name: before }, newData: { name: input.name } } })
    }
    return { kind: input.kind, id: input.id, name: input.name, changed: before !== input.name }
  }, { timeout: 15_000 })
}
