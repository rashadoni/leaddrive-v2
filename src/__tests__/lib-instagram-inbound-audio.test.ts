import { beforeEach, describe, expect, it, vi } from "vitest"

const deps = vi.hoisted(() => ({
  transcribe: vi.fn(),
  resolveTranscriptionClient: vi.fn(),
  updateMany: vi.fn(),
}))

vi.mock("@/lib/transcription/transcribe", () => ({
  resolveTranscriptionClient: deps.resolveTranscriptionClient,
}))
vi.mock("@/lib/prisma", () => ({
  prisma: { channelMessage: { updateMany: deps.updateMany } },
}))

import {
  handleInstagramInboundAudio,
  INSTAGRAM_AUDIO_TEXT_FALLBACK,
  parseInstagramAttachment,
} from "@/lib/social/instagram-inbound-audio"

const { transcribe, resolveTranscriptionClient, updateMany } = deps

beforeEach(() => {
  vi.clearAllMocks()
  updateMany.mockResolvedValue({ count: 1 })
  resolveTranscriptionClient.mockReturnValue({ transcribe })
  transcribe.mockResolvedValue({
    transcript: "Qiyməti bilmək istəyirəm",
    provider: "openai-whisper",
    language: "az",
    durationSeconds: 4,
  })
})

describe("Instagram inbound audio", () => {
  it("recognizes Meta voice/audio attachments instead of storing them as images", () => {
    expect(parseInstagramAttachment([
      { type: "audio", payload: { url: "https://lookaside.instagram.com/voice?id=1" } },
    ])).toEqual({
      mediaUrl: "https://lookaside.instagram.com/voice?id=1",
      messageType: "audio",
    })
  })

  it("uses a signed URL extension when older Meta payloads omit attachment.type", () => {
    expect(parseInstagramAttachment([
      { payload: { url: "https://cdn.example/customer-message.ogg?sig=abc" } },
    ])).toEqual({
      mediaUrl: "https://cdn.example/customer-message.ogg?sig=abc",
      messageType: "audio",
    })
  })

  it("stores the transcript and hands it to the normal reply pipeline", async () => {
    const onTranscript = vi.fn().mockResolvedValue(undefined)
    const sendFallback = vi.fn().mockResolvedValue(true)

    await expect(handleInstagramInboundAudio({
      organizationId: "org1",
      messageId: "msg1",
      audioUrl: "https://cdn.example/voice.ogg",
      metadata: { platform: "instagram" },
      onTranscript,
      sendFallback,
    })).resolves.toBe("transcribed")

    expect(transcribe).toHaveBeenCalledWith(expect.objectContaining({
      audioUrl: "https://cdn.example/voice.ogg",
    }))
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "msg1", organizationId: "org1" },
      data: {
        body: "[Səsli mesaj]\nQiyməti bilmək istəyirəm",
        metadata: {
          platform: "instagram",
          transcription: {
            text: "Qiyməti bilmək istəyirəm",
            provider: "openai-whisper",
            language: "az",
            durationSeconds: 4,
          },
        },
      },
    })
    expect(onTranscript).toHaveBeenCalledWith("Qiyməti bilmək istəyirəm")
    expect(sendFallback).not.toHaveBeenCalled()
  })

  it("asks for text when transcription is unavailable", async () => {
    resolveTranscriptionClient.mockReturnValue(null)
    const sendFallback = vi.fn().mockResolvedValue(true)

    await expect(handleInstagramInboundAudio({
      organizationId: "org1",
      messageId: "msg1",
      audioUrl: "https://cdn.example/voice.ogg",
      metadata: { platform: "instagram" },
      onTranscript: vi.fn(),
      sendFallback,
    })).resolves.toBe("fallback")

    expect(sendFallback).toHaveBeenCalledWith(INSTAGRAM_AUDIO_TEXT_FALLBACK)
    expect(updateMany).not.toHaveBeenCalled()
  })

  it("does not ask for text when transcription succeeded but the reply pipeline failed", async () => {
    const sendFallback = vi.fn().mockResolvedValue(true)

    await expect(handleInstagramInboundAudio({
      organizationId: "org1",
      messageId: "msg1",
      audioUrl: "https://cdn.example/voice.ogg",
      metadata: { platform: "instagram" },
      onTranscript: vi.fn().mockRejectedValue(new Error("AI unavailable")),
      sendFallback,
    })).rejects.toThrow("AI unavailable")

    expect(sendFallback).not.toHaveBeenCalled()
  })
})
