import type { AsteriskSettings } from "@/lib/voip"
import {
  missingVoipFields,
  normalizeVoipSettings,
  voipFromNumber,
} from "@/lib/voip/configs"
import {
  evaluateBusinessHours,
  isValidTimeZone,
} from "@/lib/inbox/business-hours"
import type { AuthResult } from "@/lib/api-auth"
import { isManagerOrAbove } from "@/lib/constants"
import type { Prisma } from "@prisma/client"
import {
  buildUnresolvedOutboundCallWhere,
  PROVIDER_UNKNOWN_NO_REDIAL,
} from "@/lib/voice-agent/unresolved-call"

/**
 * Daily ceilings on manual AI calls, per user and per organisation.
 *
 * These count every dispatch in the window, including ones the provider never
 * accepted, so a broken call path spends a person's whole day of attempts
 * before anyone has spoken to a customer. Five was too few to survive that, and
 * too few for a working day besides, so the ceilings are now tunable per
 * deployment without a release.
 */
function dailyLimit(name: string, fallback: number): number {
  const raw = Number.parseInt(process.env[name] ?? "", 10)
  return Number.isInteger(raw) && raw > 0 ? raw : fallback
}

export const MANUAL_LEAD_AI_USER_LIMIT_24H = dailyLimit("MANUAL_LEAD_AI_USER_LIMIT_24H", 25)
export const MANUAL_LEAD_AI_ORGANIZATION_LIMIT_24H = dailyLimit(
  "MANUAL_LEAD_AI_ORGANIZATION_LIMIT_24H",
  100,
)

export const MANUAL_LEAD_AI_BLOCKERS = [
  "manual_ai_calls_disabled",
  "voice_agent_disabled",
  "no_phone",
  "phone_changed",
  "voice_opt_out",
  "voice_calling_hours_unconfigured",
  "outside_calling_hours",
  "active_call_exists",
  "provider_unavailable",
  "user_limit_reached",
  "organization_limit_reached",
  "budget_limit_reached",
  "lead_inactive",
] as const

export type ManualLeadAiBlocker = (typeof MANUAL_LEAD_AI_BLOCKERS)[number]

export type ManualLeadAiCallPreflight = {
  eligible: boolean
  blockers: ManualLeadAiBlocker[]
  requiresConsentConfirmation: boolean
  limits: {
    userRemaining: number | null
    organizationRemaining: number | null
  }
  schedule?: {
    timezone: string
    localTime?: string
  }
  canResolveUnknownCall?: boolean
}

export type ManualLeadAiProviderSelection = {
  channelConfigId: string
  settings: AsteriskSettings
  fromNumber: string
}

export type ManualLeadAiPolicyEvaluation = {
  inaccessible: boolean
  preflight: ManualLeadAiCallPreflight
  lead: {
    id: string
    assignedTo: string | null
    status: string
  } | null
  targetPhoneE164: string | null
  targetDialNumber: string | null
  provider: ManualLeadAiProviderSelection | null
  consentBasis: "stored" | "per_call_attestation_required" | "blocked"
  policySnapshot: Record<string, string | number | boolean | null>
}

type ManualLeadCallDb = Pick<
  Prisma.TransactionClient,
  | "lead"
  | "channelConfig"
  | "businessHours"
  | "voiceCallSession"
  | "callLog"
  | "voiceConsent"
  | "voiceSuppression"
>

type VoipConfigRow = {
  id: string
  configName: string
  phoneNumber: string | null
  apiKey: string | null
  settings: Prisma.JsonValue | null
  isActive: boolean
}

const BLOCKER_ORDER = new Map<ManualLeadAiBlocker, number>(
  MANUAL_LEAD_AI_BLOCKERS.map((blocker, index) => [blocker, index]),
)

function orderedBlockers(values: Iterable<ManualLeadAiBlocker>): ManualLeadAiBlocker[] {
  return [...new Set(values)].sort(
    (left, right) => (BLOCKER_ORDER.get(left) ?? 999) - (BLOCKER_ORDER.get(right) ?? 999),
  )
}

/**
 * Lead.phone is the only permitted destination source. Accept canonical E.164,
 * Azerbaijani national form, and the common stored 994XXXXXXXXX form. Anything
 * ambiguous stays invalid rather than being guessed into another country.
 *
 * `dialNumber` is what reaches the trunk (the dialplan builds
 * `PJSIP/${EXTEN}@fanum-provider` verbatim, with no prefix manipulation), and it
 * is ALWAYS the digits-only international form. It used to preserve whichever
 * shape the lead was stored in, which made the destination depend on data entry:
 * a lead saved as 0XXXXXXXXX was dialed with its national leading zero, which
 * this carrier cannot route, and the call came back unavailable in about one
 * second. Measured on 2026-08-18: 84 of 98 calls dialed as 994XXXXXXXXX were
 * answered, while every attempt that carried a leading zero failed. The fault
 * hid for weeks because call_logs records the E.164 form, so the database looked
 * correct while the trunk was receiving something else.
 */
