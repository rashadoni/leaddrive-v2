/**
 * Proving the demo phone through Telegram instead of an SMS code
 * (src/lib/demo-center/phone-telegram.ts). Owner, 2026-09-22: the SMS quota
 * is limited. What must hold:
 *   - nothing is ever sent to the number itself; the prospect writes to us;
 *   - only the prospect's OWN Telegram contact counts, and only when it is the
 *     phone on their own demo request;
 *   - the link is one-time, short-lived, stored only as a hash, and dies with
 *     the grant;
 *   - the sales organisation's bot keeps serving its inbox: anything that is
 *     not the demo's goes on exactly as before.
 */
import { createHash } from "node:crypto"
import bcrypt from "bcryptjs"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mockRunWithTenant = vi.hoisted(() => vi.fn())

vi.mock("@/lib/prisma", () => ({
  prisma: {
    demoGrant: { findUnique: vi.fn(), updateMany: vi.fn() },
    demoPhoneVerification: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() },
    demoAccessEvent: { create: vi.fn() },
    organization: { findFirst: vi.fn() },
    channelConfig: { findFirst: vi.fn() },
    voiceConsent: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
  },
}))
vi.mock("@/lib/rls-context", () => ({
  runWithRlsBypass: (fn: () => unknown) => Promise.resolve().then(fn),
  runWithTenant: mockRunWithTenant,
}))
vi.mock("@/lib/sms", () => ({ sendSms: vi.fn() }))

import { prisma } from "@/lib/prisma"
import {
  consumeDemoTelegramUpdate,
  DEMO_TELEGRAM_LINK_TTL_MS,
  DEMO_TELEGRAM_MAX_LINKS_PER_GRANT,
  DEMO_TELEGRAM_TEXT,
  issueDemoTelegramLink,
  normalizeTelegramPhone,
} from "@/lib/demo-center/phone-telegram"
import { resetDemoTelegramBotCache } from "@/lib/demo-center/phone-telegram-bot"
import { DEMO_CALL_CONSENT_TEXT } from "@/lib/demo-center/phone-verification"
import { demoSessionCookieName, issueBrowserCredential } from "@/lib/demo-center/security"

const SALES_ORG = "org-leaddrive-inc"
const BOT_TOKEN = "123456:bot-token-of-the-sales-org"
const NOW = new Date("2026-09-22T12:00:00.000Z")
const PHONE = "+994501234567"
const TG_USER = 777001
const grant = { id: "grant-1", status: "ACTIVE", liveCallEnabled: true }
const openGrant = { status: "ACTIVE", liveCallEnabled: true, sessionExpiresAt: new Date("2026-09-22T13:00:00.000Z") }

const telegramCalls: Array<{ method: string; body: Record<string, unknown> }> = []
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex")

beforeEach(() => {
  vi.clearAllMocks()
  resetDemoTelegramBotCache()
  telegramCalls.length = 0
  process.env.VOICE_AGENT_ORGANIZATION_ID = SALES_ORG
  delete process.env.DEMO_LEAD_ORGANIZATION_ID
  mockRunWithTenant.mockImplementation((_org: string, fn: () => unknown) => Promise.resolve().then(fn))
  vi.mocked(prisma.organization.findFirst).mockResolvedValue({ id: SALES_ORG } as never)
  vi.mocked(prisma.channelConfig.findFirst).mockResolvedValue({ id: "tg-channel", organizationId: SALES_ORG, botToken: BOT_TOKEN } as never)
  vi.mocked(prisma.demoPhoneVerification.findMany).mockResolvedValue([])
  vi.mocked(prisma.demoPhoneVerification.upsert).mockResolvedValue({} as never)
  vi.mocked(prisma.demoPhoneVerification.updateMany).mockResolvedValue({ count: 1 })
  vi.mocked(prisma.demoAccessEvent.create).mockResolvedValue({ id: "event-1" } as never)
  vi.mocked(prisma.voiceConsent.findUnique).mockResolvedValue(null)
  vi.mocked(prisma.channelConfig.findFirst).mockImplementation((async (args: { where: { organizationId?: string; botToken?: unknown } }) => {
    const { organizationId, botToken } = args.where
    if (organizationId !== SALES_ORG) return null
    if (typeof botToken === "string" && botToken !== BOT_TOKEN) return null
    return { id: "tg-channel", organizationId: SALES_ORG, botToken: BOT_TOKEN }
  }) as never)
  telegramStore.clear()
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { body?: string }) => {
    const method = String(url).split("/").pop() ?? ""
    const body = init?.body ? JSON.parse(init.body) : {}
    telegramCalls.push({ method, body })
    if (method === "getMe") return new Response(JSON.stringify({ ok: true, result: { username: "LeadDrivebot" } }))
    if (method === "sendMessage" && body.reply_parameters) {
      // Telegram answers a reply with the original message as it holds it.
      const original = telegramStore.get(`${body.chat_id}:${body.reply_parameters.message_id}`)
      if (!original) return new Response(JSON.stringify({ ok: false, description: "Bad Request: message to be replied not found" }))
      return new Response(JSON.stringify({ ok: true, result: { message_id: 9001, chat: { id: body.chat_id }, text: body.text, reply_to_message: original } }))
    }
    return new Response(JSON.stringify({ ok: true, result: { message_id: 9002, chat: { id: body.chat_id } } }))
  }))
})

