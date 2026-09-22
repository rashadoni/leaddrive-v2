import { randomBytes } from "node:crypto"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"
import { hashOneTimeToken } from "@/lib/one-time-token"
import { runWithRlsBypass } from "@/lib/rls-context"
import { DEMO_CALL_CONSENT_TEXT } from "./journey/live-call"
import {
  callableGrant,
  DEMO_PHONE_MAX_SENDS_PER_GRANT,
  DEMO_PHONE_OTP_TTL_MS,
  DEMO_PHONE_RESEND_COOLDOWN_MS,
  normalizeDemoPhone,
} from "./phone-verification"
import { generateDemoOtp } from "./security"
import { demoTelegramBot, TELEGRAM_API_BASE } from "./phone-telegram-bot"
import { inDemoSalesOrganization } from "./sales-org"

/**
 * Proving the demo phone through Telegram — the only way (owner,
 * 2026-09-22: "смс у меня ограничен", then "заставим их, чтоб в телеграм
 * приходило … пусть немного повозятся": no SMS in the demo at all).
 *
 * Two proofs, both needed:
 *   1. The prospect opens a one-time t.me link to the sales organisation's
 *      bot and taps "share my number". Telegram sends us the number its
 *      account is registered with, and the bot accepts it only when the
 *      contact is the sender's own, shared fresh (contact.user_id equals the
 *      sender, not forwarded — a forwarded card, even of one's own account,
 *      is a snapshot of a number it may have left), equals the phone on the
 *      prospect's own demo request (the only number the AI ever rings), was
 *      shared after the link was made, the link is open and the grant still
 *      allows the call.
 *   2. The bot then writes a one-time code in that chat, and the prospect
 *      types it on the demo page. So the browser asking for the call belongs
 *      to whoever holds that Telegram account: a link forwarded to the owner
 *      of somebody else's number is useless without the code they received.
 *      The code is checked by the SMS code's own verifier
 *      (./phone-verification.ts): same limits, row, consent and permission.
 *
 * Every fact in (1) is read back from Telegram, never from the webhook body:
 * the bot replies to the contact message and Telegram returns the original
 * with the reply. The webhook is authenticated only by the bot token in its
 * URL, which access logs keep; a hand-made update naming a message Telegram
 * does not have gets no reply and proves nothing.
 *
 * Nothing is sent to the number itself, so this costs nothing. What it
 * proves is weaker than an SMS code, and the owner was told: Telegram checked
 * the number when the account was registered, not that the same person holds
 * the SIM today; an account that has since moved to a new number can also
 * re-send an old card of its own with the sender hidden (it arrives as a
 * fresh, unforwarded message), and the Bot API has no field that tells it
 * from a tap on the button. A prospect with no Telegram on the request's
 * number gets no call; the story goes on without it.
 */

export const DEMO_TELEGRAM_LINK_TTL_MS = 15 * 60_000
/** A tap on the bot's old button this long after the demo still gets a demo answer, not an inbox thread. */
const STALE_BUTTON_GRACE_MS = 24 * 60 * 60_000
/** Clock skew between Telegram's message date (whole seconds) and ours. */
const CLOCK_SLACK_MS = 5_000
export const DEMO_TELEGRAM_MAX_LINKS_PER_GRANT = 5
/** Telegram start parameters allow only [A-Za-z0-9_-], up to 64 characters. */
const START_PREFIX = "d_"
const START_PATTERN = /^\/start(?:@[A-Za-z0-9_]+)?\s+d_([A-Za-z0-9_-]{20,60})$/

