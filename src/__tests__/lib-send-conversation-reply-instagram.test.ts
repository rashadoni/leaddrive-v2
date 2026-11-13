import { beforeEach, describe, expect, it, vi } from "vitest"

// Instagram replies from the inbox composer: the token stored on the channel decides which Graph
// host accepts it. A Facebook-Login page token works only on graph.facebook.com; an Instagram-Login
// token (settings.igLogin=true) only on graph.instagram.com. Sending either through the other host
// fails, so the reply helper must pick by the channel that received the thread.

// Only `fetch` is stubbed: what is asserted is the request that actually leaves for Meta.

const mocks = vi.hoisted(() => ({
  findConfig: vi.fn(),
  createMessage: vi.fn(),
  updateConversation: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelConfig: { findFirst: mocks.findConfig },
    channelMessage: { create: mocks.createMessage },
    socialConversation: { updateMany: mocks.updateConversation },
    contact: { updateMany: vi.fn() },
  },
}))
vi.mock("@/lib/chatwoot", () => ({ sendChatwootMessage: vi.fn() }))
vi.mock("@/lib/channels/platform-connections", () => ({ resolveChannelConnection: vi.fn() }))
vi.mock("@/lib/channels/reply-routing", () => ({ resolveReplyRoute: vi.fn() }))
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }))
vi.mock("@/lib/sms", () => ({ sendSms: vi.fn() }))
vi.mock("@/lib/whatsapp", () => ({ sendWhatsAppMessage: vi.fn(), sendWhatsAppMedia: vi.fn() }))
vi.mock("@/lib/telegram", () => ({ resolveTelegramSendTarget: vi.fn(), sendTelegramText: vi.fn() }))
vi.mock("@/lib/telegram-media", () => ({ sendTelegramMedia: vi.fn() }))
vi.mock("@/lib/vkontakte", () => ({ sendVkMessage: vi.fn() }))
vi.mock("@/lib/inbox-ensure-conversation", () => ({ ensureConversation: vi.fn() }))

import { sendConversationReply } from "@/lib/inbox/send-conversation-reply"

const ORG = "org-fanumsec"
const reply = {
  organizationId: ORG,
  channel: "instagram" as const,
  to: "1318586653085202",
  body: "sizin əlaqə nömrənizi götürə bilərəm?",
  conversationId: "conv-1",
  channelConfigId: "cfg-ig",
}

type Sent = { url: string; auth: string | null; body: { recipient: { id: string }; message: Record<string, unknown> } }
let sent: Sent[] = []
/** What Meta answers to each call, in order; the last one repeats. */
let answers: Array<{ status: number; body: unknown }> = []

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXTAUTH_SECRET = "test-secret-test-secret-test-secret"
  sent = []
  answers = [{ status: 200, body: { recipient_id: reply.to, message_id: "mid.1" } }]
  mocks.createMessage.mockImplementation(async ({ data }: { data: { status: string } }) => ({ id: "msg-1", status: data.status }))
  mocks.updateConversation.mockResolvedValue({ count: 1 })
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: { headers: Record<string, string>; body: string }) => {
    sent.push({ url: String(url), auth: init.headers.Authorization ?? null, body: JSON.parse(init.body) })
    const answer = answers[Math.min(sent.length - 1, answers.length - 1)]
    return new Response(JSON.stringify(answer.body), { status: answer.status })
  }))
})

const recorded = () => mocks.createMessage.mock.calls[0][0].data