export function normalizeManualLeadPhone(value: string | null | undefined): {
  e164: string
  dialNumber: string
} | null {
  if (typeof value !== "string") return null

  const compact = value.trim().replace(/[\s().-]/g, "")
  const e164 = /^\+[1-9]\d{6,14}$/.test(compact)
    ? compact
    : /^994\d{9}$/.test(compact)
      ? `+${compact}`
      : /^0\d{9}$/.test(compact)
        ? `+994${compact.slice(1)}`
        : null
  if (!e164) return null

  return { e164, dialNumber: e164.slice(1) }
}

async function selectProvider(
  db: ManualLeadCallDb,
  organizationId: string,
): Promise<{
  provider: ManualLeadAiProviderSelection | null
  blocker: ManualLeadAiBlocker | null
}> {
  const rows = await db.channelConfig.findMany({
    where: { organizationId, channelType: "voip", isActive: true },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      configName: true,
      phoneNumber: true,
      apiKey: true,
      settings: true,
      isActive: true,
    },
  }) as VoipConfigRow[]

  const readyAsterisk = rows.flatMap((row) => {
    const normalized = normalizeVoipSettings(row, organizationId)
    if (normalized?.provider !== "asterisk" || missingVoipFields(normalized).length > 0) return []
    const raw = (row.settings || {}) as Record<string, unknown>
    return [{ row, normalized, raw }]
  })

  if (readyAsterisk.length === 0) {
    return { provider: null, blocker: "provider_unavailable" }
  }

  const voiceEnabled = readyAsterisk.filter(({ raw }) => {
    const mode = raw.voiceAgentMode
    return raw.voiceAgentEnabled === true && (mode === "outbound" || mode === "both")
  })
  if (voiceEnabled.length === 0) {
    return { provider: null, blocker: "voice_agent_disabled" }
  }

  const manualEnabled = voiceEnabled.filter(({ raw }) => raw.manualLeadAiCallsEnabled === true)
  if (manualEnabled.length === 0) {
    return { provider: null, blocker: "manual_ai_calls_disabled" }
  }

  // rows were sorted newest-first, so this choice is deterministic.
  const selected = manualEnabled[0]
  return {
    blocker: null,
    provider: {
      channelConfigId: selected.row.id,
      settings: selected.normalized,
      fromNumber: voipFromNumber(selected.normalized),
    },
  }
}