/** Messages Telegram really holds, by chat and id. A forged update names one that is not here. */
const telegramStore = new Map<string, Record<string, unknown>>()
let nextMessageId = 100
function sent(message: Record<string, unknown>) {
  const stored: Record<string, unknown> = { message_id: nextMessageId++, date: Math.floor(NOW.getTime() / 1000), ...message }
  telegramStore.set(`${(stored.chat as { id: number }).id}:${stored.message_id}`, stored)
  return stored
}

const replies = () => telegramCalls.filter((call) => call.method === "sendMessage").map((call) => call.body)

describe("issuing the Telegram link", () => {
  it("makes a one-time t.me link to the sales organisation's bot and stores only its hash", async () => {
    const result = await issueDemoTelegramLink({ grant, phone: PHONE, consent: true, now: NOW })
    expect(result).toMatchObject({ ok: true, state: "link" })
    if (!result.ok || result.state !== "link") throw new Error("no link")
    const match = /^https:\/\/t\.me\/LeadDrivebot\?start=d_([A-Za-z0-9_-]+)$/.exec(result.url)
    expect(match, result.url).not.toBeNull()
    const token = match![1]
    expect(token.length).toBeLessThanOrEqual(62) // Telegram's start parameter is at most 64 characters

    const upsert = vi.mocked(prisma.demoPhoneVerification.upsert).mock.calls[0][0]
    expect(upsert.where).toEqual({ grantId_phoneE164: { grantId: "grant-1", phoneE164: PHONE } })
    expect(upsert.create).toMatchObject({ telegramLinkHash: sha256(token), telegramLinkIssueCount: 1 })
    // A new link keeps whoever opened the old one bound: their old button then works with it.
    expect(upsert.update).not.toHaveProperty("telegramUserId")
    expect(upsert.create.telegramLinkExpiresAt).toEqual(new Date(NOW.getTime() + DEMO_TELEGRAM_LINK_TTL_MS))
    expect(JSON.stringify(upsert)).not.toContain(token)
  })

  it("sends nothing anywhere: the prospect is the one who writes to us", async () => {
    await issueDemoTelegramLink({ grant, phone: PHONE, consent: true, now: NOW })
    expect(telegramCalls.map((call) => call.method)).toEqual(["getMe"])
  })

  it("does nothing unless the admin allowed a live call", async () => {
    await expect(issueDemoTelegramLink({ grant: { ...grant, liveCallEnabled: false }, phone: PHONE, consent: true, now: NOW }))
      .resolves.toEqual({ ok: false, code: "not_enabled" })
    expect(prisma.demoPhoneVerification.upsert).not.toHaveBeenCalled()
  })

  it("asks for the agreement first", async () => {
    await expect(issueDemoTelegramLink({ grant, phone: PHONE, consent: false, now: NOW }))
      .resolves.toEqual({ ok: false, code: "consent_required" })
    expect(prisma.demoPhoneVerification.upsert).not.toHaveBeenCalled()
  })

  it("only for an Azerbaijani mobile on the request", async () => {
    await expect(issueDemoTelegramLink({ grant, phone: "+79161234567", consent: true, now: NOW }))
      .resolves.toEqual({ ok: false, code: "invalid_phone" })
  })

  it("steps aside for the SMS code when the sales organisation has no bot, or Telegram does not know it", async () => {
    vi.mocked(prisma.channelConfig.findFirst).mockResolvedValueOnce(null)
    await expect(issueDemoTelegramLink({ grant, phone: PHONE, consent: true, now: NOW }))
      .resolves.toEqual({ ok: false, code: "unavailable" })

    resetDemoTelegramBotCache()
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, description: "Unauthorized" })))
    await expect(issueDemoTelegramLink({ grant, phone: PHONE, consent: true, now: NOW }))
      .resolves.toEqual({ ok: false, code: "unavailable" })
    expect(prisma.demoPhoneVerification.upsert).not.toHaveBeenCalled()
  })

  it("caps the links per grant", async () => {
    vi.mocked(prisma.demoPhoneVerification.findMany).mockResolvedValue([
      { verifiedAt: null, telegramLinkIssueCount: DEMO_TELEGRAM_MAX_LINKS_PER_GRANT },
    ] as never)
    await expect(issueDemoTelegramLink({ grant, phone: PHONE, consent: true, now: NOW }))
      .resolves.toEqual({ ok: false, code: "too_many" })
    expect(prisma.demoPhoneVerification.upsert).not.toHaveBeenCalled()
  })

  it("needs no link once the phone is proven", async () => {
    vi.mocked(prisma.demoPhoneVerification.findMany).mockResolvedValue([{ verifiedAt: NOW, telegramLinkIssueCount: 0 }] as never)
    await expect(issueDemoTelegramLink({ grant, phone: PHONE, consent: true, now: NOW }))
      .resolves.toEqual({ ok: true, state: "already_verified" })
  })
})

