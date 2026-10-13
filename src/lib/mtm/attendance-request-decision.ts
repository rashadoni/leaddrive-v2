import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { checkPermission, type Role } from "@/lib/permissions"
import { effectiveHiddenModules } from "@/lib/user-module-access"
import { capabilitySettingsFromTenantSettings, getTenantCapabilityDefinition, resolveTenantCapability, tenantModulesFromFields } from "@/lib/tenant-capabilities"
import { canReviewMtmRouteRequest, resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { lockMtmWorkdayTransitions } from "@/lib/mtm/workday"
import { AttendanceRequestDetailsSchema, AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { attendanceRequestDto, attendanceRequestSelect, lockAttendanceRequests } from "@/lib/mtm/attendance-request-store"
import { applyAttendanceTimeCorrectionInTransaction } from "@/lib/mtm/attendance-time-correction"
import az from "../../../messages/az.json"
import ru from "../../../messages/ru.json"
import en from "../../../messages/en.json"

export const AttendanceDecisionInputSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]), version: z.string().datetime(),
  note: z.string().trim().max(1000).nullable().default(null),
}).strict().superRefine((value, ctx) => {
  if (value.decision === "REJECTED" && (!value.note || value.note.length < 3)) ctx.addIssue({ code: "custom", path: ["note"], message: "MTM_ATTENDANCE_DECISION_REASON_REQUIRED" })
})
export type AttendanceReviewer = { organizationId: string; userId: string; principalType: "session" | "api_key" }

/** The report-wide HR grant is read-only. Review uses the current web write
 * permission AND current Route & Field scope, never the cached report actor. */
