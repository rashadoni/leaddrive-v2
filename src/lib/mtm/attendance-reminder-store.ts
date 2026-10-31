import { randomUUID } from "node:crypto"
import { ATTENDANCE_TRACKED_CARD_WHERE } from "@/lib/mtm/attendance-tracking"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { createNotification } from "@/lib/notifications"
import { checkPermission, type Role } from "@/lib/permissions"
import { effectiveHiddenModules } from "@/lib/user-module-access"
import { capabilitySettingsFromTenantSettings, getTenantCapabilityDefinition, resolveTenantCapability, tenantModulesFromFields } from "@/lib/tenant-capabilities"
import { canReviewMtmRouteRequest, resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { lockMtmWorkdayTransitions } from "@/lib/mtm/workday"
import { lockAttendanceRequests } from "@/lib/mtm/attendance-self-access"
import { readAttendanceProjectionInTransaction } from "@/lib/mtm/attendance-report-store"
import { attendanceRuleForDate } from "@/lib/mtm/attendance-rules"
import { readAttendanceRules } from "@/lib/mtm/attendance-rule-store"
import { addDateKeyDays } from "@/lib/mtm/mobile-week"
import { lockAttendanceReminderPolicy, readAttendanceReminderPolicy } from "@/lib/mtm/attendance-reminder-policy"
import { attendanceReminderKinds, ATTENDANCE_REMINDER_ENTITY, ATTENDANCE_REMINDER_NOTIFICATION_KIND, type AttendanceReminderKind } from "@/lib/mtm/attendance-reminder-contract"
import az from "../../../messages/az.json"
import ru from "../../../messages/ru.json"
import en from "../../../messages/en.json"
import { AGENT_LANGUAGE_SELECT, agentLanguage } from "@/lib/mtm/agent-language"

export async function attendanceReminderTenantEnabled(tx: Prisma.TransactionClient, organizationId: string) {
  const org = await tx.organization.findFirst({ where: { id: organizationId, isActive: true }, select: { plan: true, addons: true, features: true, modules: true, settings: true } })
  const definition = getTenantCapabilityDefinition("personnel")
  if (!org || !definition) return false
  const settings = capabilitySettingsFromTenantSettings(org.settings)
  const capability = resolveTenantCapability(definition, { plan: org.plan, addons: org.addons, modules: tenantModulesFromFields(org), hidden: settings.hidden, requested: settings.requested })
  return capability.enabled && capability.status !== "disabled"
}

/** A current report reader, not a cached session and not an HR-wide write grant. */
export async function attendanceReminderReader(tx: Prisma.TransactionClient, organizationId: string, userId: string) {
  const user = await tx.user.findFirst({ where: { id: userId, organizationId, isActive: true, anonymizedAt: null }, select: { role: true, hiddenModules: true, preferredLanguage: true } })
  if (!user || !checkPermission(user.role as Role, "mtm", "read") || effectiveHiddenModules(user.role, user.hiddenModules).includes("mtm")) return null
  const actor = await resolveMtmRouteActor(tx, { organizationId, userId, webRole: user.role })
  return actor && actor.role !== "AGENT" && (actor.role === "ADMIN" || actor.scopedAgentIds !== null) ? { actor, locale: user.preferredLanguage } : null
}
const messages = { az: az.mtmAttendance, ru: ru.mtmAttendance, en: en.mtmAttendance }
const localeKey = (locale: string | null | undefined) => locale === "ru" || locale === "en" ? locale : "az"
const copyKey = { EMPLOYEE_START: "reminderEmployeeStart", EMPLOYEE_FINISH: "reminderEmployeeFinish", MANAGER_MISSING: "reminderManagerMissing", MANAGER_LATE: "reminderManagerLate" } as const

async function insertNotice(tx: Prisma.TransactionClient, input: { organizationId: string; agentId: string; date: string; kind: AttendanceReminderKind; ruleId: string; now: Date; recipientUserId?: string }) {
  const { organizationId, agentId, date, kind, ruleId, now } = input
  const id = randomUUID(), recipientUserId = input.recipientUserId ?? null
  const rows = await tx.$queryRaw<{ id: string }[]>`INSERT INTO mtm_attendance_reminder_notices
    (id,"organizationId","agentId","workDate",kind,"recipientAgentId","recipientUserId","observedAt","ruleId")
    VALUES (${id},${organizationId},${agentId},${new Date(`${date}T00:00:00.000Z`)}::date,${kind},${recipientUserId ? null : agentId},${recipientUserId},${now},${ruleId})
    ON CONFLICT DO NOTHING RETURNING id`
  return rows[0]?.id ?? null
}

/** Employee/mark/approval locks precede projection. The receipt and inbox entry
 * commit together; no external delivery or automatic workday mutation occurs. */
export async function createAttendanceRemindersInTransaction(tx: Prisma.TransactionClient, organizationId: string, agentId: string, now: Date) {
  if (!Number.isFinite(now.getTime())) return 0
  const self = { organizationId, agentId }
  await tx.$executeRaw`SELECT set_config('lock_timeout','3s',true)`
  await lockMtmWorkdayTransitions(tx, self)
  await lockAttendanceRequests(tx, self)
  await lockAttendanceReminderPolicy(tx, organizationId)
  await tx.$queryRaw`SELECT id FROM organizations WHERE id=${organizationId} FOR SHARE`
  const policy = await readAttendanceReminderPolicy(tx, organizationId)
  if (!policy.enabled || (!policy.employee && !policy.manager) || !await attendanceReminderTenantEnabled(tx, organizationId)) return 0
  const agent = await tx.mtmAgent.findFirst({ where: { organizationId, id: agentId, status: "ACTIVE", attendanceExcluded: false, ...ATTENDANCE_TRACKED_CARD_WHERE }, select: { id: true, userId: true, appLanguage: true, user: { select: { isActive: true, anonymizedAt: true, preferredLanguage: true } } } })
  if (!agent || (agent.userId && (!agent.user?.isActive || agent.user.anonymizedAt))) return 0
  // Today can be yesterday in UTC-negative zones; an overnight source date
  // can therefore be UTC minus two days. The classifier allows only local
  // today or a real overnight shift ending today, never stale ordinary days.
  const utc = now.toISOString().slice(0, 10)
  const report = await readAttendanceProjectionInTransaction(tx, { organizationId, authorizedEmployeeIds: [agentId], query: { from: addDateKeyDays(utc, -2), to: addDateKeyDays(utc, 1), employeeId: agentId, form: "ALL" }, now })
  const rules = await readAttendanceRules(organizationId, tx)
  let created = 0
  for (const row of report.rows) {
    const rule = attendanceRuleForDate(rules, row.date)
    const ruleId = row.shiftPlanId ?? rule.id
    const kinds = attendanceReminderKinds(row, now, rule.lateGraceMinutes)
    for (const kind of kinds.filter(kind => kind.startsWith("EMPLOYEE") && policy.employee)) {
      const notice = await insertNotice(tx, { organizationId, agentId, date: row.date, kind, ruleId, now })
      if (!notice) continue
      const t = messages[localeKey(agentLanguage(agent))]
      await tx.mtmNotification.create({ data: { organizationId, agentId, type: "info", title: t[copyKey[kind]], body: t.reminderEmployeeBody,
        metadata: { domain: "route", attendanceReminderId: notice, attendanceReminderKind: kind } } })
      created++
    }
    const managerKinds = kinds.filter(kind => kind.startsWith("MANAGER") && policy.manager)
    if (!managerKinds.length) continue
    const cards = await tx.mtmAgent.findMany({ where: { organizationId, status: "ACTIVE", role: { in: ["ADMIN", "MANAGER", "SUPERVISOR"] }, userId: { not: null } }, select: { userId: true } })
    const cardUsers = cards.flatMap(card => card.userId ? [card.userId] : [])
    const users = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE "organizationId"=${organizationId} AND "isActive" AND "anonymizedAt" IS NULL
      AND (${agent.userId}::text IS NULL OR id<>${agent.userId}) AND (role IN ('admin','superadmin') OR id=ANY(${cardUsers}::text[])) ORDER BY id LIMIT 1001 FOR SHARE`
    if (users.length > 1000) throw new Error("MTM_ATTENDANCE_REMINDER_RECIPIENT_LIMIT")
    for (const user of users) {
      const reader = await attendanceReminderReader(tx, organizationId, user.id)
      if (!reader || !canReviewMtmRouteRequest(reader.actor, agentId)) continue
      for (const kind of managerKinds) {
        const notice = await insertNotice(tx, { organizationId, agentId, date: row.date, kind, ruleId, now, recipientUserId: user.id })
        if (!notice) continue
        const t = messages[localeKey(reader.locale)]
        const notification = await createNotification({ organizationId, userId: user.id, type: "warning", title: t[copyKey[kind]], message: t.reminderManagerBody,
          entityType: ATTENDANCE_REMINDER_ENTITY, entityId: notice, kind: ATTENDANCE_REMINDER_NOTIFICATION_KIND, idempotencyKey: `mtm-attendance-reminder:${notice}`, client: tx })
        if (!notification) throw new Error("MTM_ATTENDANCE_REMINDER_NOTIFICATION_UNAVAILABLE")
        created++
      }
    }
  }
  return created
}
export function createAttendanceReminders(organizationId: string, agentId: string, now: Date) {
  return prisma.$transaction(tx => createAttendanceRemindersInTransaction(tx, organizationId, agentId, now), { timeout: 15_000 })
}