function startMessage(token: string, overrides: Record<string, unknown> = {}) {
  return sent({ text: `/start d_${token}`, chat: { id: TG_USER, type: "private" }, from: { id: TG_USER }, ...overrides })
}

/** A contact the user really shared: Telegram holds it. */
function contactMessage(phone: string, userId = TG_USER, extra: Record<string, unknown> = {}) {
  return sent({ chat: { id: TG_USER, type: "private" }, from: { id: TG_USER }, contact: { phone_number: phone, user_id: userId }, ...extra })
}

const TOKEN = "A".repeat(32)
const ISSUED_AT = NOW.getTime() - 60_000
const consume = (message: Record<string, unknown>, botToken = BOT_TOKEN) =>
  consumeDemoTelegramUpdate({ botToken, message, now: NOW })

function linkRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "verification-1",
    verifiedAt: null,
    telegramLinkHash: sha256(TOKEN),
    telegramLinkExpiresAt: new Date(ISSUED_AT + DEMO_TELEGRAM_LINK_TTL_MS),
    grant: openGrant,
    ...overrides,
  }
}

function pendingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "verification-1",
    grantId: "grant-1",
    phoneE164: PHONE,
    verifiedAt: null,
    telegramLinkHash: sha256(TOKEN),
    telegramLinkExpiresAt: new Date(ISSUED_AT + DEMO_TELEGRAM_LINK_TTL_MS),
    grant: openGrant,
    ...overrides,
  }
}

const finalText = () => {
  const edits = telegramCalls.filter((call) => call.method === "editMessageText")
  return edits.length ? edits[edits.length - 1].body.text : undefined
}