export async function resolveAttendanceReviewerScope(tx: Prisma.TransactionClient, reviewer: AttendanceReviewer) {
  if (reviewer.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_DECISION_FORBIDDEN", 403)
  const { organizationId, userId } = reviewer
  const [user] = await tx.$queryRaw<{ role: string; hiddenModules: string[] }[]>`
    SELECT "role", "hiddenModules" FROM "users" WHERE "organizationId" = ${organizationId} AND "id" = ${userId}
    AND "isActive" AND "anonymizedAt" IS NULL FOR SHARE`
  if (!user || !checkPermission(user.role as Role, "mtm", "write") || effectiveHiddenModules(user.role, user.hiddenModules).includes("mtm")) {
    throw new AttendanceRequestError("MTM_ATTENDANCE_DECISION_FORBIDDEN", 403)
  }
  await tx.$queryRaw`SELECT "id" FROM "organizations" WHERE "id" = ${organizationId} FOR SHARE`
  const org = await tx.organization.findUnique({ where: { id: organizationId }, select: { plan: true, addons: true, features: true, modules: true, settings: true } })
  const definition = getTenantCapabilityDefinition("route-field")
  if (!org || !definition) throw new AttendanceRequestError("MTM_ATTENDANCE_DECISION_FORBIDDEN", 403)
  const settings = capabilitySettingsFromTenantSettings(org.settings)
  const capability = resolveTenantCapability(definition, { plan: org.plan, addons: org.addons,
    modules: tenantModulesFromFields(org), hidden: settings.hidden, requested: settings.requested })
  if (!capability.enabled || capability.status === "disabled") throw new AttendanceRequestError("MTM_ATTENDANCE_DECISION_FORBIDDEN", 403)
  const feature = await tx.mtmSetting.findUnique({ where: { organizationId_key: { organizationId, key: "attendanceEnabled" } }, select: { value: true } })
  if (feature?.value !== true) throw new AttendanceRequestError("MTM_ATTENDANCE_DISABLED", 404)
  const actor = await resolveMtmRouteActor(tx, { organizationId, userId, webRole: user.role })
  if (!actor || !["ADMIN", "MANAGER", "SUPERVISOR"].includes(actor.role) || (actor.role !== "ADMIN" && actor.scopedAgentIds === null)) {
    throw new AttendanceRequestError("MTM_ATTENDANCE_DECISION_FORBIDDEN", 403)
  }
  return actor
}
export async function requireAttendanceReviewer(tx: Prisma.TransactionClient, reviewer: AttendanceReviewer, agentId: string) {
  const { organizationId, userId } = reviewer
  const actor = await resolveAttendanceReviewerScope(tx, reviewer)
  const target = await tx.mtmAgent.findFirst({ where: { id: agentId, organizationId, status: "ACTIVE" }, select: { userId: true, user: { select: { preferredLanguage: true } } } })
  if (!target || !actor || !canReviewMtmRouteRequest(actor, agentId)) throw new AttendanceRequestError("MTM_ATTENDANCE_DECISION_FORBIDDEN", 403)
  if (target.userId === userId) throw new AttendanceRequestError("MTM_ATTENDANCE_REQUEST_SELF_APPROVAL", 403)
  return { actor, locale: target.user?.preferredLanguage }
}
const notificationMessages = { az: az.mtmAttendance, ru: ru.mtmAttendance, en: en.mtmAttendance }
export async function decideAttendanceRequestInTransaction(tx: Prisma.TransactionClient, reviewer: AttendanceReviewer, requestId: string, raw: unknown) {
  const parsed = AttendanceDecisionInputSchema.safeParse(raw)
  if (!parsed.success || !z.string().uuid().safeParse(requestId).success) throw new AttendanceRequestError("MTM_ATTENDANCE_DECISION_INVALID", 400)
  if (reviewer.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_DECISION_FORBIDDEN", 403)
  const { organizationId, userId } = reviewer
  // This initial lookup identifies only the lock scope; it grants no authority.
  const candidate = await tx.mtmHrmRequest.findFirst({ where: { id: requestId, organizationId, attendanceDetails: { not: Prisma.DbNull } }, select: { agentId: true } })
  if (!candidate) throw new AttendanceRequestError("MTM_ATTENDANCE_REQUEST_NOT_FOUND", 404)
  const scope = { organizationId, agentId: candidate.agentId }
  await tx.$executeRaw`SELECT set_config('lock_timeout', '3s', true)`
  await lockMtmWorkdayTransitions(tx, scope)
  await lockAttendanceRequests(tx, scope)
  const access = await requireAttendanceReviewer(tx, reviewer, candidate.agentId)
  const row = await tx.mtmHrmRequest.findFirst({ where: { id: requestId, organizationId }, select: { ...attendanceRequestSelect, decidedByUserId: true } })
  if (!row) throw new AttendanceRequestError("MTM_ATTENDANCE_REQUEST_NOT_FOUND", 404)
  const details = AttendanceRequestDetailsSchema.safeParse(row.attendanceDetails)
  if (!details.success) throw new AttendanceRequestError("MTM_ATTENDANCE_DECISION_KIND_UNAVAILABLE", 400)
  const { decision, version } = parsed.data
  const note = parsed.data.note || null
  const now = new Date()
  let idempotent = false
  if (decision === "APPROVED" && details.data.kind === "TIME_CORRECTION") {
    const result = await applyAttendanceTimeCorrectionInTransaction(tx, { organizationId, userId, requestId, expectedVersion: version, decisionNote: note, now })
    idempotent = result.idempotent
  } else if (row.status !== "PENDING") {
    if (row.status !== decision || row.decidedByUserId !== userId || row.decisionNote !== note) throw new AttendanceRequestError("MTM_ATTENDANCE_REQUEST_ALREADY_DECIDED")
    idempotent = true
  } else {
    if (row.updatedAt.toISOString() !== version) throw new AttendanceRequestError("MTM_ATTENDANCE_REQUEST_CHANGED")
    const changed = await tx.mtmHrmRequest.updateMany({ where: { id: requestId, organizationId, status: "PENDING", updatedAt: row.updatedAt },
      data: { status: decision, decisionNote: note, decidedAt: now, decidedByUserId: userId } })
    if (changed.count !== 1) throw new AttendanceRequestError("MTM_ATTENDANCE_REQUEST_CHANGED")
  }
  if (!idempotent) {
    await tx.mtmAuditLog.create({ data: { organizationId, actorUserId: userId, agentId: candidate.agentId,
      action: "MTM_ATTENDANCE_REQUEST_DECIDED", entity: "hrm_request", entityId: requestId, metadataKind: "mtm_attendance_request",
      oldData: { status: "PENDING" }, newData: { status: decision, actorUserId: userId } } })
    const locale = access.locale === "ru" || access.locale === "en" ? access.locale : "az"
    await tx.mtmNotification.create({ data: { organizationId, agentId: candidate.agentId,
      title: notificationMessages[locale][decision === "APPROVED" ? "decisionApproved" : "decisionRejected"], type: decision === "APPROVED" ? "info" : "warning",
      // No reason, medical subtype, attachment or coordinates in an inbox preview.
      metadata: { domain: "route", attendanceRequestId: requestId, status: decision } } })
  }
  const updated = await tx.mtmHrmRequest.findFirst({ where: { id: requestId, organizationId }, select: attendanceRequestSelect })
  if (!updated) throw new AttendanceRequestError("MTM_ATTENDANCE_REQUEST_CHANGED")
  return { request: attendanceRequestDto(updated), idempotent }
}
export async function decideAttendanceRequest(reviewer: AttendanceReviewer, requestId: string, raw: unknown) {
  return prisma.$transaction((tx: Prisma.TransactionClient) => decideAttendanceRequestInTransaction(tx, reviewer, requestId, raw), { timeout: 15_000 })
}
