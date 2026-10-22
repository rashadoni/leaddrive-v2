import { ATTENDANCE_REMINDER_KEYS, AttendanceReminderPolicySchema } from "@/lib/mtm/attendance-reminder-contract"
import { saveAttendanceReminderPolicy } from "@/lib/mtm/attendance-reminder-policy"
import { ATTENDANCE_QR_RULE_KEY, saveAttendanceQrRule } from "@/lib/mtm/attendance-qr-policy"
import { ATTENDANCE_INSTALLATION_RULE_KEY, saveAttendanceInstallationRule } from "@/lib/mtm/attendance-installation-policy"
import { NextRequest, NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { attendanceIdentityConflictResponse } from "@/lib/mtm/attendance-identity-error"
import { SettingsUpdateSchema, parseBody } from "@/lib/mtm-validators"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { withRls, withRlsAuth } from "@/lib/with-rls"
import { MTM_SETTING_DEFAULTS, getMtmSettings } from "@/lib/mtm-settings"
import { isValidTimezone } from "@/lib/timezone"
import { coerceMtmContactRequiredFields } from "@/lib/mtm/contact-required-fields"
import { coerceMtmContactHiddenFields, isMtmContactSwitchableField } from "@/lib/mtm/contact-field-visibility"
import { parseMtmContactSpecialties } from "@/lib/mtm/contact-specialties"
import { parseMtmContactClasses } from "@/lib/mtm/contact-classes"
import { parseMtmRouteTargetTypes } from "@/lib/mtm/route-target-types"
import { parseMtmVisitEvaluationQuestions } from "@/lib/mtm/visit-evaluation-questions"
import { mtmSettingValuesEqual, validateMtmSettingChanges } from "@/lib/mtm/settings-validation"
import { AGENT_PERMISSION_ADMIN_ONLY_KEYS } from "@/lib/mtm/agent-permissions"
import { locationShareLinkAliveWhere } from "@/lib/mtm/location-share-link"
import { ATTENDANCE_OUTSIDE_RULE_KEY, saveAttendanceOutsideRule } from "@/lib/mtm/attendance-outside-rule"
import { ATTENDANCE_RISK_SETTING_KEYS, saveAttendanceRiskPolicy } from "@/lib/mtm/attendance-risk-policy"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { ATTENDANCE_AUTO_CLOSE_BY_KEY, ATTENDANCE_AUTO_CLOSE_SETTING_KEY } from "@/lib/mtm/attendance-auto-close"

const MODULE_TOGGLE_ROLES = ["admin", "superadmin"]
// Whole-feature visibility switches. Only an administrator changes them.
const MODULE_TOGGLE_KEYS = ["fieldContactsEnabled", "pharmacyPromotionsEnabled", "attendanceEnabled"] as const
// Technical GPS-history thresholds, shown in the collapsed «Qabaqcıl (yalnız
// administrator)» section. Same rule as the module switches.
const ADVANCED_KEYS = [
  "gpsInterval",
  "locationWindowMinutes",
  "historyMaxAccuracyMeters",
  "historyStopRadiusMeters",
  "historyStopMinimumMinutes",
] as const

export const GET = withRls(async (_req: NextRequest, { orgId }) => {
  try {
    // Single source of truth: getMtmSettings merges org rows over the schema
    // defaults AND coerces types — the old inline DEFAULT_SETTINGS copy had
    // already drifted from the schema.
    const result = await getMtmSettings(orgId)
    return NextResponse.json({ success: true, data: result })
  } catch (e) {
    console.error("[MTM/settings GET]", e)
    return NextResponse.json({ error: "Failed to load settings" }, { status: 500 })
  }
})

export const PUT = withRlsAuth(undefined, undefined, async (req, auth) => {
  const ALLOWED_ROLES = ["admin", "manager", "superadmin"]
  if (!ALLOWED_ROLES.includes(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const orgId = auth.orgId
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const raw = await req.json()
    const parsed = parseBody(SettingsUpdateSchema, raw)
    if (!parsed.ok) return parsed.response
    // Whitelist to schema keys — the old endpoint persisted ANY key, which let
    // the UI save settings nothing ever read (decorative toggles). Unknown keys
    // are silently dropped so stale clients don't hard-fail.
    const body = Object.fromEntries(
      Object.entries(parsed.data).filter(([key, value]) => key in MTM_SETTING_DEFAULTS && value !== undefined)
    )
    // Unlike legacy menu switches, attendance enables new personal-data access.
    // Refuse the entire unauthorized request before any setting can be written.
    if ((body.attendanceEnabled !== undefined || ATTENDANCE_REMINDER_KEYS.some(key => body[key] !== undefined) || body[ATTENDANCE_QR_RULE_KEY] !== undefined || body[ATTENDANCE_INSTALLATION_RULE_KEY] !== undefined || body[ATTENDANCE_OUTSIDE_RULE_KEY] !== undefined || ATTENDANCE_RISK_SETTING_KEYS.some(key => body[key] !== undefined) || body[ATTENDANCE_AUTO_CLOSE_SETTING_KEY] !== undefined) && !MODULE_TOGGLE_ROLES.includes(auth.role)) {
      return NextResponse.json({ error: "Forbidden", code: "MTM_ATTENDANCE_ADMIN_REQUIRED" }, { status: 403 })
    }
    // Hiding a whole module surface for every manager and field agent is an
    // administrator decision, narrower than the general settings guard. The
    // settings page now sends only changed keys and disables these controls
    // for everyone else, but an older open page still sends the whole object:
    // drop the key instead of refusing the save, and name it in
    // `data.ignoredKeys` so the current page can say so (old pages ignore it).
    const ignoredKeys: string[] = []
    // Same rule for what a field agent may ask for ("Access & permissions").
    for (const key of [...ADVANCED_KEYS, ...MODULE_TOGGLE_KEYS, ...AGENT_PERMISSION_ADMIN_ONLY_KEYS]) {
      if (body[key] !== undefined && !MODULE_TOGGLE_ROLES.includes(auth.role)) {
        delete body[key]
        ignoredKeys.push(key)
      }
    }
    for (const key of MODULE_TOGGLE_KEYS) {
      if (body[key] !== undefined && typeof body[key] !== "boolean") {
        return NextResponse.json({
          error: `${key} must be a boolean`,
        }, { status: 400 })
      }
    }
    // Effective values before this save (stored row or default): used to skip
    // unchanged keys in validation and audit.
    const previous = await getMtmSettings(orgId) as unknown as Record<string, unknown>
    const differs = (key: string) => !mtmSettingValuesEqual(body[key], previous[key])
    // Auto-approval is a person's standing decision: the approvals it makes are
    // recorded in that person's name (attendance-auto-close.ts). A key has no person.
    if (body[ATTENDANCE_AUTO_CLOSE_SETTING_KEY] === true && differs(ATTENDANCE_AUTO_CLOSE_SETTING_KEY) && auth.principalType !== "session") {
      return NextResponse.json({ error: "Forbidden", code: "MTM_ATTENDANCE_ADMIN_REQUIRED" }, { status: 403 })
    }

    // Ranges and types are checked for incoming keys that CHANGE the stored
    // value. Nothing is clamped. A page opened before this deploy still sends
    // the whole object, so a value stored before these bounds existed comes
    // back unchanged and must not block saving some other key.
    const fieldErrors = validateMtmSettingChanges(
      Object.fromEntries(Object.entries(body).filter(([key]) => differs(key))),
      MTM_SETTING_DEFAULTS,
    )
    if (fieldErrors.length > 0) {
      return NextResponse.json({
        error: "Invalid setting value",
        code: fieldErrors[0].code,
        key: fieldErrors[0].key,
        errors: fieldErrors,
      }, { status: 400 })
    }
    if (typeof body.supportEmail === "string") body.supportEmail = body.supportEmail.trim()
    if (typeof body.supportPhone === "string") body.supportPhone = body.supportPhone.trim()
    if (body.contactRequiredFields !== undefined) {
      if (!Array.isArray(body.contactRequiredFields)) {
        return NextResponse.json({ error: "Contact required fields must be an array" }, { status: 400 })
      }
      body.contactRequiredFields = coerceMtmContactRequiredFields(body.contactRequiredFields)
    }
    if (body.contactHiddenFields !== undefined) {
      if (!Array.isArray(body.contactHiddenFields) || !body.contactHiddenFields.every(isMtmContactSwitchableField)) {
        return NextResponse.json({ error: "Hidden contact fields must be a list of switchable fields" }, { status: 400 })
      }
      body.contactHiddenFields = coerceMtmContactHiddenFields(body.contactHiddenFields)
    }
    if (body.contactSpecialties !== undefined) {
      const specialties = parseMtmContactSpecialties(body.contactSpecialties)
      if (!specialties.success) {
        return NextResponse.json({ error: specialties.error }, { status: 400 })
      }
      body.contactSpecialties = specialties.data
    }
    if (body.contactClasses !== undefined) {
      const classes = parseMtmContactClasses(body.contactClasses)
      if (!classes.success) {
        return NextResponse.json({ error: classes.error }, { status: 400 })
      }
      body.contactClasses = classes.data
    }
    if (body.routeTargetTypes !== undefined) {
      const targetTypes = parseMtmRouteTargetTypes(body.routeTargetTypes)
      if (!targetTypes.success) {
        return NextResponse.json({ error: targetTypes.error }, { status: 400 })
      }
      body.routeTargetTypes = targetTypes.data
    }
    if (body.visitEvaluationQuestions !== undefined) {
      const questions = parseMtmVisitEvaluationQuestions(body.visitEvaluationQuestions)
      if (!questions.success) {
        return NextResponse.json({ error: questions.error, code: "MTM_VISIT_EVALUATION_QUESTIONS_INVALID", key: "visitEvaluationQuestions" }, { status: 400 })
      }
      body.visitEvaluationQuestions = questions.data
    }
    if (body.timezone !== undefined && !isValidTimezone(body.timezone)) {
      return NextResponse.json({ error: "Invalid IANA timezone" }, { status: 400 })
    }
    if (
      body.supportEmail !== undefined
      && (
        typeof body.supportEmail !== "string"
        || body.supportEmail.length > 200
        || (body.supportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.supportEmail))
      )
    ) {
      return NextResponse.json({ error: "Invalid support email" }, { status: 400 })
    }
    if (
      body.supportPhone !== undefined
      && (typeof body.supportPhone !== "string" || body.supportPhone.length > 100)
    ) {
      return NextResponse.json({ error: "Invalid support phone" }, { status: 400 })
    }
    if (
      body.teamScheduleVisibilityEnabled !== undefined
      && typeof body.teamScheduleVisibilityEnabled !== "boolean"
    ) {
      return NextResponse.json({ error: "Team schedule visibility must be a boolean" }, { status: 400 })
    }
    if (body.routeTravelEnabled !== undefined && typeof body.routeTravelEnabled !== "boolean") {
      return NextResponse.json({ error: "Route travel must be a boolean" }, { status: 400 })
    }
    if (body.routeTravelNavigationEnabled !== undefined && typeof body.routeTravelNavigationEnabled !== "boolean") {
      return NextResponse.json({ error: "Route travel navigation must be a boolean" }, { status: 400 })
    }

    if (body[ATTENDANCE_INSTALLATION_RULE_KEY] !== undefined && typeof body[ATTENDANCE_INSTALLATION_RULE_KEY] !== "boolean") {
      return NextResponse.json({ error: "Invalid installation approval rule", code: "MTM_ATTENDANCE_INSTALLATION_RULE_INVALID" }, { status: 400 })
    }

    if (body[ATTENDANCE_QR_RULE_KEY] !== undefined && typeof body[ATTENDANCE_QR_RULE_KEY] !== "boolean") {
      return NextResponse.json({ error: "Invalid QR rule", code: "MTM_ATTENDANCE_QR_RULE_INVALID" }, { status: 400 })
    }

    const reminderPolicy = Object.fromEntries(ATTENDANCE_REMINDER_KEYS.filter(key => body[key] !== undefined).map(key => [key, body[key]]))
    if (Object.keys(reminderPolicy).length && !AttendanceReminderPolicySchema.safeParse(reminderPolicy).success) {
      return NextResponse.json({ error: "Invalid reminder policy", code: "MTM_ATTENDANCE_REMINDER_POLICY_INVALID" }, { status: 400 })
    }

    // Nothing left to write (e.g. only administrator keys from a manager).
    if (Object.keys(body).length === 0) return NextResponse.json({ success: true, data: { ignoredKeys } })

    if (Object.keys(reminderPolicy).length) {
      await saveAttendanceReminderPolicy({ organizationId: orgId, userId: auth.userId, principalType: auth.principalType ?? "api_key" }, reminderPolicy)
    }

    // This policy is serialized with endpoint writes, including its first
    // insertion. An audit failure must not leave an unaudited rejection rule.
    if (body[ATTENDANCE_OUTSIDE_RULE_KEY] !== undefined) {
      await saveAttendanceOutsideRule({ organizationId: orgId, userId: auth.userId, principalType: auth.principalType ?? "api_key" }, body[ATTENDANCE_OUTSIDE_RULE_KEY] as boolean)
    }

    if (body[ATTENDANCE_INSTALLATION_RULE_KEY] !== undefined) {
      await saveAttendanceInstallationRule({ organizationId: orgId, userId: auth.userId, principalType: auth.principalType ?? "api_key" }, body[ATTENDANCE_INSTALLATION_RULE_KEY] as boolean)
    }

    if (body[ATTENDANCE_QR_RULE_KEY] !== undefined) {
      await saveAttendanceQrRule({ organizationId: orgId, userId: auth.userId, principalType: auth.principalType ?? "api_key" }, body[ATTENDANCE_QR_RULE_KEY] as boolean)
    }

    const riskChanges = Object.fromEntries(Object.entries(body).filter(([key]) => (ATTENDANCE_RISK_SETTING_KEYS as readonly string[]).includes(key)))
    if (Object.keys(riskChanges).length) await saveAttendanceRiskPolicy({ organizationId: orgId, userId: auth.userId, principalType: auth.principalType ?? "api_key" }, riskChanges)

    const storeSetting = (key: string, value: unknown) => {
      const jsonValue = value as Prisma.InputJsonValue
      return prisma.mtmSetting.upsert({
        where: { organizationId_key: { organizationId: orgId, key } },
        create: { organizationId: orgId, key, value: jsonValue },
        update: { value: jsonValue },
      })
    }

    // «Ссылка на местоположение»: switching the links off ends every link
    // already handed out, for good. Whoever switches off to stop a leak
    // expects it to stay stopped: without this, the links whose time is not
    // up would open again the moment somebody switched back on. So the save
    // that turns the switch from on to off also revokes every working link
    // of this organization — in one transaction with the switch itself:
    // there is no «off, but the links were not ended», and a save that
    // failed changed nothing and can simply be pressed again. After it, new
    // links are made; nothing comes back. (The public answer still asks the
    // switch on every view — it does not lean on these rows.)
    //
    // The switch first, the links second, and in that order: a link that is
    // being made at this very moment holds the switch's row until it is
    // committed (POST /api/v1/mtm/locations/share-links reads it FOR SHARE
    // behind the employee's lock). This save therefore waits for that link
    // at its first statement, and its second ends it with the rest; a
    // creation that comes after reads «off». The other way round, the links
    // would be ended before that one existed.
    const endsLocationShareLinks = previous.locationShareLinksEnabled === true && body.locationShareLinksEnabled === false
    let locationShareLinksEnded = 0
    if (endsLocationShareLinks) {
      const endedAt = new Date()
      const [, ended] = await prisma.$transaction([
        storeSetting("locationShareLinksEnabled", false),
        prisma.mtmLocationShareLink.updateMany({
          where: { organizationId: orgId, ...locationShareLinkAliveWhere(endedAt) },
          data: { revokedAt: endedAt, revokedBy: auth.userId },
        }),
      ])
      locationShareLinksEnded = ended.count
    }
    await Promise.all(
      Object.entries(body)
        .filter(([key]) => key !== ATTENDANCE_OUTSIDE_RULE_KEY && key !== ATTENDANCE_INSTALLATION_RULE_KEY && !ATTENDANCE_REMINDER_KEYS.includes(key as typeof ATTENDANCE_REMINDER_KEYS[number]) && key !== ATTENDANCE_QR_RULE_KEY && !(ATTENDANCE_RISK_SETTING_KEYS as readonly string[]).includes(key) && !(endsLocationShareLinks && key === "locationShareLinksEnabled"))
        .map(([key, value]) => storeSetting(key, value)),
    )

    // Who switched auto-approval on is who its approvals are recorded for.
    if (body[ATTENDANCE_AUTO_CLOSE_SETTING_KEY] === true && differs(ATTENDANCE_AUTO_CLOSE_SETTING_KEY)) {
      await storeSetting(ATTENDANCE_AUTO_CLOSE_BY_KEY, auth.userId)
    }

    // Audit only real changes: an old page's whole-object save would otherwise
    // log dozens of untouched keys. Values are compared after normalization.
    const changedKeys = Object.keys(body).filter(key => key !== ATTENDANCE_OUTSIDE_RULE_KEY && key !== ATTENDANCE_INSTALLATION_RULE_KEY && !ATTENDANCE_REMINDER_KEYS.includes(key as typeof ATTENDANCE_REMINDER_KEYS[number]) && key !== ATTENDANCE_QR_RULE_KEY && !(ATTENDANCE_RISK_SETTING_KEYS as readonly string[]).includes(key) && differs(key))
    if (changedKeys.length > 0) await writeMtmAudit({
      organizationId: orgId,
      agentId: null,
      action: "SETTINGS_UPDATE",
      entity: "settings",
      entityId: orgId,
      metadataKind: "settings_update",
      oldData: Object.fromEntries(changedKeys.map((key) => [key, previous[key] ?? null])),
      newData: {
        ...Object.fromEntries(changedKeys.map((key) => [key, body[key]])),
        keys: changedKeys,
        actor: { userId: auth.userId, role: auth.role },
        // How many links this save ended — the row that says who switched
        // them off is this one; no row is written per link.
        ...(endsLocationShareLinks ? { locationShareLinksEnded } : {}),
      },
      req,
    }).catch((e) => console.warn("[MTM/settings PUT] audit failed", e))

    return NextResponse.json({ success: true, data: { ignoredKeys } })
  } catch (error: unknown) {
    const conflict = attendanceIdentityConflictResponse(error)
    if (conflict) return conflict
    if (error instanceof AttendanceRequestError) return NextResponse.json({ error: error.code, code: error.code }, { status: error.status })
    const message = error instanceof Error ? error.message : "Failed to update settings"
    return NextResponse.json({ error: message }, { status: 400 })
  }
})