describe("the bot, when the prospect opens the link", () => {
  it("binds the link to that Telegram user and shows the consent with a share-my-number button", async () => {
    vi.mocked(prisma.demoPhoneVerification.findUnique).mockResolvedValue(linkRow() as never)

    await expect(consume(startMessage(TOKEN))).resolves.toBe(true)

    expect(prisma.demoPhoneVerification.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { telegramLinkHash: sha256(TOKEN) } }))
    expect(prisma.demoPhoneVerification.updateMany).toHaveBeenCalledWith({
      where: { id: "verification-1", telegramLinkHash: sha256(TOKEN), verifiedAt: null },
      data: { telegramUserId: String(TG_USER) },
    })
    const [message] = replies()
    expect(message.text).toContain(DEMO_CALL_CONSENT_TEXT)
    // The owner of the number reads what arrives: one confirmation here, then the one call.
    expect(message.text).not.toContain("heç nə göndərilmir")
    expect(message.reply_markup).toMatchObject({ keyboard: [[{ text: DEMO_TELEGRAM_TEXT.shareButton, request_contact: true }]] })
  })

  it("answers an expired, used or revoked link without binding anything", async () => {
    for (const row of [
      linkRow({ telegramLinkExpiresAt: new Date(NOW.getTime() - 1) }),
      linkRow({ verifiedAt: NOW }),
      linkRow({ grant: { ...openGrant, status: "REVOKED" } }),
      linkRow({ grant: { ...openGrant, liveCallEnabled: false } }),
      null,
    ]) {
      vi.mocked(prisma.demoPhoneVerification.findUnique).mockResolvedValueOnce(row as never)
      await expect(consume(startMessage(TOKEN))).resolves.toBe(true)
    }
    expect(prisma.demoPhoneVerification.updateMany).not.toHaveBeenCalled()
    expect(replies().map((reply) => reply.text)).toEqual(Array(5).fill(DEMO_TELEGRAM_TEXT.linkDead))
  })

  it("keeps a demo link out of the inbox even in a group, and says nothing there", async () => {
    await expect(consume(startMessage(TOKEN, { chat: { id: -100, type: "group" } }))).resolves.toBe(true)
    expect(prisma.demoPhoneVerification.findUnique).not.toHaveBeenCalled()
    expect(replies()).toEqual([])
  })
})

