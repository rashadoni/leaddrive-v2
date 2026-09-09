/**
 * SMS utilities: generic sending + OTP generation/verification.
 *
 * Delivery is pluggable via the provider registry in src/lib/sms/providers/.
 * Provider resolution order (highest → lowest priority):
 *   1. ChannelConfig(sms).settings.smsProvider + settings — canonical per-org.
 *   2. ChannelConfig(sms) legacy shape (apiKey + phoneNumber + settings.accountSid)
 *      → synthesized as Twilio. Lets orgs created before the refactor keep
 *      working without a DB migration.
 *   3. ChannelConfig(voip).settings.smsProvider + settings — backward compat
 *      for orgs that set it under the VoIP row.
 *   4. SMS_PROVIDER env + provider env vars — shared-instance default and
 *      fallback for pre-auth flows (signup has no organizationId).
 *
 * OTP codes are single-use, time-limited (10 min), and stored hashed via bcrypt.
 */

import bcrypt from "bcryptjs"
import { randomInt } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { twilioProvider } from "@/lib/sms/providers/twilio"
import { vonageProvider } from "@/lib/sms/providers/vonage"
import { atlProvider } from "@/lib/sms/providers/atl"
import type { SmsProvider, SmsProviderSettings } from "@/lib/sms/providers/types"

const OTP_TTL_MS = 10 * 60 * 1000 // 10 minutes
const OTP_LENGTH = 6
const MAX_VERIFY_ATTEMPTS = 5

const PROVIDERS: Record<string, SmsProvider> = {
  twilio: twilioProvider,
  vonage: vonageProvider,
  atl: atlProvider,
}

/**
 * Map a provider name to the settings key it expects its secret under.
 * Secrets live in `ChannelConfig.apiKey` (masked by GET) — the UI never
 * stores raw secrets in `settings` JSON.
 */
const PROVIDER_SECRET_KEY: Record<string, string> = {
  twilio: "authToken",
  atl: "atlPassword",
  vonage: "apiSecret",
}

function mergeSecret(providerName: string, settings: SmsProviderSettings, secret: string | null | undefined): SmsProviderSettings {
  if (!secret) return settings
  const key = PROVIDER_SECRET_KEY[providerName]
  if (!key) return settings
  if (settings[key]) return settings
  return { ...settings, [key]: secret }
}

