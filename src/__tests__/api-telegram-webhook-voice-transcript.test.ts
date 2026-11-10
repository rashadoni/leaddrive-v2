import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

/**
 * A Telegram voice note arrives as words (owner, 2026-11-10). Before, the AI on a Telegram bot was
 * handed the placeholder «[Голосовое сообщение]» as if the customer had typed it; now the downloaded
 * voice is transcribed before the message is saved, and the body the manager reads — and the AI
 * gets — is «[Səsli mesaj]» and what was said.
 */
const { aiSpy, created, media, transcribe, client } = vi.hoisted(() => ({
  aiSpy: vi.fn(async (..._a: unknown[]) => ({ replied: true, escalated: false })),
  created: [] as Array<Record<string, unknown>>,
  media: vi.fn(),
  transcribe: vi.fn(),
  client: { available: true },
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelConfig: { findFirst: vi.fn(async () => ({ id: "cfg_tg", organizationId: "org_1", botToken: "BOT", settings: { replyMode: "ai" } })) },
    channelMessage: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { created.push(data); return { id: "msg_1", ...data } }),
      update: vi.fn(async () => ({})),
    },
    contact: { updateMany: vi.fn(async () => ({})) },
  },
}))
vi.mock("@/lib/sanitize", () => ({ sanitizeLog: (s: string) => s }))
vi.mock("@/lib/social/notify-recipients", () => ({ notifyConversationRecipients: vi.fn(async () => {}) }))
vi.mock("@/lib/telegram-media", () => ({ fetchAndStoreTelegramMedia: media }))
vi.mock("@/lib/inbound-lead-match", () => ({ matchInboundLeadId: vi.fn(async () => undefined) }))
vi.mock("@/lib/rls-context", () => ({
  runWithTenant: (_o: string, fn: () => unknown) => fn(),
  runWithRlsBypass: (fn: () => unknown) => fn(),
}))
vi.mock("@/lib/facebook", () => ({ upsertSocialConversation: vi.fn(async () => ({ id: "conv_tg", assignedTo: null })) }))
vi.mock("@/lib/inbox/conversation-events", () => ({ emitConversationIngestEvents: vi.fn(async () => ({})) }))
vi.mock("@/lib/chatbot-autoreply", () => ({
  maybeAutoReply: vi.fn(async () => ({ matched: false })),
  chatbotTookOwnership: () => false,
  sendChannelReply: vi.fn(async () => ({ ok: true })),
}))
vi.mock("@/lib/social/ai-autoreply", () => ({ maybeAiAutoReply: aiSpy }))
vi.mock("@/lib/transcription/transcribe", () => ({
  resolveTranscriptionClient: vi.fn(async () => (client.available ? { transcribe } : null)),
}))

const VOICE = Buffer.from("OggS-telegram-voice")

function voiceReq(extra: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/api/v1/webhooks/telegram?token=BOT", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: { message_id: 7, chat: { id: 999 }, from: { id: 1, first_name: "Ali" }, voice: { file_id: "voice_1", duration: 3 }, ...extra } }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  created.length = 0
  client.available = true
  media.mockResolvedValue({ url: "/uploads/telegram/org_1/v.oga", mime: "audio/ogg", bytes: VOICE })
  transcribe.mockResolvedValue({ transcript: "Qiymət nə qədərdir?", provider: "openai-whisper", language: "az", durationSeconds: 3 })
})

describe("a Telegram voice note", () => {
  it("is saved with the words, from the file already downloaded", async () => {
    const { POST } = await import("../app/api/v1/webhooks/telegram/route")
    await POST(voiceReq())
    expect(created[0]).toMatchObject({ body: "[Səsli mesaj]\nQiymət nə qədərdir?", mediaUrl: "/uploads/telegram/org_1/v.oga" })
    expect((created[0].metadata as Record<string, unknown>).transcription).toMatchObject({ text: "Qiymət nə qədərdir?" })
    expect(transcribe.mock.calls[0][0]).toMatchObject({ audio: { bytes: VOICE, contentType: "audio/ogg" } })
  })

  it("reaches the AI as words, not as the placeholder", async () => {
    const { POST } = await import("../app/api/v1/webhooks/telegram/route")
    await POST(voiceReq())
    expect(aiSpy).toHaveBeenCalledWith(expect.objectContaining({ userMessage: "[Səsli mesaj]\nQiymət nə qədərdir?" }))
  })

  it("keeps the placeholder when transcription is not available", async () => {
    client.available = false
    const { POST } = await import("../app/api/v1/webhooks/telegram/route")
    await POST(voiceReq())
    expect(created[0].body).toBe("[Голосовое сообщение]")
  })

  it("leaves a caption the customer typed as it is", async () => {
    const { POST } = await import("../app/api/v1/webhooks/telegram/route")
    await POST(voiceReq({ caption: "zəng edin" }))
    expect(transcribe).not.toHaveBeenCalled()
    expect(created[0].body).toBe("zəng edin")
  })
})