describe("the bot, when the prospect shares a contact", () => {
  it("on the prospect's own fresh contact with the request's number, writes a one-time code in Telegram", async () => {
    vi.mocked(prisma.demoPhoneVerification.findMany).mockImplementation((async (args: { where: Record<string, unknown> }) =>
      "OR" in args.where ? [pendingRow()] : [{ id: "verification-1", otpSendCount: 0, otpSentAt: null }]) as never)

    // Telegram usually sends the number without "+".
    await expect(consume(contactMessage("994501234567"))).resolves.toBe(true)

    expect(prisma.demoPhoneVerification.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        updatedAt: { gt: new Date(NOW.getTime() - 24 * 60 * 60_000) },
        OR: [{ telegramUserId: String(TG_USER) }, { phoneE164: PHONE, verifiedAt: null, telegramLinkExpiresAt: { gt: NOW } }],
      },
    }))
    const update = vi.mocked(prisma.demoPhoneVerification.updateMany).mock.calls[0][0] as { where: unknown; data: Record<string, unknown> }
    expect(update.where).toEqual({ id: "verification-1", telegramLinkHash: sha256(TOKEN), verifiedAt: null })
    expect(update.data).toMatchObject({
      telegramProofMessage: expect.stringMatching(new RegExp(`^${TG_USER}:\\d+$`)),
      otpExpiresAt: new Date(NOW.getTime() + 10 * 60_000),
      otpSentAt: NOW,
      otpAttempts: 0,
      otpSendCount: { increment: 1 },
    })
    // Not proven yet: the browser still has to type the code.
    expect(update.data).not.toHaveProperty("verifiedAt")
    expect(prisma.voiceConsent.create).not.toHaveBeenCalled()
    expect(prisma.demoAccessEvent.create).toHaveBeenCalledWith({
      data: { grantId: "grant-1", eventType: "PHONE_CODE_SENT", metadata: { delivered: true, phoneTail: "67", method: "telegram" } },
    })
    // The code in the message is the one whose hash was stored.
    const code = /(\d{6})/.exec(String(finalText()))?.[1]
    expect(code, String(finalText())).toBeDefined()
    expect(await bcrypt.compare(code!, String(update.data.otpHash))).toBe(true)
  })

  it("keeps to the old code's limits: a minute between codes, a few per grant", async () => {
    vi.mocked(prisma.demoPhoneVerification.findMany).mockImplementation((async (args: { where: Record<string, unknown> }) =>
      "OR" in args.where ? [pendingRow()] : [{ id: "verification-1", otpSendCount: 1, otpSentAt: new Date(NOW.getTime() - 10_000) }]) as never)
    await consume(contactMessage(PHONE))
    expect(finalText()).toBe(DEMO_TELEGRAM_TEXT.codeCooldown)

    vi.mocked(prisma.demoPhoneVerification.findMany).mockImplementation((async (args: { where: Record<string, unknown> }) =>
      "OR" in args.where ? [pendingRow()] : [{ id: "verification-1", otpSendCount: 3, otpSentAt: new Date(NOW.getTime() - 3_600_000) }]) as never)
    await consume(contactMessage(PHONE))
    expect(finalText()).toBe(DEMO_TELEGRAM_TEXT.codeLimit)
    expect(prisma.demoPhoneVerification.updateMany).not.toHaveBeenCalled()
  })

  it("believes Telegram, not the webhook body: a hand-made update proves nothing", async () => {
    // Anyone holding the bot token can POST to the webhook. The update below
    // names a message Telegram never received.
    vi.mocked(prisma.demoPhoneVerification.findMany).mockResolvedValue([pendingRow()] as never)
    const forged = { message_id: 424242, date: Math.floor(NOW.getTime() / 1000), chat: { id: TG_USER, type: "private" }, from: { id: TG_USER }, contact: { phone_number: PHONE, user_id: TG_USER } }

    await expect(consume(forged)).resolves.toBe(true)
    expect(prisma.demoPhoneVerification.updateMany).not.toHaveBeenCalled()
    expect(prisma.voiceConsent.create).not.toHaveBeenCalled()
  })

  it("reads the number from Telegram even when the webhook body says another", async () => {
    vi.mocked(prisma.demoPhoneVerification.findMany).mockResolvedValue([pendingRow()] as never)
    const real = contactMessage("+994551112233")
    // Same message id, but the body claims the request's number.
    await expect(consume({ ...real, contact: { phone_number: PHONE, user_id: TG_USER } })).resolves.toBe(true)
    expect(prisma.demoPhoneVerification.updateMany).not.toHaveBeenCalled()
    expect(finalText()).toBe(DEMO_TELEGRAM_TEXT.otherNumber)
  })

  it("refuses somebody else's contact card and offers the button again", async () => {
    vi.mocked(prisma.demoPhoneVerification.findMany).mockResolvedValue([pendingRow()] as never)
    await expect(consume(contactMessage(PHONE, 555))).resolves.toBe(true)
    expect(prisma.demoPhoneVerification.updateMany).not.toHaveBeenCalled()
    expect(finalText()).toBe(DEMO_TELEGRAM_TEXT.notOwnContact)
    expect(replies().at(-1)?.reply_markup).toMatchObject({ keyboard: [[{ request_contact: true }]] })
  })

  it("refuses a forwarded card, even of one's own account: it can carry a number the account has left", async () => {
    vi.mocked(prisma.demoPhoneVerification.findMany).mockResolvedValue([pendingRow()] as never)
    await expect(consume(contactMessage(PHONE, TG_USER, { forward_origin: { type: "user", date: 1 } }))).resolves.toBe(true)
    await expect(consume(contactMessage(PHONE, TG_USER, { forward_date: 1 }))).resolves.toBe(true)
    expect(prisma.demoPhoneVerification.updateMany).not.toHaveBeenCalled()
  })

  it("refuses a contact shared before the link was made", async () => {
    vi.mocked(prisma.demoPhoneVerification.findMany).mockResolvedValue([pendingRow()] as never)
    const old = contactMessage(PHONE, TG_USER, { date: Math.floor((ISSUED_AT - 60 * 60_000) / 1000) })
    await expect(consume(old)).resolves.toBe(true)
    expect(prisma.demoPhoneVerification.updateMany).not.toHaveBeenCalled()
    expect(finalText()).toBe(DEMO_TELEGRAM_TEXT.linkDead)
  })

  it("refuses a Telegram account on another number: only the request's phone is ever called", async () => {
    vi.mocked(prisma.demoPhoneVerification.findMany).mockResolvedValue([pendingRow()] as never)
    await expect(consume(contactMessage("+994551112233"))).resolves.toBe(true)
    expect(prisma.demoPhoneVerification.updateMany).not.toHaveBeenCalled()
    expect(prisma.voiceConsent.create).not.toHaveBeenCalled()
    expect(finalText()).toBe(DEMO_TELEGRAM_TEXT.otherNumber)
  })

  it("proves nothing for a grant revoked since the link was opened", async () => {
    vi.mocked(prisma.demoPhoneVerification.findMany).mockResolvedValue([pendingRow({ grant: { ...openGrant, status: "REVOKED" } })] as never)
    await expect(consume(contactMessage(PHONE))).resolves.toBe(true)
    expect(prisma.demoPhoneVerification.updateMany).not.toHaveBeenCalled()
    expect(finalText()).toBe(DEMO_TELEGRAM_TEXT.linkDead)
  })

  it("loses a race instead of proving twice", async () => {
    vi.mocked(prisma.demoPhoneVerification.findMany).mockResolvedValue([pendingRow()] as never)
    vi.mocked(prisma.demoPhoneVerification.updateMany).mockResolvedValue({ count: 0 })
    await expect(consume(contactMessage(PHONE))).resolves.toBe(true)
    expect(prisma.demoAccessEvent.create).not.toHaveBeenCalled()
    expect(prisma.voiceConsent.create).not.toHaveBeenCalled()
  })

  it("lets one message prove one phone once: a replay aimed at another demo fails on the unique proof", async () => {
    vi.mocked(prisma.demoPhoneVerification.findMany).mockResolvedValue([pendingRow({ id: "verification-2", grantId: "grant-2" })] as never)
    vi.mocked(prisma.demoPhoneVerification.updateMany).mockRejectedValue(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }))
    await expect(consume(contactMessage(PHONE))).resolves.toBe(true)
    expect(prisma.demoAccessEvent.create).not.toHaveBeenCalled()
    expect(prisma.voiceConsent.create).not.toHaveBeenCalled()
    expect(finalText()).toBe(DEMO_TELEGRAM_TEXT.linkDead)
  })

  it("says so and gives the button back when Telegram does not answer, instead of going silent", async () => {
    vi.mocked(prisma.demoPhoneVerification.findMany).mockResolvedValue([pendingRow()] as never)
    const message = contactMessage(PHONE)
    vi.mocked(fetch).mockImplementationOnce(async () => new Response(JSON.stringify({ ok: false, error_code: 429, description: "Too Many Requests: retry after 3" })))
    await expect(consume(message)).resolves.toBe(true)
    expect(prisma.demoPhoneVerification.updateMany).not.toHaveBeenCalled()
    expect(replies().map((reply) => reply.text)).toContain(DEMO_TELEGRAM_TEXT.failed)
    expect(replies().at(-1)?.reply_markup).toMatchObject({ keyboard: [[{ request_contact: true }]] })
  })

  it("still takes the share of a prospect whose link somebody else opened later", async () => {
    // The row is bound to whoever opened the link last; the prospect's own
    // share is routed by its number and proven by the read-back.
    vi.mocked(prisma.demoPhoneVerification.findMany).mockImplementation((async (args: { where: Record<string, unknown> }) =>
      "OR" in args.where ? [pendingRow()] : [{ id: "verification-1", otpSendCount: 0, otpSentAt: null }]) as never)
    await expect(consume(contactMessage(PHONE))).resolves.toBe(true)
    expect(prisma.demoPhoneVerification.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ OR: expect.arrayContaining([{ phoneE164: PHONE, verifiedAt: null, telegramLinkExpiresAt: { gt: NOW } }]) }),
    }))
    expect(String(finalText())).toMatch(/LeadDrive demo kodu: \d{6}/)
  })

  it("answers the old button after the link lapsed, instead of dropping a thread into the inbox", async () => {
    vi.mocked(prisma.demoPhoneVerification.findMany).mockResolvedValue([pendingRow({ telegramLinkExpiresAt: new Date(NOW.getTime() - 1) })] as never)
    await expect(consume(contactMessage(PHONE))).resolves.toBe(true)
    expect(prisma.demoPhoneVerification.updateMany).not.toHaveBeenCalled()
    expect(replies()[0].text).toBe(DEMO_TELEGRAM_TEXT.linkDead)
  })
})