export async function evaluateManualLeadAiCallPolicy(params: {
  db: ManualLeadCallDb
  auth: Pick<AuthResult, "orgId" | "userId" | "role">
  leadId: string
  now?: Date
}): Promise<ManualLeadAiPolicyEvaluation> {
  const { db, auth, leadId } = params
  const now = params.now ?? new Date()
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1_000)

  const lead = await db.lead.findFirst({
    where: {
      id: leadId,
      organizationId: auth.orgId,
      ...(!isManagerOrAbove(auth.role) ? { assignedTo: auth.userId } : {}),
    },
    select: { id: true, assignedTo: true, status: true, phone: true },
  })

  if (!lead) {
    return {
      inaccessible: true,
      preflight: {
        eligible: false,
        blockers: [],
        requiresConsentConfirmation: false,
        limits: {
          userRemaining: 0,
          organizationRemaining: 0,
        },
      },
      lead: null,
      targetPhoneE164: null,
      targetDialNumber: null,
      provider: null,
      consentBasis: "blocked",
      policySnapshot: {},
    }
  }

  const normalizedPhone = normalizeManualLeadPhone(lead.phone)
  const targetPhoneE164 = normalizedPhone?.e164 ?? null

  const [
    providerResult,
    voiceHours,
    activeSession,
    unresolvedHumanCall,
    userAttemptCount,
    organizationAttemptCount,
    suppressions,
    consents,
  ] = await Promise.all([
    selectProvider(db, auth.orgId),
    db.businessHours.findFirst({
      where: { organizationId: auth.orgId, channelType: "voice" },
      select: {
        id: true,
        timezone: true,
        schedule: true,
        holidays: true,
        isActive: true,
      },
    }),
    db.voiceCallSession.findFirst({
      where: {
        organizationId: auth.orgId,
        OR: [
          { activeOrganizationKey: auth.orgId },
          { activeLeadKey: lead.id },
          ...(targetPhoneE164 ? [{ activePhoneKey: targetPhoneE164 }] : []),
        ],
        // A dispatch that never got an answer from the provider leaves this row
        // holding the lead with its active keys still set, and nothing clears
        // them: the lead becomes permanently uncallable until an operator edits
        // the database. That is what `leaseUntil` is for, and the eligibility
        // check was the one place not reading it.
        //
        // Only the dispatch phase is expired this way. Once a call is really up
        // its status has moved on, so a live conversation keeps blocking even
        // after its lease runs out.
        NOT: { status: "dispatching", leaseUntil: { lt: now } },
      },
      select: {
        id: true,
        leadId: true,
        status: true,
        leaseUntil: true,
        blockReason: true,
        callLogId: true,
        queueItem: { select: { id: true } },
      },
    }),
    targetPhoneE164
      ? db.callLog.findFirst({
          where: buildUnresolvedOutboundCallWhere({
            organizationId: auth.orgId,
            targetPhoneE164,
            callModes: ["human"],
          }),
          select: { id: true },
        })
      : Promise.resolve(null),
    db.voiceCallSession.count({
      where: {
        organizationId: auth.orgId,
        requestedByUserId: auth.userId,
        createdAt: { gte: since },
      },
    }),
    db.voiceCallSession.count({
      where: { organizationId: auth.orgId, createdAt: { gte: since } },
    }),
    targetPhoneE164
      ? db.voiceSuppression.findMany({
          where: {
            organizationId: auth.orgId,
            phoneE164: targetPhoneE164,
            scope: { in: ["sales", "all"] },
            isActive: true,
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
          select: { id: true },
          take: 1,
        })
      : Promise.resolve([]),
    targetPhoneE164
      ? db.voiceConsent.findMany({
          where: {
            organizationId: auth.orgId,
            phoneE164: targetPhoneE164,
            scope: { in: ["sales", "all"] },
          },
          select: { status: true, expiresAt: true },
        })
      : Promise.resolve([]),
  ])

  const blockers: ManualLeadAiBlocker[] = []
  if (["converted", "lost"].includes(lead.status.toLowerCase())) blockers.push("lead_inactive")
  if (!targetPhoneE164) blockers.push("no_phone")
  if (providerResult.blocker) blockers.push(providerResult.blocker)
  // Fail closed even after lease expiry. The lease makes an uncertain/stale
  // dispatch discoverable by an admin reconciliation job; it is never a timer
  // that silently releases the unique active-lead fence and enables a redial.
  if (activeSession || unresolvedHumanCall) blockers.push("active_call_exists")

  const validVoiceTimezone = Boolean(
    voiceHours?.isActive === true
    && voiceHours.timezone
    && isValidTimeZone(voiceHours.timezone),
  )
  const voiceHoursEvaluation = validVoiceTimezone
    ? evaluateBusinessHours(voiceHours, now)
    : null
  const insideVoiceHours = Boolean(
    voiceHours
    && validVoiceTimezone
    && voiceHoursEvaluation?.open === true
    && (voiceHoursEvaluation.reason === "inside_hours" || voiceHoursEvaluation.reason === "holiday_hours"),
  )
  if (!voiceHours || !validVoiceTimezone) {
    blockers.push("voice_calling_hours_unconfigured")
  } else if (!insideVoiceHours) {
    blockers.push("outside_calling_hours")
  }

  // A lead-card call is an explicit human action, not an automatic campaign.
  // Do not apply queue/campaign daily ceilings to this manual path.

  const suppressed = suppressions.length > 0
  const effectiveConsents = consents.filter(
    (consent) => !consent.expiresAt || consent.expiresAt > now,
  )
  const storedBlock = effectiveConsents.some((consent) => consent.status === "blocked")
  const storedAllow = effectiveConsents.some((consent) => consent.status === "allowed")
  if (suppressed || storedBlock) blockers.push("voice_opt_out")

  const consentBasis = suppressed || storedBlock
    ? "blocked"
    : storedAllow
      ? "stored"
      : "per_call_attestation_required"
  const requiresConsentConfirmation = consentBasis === "per_call_attestation_required"
  const finalBlockers = orderedBlockers(blockers)
  const canResolveUnknownCall = isManagerOrAbove(auth.role)
    && (
      (
        activeSession?.leadId === lead.id
        && activeSession.blockReason === PROVIDER_UNKNOWN_NO_REDIAL
        && !activeSession.queueItem
      )
      || Boolean(unresolvedHumanCall)
    )

  const schedule = voiceHours && validVoiceTimezone
    ? {
        timezone: voiceHours.timezone,
        ...(voiceHoursEvaluation?.localTime ? { localTime: voiceHoursEvaluation.localTime } : {}),
      }
    : undefined

  return {
    inaccessible: false,
    preflight: {
      eligible: finalBlockers.length === 0,
      blockers: finalBlockers,
      requiresConsentConfirmation,
      limits: { userRemaining: null, organizationRemaining: null },
      ...(schedule ? { schedule } : {}),
      ...(canResolveUnknownCall ? { canResolveUnknownCall: true } : {}),
    },
    lead: {
      id: lead.id,
      assignedTo: lead.assignedTo,
      status: lead.status,
    },
    targetPhoneE164,
    targetDialNumber: normalizedPhone?.dialNumber ?? null,
    provider: providerResult.provider,
    consentBasis,
    policySnapshot: {
      evaluatedAt: now.toISOString(),
      userLimit24h: MANUAL_LEAD_AI_USER_LIMIT_24H,
      organizationLimit24h: MANUAL_LEAD_AI_ORGANIZATION_LIMIT_24H,
      userAttempts24h: userAttemptCount,
      organizationAttempts24h: organizationAttemptCount,
      dailyLimitsEnforced: false,
      businessHoursConfigured: Boolean(voiceHours),
      businessHoursOpen: insideVoiceHours,
      businessHoursTimezone: schedule?.timezone ?? null,
      staleActivePolicy: "fail_closed_admin_reconciliation_required",
      consentBasis,
      leadAssignedToRequester: lead.assignedTo === auth.userId,
    },
  }
}
