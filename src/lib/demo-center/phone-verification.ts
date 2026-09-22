import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { sendSms } from "@/lib/sms"
import { normalizeManualLeadPhone } from "@/lib/voice-agent/manual-lead-call"
import { inDemoSalesOrganization, resolveDemoSalesOrganization } from "./sales-org"
import { generateDemoOtp } from "./security"
import { demoTelegramBot } from "./phone-telegram-bot"

/**
 * A prospect proves a phone and agrees to exactly one AI call.
 *
 * Owner decisions, 2026-09-21: the call is real, only transcribed as text,
 * disclosed in the agent's first sentence, agreed to with an explicit
 * checkbox beforehand, and the transcript is kept for 90 days. This module is
 * the first half of that: the phone and the agreement. Placing the call is a
 * separate step and never happens here.
 *
 * Rules:
 *  - Only for a grant whose admin ticked "live call"; everything else answers
 *    `not_enabled` and sends nothing.
 *  - Only Azerbaijani numbers. The agent speaks Azerbaijani, the trunk is
 *    local, and a demo must not become a way to text or ring anyone abroad.
 *  - The same limits as the email code: a new code never renews guessing
 *    attempts, sends are capped per grant, and a failed SMS still counts.
 *  - Consent is recorded with its exact wording version, only together with a
 *    proven phone, and is scoped to this call: the stored permission in the
 *    sales organisation expires after a day unless something stronger is
 *    already there. An existing "blocked" is never lifted by a demo.
 *  - Tenant access goes only through ./sales-org, to the configured sales
 *    organisation, exactly as for the demo lead.
 */

// The wording and its version live in the pure journey module, so the
// browser shows exactly what the server records.
export { DEMO_CALL_CONSENT_TEXT, DEMO_CALL_CONSENT_VERSION } from "./journey/live-call"
import { DEMO_CALL_CONSENT_VERSION } from "./journey/live-call"

export const DEMO_PHONE_OTP_TTL_MS = 10 * 60_000
export const DEMO_PHONE_RESEND_COOLDOWN_MS = 60_000
export const DEMO_PHONE_MAX_SENDS_PER_GRANT = 3
export const DEMO_PHONE_MAX_ATTEMPTS = 5
/** Long enough for the call the prospect just asked for, and no longer. */
export const DEMO_CALL_CONSENT_TTL_MS = 24 * 60 * 60_000

export function normalizeDemoPhone(raw: string): { e164: string; dialNumber: string } | null {
  const normalized = normalizeManualLeadPhone(raw)
  return normalized && /^\+994\d{9}$/.test(normalized.e164) ? normalized : null
}

export function demoPhoneCodeMessage(code: string): string {
  return `LeadDrive demo kodu: ${code}. 10 dəqiqə etibarlıdır.`
}

type Grant = {
  id: string
  status: string
  liveCallEnabled: boolean
}

export type SendDemoPhoneCodeResult =
  | { ok: true; state: "code_sent" | "already_verified" }
  | { ok: false; code: "not_enabled" | "invalid_phone" | "too_many" | "cooldown" | "sms_failed" | "unconfigured"; retryAfterSeconds?: number }

export type VerifyDemoPhoneCodeResult =
  | { ok: true; state: "verified" }
  | { ok: false; code: "not_enabled" | "consent_required" | "no_code" | "expired" | "too_many_attempts" | "wrong_code" | "already_used"; attemptsRemaining?: number }

export function callableGrant(grant: Grant | null): grant is Grant {
  return Boolean(grant && grant.status === "ACTIVE" && grant.liveCallEnabled)
}