describe("the sales organisation's inbox keeps its bot", () => {
  it("lets ordinary messages and contacts through untouched", async () => {
    await expect(consume({ text: "Salam, qiymət nədir?", chat: { id: 1, type: "private" }, from: { id: 1 } })).resolves.toBe(false)
    await expect(consume({ text: "/start", chat: { id: 1, type: "private" }, from: { id: 1 } })).resolves.toBe(false)
    // A contact from someone who never opened a demo link is an ordinary inbox message.
    await expect(consume(contactMessage(PHONE))).resolves.toBe(false)
    expect(prisma.demoPhoneVerification.updateMany).not.toHaveBeenCalled()
    expect(telegramCalls.filter((call) => call.method !== "getMe")).toEqual([])
  })

  it("never acts for a bot the demo sales organisation does not own", async () => {
    vi.mocked(prisma.demoPhoneVerification.findMany).mockResolvedValue([pendingRow()] as never)
    await expect(consume(startMessage(TOKEN), "999:another-organisations-bot")).resolves.toBe(false)
    await expect(consume(contactMessage(PHONE), "999:another-organisations-bot")).resolves.toBe(false)
    expect(prisma.demoPhoneVerification.findUnique).not.toHaveBeenCalled()
    expect(prisma.demoPhoneVerification.updateMany).not.toHaveBeenCalled()
  })
})

