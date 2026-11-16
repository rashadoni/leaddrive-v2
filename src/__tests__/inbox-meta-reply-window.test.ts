import { readFileSync } from "node:fs"
import path from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

// Zeytun 2026-11-16: operators answered Instagram customers 24–35 hours after they wrote (a
// weekend), Meta refused each reply with code 10 / 2534022, and the composer printed Meta's own
// Russian «Сообщение отправлено за пределами допустимого окна» on an Azerbaijani screen — ten tries
// in nine minutes. Meta lets a PERSON answer for 7 days with the HUMAN_AGENT tag (once the app's
// «Human Agent» feature is approved); a robot never.
//
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
import { META_OUTSIDE_WINDOW, hoursSinceCustomerWrote, metaWindowNotice } from "@/lib/inbox/meta-reply-window"

const ORG = "org-zeytun"
const operator = { authorType: "operator", authorUserId: "user-narmin", authorName: "Narmin" }
const reply = {
  organizationId: ORG,
  channel: "instagram" as const,
  to: "1318586653085202",
  body: "Salam, Hörmətli müştəri",
  conversationId: "conv-1",
  channelConfigId: "cfg-ig",
  extraMetadata: operator,
}

/** What production logged at 06:52 UTC, the message in the token owner's language. */
const OUTSIDE_WINDOW = {
  status: 403,
  body: {
    error: {
      message: "Сообщение отправлено за пределами допустимого окна.",
      type: "IGApiException",
      code: 10,
      error_subcode: 2534022,
      fbtrace_id: "AbCdEf",
    },
  },
}
const OK = (id: string) => ({ status: 200, body: { recipient_id: reply.to, message_id: id } })

type Sent = { url: string; body: Record<string, unknown> & { message: Record<string, unknown> } }
let sent: Sent[] = []
/** What Meta answers to each call, in order; the last one repeats. */
let answers: Array<{ status: number; body: unknown }> = []

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXTAUTH_SECRET = "test-secret-test-secret-test-secret"
  sent = []
  answers = [OK("mid.1")]
  mocks.findConfig.mockResolvedValue({ apiKey: "ig-login-token", settings: { igLogin: true } })
  mocks.createMessage.mockImplementation(async ({ data }: { data: { status: string } }) => ({ id: "msg-1", status: data.status }))
  mocks.updateConversation.mockResolvedValue({ count: 1 })
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: { body: string }) => {
    sent.push({ url: String(url), body: JSON.parse(init.body) })
    const answer = answers[Math.min(sent.length - 1, answers.length - 1)]
    return new Response(JSON.stringify(answer.body), { status: answer.status })
  }))
})

const recorded = () => mocks.createMessage.mock.calls[0][0].data
const tagged = (s: Sent) => s.body.messaging_type === "MESSAGE_TAG" && s.body.tag === "HUMAN_AGENT"

describe("a reply inside the 24 hours", () => {
  it("goes as before: one call, no tag", async () => {
    const result = await sendConversationReply(reply)

    expect(result.success).toBe(true)
    expect(sent).toHaveLength(1)
    expect(sent[0].body).toEqual({ recipient: { id: reply.to }, message: { text: reply.body } })
  })
})

describe("a person's reply after the window has closed", () => {
  it("goes once more with the HUMAN_AGENT tag, and is kept as sent when Meta takes it", async () => {
    answers = [OUTSIDE_WINDOW, OK("mid.tagged")]

    const result = await sendConversationReply(reply)

    expect(result.success).toBe(true)
    expect(sent).toHaveLength(2)
    expect(tagged(sent[0])).toBe(false)
    expect(sent[1].body).toEqual({
      recipient: { id: reply.to },
      message: { text: reply.body },
      messaging_type: "MESSAGE_TAG",
      tag: "HUMAN_AGENT",
    })
    expect(recorded()).toMatchObject({ status: "delivered", externalId: "mid.tagged" })
  })

  it("answers with a code, not Meta's words, when the tagged send is refused too", async () => {
    // Before Meta approves «Human Agent» it refuses the tagged send as well.
    answers = [OUTSIDE_WINDOW, { status: 400, body: { error: { message: "(#3) Application does not have the capability", code: 3 } } }]

    const result = await sendConversationReply(reply)

    expect(result).toMatchObject({ success: false, error: META_OUTSIDE_WINDOW })
    expect(recorded().status).toBe("failed")
    expect(recorded().metadata.error).toBe("instagram send failed: outside the customer's messaging window (Meta code 10)")
    expect(JSON.stringify(recorded())).not.toMatch(/допустимого/)
    expect(mocks.updateConversation).not.toHaveBeenCalled()
  })

  it("does the same for a file", async () => {
    answers = [OUTSIDE_WINDOW, OK("mid.file"), OK("mid.caption")]
    const photo = { url: `/uploads/inbox/${ORG}/0123456789abcdef.jpg`, buffer: Buffer.from("jpeg"), mime: "image/jpeg", filename: "0123456789abcdef.jpg" }

    const result = await sendConversationReply({ ...reply, body: "Budur", attachment: photo })

    expect(result.success).toBe(true)
    expect(sent).toHaveLength(3)
    expect(sent[0].body.message.attachment).toBeTruthy()
    expect(tagged(sent[0])).toBe(false)
    expect(sent[1].body.message.attachment).toBeTruthy()
    expect(tagged(sent[1])).toBe(true)
    // The caption follows as its own message, by the same rule.
    expect(sent[2].body.message).toEqual({ text: "Budur" })
  })

  it("works on Messenger, where Meta's subcode differs", async () => {
    mocks.findConfig.mockResolvedValue({ apiKey: "page-token", settings: {} })
    answers = [{ status: 400, body: { error: { message: "(#10) This message is sent outside of allowed window.", code: 10, error_subcode: 2018278 } } }, OK("m_tagged")]

    const result = await sendConversationReply({ ...reply, channel: "facebook", channelConfigId: "cfg-fb" })

    expect(result.success).toBe(true)
    expect(tagged(sent[1])).toBe(true)
  })
})