export const DEMO_TELEGRAM_TEXT = {
  consentPrompt: [
    "LeadDrive demo: AI köməkçimiz demo sorğunuzdakı nömrəyə bir dəfə zəng edəcək, söhbət ən çoxu 2 dəqiqə çəkir.",
    DEMO_CALL_CONSENT_TEXT,
    "Razısınızsa, aşağıdakı «Razıyam, nömrəmi paylaş» düyməsinə basın: Telegram nömrənizi bizə göndərəcək, bot isə burada sizə 6 rəqəmli kod yazacaq — onu demo səhifəsində daxil edin. Nömrənizə SMS və ya reklam göndərilmir, nömrəniz yalnız bu bir demo zəngi üçün istifadə olunur.",
  ].join("\n\n"),
  shareButton: "📱 Razıyam, nömrəmi paylaş",
  checking: "⏳ Nömrə yoxlanılır…",
  code: (code: string) => `🔐 LeadDrive demo kodu: ${code}\n\nBu kodu demo səhifəsində yazın. 10 dəqiqə etibarlıdır. Kodu heç kimə verməyin.`,
  codeCooldown: "Kod az əvvəl göndərildi — yuxarıdakı mesaja baxın. Yeni kod bir dəqiqədən sonra.",
  codeLimit: "Kod limiti bitib. Demo səhifəsində zəngsiz davam edə bilərsiniz.",
  verified: "✅ Nömrəniz artıq təsdiqlənib. Demo səhifəsinə qayıdın — zəngi oradan başlada bilərsiniz.",
  notOwnContact: "Yalnız öz nömrənizi paylaşa bilərsiniz: aşağıdakı düyməyə basın. Başqasının və ya köhnə, yönləndirilmiş kontakt qəbul edilmir.",
  otherNumber:
    "Bu Telegram hesabı başqa nömrəyə bağlıdır. Zəng yalnız demo sorğusundakı nömrəyə edilir — keçidi həmin nömrə ilə qeydiyyatda olan Telegram-da açın.",
  linkDead: "Bu keçidin müddəti bitib və ya o artıq istifadə olunub. Demo səhifəsinə qayıdın və yeni keçid alın.",
  failed: "Hazırda təsdiqləmək alınmadı. Bir az sonra düyməni yenidən basın.",
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
    // A new link retires the previous one. The Telegram user who opened the
    // old one stays bound: the binding only routes their next contact here and
    // proves nothing, so their old share button keeps working with the new link.
    const link = { telegramLinkHash: hashOneTimeToken(token), telegramLinkExpiresAt: expiresAt }
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
export async function demoPhoneProofState(
  grantId: string,
  now = new Date(),
): Promise<{ verified: boolean; linkOpen: boolean; codeSent: boolean }> {
  const rows = await runWithRlsBypass(() =>
    prisma.demoPhoneVerification.findMany({
      where: { grantId },
      select: { verifiedAt: true, telegramLinkExpiresAt: true, otpHash: true, otpExpiresAt: true },
    }),
  )
  return {
    verified: rows.some((row) => row.verifiedAt),
    linkOpen: rows.some((row) => !row.verifiedAt && row.telegramLinkExpiresAt && row.telegramLinkExpiresAt > now),
    // The bot has written a code the page can now ask for.
    codeSent: rows.some((row) => !row.verifiedAt && row.otpHash && row.otpExpiresAt && row.otpExpiresAt > now),
  }
}

interface TelegramContact {
  phone_number?: unknown
  user_id?: unknown
}

interface TelegramMessage {
  message_id?: unknown
  date?: unknown
  text?: unknown
  chat?: { id?: unknown; type?: unknown }
  from?: { id?: unknown }
  contact?: TelegramContact
  forward_origin?: unknown
  forward_from?: unknown
  forward_from_chat?: unknown
  forward_sender_name?: unknown
  forward_date?: unknown
  is_automatic_forward?: unknown
  via_bot?: unknown
}

/**
 * Called by the Telegram webhook for every message a bot receives, before the
 * inbox sees it. True means "this was the demo's; do not make a conversation
 * of it". Only a bot the demo sales organisation owns is ever considered, only
 * a demo start link or a contact from someone who opened a demo link is
 * taken, and everything else goes on to the inbox exactly as before.
 */
export async function consumeDemoTelegramUpdate(params: {
  botToken: string
  message: TelegramMessage
  now?: Date
}): Promise<boolean> {
  const { message, botToken } = params
  const now = params.now ?? new Date()
  const text = typeof message.text === "string" ? message.text.trim() : ""
  const start = START_PATTERN.exec(text)
  if (!start && !message.contact) return false

  let owned: boolean
  try {
    owned = await salesOrganisationOwnsBot(botToken)
  } catch (error) {
    logFailure("bot ownership", error)
    // A demo link must not end up as an inbox message even when we cannot check.
    return Boolean(start)
  }
  if (!owned) return false

  const fromId = typeof message.from?.id === "number" ? message.from.id : null
  const chatId = typeof message.chat?.id === "number" ? message.chat.id : null
  const privateChat = message.chat?.type === "private" && chatId !== null && chatId === fromId
  if (start) {
    if (privateChat && fromId !== null) {
      await openLink({ botToken, chatId: fromId, token: start[1], now }).catch(async (error) => {
        logFailure("start", error)
        await telegram(botToken, "sendMessage", { chat_id: fromId, text: DEMO_TELEGRAM_TEXT.failed, reply_markup: { remove_keyboard: true } })
      })
    }
    return true
  }
  const messageId = typeof message.message_id === "number" ? message.message_id : null
  if (!privateChat || fromId === null || messageId === null) return false
  return shareContact({ botToken, chatId: fromId, messageId, claimedPhone: normalizeTelegramPhone(message.contact?.phone_number), now })
}

/** The token belongs to an active Telegram channel of the demo sales organisation. */
async function salesOrganisationOwnsBot(botToken: string): Promise<boolean> {
  const entered = await inDemoSalesOrganization(async (organizationId) =>
    await prisma.channelConfig.findFirst({
      where: { organizationId, channelType: "telegram", isActive: true, botToken },
      select: { id: true },
    }),
  )
  return Boolean(entered?.value)
}

async function openLink(params: { botToken: string; chatId: number; token: string; now: Date }) {
  const { botToken, chatId, now } = params
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
    // only their own fresh contact with the request's number finishes the proof.
    const updated = await prisma.demoPhoneVerification.updateMany({
      where: { id: row.id, telegramLinkHash: row.telegramLinkHash, verifiedAt: null },
      data: { telegramUserId: String(chatId) },
    })
    return updated.count === 1
  })
  if (!bound) {
    await telegram(botToken, "sendMessage", { chat_id: chatId, text: DEMO_TELEGRAM_TEXT.linkDead, reply_markup: { remove_keyboard: true } })
    return
  }
  await sendConsentPrompt(botToken, chatId)
}

