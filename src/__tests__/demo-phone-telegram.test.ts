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
import { DEMO_CALL_CONSENT_TEXT, DEMO_CALL_CONSENT_VERSION } from "@/lib/demo-center/phone-verification"
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
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { body?: string }) => {
    const method = String(url).split("/").pop() ?? ""
    telegramCalls.push({ method, body: init?.body ? JSON.parse(init.body) : {} })
    if (method === "getMe") return new Response(JSON.stringify({ ok: true, result: { username: "LeadDrivebot" } }))
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }))
  }))
})

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
    expect(upsert.create).toMatchObject({ telegramLinkHash: sha256(token), telegramUserId: null, telegramLinkIssueCount: 1 })
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
  return { text: `/start d_${token}`, chat: { id: TG_USER, type: "private" }, from: { id: TG_USER }, ...overrides }
}

function contactMessage(phone: string, userId = TG_USER, fromId = TG_USER) {
  return { chat: { id: fromId, type: "private" }, from: { id: fromId }, contact: { phone_number: phone, user_id: userId } }
}

const TOKEN = "A".repeat(32)
const consume = (message: Record<string, unknown>, organizationId = SALES_ORG) =>
  consumeDemoTelegramUpdate({ organizationId, botToken: BOT_TOKEN, message, now: NOW })

function linkRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "verification-1",
    verifiedAt: null,
    telegramLinkHash: sha256(TOKEN),
    telegramLinkExpiresAt: new Date(NOW.getTime() + 60_000),
    grant: openGrant,
    ...overrides,
  }
}

function pendingRow(overrides: Record<string, unknown> = {}) {
  return { id: "verification-1", grantId: "grant-1", phoneE164: PHONE, telegramLinkHash: sha256(TOKEN), grant: openGrant, ...overrides }
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
  it("proves the request's phone with the prospect's own contact, and records the consent", async () => {
    vi.mocked(prisma.demoPhoneVerification.findMany).mockResolvedValue([pendingRow()] as never)

    // Telegram usually sends the number without "+".
    await expect(consume(contactMessage("994501234567"))).resolves.toBe(true)

    expect(prisma.demoPhoneVerification.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { telegramUserId: String(TG_USER), verifiedAt: null, telegramLinkExpiresAt: { gt: NOW } },
    }))
    expect(prisma.demoPhoneVerification.updateMany).toHaveBeenCalledWith({
      where: { id: "verification-1", telegramLinkHash: sha256(TOKEN), verifiedAt: null },
      data: {
        telegramLinkHash: null,
        telegramLinkExpiresAt: null,
        verifiedAt: NOW,
        verifiedVia: "telegram",
        consentAt: NOW,
        consentVersion: DEMO_CALL_CONSENT_VERSION,
      },
    })
    expect(prisma.demoAccessEvent.create).toHaveBeenCalledWith({
      data: { grantId: "grant-1", eventType: "PHONE_VERIFIED", metadata: { consentVersion: DEMO_CALL_CONSENT_VERSION, phoneTail: "67", method: "telegram" } },
    })
    expect(mockRunWithTenant.mock.calls.some(([org]) => org === SALES_ORG)).toBe(true)
    expect(prisma.voiceConsent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ organizationId: SALES_ORG, phoneE164: PHONE, scope: "sales", status: "allowed" }),
    })
    expect(replies()).toEqual([expect.objectContaining({ text: DEMO_TELEGRAM_TEXT.verified, reply_markup: { remove_keyboard: true } })])
  })

  it("refuses somebody else's contact card", async () => {
    vi.mocked(prisma.demoPhoneVerification.findMany).mockResolvedValue([pendingRow()] as never)
    await expect(consume(contactMessage(PHONE, 555))).resolves.toBe(true)
    expect(prisma.demoPhoneVerification.updateMany).not.toHaveBeenCalled()
    expect(replies()[0].text).toBe(DEMO_TELEGRAM_TEXT.notOwnContact)
  })

  it("refuses a Telegram account on another number: only the request's phone is ever called", async () => {
    vi.mocked(prisma.demoPhoneVerification.findMany).mockResolvedValue([pendingRow()] as never)
    await expect(consume(contactMessage("+994551112233"))).resolves.toBe(true)
    expect(prisma.demoPhoneVerification.updateMany).not.toHaveBeenCalled()
    expect(prisma.voiceConsent.create).not.toHaveBeenCalled()
    expect(replies()[0].text).toBe(DEMO_TELEGRAM_TEXT.otherNumber)
  })

  it("proves nothing for a grant revoked since the link was opened", async () => {
    vi.mocked(prisma.demoPhoneVerification.findMany).mockResolvedValue([pendingRow({ grant: { ...openGrant, status: "REVOKED" } })] as never)
    await expect(consume(contactMessage(PHONE))).resolves.toBe(true)
    expect(prisma.demoPhoneVerification.updateMany).not.toHaveBeenCalled()
    expect(replies()[0].text).toBe(DEMO_TELEGRAM_TEXT.linkDead)
  })

  it("loses a race instead of proving twice", async () => {
    vi.mocked(prisma.demoPhoneVerification.findMany).mockResolvedValue([pendingRow()] as never)
    vi.mocked(prisma.demoPhoneVerification.updateMany).mockResolvedValue({ count: 0 })
    await expect(consume(contactMessage(PHONE))).resolves.toBe(true)
    expect(prisma.demoAccessEvent.create).not.toHaveBeenCalled()
    expect(prisma.voiceConsent.create).not.toHaveBeenCalled()
  })
})

describe("the sales organisation's inbox keeps its bot", () => {
  it("lets ordinary messages and contacts through untouched", async () => {
    await expect(consume({ text: "Salam, qiymət nədir?", chat: { id: 1, type: "private" }, from: { id: 1 } })).resolves.toBe(false)
    await expect(consume({ text: "/start", chat: { id: 1, type: "private" }, from: { id: 1 } })).resolves.toBe(false)
    // A contact from someone with no open demo link is an ordinary inbox message.
    await expect(consume(contactMessage(PHONE))).resolves.toBe(false)
    expect(prisma.demoPhoneVerification.updateMany).not.toHaveBeenCalled()
    expect(replies()).toEqual([])
  })

  it("never acts for any other organisation's bot", async () => {
    vi.mocked(prisma.demoPhoneVerification.findMany).mockResolvedValue([pendingRow()] as never)
    await expect(consume(startMessage(TOKEN), "org-brand-protection")).resolves.toBe(false)
    await expect(consume(contactMessage(PHONE), "org-brand-protection")).resolves.toBe(false)
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
    expect(await response.json()).toEqual({ success: true, verified: false, linkOpen: true })
  })
})