async function resolveProvider(organizationId?: string, allowEnvFallback = false): Promise<{ provider: SmsProvider | null; settings: SmsProviderSettings; allowEnv: boolean }> {
  // Whether the shared env-var credential fallback is permitted for THIS resolution.
  // Allowed for: system/pre-auth flows (no orgId), OTP (allowEnvFallback), and the
  // designated LeadDrive instance org (SMS_ENV_FALLBACK_ORG_ID). A normal tenant must
  // use ONLY its own config — `allowEnv=false` is passed to the provider so it cannot
  // satisfy itself from env creds (closes the Tier-1/3 "named-but-secretless" bypass).
  const envOrg = process.env.SMS_ENV_FALLBACK_ORG_ID
  // Safe rollout: with NO env-org designated the guard is inactive → env fallback is allowed
  // for everyone (prior behavior preserved). Once SMS_ENV_FALLBACK_ORG_ID is set, env is
  // allowed ONLY for: system/pre-auth (no orgId), OTP (allowEnvFallback), and the env-org.
  const allowEnv = !envOrg || !organizationId || allowEnvFallback || organizationId === envOrg
  if (organizationId) {
    const [smsRow, voipRow] = await Promise.all([
      prisma.channelConfig.findFirst({
        where: { organizationId, channelType: "sms", isActive: true },
      }),
      prisma.channelConfig.findFirst({
        where: { organizationId, channelType: "voip", isActive: true },
      }),
    ])

    // Tier 1: ChannelConfig(sms) with an explicit provider in settings.
    const smsSettings = (smsRow?.settings as SmsProviderSettings | null) || null
    if (smsRow && smsSettings && typeof smsSettings.smsProvider === "string") {
      const name = smsSettings.smsProvider
      const merged = mergeSecret(name, smsSettings, smsRow.apiKey)
      return { provider: PROVIDERS[name] || PROVIDERS.twilio, settings: merged, allowEnv }
    }

    // Tier 2: Legacy ChannelConfig(sms) Twilio shape — apiKey + phoneNumber + settings.accountSid.
    if (smsRow?.apiKey && smsRow?.phoneNumber) {
      const legacyAccountSid =
        smsSettings && typeof smsSettings.accountSid === "string" ? smsSettings.accountSid : undefined
      if (legacyAccountSid) {
        return {
          provider: PROVIDERS.twilio,
          settings: {
            smsProvider: "twilio",
            accountSid: legacyAccountSid,
            authToken: smsRow.apiKey,
            twilioNumber: smsRow.phoneNumber,
          } as SmsProviderSettings,
          allowEnv,
        }
      }
    }

    // Tier 3: ChannelConfig(voip).settings.smsProvider — backward compat.
    const voipSettings = (voipRow?.settings as SmsProviderSettings | null) || null
    if (voipRow && voipSettings && typeof voipSettings.smsProvider === "string") {
      const name = voipSettings.smsProvider
      const merged = mergeSecret(name, voipSettings, voipRow.apiKey)
      return { provider: PROVIDERS[name] || PROVIDERS.twilio, settings: merged, allowEnv }
    }

    // No per-org provider configured. The shared env account (Tier 4) is reserved for
    // the LeadDrive instance org (SMS_ENV_FALLBACK_ORG_ID) + OTP/system flows
    // (allowEnvFallback). A tenant's customer-facing SMS must use its OWN provider —
    // never the shared ATL account — so we fail CLOSED instead of silently sending
    // from the shared account.
    //
    // Safe rollout: the guard is ACTIVE only once an env-fallback org is designated
    // (SMS_ENV_FALLBACK_ORG_ID). Until that env var is set, the prior shared-fallback
    // behavior is preserved so deploying this code can't break SMS before the LeadDrive
    // org id is configured on the server.
    if (envOrg && !allowEnv) {
      return { provider: null, settings: {}, allowEnv }
    }
  }

  // Tier 4: env defaults (shared-instance default + OTP/pre-auth + the env-designated org).
  const envProviderName = process.env.SMS_PROVIDER || "twilio"
  return { provider: PROVIDERS[envProviderName] || PROVIDERS.twilio, settings: {}, allowEnv }
}

export interface SendSmsOptions {
  to: string
  message: string
  organizationId?: string
  /** OTP/system flows may fall back to the shared env account so login never breaks;
   *  customer-facing sends (campaigns, notifications) must NOT — leave false. */
  allowEnvFallback?: boolean
}

export interface SmsResult {
  success: boolean
  messageId?: string
  error?: string
}

/** Preflight check: is an SMS provider configured for this org (or env fallback)? */
export async function isSmsConfigured(organizationId?: string, allowEnvFallback = false): Promise<boolean> {
  const { provider, settings, allowEnv } = await resolveProvider(organizationId, allowEnvFallback)
  return provider != null && provider.isConfigured(settings, allowEnv)
}

/** Send an SMS via the resolved provider. */
export async function sendSms(opts: SendSmsOptions): Promise<SmsResult> {
  const { provider, settings, allowEnv } = await resolveProvider(opts.organizationId, opts.allowEnvFallback ?? false)
  if (!provider || !provider.isConfigured(settings, allowEnv)) {
    return {
      success: false,
      error: provider
        ? "SMS provider not configured"
        : "SMS is not configured for this organization — set up your SMS provider in Settings → Channels",
    }
  }
  return provider.send(settings, { to: opts.to, message: opts.message }, allowEnv)
}

function generateNumericCode(length = OTP_LENGTH): string {
  let code = ""
  // OTPs are authentication secrets. Math.random() is predictable and must
  // never be used for a login or step-up factor.
  for (let i = 0; i < length; i++) code += randomInt(0, 10).toString()
  return code
}

export interface SendOtpOptions {
  phone: string
  purpose: "login" | "2fa" | "verification" | "sensitive_action"
  organizationId?: string
  /** Bind the code to a specific user — required for 2fa/sensitive_action flows. */
  userId?: string
  /** Override the default SMS message. `{{code}}` will be replaced. */
  messageTemplate?: string
}