function sendConsentPrompt(botToken: string, chatId: number) {
  return telegram(botToken, "sendMessage", {
    chat_id: chatId,
    text: DEMO_TELEGRAM_TEXT.consentPrompt,
    reply_markup: {
      keyboard: [[{ text: DEMO_TELEGRAM_TEXT.shareButton, request_contact: true }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  })
}

async function shareContact(params: { botToken: string; chatId: number; messageId: number; claimedPhone: string | null; now: Date }): Promise<boolean> {
  const { botToken, chatId, messageId, claimedPhone, now } = params
  // Routed by who opened a link, or — when somebody else opened the same link
  // later and took the binding — by the number the share claims. Routing
  // proves nothing: everything is decided on what Telegram reads back.
  const rows = await runWithRlsBypass(() =>
    prisma.demoPhoneVerification.findMany({
      where: {
        updatedAt: { gt: new Date(now.getTime() - STALE_BUTTON_GRACE_MS) },
        OR: [
          { telegramUserId: String(chatId) },
          ...(claimedPhone ? [{ phoneE164: claimedPhone, verifiedAt: null, telegramLinkExpiresAt: { gt: now } }] : []),
        ],
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        grantId: true,
        phoneE164: true,
        verifiedAt: true,
        telegramLinkHash: true,
        telegramLinkExpiresAt: true,
        grant: { select: { status: true, liveCallEnabled: true, sessionExpiresAt: true } },
      },
    }),
  ).catch((error) => {
    logFailure("contact lookup", error)
    return null
  })
  // Nobody who opened a demo link: an ordinary contact for the inbox.
  if (!rows?.length) return false

  const open = rows.filter((row) => !row.verifiedAt && row.telegramLinkHash && row.telegramLinkExpiresAt && row.telegramLinkExpiresAt > now)
  if (!open.length) {
    // The old button, tapped after the link lapsed or the phone was proven.
    const done = rows.some((row) => row.verifiedAt)
    await telegram(botToken, "sendMessage", { chat_id: chatId, text: done ? DEMO_TELEGRAM_TEXT.verified : DEMO_TELEGRAM_TEXT.linkDead, reply_markup: { remove_keyboard: true } })
    return true
  }

  try {
    // Read the message back from Telegram: the reply carries the original,
    // so what we check is what Telegram holds, not what the webhook said.
    const echo = await telegram(botToken, "sendMessage", {
      chat_id: chatId,
      text: DEMO_TELEGRAM_TEXT.checking,
      reply_parameters: { message_id: messageId },
      reply_markup: { remove_keyboard: true },
    })
    const sent = echo?.ok ? (echo.result as { message_id?: unknown; chat?: { id?: unknown }; reply_to_message?: TelegramMessage } | undefined) : undefined
    const original = sent?.reply_to_message
    const finish = (text: string) =>
      typeof sent?.message_id === "number"
        ? telegram(botToken, "editMessageText", { chat_id: chatId, message_id: sent.message_id, text })
        : telegram(botToken, "sendMessage", { chat_id: chatId, text })
    const description = typeof (echo as { description?: unknown } | null)?.description === "string" ? (echo as { description: string }).description : ""
    if (!sent && !/not found/i.test(description)) {
      // Telegram did not answer (timeout, 429): not a forgery. Say so and give
      // the button back, so a genuine prospect can simply tap it again.
      logFailure("contact read-back (Telegram unavailable)", new Error(description || "no answer"))
      await telegram(botToken, "sendMessage", { chat_id: chatId, text: DEMO_TELEGRAM_TEXT.failed })
      await sendConsentPrompt(botToken, chatId)
      return true
    }
    if (!sent || !original || sent.chat?.id !== chatId || original.message_id !== messageId || original.from?.id !== chatId || !original.contact) {
      // No such message in this chat: a hand-made update. Nothing to answer.
      logFailure("contact read-back (no such message)", new Error("mismatch"))
      return true
    }

    if (forwarded(original) || original.contact.user_id !== chatId) {
      await finish(DEMO_TELEGRAM_TEXT.notOwnContact)
      await sendConsentPrompt(botToken, chatId)
      return true
    }
    const shared = normalizeTelegramPhone(original.contact.phone_number)
    const row = shared ? open.find((candidate) => candidate.phoneE164 === shared) : undefined
    if (!row) {
      await finish(DEMO_TELEGRAM_TEXT.otherNumber)
      return true
    }
    const sharedAt = typeof original.date === "number" ? original.date * 1000 : 0
    const issuedAt = row.telegramLinkExpiresAt!.getTime() - DEMO_TELEGRAM_LINK_TTL_MS
    if (sharedAt < issuedAt - CLOCK_SLACK_MS || !grantStillCallable(row.grant, now)) {
      await finish(DEMO_TELEGRAM_TEXT.linkDead)
      return true
    }

    // The number is proven; the browser still has to show it is the same
    // person. The bot writes a code here and the page asks for it — the old
    // SMS code's limits: a few codes per grant, a minute apart.
    const code = generateDemoOtp()
    const otpHash = await bcrypt.hash(code, 10)
    const issued = await runWithRlsBypass(async () => {
      const current = await prisma.demoPhoneVerification.findMany({
        where: { grantId: row.grantId },
        select: { id: true, otpSendCount: true, otpSentAt: true },
      })
      if (current.reduce((total, candidate) => total + candidate.otpSendCount, 0) >= DEMO_PHONE_MAX_SENDS_PER_GRANT) return "limit" as const
      const mine = current.find((candidate) => candidate.id === row.id)
      if (mine?.otpSentAt && now.getTime() - mine.otpSentAt.getTime() < DEMO_PHONE_RESEND_COOLDOWN_MS) return "cooldown" as const
      // The unique index on telegramProofMessage makes a second use of the
      // same message fail here, whichever demo it is aimed at.
      const updated = await prisma.demoPhoneVerification
        .updateMany({
          where: { id: row.id, telegramLinkHash: row.telegramLinkHash, verifiedAt: null },
          data: {
            telegramProofMessage: `${chatId}:${messageId}`,
            otpHash,
            otpExpiresAt: new Date(now.getTime() + DEMO_PHONE_OTP_TTL_MS),
            otpSentAt: now,
            otpAttempts: 0,
            otpSendCount: { increment: 1 },
          },
        })
        .catch((error: unknown) => {
          if ((error as { code?: unknown } | null)?.code === "P2002") return { count: 0 }
          throw error
        })
      if (updated.count !== 1) return "gone" as const
      await prisma.demoAccessEvent.create({
        data: { grantId: row.grantId, eventType: "PHONE_CODE_SENT", metadata: { delivered: true, phoneTail: row.phoneE164.slice(-2), method: "telegram" } },
      })
      return "sent" as const
    })
    await finish(
      issued === "sent" ? DEMO_TELEGRAM_TEXT.code(code)
        : issued === "cooldown" ? DEMO_TELEGRAM_TEXT.codeCooldown
        : issued === "limit" ? DEMO_TELEGRAM_TEXT.codeLimit
        : DEMO_TELEGRAM_TEXT.linkDead,
    )
    return true
  } catch (error) {
    logFailure("contact", error)
    await telegram(botToken, "sendMessage", { chat_id: chatId, text: DEMO_TELEGRAM_TEXT.failed })
    await sendConsentPrompt(botToken, chatId)
    return true
  }
}

function forwarded(message: TelegramMessage): boolean {
  return [
    message.forward_origin,
    message.forward_from,
    message.forward_from_chat,
    message.forward_sender_name,
    message.forward_date,
    message.via_bot,
  ].some((field) => field !== undefined && field !== null) || message.is_automatic_forward === true
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

/** One Bot API call; never throws, null when Telegram could not be reached. */
async function telegram(botToken: string, method: string, body: Record<string, unknown>): Promise<{ ok?: boolean; result?: unknown } | null> {
  try {
    const response = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
    })
    return (await response.json()) as { ok?: boolean; result?: unknown }
  } catch (error) {
    logFailure(method, error)
    return null
  }
}

function logFailure(step: string, error: unknown) {
  console.error(`[demo-telegram] ${step} failed`, { errorType: error instanceof Error ? error.name : "unknown" })
}