export async function sendDemoPhoneCode(params: {
  grant: Grant
  phone: string
  now?: Date
}): Promise<SendDemoPhoneCodeResult> {
  const now = params.now ?? new Date()
  if (!callableGrant(params.grant)) return { ok: false, code: "not_enabled" }
  const phone = normalizeDemoPhone(params.phone)
  if (!phone) return { ok: false, code: "invalid_phone" }
  if (!(await resolveDemoSalesOrganization())) return { ok: false, code: "unconfigured" }

  const grantId = params.grant.id
  const prepared = await runWithRlsBypass(async () => {
    const rows = await prisma.demoPhoneVerification.findMany({
      where: { grantId },
      select: { phoneE164: true, otpSendCount: true, otpSentAt: true, verifiedAt: true },
    })
    const existing = rows.find((row) => row.phoneE164 === phone.e164)
    if (existing?.verifiedAt) return { state: "already_verified" as const }
    const sent = rows.reduce((total, row) => total + row.otpSendCount, 0)
    if (sent >= DEMO_PHONE_MAX_SENDS_PER_GRANT) return { state: "too_many" as const }
    if (existing?.otpSentAt && now.getTime() - existing.otpSentAt.getTime() < DEMO_PHONE_RESEND_COOLDOWN_MS) {
      const retryAfterSeconds = Math.ceil(
        (DEMO_PHONE_RESEND_COOLDOWN_MS - (now.getTime() - existing.otpSentAt.getTime())) / 1000,
      )
      return { state: "cooldown" as const, retryAfterSeconds }
    }

    const code = generateDemoOtp()
    const otpHash = await bcrypt.hash(code, 10)
    // Counted before sending: a send the provider then refuses still spent
    // the prospect's allowance, as it does for the email code.
    await prisma.demoPhoneVerification.upsert({
      where: { grantId_phoneE164: { grantId, phoneE164: phone.e164 } },
      create: {
        grantId,
        phoneE164: phone.e164,
        otpHash,
        otpExpiresAt: new Date(now.getTime() + DEMO_PHONE_OTP_TTL_MS),
        otpSentAt: now,
        otpSendCount: 1,
      },
      update: {
        otpHash,
        otpExpiresAt: new Date(now.getTime() + DEMO_PHONE_OTP_TTL_MS),
        otpSentAt: now,
        otpSendCount: { increment: 1 },
      },
    })
    return { state: "send" as const, code }
  })

  if (prepared.state === "already_verified") return { ok: true, state: "already_verified" }
  if (prepared.state === "too_many") return { ok: false, code: "too_many" }
  if (prepared.state === "cooldown") return { ok: false, code: "cooldown", retryAfterSeconds: prepared.retryAfterSeconds }

  const delivery = await inDemoSalesOrganization((organizationId) =>
    sendSms({
      to: phone.e164,
      message: demoPhoneCodeMessage(prepared.code),
      organizationId,
      allowEnvFallback: true,
    }),
  )
    .then((entered) => entered?.value ?? { success: false as const })
    .catch(() => ({ success: false as const }))

  await runWithRlsBypass(() =>
    prisma.demoAccessEvent.create({
      data: {
        grantId,
        eventType: "PHONE_CODE_SENT",
        metadata: { delivered: Boolean(delivery.success), phoneTail: phone.e164.slice(-2) },
      },
    }),
  ).catch(() => {})

  return delivery.success ? { ok: true, state: "code_sent" } : { ok: false, code: "sms_failed" }
}

/**
 * The browser never sends the phone back: the code it types belongs to the
 * newest pending code of this grant, and the server knows which phone that is.
 */