describe("normalizeTelegramPhone", () => {
  it("accepts Telegram's shapes of an Azerbaijani mobile and nothing else", () => {
    expect(normalizeTelegramPhone("994501234567")).toBe(PHONE)
    expect(normalizeTelegramPhone("+994501234567")).toBe(PHONE)
    expect(normalizeTelegramPhone("79161234567")).toBeNull()
    expect(normalizeTelegramPhone("994 50 123")).toBeNull()
    expect(normalizeTelegramPhone(994501234567)).toBeNull()
  })
})

describe("the public Telegram route", () => {
  const RAW = "c".repeat(64)

  function activeGrant(sessionHash: string | null) {
    return {
      id: "grant-1",
      status: "ACTIVE",
      liveCallEnabled: true,
      sessionHash,
      linkExpiresAt: new Date("2099-01-01T00:00:00Z"),
      sessionStartedAt: new Date(),
      sessionLastSeenAt: new Date(),
      sessionExpiresAt: new Date("2099-01-01T00:00:00Z"),
      inactivityMinutes: 30,
      request: { phone: PHONE },
    }
  }

  async function call(method: "POST" | "GET", body?: unknown, cookie?: string) {
    const route = await import("@/app/api/v1/public/demo-access/[token]/phone/telegram/route")
    const request = new NextRequest(new URL(`/api/v1/public/demo-access/${RAW}/phone/telegram`, "http://localhost:3000"), {
      method,
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return route[method](request, { params: Promise.resolve({ token: RAW }) })
  }

  it("requires the prospect's own live session", async () => {
    vi.mocked(prisma.demoGrant.findUnique).mockResolvedValue(activeGrant("some-other-hash") as never)
    expect((await call("POST", { consent: true })).status).toBe(401)
    expect((await call("GET")).status).toBe(401)
    expect(prisma.demoPhoneVerification.upsert).not.toHaveBeenCalled()
  })

  it("answers with the link and a QR code for a laptop, never with the number", async () => {
    const credential = issueBrowserCredential()
    vi.mocked(prisma.demoGrant.findUnique).mockResolvedValue(activeGrant(credential.credentialHash) as never)

    const response = await call("POST", { consent: true }, `${demoSessionCookieName(RAW)}=${credential.credential}`)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ success: true, state: "link" })
    expect(body.url).toMatch(/^https:\/\/t\.me\/LeadDrivebot\?start=d_/)
    expect(body.qr).toMatch(/^data:image\/png;base64,/)
    expect(JSON.stringify({ ...body, qr: null })).not.toMatch(/994|501234567/)
  })

  it("refuses a browser that names a number", async () => {
    const credential = issueBrowserCredential()
    vi.mocked(prisma.demoGrant.findUnique).mockResolvedValue(activeGrant(credential.credentialHash) as never)
    const response = await call("POST", { consent: true, phone: "+994551112233" }, `${demoSessionCookieName(RAW)}=${credential.credential}`)
    expect(response.status).toBe(400)
    expect(prisma.demoPhoneVerification.upsert).not.toHaveBeenCalled()
  })

  it("tells the waiting page whether the bot has accepted the number", async () => {
    const credential = issueBrowserCredential()
    vi.mocked(prisma.demoGrant.findUnique).mockResolvedValue(activeGrant(credential.credentialHash) as never)
    vi.mocked(prisma.demoPhoneVerification.findMany).mockResolvedValue([{ verifiedAt: null, telegramLinkExpiresAt: new Date(Date.now() + 60_000) }] as never)

    const response = await call("GET", undefined, `${demoSessionCookieName(RAW)}=${credential.credential}`)
    expect(await response.json()).toEqual({ success: true, verified: false, linkOpen: true, codeSent: false })
  })
})
