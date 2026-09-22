import { randomBytes } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { hashOneTimeToken } from "@/lib/one-time-token"
import { runWithRlsBypass } from "@/lib/rls-context"
import { DEMO_CALL_CONSENT_TEXT, DEMO_CALL_CONSENT_VERSION } from "./journey/live-call"
import { callableGrant, normalizeDemoPhone, recordDemoCallPermission } from "./phone-verification"
import { demoTelegramBot, TELEGRAM_API_BASE } from "./phone-telegram-bot"
import { resolveDemoSalesOrganization } from "./sales-org"

/**
 * Proving the demo phone through Telegram instead of an SMS code (owner,
 * 2026-09-22: "смс у меня ограничен").
 *
 * The prospect opens a one-time t.me link to the sales organisation's bot and
 * taps "share my number". Telegram sends us the number its account is
 * registered with, and the bot accepts it only when:
 *   - the contact is the sender's own (contact.user_id === from.id), so a
 *     forwarded card of somebody else proves nothing;
 *   - it equals the phone on the prospect's own demo request, the only number
 *     the AI will ever ring (owner decision 2026-09-22);
 *   - the link is unexpired and unused, and the grant still allows the call.
 *
 * Nothing is ever sent to the number itself — the prospect writes to us — so
 * this path costs nothing and cannot reach a stranger. The person who owns the
 * number sees the consent wording in Telegram and agrees by tapping the
 * button; the browser asked for the same agreement before the link was made.
 *
 * The SMS code stays as the fallback for anyone without Telegram on that
 * number. Both proofs end in the same row, consent and call permission.
 */

export const DEMO_TELEGRAM_LINK_TTL_MS = 15 * 60_000
export const DEMO_TELEGRAM_MAX_LINKS_PER_GRANT = 5
/** Telegram start parameters allow only [A-Za-z0-9_-], up to 64 characters. */
const START_PREFIX = "d_"
const START_PATTERN = /^\/start(?:@[A-Za-z0-9_]+)?\s+d_([A-Za-z0-9_-]{20,60})$/

export const DEMO_TELEGRAM_TEXT = {
  consentPrompt: [
    "LeadDrive demo: AI köməkçimiz demo sorğunuzdakı nömrəyə bir dəfə zəng edəcək, söhbət ən çoxu 2 dəqiqə çəkir.",
    DEMO_CALL_CONSENT_TEXT,
    "Razısınızsa, aşağıdakı «Razıyam, nömrəmi paylaş» düyməsinə basın: Telegram nömrənizi bizə göndərəcək. Sizə heç nə göndərilmir və nömrəniz başqa məqsədlə istifadə olunmur.",
  ].join("\n\n"),
  shareButton: "📱 Razıyam, nömrəmi paylaş",
  verified: "✅ Nömrəniz təsdiqləndi. Demo səhifəsinə qayıdın — zəngi oradan başlada bilərsiniz.",
  notOwnContact: "Yalnız öz nömrənizi paylaşa bilərsiniz: aşağıdakı düyməyə basın, başqasının kontaktını göndərməyin.",
  otherNumber:
    "Bu Telegram hesabı başqa nömrəyə bağlıdır. Zəng yalnız demo sorğusundakı nömrəyə edilir. Həmin nömrə ilə qeydiyyatda olan Telegram-dan açın və ya demo səhifəsində SMS kodu istəyin.",
  linkDead: "Bu keçidin müddəti bitib və ya o artıq istifadə olunub. Demo səhifəsinə qayıdın və yeni keçid alın.",
  failed: "Hazırda təsdiqləmək alınmadı. Bir az sonra yenidən cəhd edin və ya demo səhifəsində SMS kodu istəyin.",
} as const

type Grant = { id: string; status: string; liveCallEnabled: boolean }

export type IssueDemoTelegramLinkResult =
  | { ok: true; state: "link"; url: string; expiresAt: Date }
  | { ok: true; state: "already_verified" }
  | { ok: false; code: "not_enabled" | "consent_required" | "invalid_phone" | "unavailable" | "too_many" }

