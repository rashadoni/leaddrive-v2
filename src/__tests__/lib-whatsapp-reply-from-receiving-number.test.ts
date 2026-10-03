import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * A workspace with two WhatsApp numbers answers from the number the customer wrote to.
 *
 * Found on production 2026-10-03, the first day a number was connected through Embedded Signup into a
 * workspace that already had one: the AI answered a message received on the new number from the OLD
 * number — outside that number's 24h window with the customer, so Meta refused it. Every send resolved
 * "the workspace's WhatsApp row" by organization alone; the conversation's channel was passed by the
 * inbox and the webhook and then dropped. The property: given the conversation's channel, the request
 * goes to THAT number with THAT number's token, and is logged on that channel.
 */

// A stand-in for Prisma's rows and arguments, which differ per call; typing them is the real client's job.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>
const db = vi.hoisted(() => ({ rows: [] as Row[], logged: [] as Row[] }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelConfig: {
      findFirst: vi.fn(async ({ where }: Row) =>
        db.rows.find((r) =>
          (!where.id || r.id === where.id)
          && r.organizationId === where.organizationId
          && r.channelType === where.channelType
          && r.isActive === where.isActive,
        ) ?? null),
    },
    channelMessage: {
      create: vi.fn(async ({ data }: Row) => { db.logged.push(data); return data }),
      findFirst: vi.fn(async () => ({ createdAt: new Date() })), // inside the 24h window
    },
  },
}))

import { sendWhatsAppMessage, sendWhatsAppMedia } from "@/lib/whatsapp"

let calls: Array<{ url: string; auth: string | null }> = []

beforeEach(() => {
  db.rows.splice(0, db.rows.length,
    // The workspace's first number (oldest row: what an organization-only lookup lands on).
    { id: "wa_old", organizationId: "org_1", channelType: "whatsapp", isActive: true, phoneNumberId: "111", accessToken: "TOKEN_OLD" },
    // The number connected later through Embedded Signup, in the customer's own WABA.
    { id: "wa_new", organizationId: "org_1", channelType: "whatsapp", isActive: true, phoneNumberId: "222", accessToken: "TOKEN_NEW" },
  )
  db.logged.length = 0
  calls = []
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = (init?.headers || {}) as Record<string, string>
    calls.push({ url: String(input), auth: headers.Authorization || null })
    const body = String(input).endsWith("/media") ? { id: "media-1" } : { messages: [{ id: "wamid.1" }] }
    return new Response(JSON.stringify(body), { status: 200 })
  }))
})

describe("sending WhatsApp from the conversation's number", () => {
  it("answers from the number the conversation came in on (forced text — the auto-reply path)", async () => {
    const r = await sendWhatsAppMessage({ to: "+994501234567", message: "Salam", organizationId: "org_1", forceText: true, channelConfigId: "wa_new" })
    expect(r.success).toBe(true)
    expect(calls).toEqual([{ url: expect.stringMatching(/\/222\/messages$/), auth: "Bearer TOKEN_NEW" }])
    expect(db.logged.map((m) => [m.channelConfigId, m.from])).toEqual([["wa_new", "222"]])
  })

  it("answers from the number the conversation came in on (window-checked text — the inbox path)", async () => {
    await sendWhatsAppMessage({ to: "994501234567", message: "Salam", organizationId: "org_1", channelConfigId: "wa_new" })
    expect(calls.map((c) => [new URL(c.url).pathname.split("/").at(-2), c.auth])).toEqual([["222", "Bearer TOKEN_NEW"]])
  })

  it("sends media from that number too, upload and message alike", async () => {
    await sendWhatsAppMedia({ to: "994501234567", buffer: Buffer.from("x"), mime: "image/png", filename: "a.png", organizationId: "org_1", channelConfigId: "wa_new" })
    expect(calls.map((c) => [new URL(c.url).pathname.split("/").at(-2), c.auth])).toEqual([
      ["222", "Bearer TOKEN_NEW"],
      ["222", "Bearer TOKEN_NEW"],
    ])
  })

  it("keeps the workspace's number when no channel is named, or the named one is gone", async () => {
    await sendWhatsAppMessage({ to: "994501234567", message: "a", organizationId: "org_1", forceText: true })
    await sendWhatsAppMessage({ to: "994501234567", message: "b", organizationId: "org_1", forceText: true, channelConfigId: "wa_deleted" })
    db.rows[1].isActive = false
    await sendWhatsAppMessage({ to: "994501234567", message: "c", organizationId: "org_1", forceText: true, channelConfigId: "wa_new" })
    expect(calls.map((c) => c.auth)).toEqual(["Bearer TOKEN_OLD", "Bearer TOKEN_OLD", "Bearer TOKEN_OLD"])
  })

  it("never borrows another workspace's channel", async () => {
    db.rows.push({ id: "wa_foreign", organizationId: "org_2", channelType: "whatsapp", isActive: true, phoneNumberId: "999", accessToken: "TOKEN_FOREIGN" })
    await sendWhatsAppMessage({ to: "994501234567", message: "x", organizationId: "org_1", forceText: true, channelConfigId: "wa_foreign" })
    expect(calls.map((c) => c.auth)).toEqual(["Bearer TOKEN_OLD"])
  })
})
