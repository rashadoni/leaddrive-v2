import { randomUUID } from "node:crypto"
import bcrypt from "bcryptjs"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { checkUserLimit } from "@/lib/plan-limits"
import { passwordPolicyError } from "@/lib/password-policy"
import { USER_HIDEABLE_MODULE_IDS, parseHiddenModulesInput } from "@/lib/user-module-access"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import type { AttendanceReviewer } from "@/lib/mtm/attendance-request-decision"
import { recordAttendanceInitialHire, requireAttendanceEmployeeAdmin, resolveAttendanceDepartment } from "@/lib/mtm/attendance-employee-store"
import { ATTENDANCE_EMPLOYEE_POSITION_MAX } from "@/lib/mtm/attendance-employee-contract"
import { isDateKey } from "@/lib/mtm/mobile-week"

/**
 * Personnel → Employees → "Add employee" (owner, 2026-10-15): HR adds office
 * staff here, apart from MTM field agents. The owner chose a CRM user (it counts
 * against the plan's user limit and signs in to the phone with this password),
 * but an office employee must not read the CRM: the "viewer" role reads every
 * module, so every hideable module is hidden from them. The phone does not read
 * the module mask, so marks and requests work.
 */
export const OFFICE_EMPLOYEE_CRM_ROLE = "viewer"

export const AttendanceEmployeeCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().max(320).email(),
  phone: z.union([z.literal("").transform(() => null), z.string().regex(/^\+[1-9]\d{6,14}$/), z.null()]).optional(),
  password: z.string().max(72),
  // The card: job title, department and hire date, all optional (filled later in the card).
  position: z.string().trim().max(ATTENDANCE_EMPLOYEE_POSITION_MAX).transform(value => value || null).nullable().optional(),
  teamId: z.string().trim().min(1).max(191).nullable().optional(),
  newTeamName: z.string().trim().min(1).max(120).optional(),
  hireDate: z.union([z.literal("").transform(() => null), z.string().refine(isDateKey), z.null()]).optional(),
}).strict().refine(input => !(input.newTeamName && input.teamId), { path: ["teamId"] })

export async function createAttendanceEmployee(actor: AttendanceReviewer, raw: unknown) {
  const parsed = AttendanceEmployeeCreateSchema.safeParse(raw)
  if (!parsed.success) throw new AttendanceRequestError(parsed.error.issues.some(issue => issue.path[0] === "phone") ? "MTM_ATTENDANCE_EMPLOYEE_PHONE_INVALID" : "MTM_ATTENDANCE_EMPLOYEE_INVALID", 400)
  const { name, email, phone, password, position = null, teamId = null, newTeamName, hireDate = null } = parsed.data
  if (passwordPolicyError(password)) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_PASSWORD_WEAK", 400)
  const organizationId = actor.organizationId
  const limit = await checkUserLimit(organizationId)
  if (!limit.allowed) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_USER_LIMIT", 403)
  const hiddenModules = parseHiddenModulesInput(OFFICE_EMPLOYEE_CRM_ROLE, [...USER_HIDEABLE_MODULE_IDS])!
  const passwordHash = await bcrypt.hash(password, 12)

  const created = await prisma.$transaction(async tx => {
    const timezone = await requireAttendanceEmployeeAdmin(tx, actor)
    if (await tx.user.findFirst({ where: { organizationId, email }, select: { id: true } })) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_EMAIL_TAKEN", 409)
    // A field agent's card with this email is another person's phone login.
    if (await tx.mtmAgent.findFirst({ where: { organizationId, email }, select: { id: true } })) throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_EMAIL_TAKEN", 409)
    const user = await tx.user.create({
      data: { organizationId, name, email, phone: phone ?? null, passwordHash, role: OFFICE_EMPLOYEE_CRM_ROLE, isActive: true, hiddenModules },
      select: { id: true, name: true, email: true },
    })
    // With attendance on, the database trigger has already created the card.
    const card = await tx.mtmAgent.findFirst({ where: { organizationId, userId: user.id }, select: { id: true } })
    const agentId = card?.id ?? randomUUID()
    const department = await resolveAttendanceDepartment(tx, organizationId, { teamId, newTeamName })
    if (!card) await tx.mtmAgent.create({ data: { id: agentId, organizationId, userId: user.id, name, email, role: "EMPLOYEE", status: "ACTIVE",
      attendanceParticipant: true, canPlanOwnRoutes: false, canSelfPublishRoutes: false, position, teamId: department } })
    else if (position || department) await tx.mtmAgent.update({ where: { organizationId, id: agentId }, data: { position, teamId: department } })
    if (hireDate) await recordAttendanceInitialHire(tx, actor, agentId, hireDate, timezone)
    await tx.mtmAuditLog.create({ data: { organizationId, actorUserId: actor.userId, agentId, entity: "agent", entityId: agentId,
      action: "MTM_ATTENDANCE_EMPLOYEE_CREATED", metadataKind: "mtm_attendance_employment", newData: { userId: user.id, position, teamId: department, hireDate } } })
    return { userId: user.id, agentId, name: user.name, email: user.email }
  }, { timeout: 15_000 })

  await logAudit(organizationId, "user_created", "user", created.userId, created.email, {
    userId: actor.userId,
    newValue: { name: created.name, email: created.email, role: OFFICE_EMPLOYEE_CRM_ROLE, isActive: true, hiddenModules, source: "personnel" },
  })
  return created
}
