import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Outbound media delivery (media SEND, Slice 3b): sendWhatsAppMedia (2-step upload→send) +
 * sendTelegramMedia (sendPhoto/sendDocument). Mock prisma (WA config) + fetch.
 */
vi.mock("@/lib/prisma", () => ({ prisma: { channelConfig: { findFirst: vi.fn() } } }))

const fetchMock = vi.fn()
global.fetch = fetchMock as unknown as typeof fetch

import { sendWhatsAppMedia } from "@/lib/whatsapp"
import { sendTelegramMedia } from "@/lib/telegram-media"
import { prisma } from "@/lib/prisma"

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.channelConfig.findFirst).mockResolvedValue({
    accessToken: "TOK", phoneNumberId: "PHONE", apiKey: null, phoneNumber: null,
    businessAccountId: "BIZ", webhookUrl: null,
  } as never)
})

describe("sendWhatsAppMedia (2-step: upload → send)", () => {
  it("uploads to /media → media_id → sends an image message with caption", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: "MID" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.1" }] }) })
    const r = await sendWhatsAppMedia({
      to: "+994501112233", buffer: Buffer.from([1, 2, 3]), mime: "image/jpeg", filename: "a.jpg",
      caption: "hi", organizationId: "org1",
    })
    expect(r.success).toBe(true)
    expect(r.messageId).toBe("wamid.1")
    expect(String(fetchMock.mock.calls[0][0])).toContain("/PHONE/media")
    expect(String(fetchMock.mock.calls[1][0])).toContain("/PHONE/messages")
    const body = JSON.parse(String((fetchMock.mock.calls[1][1] as { body: string }).body))
    expect(body.type).toBe("image")
    expect(body.image.id).toBe("MID")
    expect(body.image.caption).toBe("hi")
  })

  it("sends type=document (with filename) for a pdf", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "MID" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [{ id: "x" }] }) })
    await sendWhatsAppMedia({ to: "x", buffer: Buffer.from([1]), mime: "application/pdf", filename: "c.pdf", organizationId: "org1" })
    const body = JSON.parse(String((fetchMock.mock.calls[1][1] as { body: string }).body))
    expect(body.type).toBe("document")
    expect(body.document.filename).toBe("c.pdf")
  })

  it("fails (no fetch) when WhatsApp isn't configured", async () => {
    vi.mocked(prisma.channelConfig.findFirst).mockResolvedValueOnce(null as never)
    const r = await sendWhatsAppMedia({ to: "x", buffer: Buffer.from([1]), mime: "image/jpeg", filename: "a.jpg", organizationId: "org1" })
    expect(r.success).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("fails when the media upload is rejected (no send attempted)", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: { message: "bad media" } }) })
    const r = await sendWhatsAppMedia({ to: "x", buffer: Buffer.from([1]), mime: "image/jpeg", filename: "a.jpg", organizationId: "org1" })
    expect(r.success).toBe(false)
    expect(r.error).toContain("bad media")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe("sendTelegramMedia (sendPhoto / sendDocument)", () => {
  it("uses sendPhoto for an image", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, result: { message_id: 7 } }) })
    const r = await sendTelegramMedia("BOT:TOK", "123", Buffer.from([1, 2]), "image/jpeg", "a.jpg", "cap")
    expect(r.success).toBe(true)
    expect(r.messageId).toBe("7")
    expect(String(fetchMock.mock.calls[0][0])).toContain("/botBOT:TOK/sendPhoto")
  })

  it("uses sendDocument for a pdf", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, result: { message_id: 8 } }) })
    await sendTelegramMedia("BOT:TOK", "123", Buffer.from([1]), "application/pdf", "c.pdf")
    expect(String(fetchMock.mock.calls[0][0])).toContain("/sendDocument")
  })

  it("fails on a Telegram API error", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: false, description: "chat not found" }) })
    const r = await sendTelegramMedia("BOT:TOK", "123", Buffer.from([1]), "image/jpeg", "a.jpg")
    expect(r.success).toBe(false)
    expect(r.error).toContain("chat not found")
  })

  it("fails fast without a token/chatId", async () => {
    expect((await sendTelegramMedia("", "123", Buffer.from([1]), "image/jpeg", "a.jpg")).success).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