describe("sendConversationReply — Instagram", () => {
  it("sends through the Facebook-Login page token of the channel that received the thread", async () => {
    mocks.findConfig.mockResolvedValue({ apiKey: "page-token", settings: {} })

    const result = await sendConversationReply(reply)

    expect(result.success).toBe(true)
    expect(mocks.findConfig).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "cfg-ig", organizationId: ORG, channelType: "instagram", isActive: true },
    }))
    expect(sent).toHaveLength(1)
    expect(sent[0].url).toBe("https://graph.facebook.com/v20.0/me/messages")
    expect(sent[0].auth).toBe("Bearer page-token")
    expect(sent[0].body).toEqual({ recipient: { id: reply.to }, message: { text: reply.body } })
  })

  it("sends an Instagram-Login channel's reply through graph.instagram.com", async () => {
    mocks.findConfig.mockResolvedValue({ apiKey: "ig-login-token", settings: { igLogin: true } })

    const result = await sendConversationReply(reply)

    expect(result.success).toBe(true)
    expect(sent).toHaveLength(1)
    expect(sent[0].url).toBe("https://graph.instagram.com/v21.0/me/messages?access_token=ig-login-token")
    expect(sent[0].auth).toBeNull()
  })

  it("keeps Meta's message id, so the echo of this reply is not stored as a second answer", async () => {
    mocks.findConfig.mockResolvedValue({ apiKey: "ig-login-token", settings: { igLogin: true } })

    await sendConversationReply(reply)

    expect(recorded()).toMatchObject({ externalId: "mid.1", status: "delivered" })
    expect(recorded().metadata.metaMessageIds).toEqual(["mid.1"])
  })

  it("records a failed outbound row and reports failure when Meta refuses", async () => {
    mocks.findConfig.mockResolvedValue({ apiKey: "page-token", settings: {} })
    answers = [{ status: 400, body: { error: { message: "(#10) outside the allowed window" } } }]

    const result = await sendConversationReply(reply)

    expect(result.success).toBe(false)
    expect(recorded()).toMatchObject({ status: "failed", channelType: "instagram", to: reply.to })
    expect(mocks.updateConversation).not.toHaveBeenCalled()
  })
})

describe("sendConversationReply — a file to an Instagram customer", () => {
  const photo = {
    url: `/uploads/inbox/${ORG}/0123456789abcdef.jpg`,
    buffer: Buffer.from("jpeg"),
    mime: "image/jpeg",
    filename: "0123456789abcdef.jpg",
  }

  beforeEach(() => {
    mocks.findConfig.mockResolvedValue({ apiKey: "ig-login-token", settings: { igLogin: true } })
    answers = [
      { status: 200, body: { message_id: "mid.file" } },
      { status: 200, body: { message_id: "mid.caption" } },
    ]
  })

  it("sends the picture as an image Meta can fetch, then the text as its own message", async () => {
    const result = await sendConversationReply({ ...reply, body: "Budur", attachment: photo })

    expect(result.success).toBe(true)
    expect(sent).toHaveLength(2)
    const attachment = sent[0].body.message.attachment as { type: string; payload: { url: string } }
    expect(attachment.type).toBe("image")
    expect(attachment.payload.url).toMatch(/^https:\/\/[^/]+\/api\/v1\/public\/inbox-media\/[^/]+\/0123456789abcdef\.jpg$/)
    expect(sent[1].body.message).toEqual({ text: "Budur" })
    expect(recorded()).toMatchObject({
      status: "delivered", mediaUrl: photo.url, messageType: "image", externalId: "mid.file",
    })
    // Both ids: Meta echoes the file and the caption separately, and neither may become a new row.
    expect(recorded().metadata.metaMessageIds).toEqual(["mid.file", "mid.caption"])
  })

  it("sends a picture alone when there is no text", async () => {
    const result = await sendConversationReply({ ...reply, body: "", attachment: photo })

    expect(result.success).toBe(true)
    expect(sent).toHaveLength(1)
    expect(sent[0].body.message).toHaveProperty("attachment")
  })

  it("names video, audio and PDF the way Meta expects", async () => {
    for (const [mime, type] of [["video/mp4", "video"], ["audio/mp4", "audio"], ["application/pdf", "file"]] as const) {
      sent = []
      await sendConversationReply({ ...reply, body: "", attachment: { ...photo, mime } })
      expect((sent[0].body.message.attachment as { type: string }).type).toBe(type)
    }
  })

  it("refuses an office document in words, without calling Meta or recording a message", async () => {
    const result = await sendConversationReply({
      ...reply, body: "", attachment: { ...photo, mime: "application/vnd.ms-excel" },
    })

    expect(result).toMatchObject({ success: false, statusCode: 400 })
    expect(sent).toHaveLength(0)
    expect(mocks.createMessage).not.toHaveBeenCalled()
  })

  it("does not send the text when Meta refused the file", async () => {
    answers = [{ status: 400, body: { error: { message: "Invalid image" } } }]

    const result = await sendConversationReply({ ...reply, body: "Budur", attachment: photo })

    expect(result.success).toBe(false)
    expect(sent).toHaveLength(1)
    expect(recorded()).toMatchObject({ status: "failed" })
  })
})
