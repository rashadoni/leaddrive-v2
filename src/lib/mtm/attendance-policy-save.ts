import type { NextRequest } from "next/server"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { MTM_SETTING_DEFAULTS, getMtmSettings } from "@/lib/mtm-settings"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { mtmSettingValuesEqual, validateMtmSettingChanges } from "@/lib/mtm/settings-validation"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { ATTENDANCE_TWO_STEP_SETTING_KEY } from "@/lib/mtm/attendance-approval-chain"
import { ATTENDANCE_AUTO_CLOSE_BY_KEY, ATTENDANCE_AUTO_CLOSE_SETTING_KEY } from "@/lib/mtm/attendance-auto-close"
import { ATTENDANCE_INSTALLATION_RULE_KEY, saveAttendanceInstallationRule } from "@/lib/mtm/attendance-installation-policy"
import { ATTENDANCE_OUTSIDE_RULE_KEY, saveAttendanceOutsideRule } from "@/lib/mtm/attendance-outside-rule"
import { ATTENDANCE_QR_RULE_KEY, saveAttendanceQrRule } from "@/lib/mtm/attendance-qr-policy"
import { ATTENDANCE_REMINDER_KEYS, AttendanceReminderPolicySchema } from "@/lib/mtm/attendance-reminder-contract"
import { saveAttendanceReminderPolicy } from "@/lib/mtm/attendance-reminder-policy"
import { ATTENDANCE_RISK_SETTING_KEYS, saveAttendanceRiskPolicy } from "@/lib/mtm/attendance-risk-policy"

/**
 * Personnel's own settings, for whoever runs the section. They used to be saved
 * through /api/v1/mtm/settings, which belongs to Route & Field and refuses HR
 * who do not have it. `attendanceEnabled` is not here on purpose: switching the
 * section off stays with an administrator.
 */
export const ATTENDANCE_POLICY_KEYS = [
  ...ATTENDANCE_REMINDER_KEYS,
  ATTENDANCE_TWO_STEP_SETTING_KEY,
  ATTENDANCE_AUTO_CLOSE_SETTING_KEY,
  ATTENDANCE_OUTSIDE_RULE_KEY,
  ATTENDANCE_INSTALLATION_RULE_KEY,
  ATTENDANCE_QR_RULE_KEY,
  ...ATTENDANCE_RISK_SETTING_KEYS,
] as const

const POLICY_KEYS = new Set<string>(ATTENDANCE_POLICY_KEYS)
/** These write their own row and audit, under their own lock. */
const SELF_SAVING_KEYS = new Set<string>([
  ...ATTENDANCE_REMINDER_KEYS, ATTENDANCE_OUTSIDE_RULE_KEY, ATTENDANCE_INSTALLATION_RULE_KEY, ATTENDANCE_QR_RULE_KEY, ...ATTENDANCE_RISK_SETTING_KEYS,
])
const invalid = (code: string) => new AttendanceRequestError(code, 400)

export async function readAttendancePolicy(organizationId: string) {
  const settings = await getMtmSettings(organizationId) as unknown as Record<string, unknown>
  return Object.fromEntries(ATTENDANCE_POLICY_KEYS.map(key => [key, settings[key]]))
}

export async function saveAttendancePolicy(
  auth: { orgId: string; userId: string; role: string },
  raw: unknown,
  req: NextRequest,
) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalid("MTM_ATTENDANCE_POLICY_INVALID")
  const organizationId = auth.orgId
  const reviewer = { organizationId, userId: auth.userId, principalType: "session" as const }
  const body = Object.fromEntries(Object.entries(raw).filter(([key, value]) => POLICY_KEYS.has(key) && value !== undefined))
  if (Object.keys(body).length === 0) return { changed: [] as string[] }

  const previous = await getMtmSettings(organizationId) as unknown as Record<string, unknown>
  const differs = (key: string) => !mtmSettingValuesEqual(body[key], previous[key])
  const errors = validateMtmSettingChanges(Object.fromEntries(Object.entries(body).filter(([key]) => differs(key))), MTM_SETTING_DEFAULTS)
  if (errors.length > 0) throw invalid(errors[0].code)
  for (const key of [ATTENDANCE_OUTSIDE_RULE_KEY, ATTENDANCE_INSTALLATION_RULE_KEY, ATTENDANCE_QR_RULE_KEY, ATTENDANCE_TWO_STEP_SETTING_KEY, ATTENDANCE_AUTO_CLOSE_SETTING_KEY]) {
    if (body[key] !== undefined && typeof body[key] !== "boolean") throw invalid("MTM_ATTENDANCE_POLICY_INVALID")
  }
  const reminders = Object.fromEntries(ATTENDANCE_REMINDER_KEYS.filter(key => body[key] !== undefined).map(key => [key, body[key]]))
  if (Object.keys(reminders).length && !AttendanceReminderPolicySchema.safeParse(reminders).success) throw invalid("MTM_ATTENDANCE_REMINDER_POLICY_INVALID")

  if (Object.keys(reminders).length) await saveAttendanceReminderPolicy(reviewer, reminders)
  if (body[ATTENDANCE_OUTSIDE_RULE_KEY] !== undefined) await saveAttendanceOutsideRule(reviewer, body[ATTENDANCE_OUTSIDE_RULE_KEY] as boolean)
  if (body[ATTENDANCE_INSTALLATION_RULE_KEY] !== undefined) await saveAttendanceInstallationRule(reviewer, body[ATTENDANCE_INSTALLATION_RULE_KEY] as boolean)
  if (body[ATTENDANCE_QR_RULE_KEY] !== undefined) await saveAttendanceQrRule(reviewer, body[ATTENDANCE_QR_RULE_KEY] as boolean)
  const risk = Object.fromEntries(Object.entries(body).filter(([key]) => (ATTENDANCE_RISK_SETTING_KEYS as readonly string[]).includes(key)))
  if (Object.keys(risk).length) await saveAttendanceRiskPolicy(reviewer, risk)

  const store = (key: string, value: unknown) => {
    const json = value as Prisma.InputJsonValue
    return prisma.mtmSetting.upsert({
      where: { organizationId_key: { organizationId, key } },
      create: { organizationId, key, value: json },
      update: { value: json },
    })
  }
  const own = Object.keys(body).filter(key => !SELF_SAVING_KEYS.has(key))
  await Promise.all(own.map(key => store(key, body[key])))
  // Who switched auto-approval on is who its approvals are recorded for.
  if (body[ATTENDANCE_AUTO_CLOSE_SETTING_KEY] === true && differs(ATTENDANCE_AUTO_CLOSE_SETTING_KEY)) {
    await store(ATTENDANCE_AUTO_CLOSE_BY_KEY, auth.userId)
  }
  const audited = own.filter(differs)
  if (audited.length > 0) await writeMtmAudit({
    organizationId, agentId: null, action: "SETTINGS_UPDATE", entity: "settings", entityId: organizationId, metadataKind: "settings_update",
    oldData: Object.fromEntries(audited.map(key => [key, previous[key] ?? null])),
    newData: { ...Object.fromEntries(audited.map(key => [key, body[key]])), keys: audited, actor: { userId: auth.userId, role: auth.role } },
    req,
  }).catch(error => console.warn("[mtm/attendance] policy audit failed", error instanceof Error ? error.name : "unknown"))
  return { changed: Object.keys(body).filter(differs) }
}