export interface SendOtpResult {
  success: boolean
  error?: string
  /** Only returned in dev/test mode; never in prod. */
  debugCode?: string
}

/**
 * Generate a one-time code, store its hash, and send via SMS.
 * Invalidates any prior unused codes for the same phone+purpose.
 */
export async function sendOtp(opts: SendOtpOptions): Promise<SendOtpResult> {
  const { phone, purpose, organizationId, userId, messageTemplate } = opts
  const code = generateNumericCode()
  const codeHash = await bcrypt.hash(code, 8)

  // Invalidate prior unused codes. Scope by userId when available so one user's
  // reissue doesn't wipe another user's pending code that happens to share a phone.
  await prisma.otpCode.updateMany({
    where: {
      phone,
      purpose,
      usedAt: null,
      expiresAt: { gt: new Date() },
      ...(userId ? { userId } : {}),
    },
    data: { usedAt: new Date() },
  })

  await prisma.otpCode.create({
    data: {
      phone,
      purpose,
      codeHash,
      organizationId: organizationId || null,
      userId: userId || null,
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    },
  })

  const message = (messageTemplate || "Your LeadDrive verification code is {{code}}. Valid for 10 minutes.")
    .replace("{{code}}", code)

  // OTP is a system/auth flow — allow the shared env account as a last resort so SMS
  // login never breaks for a tenant that hasn't configured its own provider yet.
  const smsResult = await sendSms({ to: phone, message, organizationId, allowEnvFallback: true })

  // debugCode is only exposed when BOTH:
  //   1. NODE_ENV !== "production"
  //   2. OTP_EXPOSE_DEBUG_CODE="1" is explicitly set in env
  // Belt-and-braces: if someone boots prod with NODE_ENV=development by mistake,
  // they'd still need to flip the explicit opt-in to leak codes.
  const debugCode = (process.env.NODE_ENV !== "production" && process.env.OTP_EXPOSE_DEBUG_CODE === "1")
    ? code
    : undefined

  if (!smsResult.success) {
    return { success: false, error: smsResult.error, debugCode }
  }
  return { success: true, debugCode }
}

export interface VerifyOtpResult {
  success: boolean
  error?: string
}

/**
 * Check a submitted code against the latest unused OTP for the phone+purpose.
 * When `userId` is provided, the lookup is also scoped to that user so a code
 * issued for user A cannot be verified as user B even if they share a phone.
 *
 * Single-attempt window with a per-code attempt counter to slow brute force.
 */
export async function verifyOtp(
  phone: string,
  code: string,
  purpose: string,
  userId?: string
): Promise<VerifyOtpResult> {
  if (!/^\d{6}$/.test(code)) return { success: false, error: "Invalid code format" }

  const record = await prisma.otpCode.findFirst({
    where: {
      phone,
      purpose,
      usedAt: null,
      expiresAt: { gt: new Date() },
      ...(userId ? { userId } : {}),
    },
    orderBy: { createdAt: "desc" },
  })

  if (!record) return { success: false, error: "Code expired or not found" }

  if (record.attempts >= MAX_VERIFY_ATTEMPTS) {
    // Lock out further attempts on this record. Keep the write conditional so
    // a concurrent verifier cannot revive or overwrite an already-consumed OTP.
    await prisma.otpCode.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    })
    return { success: false, error: "Too many attempts" }
  }

  const match = await bcrypt.compare(code, record.codeHash)

  if (!match) {
    await prisma.otpCode.updateMany({
      where: {
        id: record.id,
        usedAt: null,
        expiresAt: { gt: new Date() },
        attempts: { lt: MAX_VERIFY_ATTEMPTS },
      },
      data: { attempts: { increment: 1 } },
    })
    return { success: false, error: "Invalid code" }
  }

  // Consume with compare-and-set after the expensive hash comparison. Exactly
  // one concurrent request may change usedAt from null; all racing replays fail.
  const consumed = await prisma.otpCode.updateMany({
    where: {
      id: record.id,
      usedAt: null,
      expiresAt: { gt: new Date() },
      attempts: { lt: MAX_VERIFY_ATTEMPTS },
    },
    data: { usedAt: new Date() },
  })
  if (consumed.count !== 1) {
    return { success: false, error: "Code expired or already used" }
  }
  return { success: true }
}