export async function verifyDemoPhoneCode(params: {
  grant: Grant
  code: string
  consent: boolean
  now?: Date
}): Promise<VerifyDemoPhoneCodeResult> {
  const now = params.now ?? new Date()
  if (!callableGrant(params.grant)) return { ok: false, code: "not_enabled" }
  if (params.consent !== true) return { ok: false, code: "consent_required" }
  const grantId = params.grant.id
  const checked = await runWithRlsBypass(async () => {
    const verified = await prisma.demoPhoneVerification.findFirst({
      where: { grantId, verifiedAt: { not: null } },
      select: { id: true },
    })
    if (verified) return { state: "verified" as const }
    const row = await prisma.demoPhoneVerification.findFirst({
      where: { grantId, verifiedAt: null, otpHash: { not: null } },
      orderBy: { otpSentAt: "desc" },
    })
    if (!row?.otpHash || !row.otpExpiresAt) return { state: "no_code" as const }
    if (row.otpExpiresAt <= now) return { state: "expired" as const }
    if (row.otpAttempts >= DEMO_PHONE_MAX_ATTEMPTS) return { state: "too_many_attempts" as const }

    if (!/^\d{6}$/.test(params.code) || !(await bcrypt.compare(params.code, row.otpHash))) {
      await prisma.demoPhoneVerification.updateMany({
        where: { id: row.id, otpHash: row.otpHash, otpAttempts: { lt: DEMO_PHONE_MAX_ATTEMPTS } },
        data: { otpAttempts: { increment: 1 } },
      })
      return { state: "wrong_code" as const, attemptsRemaining: Math.max(0, DEMO_PHONE_MAX_ATTEMPTS - row.otpAttempts - 1) }
    }

    // One use per code: the claim only succeeds for the hash that was checked.
    const claimed = await prisma.demoPhoneVerification.updateMany({
      where: { id: row.id, otpHash: row.otpHash, verifiedAt: null },
      data: {
        otpHash: null,
        otpExpiresAt: null,
        verifiedAt: now,
        verifiedVia: "sms",
        // The phone is proven: an open Telegram link for it has nothing left to do.
        telegramLinkHash: null,
        telegramLinkExpiresAt: null,
        consentAt: now,
        consentVersion: DEMO_CALL_CONSENT_VERSION,
      },
    })
    if (!claimed.count) return { state: "already_used" as const }
    await prisma.demoAccessEvent.create({
      data: {
        grantId,
        eventType: "PHONE_VERIFIED",
        metadata: { consentVersion: DEMO_CALL_CONSENT_VERSION, phoneTail: row.phoneE164.slice(-2), method: "sms" },
      },
    })
    return { state: "newly_verified" as const, phoneE164: row.phoneE164 }
  })

  if (checked.state === "verified") return { ok: true, state: "verified" }
  if (checked.state === "wrong_code") return { ok: false, code: "wrong_code", attemptsRemaining: checked.attemptsRemaining }
  if (checked.state !== "newly_verified") return { ok: false, code: checked.state }

  await recordDemoCallPermission(checked.phoneE164, now).catch((error) => {
    // The journal already holds the consent; the call step re-checks the
    // permission and will not dial without it.
    console.error("[demo-phone] consent not mirrored to the sales organisation", {
      grantId,
      error: error instanceof Error ? error.name : "unknown",
    })
  })
  return { ok: true, state: "verified" }
}

/**
 * Mirror the prospect's agreement into the sales organisation's own consent
 * register, which is what the call policy reads. Never weakens what is there:
 * a block stays a block, and an open-ended permission is not shortened.
 */
export async function recordDemoCallPermission(phoneE164: string, now: Date): Promise<void> {
  const expiresAt = new Date(now.getTime() + DEMO_CALL_CONSENT_TTL_MS)
  const entered = await inDemoSalesOrganization(async (organizationId) => {
    const key = { organizationId_phoneE164_scope: { organizationId, phoneE164, scope: "sales" } }
    const current = await prisma.voiceConsent.findUnique({ where: key, select: { status: true, expiresAt: true } })
    if (current?.status === "blocked") return
    if (current?.status === "allowed" && (!current.expiresAt || current.expiresAt >= expiresAt)) return
    const data = {
      status: "allowed",
      source: "demo_center_self_consent",
      reason: DEMO_CALL_CONSENT_VERSION,
      confirmedAt: now,
      confirmedBy: null,
      expiresAt,
    }
    if (current) await prisma.voiceConsent.update({ where: key, data })
    else await prisma.voiceConsent.create({ data: { organizationId, phoneE164, scope: "sales", ...data } })
  })
  if (!entered) throw new Error("no active sales organisation")
}

export interface DemoLiveCallState {
  enabled: boolean
  /** The request carries an Azerbaijani mobile the prospect can have coded without retyping it. */
  requestPhoneUsable: boolean
  phoneVerified: boolean
  /** The sales organisation has a Telegram bot, so the phone can be proven there instead of by SMS. */
  telegramAvailable: boolean
}

export async function demoLiveCallState(grant: { id: string; liveCallEnabled: boolean }, requestPhone: string | null): Promise<DemoLiveCallState> {
  if (!grant.liveCallEnabled) return { enabled: false, requestPhoneUsable: false, phoneVerified: false, telegramAvailable: false }
  const verified = await runWithRlsBypass(() =>
    prisma.demoPhoneVerification.findFirst({
      where: { grantId: grant.id, verifiedAt: { not: null } },
      select: { id: true },
    }),
  )
  return {
    enabled: true,
    requestPhoneUsable: Boolean(requestPhone && normalizeDemoPhone(requestPhone)),
    phoneVerified: Boolean(verified),
    telegramAvailable: verified ? false : Boolean(await demoTelegramBot().catch(() => null)),
  }
}