describe("never a tag on what a person did not write", () => {
  it("an AI auto-reply is refused once and not repeated", async () => {
    answers = [OUTSIDE_WINDOW]

    const result = await sendConversationReply({ ...reply, extraMetadata: { aiAutoReply: true, autoReply: true } })

    expect(result).toMatchObject({ success: false, error: META_OUTSIDE_WINDOW })
    expect(sent).toHaveLength(1)
    expect(tagged(sent[0])).toBe(false)
  })

  it("an automation's send with no author is not repeated", async () => {
    answers = [OUTSIDE_WINDOW]

    await sendConversationReply({ ...reply, extraMetadata: undefined })

    expect(sent).toHaveLength(1)
  })

  it("an operator-labelled send that the AI wrote is not repeated", async () => {
    answers = [OUTSIDE_WINDOW]

    await sendConversationReply({ ...reply, extraMetadata: { ...operator, aiGenerated: true } })

    expect(sent).toHaveLength(1)
  })
})

describe("other refusals are not the window", () => {
  it("a bad token is not retried and keeps Meta's reason", async () => {
    answers = [{ status: 400, body: { error: { message: "Invalid OAuth access token", code: 190 } } }]

    const result = await sendConversationReply(reply)

    expect(sent).toHaveLength(1)
    expect(result.success).toBe(false)
    expect(result.success === false && result.error).toBe("instagram send failed: Invalid OAuth access token")
  })

  it("code 10 with another subcode is not the window", async () => {
    answers = [{ status: 400, body: { error: { message: "(#10) Permission denied", code: 10, error_subcode: 1234 } } }]

    await sendConversationReply(reply)

    expect(sent).toHaveLength(1)
  })
})

describe("what the composer says", () => {
  const now = Date.parse("2026-11-16T06:03:00Z")
  const thread = [
    { direction: "inbound", channelType: "instagram", createdAt: "2026-11-14T18:36:00Z" },
    { direction: "inbound", channelType: "instagram", createdAt: "2026-11-14T18:37:00Z" },
    { direction: "outbound", channelType: "instagram", createdAt: "2026-11-16T06:00:00Z" },
    { direction: "inbound", channelType: "whatsapp", createdAt: "2026-11-16T05:00:00Z" },
  ]

  it("counts from the customer's last message on that channel", () => {
    expect(hoursSinceCustomerWrote(thread, "instagram", now)).toBe(35)
    expect(hoursSinceCustomerWrote(thread, "facebook", now)).toBeNull()
  })

  it("names the hours, the app and what to do", () => {
    expect(metaWindowNotice(thread, "instagram", now)).toEqual({ key: "sendMetaWindowClosedHours", values: { app: "Instagram", hours: 35 } })
    expect(metaWindowNotice(thread, "facebook", now)).toEqual({ key: "sendMetaWindowClosed", values: { app: "Messenger" } })
  })

  it("speaks in days past the week a person's reply could have had", () => {
    const old = [{ direction: "inbound", channelType: "instagram", createdAt: "2026-11-01T06:03:00Z" }]
    expect(metaWindowNotice(old, "instagram", now)).toEqual({ key: "sendMetaWindowClosedDays", values: { app: "Instagram", days: 15 } })
  })

  it("has the words in every language, with the values it passes", () => {
    for (const locale of ["en", "ru", "az"]) {
      const ns = JSON.parse(readFileSync(path.join(process.cwd(), `messages/${locale}.json`), "utf8")).inboxV2 as Record<string, string>
      expect(ns.sendMetaWindowClosed, locale).toContain("{app}")
      expect(ns.sendMetaWindowClosedHours, locale).toContain("{hours}")
      expect(ns.sendMetaWindowClosedDays, locale).toContain("{days}")
    }
  })

  it("is what the inbox composer shows for the code", () => {
    const page = readFileSync(path.join(process.cwd(), "src/app/(dashboard)/inbox/page.tsx"), "utf8")
    expect(page).toMatch(/code === META_OUTSIDE_WINDOW \? metaWindowNotice\(convo\.messages, replyChannel\)/)
  })
})
