/**
 * The Telegram webhook hands every message to the demo's phone check first
 * (src/lib/demo-center/phone-telegram.ts). What the demo takes never becomes
 * an inbox message; everything else reaches the inbox exactly as before.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mockConsume = vi.hoisted(() => vi.fn())

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelConfig: { findFirst: vi.fn() },
    channelMessage: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}))
vi.mock("@/lib/rls-context", () => ({
  runWithRlsBypass: (fn: () => unknown) => Promise.resolve().then(fn),
  runWithTenant: (_org: string, fn: () => unknown) => Promise.resolve().then(fn),
}))
vi.mock("@/lib/demo-center/phone-telegram", () => ({ consumeDemoTelegramUpdate: mockConsume }))
vi.mock("@/lib/social/notify-recipients", () => ({ notifyConversationRecipients: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/telegram-media", () => ({ fetchAndStoreTelegramMedia: vi.fn() }))
vi.mock("@/lib/inbound-lead-match", () => ({ matchInboundLeadId: vi.fn().mockResolvedValue(undefined) }))

import { prisma } from "@/lib/prisma"
import { POST } from "@/app/api/v1/webhooks/telegram/route"

const BOT_TOKEN = "123456:bot-token"

function update(message: Record<string, unknown>) {
  return new NextRequest(new URL(`/api/v1/webhooks/telegram?token=${BOT_TOKEN}`, "http://localhost:3000"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ update_id: 1, message }),
  })
}

const contact = { message_id: 5, chat: { id: 42, type: "private" }, from: { id: 42, first_name: "Aysel" }, contact: { phone_number: "994501234567", user_id: 42 } }

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.TELEGRAM_WEBHOOK_SECRET
  vi.mocked(prisma.channelConfig.findFirst).mockResolvedValue({ id: "tg-channel", organizationId: "org-leaddrive-inc", botToken: BOT_TOKEN, settings: {} } as never)
  vi.mocked(prisma.channelMessage.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.channelMessage.create).mockResolvedValue({ id: "message-1" } as never)
})

describe("the Telegram webhook and the demo's phone check", () => {
  it("asks the demo first, with the bot token and the message", async () => {
    mockConsume.mockResolvedValue(true)
    const response = await POST(update(contact))
    expect(response.status).toBe(200)
    expect(mockConsume).toHaveBeenCalledWith({ botToken: BOT_TOKEN, message: contact })
  })

  it("makes no inbox message of what the demo took", async () => {
    mockConsume.mockResolvedValue(true)
    await POST(update(contact))
    expect(prisma.channelMessage.create).not.toHaveBeenCalled()
  })

  it("passes everything else to the inbox as before", async () => {
    mockConsume.mockResolvedValue(false)
    await POST(update({ message_id: 6, chat: { id: 42, type: "private" }, from: { id: 42, first_name: "Aysel" }, text: "Salam" }))
    expect(prisma.channelMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ organizationId: "org-leaddrive-inc", channelType: "telegram", body: "Salam" }),
    }))
  })
})