/** A fresh one-time link for the phone on the prospect's own request. */
export async function issueDemoTelegramLink(params: {
  grant: Grant
  phone: string
  consent: boolean
  now?: Date
}): Promise<IssueDemoTelegramLinkResult> {
  const now = params.now ?? new Date()
  if (!callableGrant(params.grant)) return { ok: false, code: "not_enabled" }
  if (params.consent !== true) return { ok: false, code: "consent_required" }
  const phone = normalizeDemoPhone(params.phone)
  if (!phone) return { ok: false, code: "invalid_phone" }
  const bot = await demoTelegramBot(now.getTime()).catch(() => null)
  if (!bot) return { ok: false, code: "unavailable" }

  const grantId = params.grant.id
  const token = randomBytes(24).toString("base64url")
  const expiresAt = new Date(now.getTime() + DEMO_TELEGRAM_LINK_TTL_MS)
  const prepared = await runWithRlsBypass(async () => {
    const rows = await prisma.demoPhoneVerification.findMany({
      where: { grantId },
      select: { verifiedAt: true, telegramLinkIssueCount: true },
    })
    if (rows.some((row) => row.verifiedAt)) return "already_verified" as const
    const issued = rows.reduce((total, row) => total + row.telegramLinkIssueCount, 0)
    if (issued >= DEMO_TELEGRAM_MAX_LINKS_PER_GRANT) return "too_many" as const
    // A new link retires the previous one and whoever opened it.
    const link = { telegramLinkHash: hashOneTimeToken(token), telegramLinkExpiresAt: expiresAt, telegramUserId: null }
    await prisma.demoPhoneVerification.upsert({
      where: { grantId_phoneE164: { grantId, phoneE164: phone.e164 } },
      create: { grantId, phoneE164: phone.e164, ...link, telegramLinkIssueCount: 1 },
      update: { ...link, telegramLinkIssueCount: { increment: 1 } },
    })
    return "issued" as const
  })
  if (prepared === "already_verified") return { ok: true, state: "already_verified" }
  if (prepared === "too_many") return { ok: false, code: "too_many" }
  return { ok: true, state: "link", url: `https://t.me/${bot.username}?start=${START_PREFIX}${token}`, expiresAt }
}

/** What the demo page polls while the prospect is in Telegram. */
export async function demoPhoneProofState(grantId: string, now = new Date()): Promise<{ verified: boolean; linkOpen: boolean }> {
  const rows = await runWithRlsBypass(() =>
    prisma.demoPhoneVerification.findMany({
      where: { grantId },
      select: { verifiedAt: true, telegramLinkExpiresAt: true },
    }),
  )
  return {
    verified: rows.some((row) => row.verifiedAt),
    linkOpen: rows.some((row) => !row.verifiedAt && row.telegramLinkExpiresAt && row.telegramLinkExpiresAt > now),
  }
}

interface TelegramMessage {
  text?: unknown
  chat?: { id?: unknown; type?: unknown }
  from?: { id?: unknown }
  contact?: { phone_number?: unknown; user_id?: unknown }
}

/**
 * Called by the Telegram webhook for every message a bot receives, before the
 * inbox sees it. True means "this was the demo's; do not make a conversation
 * of it". Only the demo sales organisation's bot is ever considered, only a
 * demo start link or a contact from someone holding an open demo link is
 * taken, and everything else goes on to the inbox exactly as before.
 */
export async function consumeDemoTelegramUpdate(params: {
  organizationId: string
  botToken: string
  message: TelegramMessage
  now?: Date
}): Promise<boolean> {
  const { message } = params
  const now = params.now ?? new Date()
  const text = typeof message.text === "string" ? message.text.trim() : ""
  const start = START_PATTERN.exec(text)
  const contact = message.contact
  if (!start && !contact) return false

  try {
    if ((await resolveDemoSalesOrganization()) !== params.organizationId) return false
  } catch (error) {
    logFailure("sales organisation", error)
    // A demo link must not end up as an inbox message even when we cannot check.
    return Boolean(start)
  }
  const fromId = typeof message.from?.id === "number" ? message.from.id : null
  const chatId = typeof message.chat?.id === "number" || typeof message.chat?.id === "string" ? message.chat.id : null
  const privateChat = message.chat?.type === "private"
  if (start) {
    if (fromId !== null && chatId !== null && privateChat) {
      await openLink({ botToken: params.botToken, chatId, fromId, token: start[1], now }).catch(async (error) => {
        logFailure("start", error)
        await reply(params.botToken, chatId, DEMO_TELEGRAM_TEXT.failed, { remove_keyboard: true })
      })
    }
    return true
  }
  if (fromId === null || chatId === null || !privateChat) return false
  return shareContact({ botToken: params.botToken, chatId, fromId, contact: contact!, now })
}

async function openLink(params: { botToken: string; chatId: number | string; fromId: number; token: string; now: Date }) {
  const { botToken, chatId, fromId, now } = params
  const bound = await runWithRlsBypass(async () => {
    const row = await prisma.demoPhoneVerification.findUnique({
      where: { telegramLinkHash: hashOneTimeToken(params.token) },
      select: {
        id: true,
        verifiedAt: true,
        telegramLinkHash: true,
        telegramLinkExpiresAt: true,
        grant: { select: { status: true, liveCallEnabled: true, sessionExpiresAt: true } },
      },
    })
    if (!row || row.verifiedAt || !row.telegramLinkExpiresAt || row.telegramLinkExpiresAt <= now || !grantStillCallable(row.grant, now)) {
      return false
    }
    // Whoever opens the link last holds it; that proves nothing by itself —
    // only a contact whose number matches the request can finish the proof.
    const updated = await prisma.demoPhoneVerification.updateMany({
      where: { id: row.id, telegramLinkHash: row.telegramLinkHash, verifiedAt: null },
      data: { telegramUserId: String(fromId) },
    })
    return updated.count === 1
  })
  if (!bound) {
    await reply(botToken, chatId, DEMO_TELEGRAM_TEXT.linkDead, { remove_keyboard: true })
    return
  }
  await reply(botToken, chatId, DEMO_TELEGRAM_TEXT.consentPrompt, {
    keyboard: [[{ text: DEMO_TELEGRAM_TEXT.shareButton, request_contact: true }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  })
}

async function shareContact(params: {
  botToken: string
  chatId: number | string
  fromId: number
  contact: NonNullable<TelegramMessage["contact"]>
  now: Date
}): Promise<boolean> {
  const { botToken, chatId, fromId, contact, now } = params
  const pending = await runWithRlsBypass(() =>
    prisma.demoPhoneVerification.findMany({
      where: { telegramUserId: String(fromId), verifiedAt: null, telegramLinkExpiresAt: { gt: now } },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        grantId: true,
        phoneE164: true,
        telegramLinkHash: true,
        grant: { select: { status: true, liveCallEnabled: true, sessionExpiresAt: true } },
      },
    }),
  ).catch((error) => {
    logFailure("contact lookup", error)
    return null
  })
  // No open demo link for this Telegram user: an ordinary contact for the inbox.
  if (!pending?.length) return false

  try {
    if (contact.user_id !== fromId) {
      await reply(botToken, chatId, DEMO_TELEGRAM_TEXT.notOwnContact)
      return true
    }
    const shared = normalizeTelegramPhone(contact.phone_number)
    const row = shared ? pending.find((candidate) => candidate.phoneE164 === shared) : undefined
    if (!row) {
      await reply(botToken, chatId, DEMO_TELEGRAM_TEXT.otherNumber, { remove_keyboard: true })
      return true
    }
    if (!grantStillCallable(row.grant, now)) {
      await reply(botToken, chatId, DEMO_TELEGRAM_TEXT.linkDead, { remove_keyboard: true })
      return true
    }

    const claimed = await runWithRlsBypass(async () => {
      const updated = await prisma.demoPhoneVerification.updateMany({
        where: { id: row.id, telegramLinkHash: row.telegramLinkHash, verifiedAt: null },
        data: {
          telegramLinkHash: null,
          telegramLinkExpiresAt: null,
          verifiedAt: now,
          verifiedVia: "telegram",
          consentAt: now,
          consentVersion: DEMO_CALL_CONSENT_VERSION,
        },
      })
      if (updated.count !== 1) return false
      await prisma.demoAccessEvent.create({
        data: {
          grantId: row.grantId,
          eventType: "PHONE_VERIFIED",
          metadata: { consentVersion: DEMO_CALL_CONSENT_VERSION, phoneTail: row.phoneE164.slice(-2), method: "telegram" },
        },
      })
      return true
    })
    if (claimed) {
      await recordDemoCallPermission(row.phoneE164, now).catch((error) => logFailure("consent mirror", error))
    }
    await reply(botToken, chatId, claimed ? DEMO_TELEGRAM_TEXT.verified : DEMO_TELEGRAM_TEXT.linkDead, { remove_keyboard: true })
    return true
  } catch (error) {
    logFailure("contact", error)
    await reply(botToken, chatId, DEMO_TELEGRAM_TEXT.failed, { remove_keyboard: true })
    return true
  }
}

/** Telegram sends the number with or without "+", depending on the client. */
export function normalizeTelegramPhone(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const digits = raw.trim()
  if (!/^\+?\d{9,15}$/.test(digits)) return null
  return normalizeDemoPhone(digits.startsWith("+") ? digits : `+${digits}`)?.e164 ?? null
}

function grantStillCallable(
  grant: { status: string; liveCallEnabled: boolean; sessionExpiresAt: Date | null },
  now: Date,
): boolean {
  return grant.status === "ACTIVE" && grant.liveCallEnabled && (!grant.sessionExpiresAt || grant.sessionExpiresAt > now)
}

async function reply(botToken: string, chatId: number | string, text: string, replyMarkup?: Record<string, unknown>): Promise<void> {
  try {
    await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) }),
      signal: AbortSignal.timeout(5_000),
    })
  } catch (error) {
    logFailure("reply", error)
  }
}

function logFailure(step: string, error: unknown) {
  console.error(`[demo-telegram] ${step} failed`, { errorType: error instanceof Error ? error.name : "unknown" })
}
