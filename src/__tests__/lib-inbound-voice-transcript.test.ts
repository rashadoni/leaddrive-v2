/**
 * The one transcription every messenger uses for a customer's voice note
 * (lib/inbox/inbound-voice-transcript): words when it can, nothing — and never an error — when it
 * cannot, so a voice message is never lost or delayed past the platform's webhook deadline.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { transcribe, client } = vi.hoisted(() => ({ transcribe: vi.fn(), client: { available: true } }))
vi.mock("@/lib/transcription/transcribe", () => ({
  resolveTranscriptionClient: vi.fn(async () => (client.available ? { transcribe } : null)),
}))
vi.mock("@/lib/prisma", () => ({ prisma: { channelMessage: { updateMany: vi.fn(async () => ({ count: 1 })) } } }))

import { transcribeInboundVoice, voiceMessageBody } from "@/lib/inbox/inbound-voice-transcript"
import { createOpenAIWhisperClient } from "@/lib/transcription/providers/openai-whisper"
import { isAudioPreview } from "@/lib/media-preview"

const BYTES = new Uint8Array([79, 103, 103, 83])

beforeEach(() => {
  vi.clearAllMocks()
  client.available = true
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("transcribeInboundVoice", () => {
  it("returns the words, trimmed, with who transcribed them and how long the audio was", async () => {
    transcribe.mockResolvedValue({ transcript: "  Salam  ", provider: "openai-whisper", language: "az", durationSeconds: 2 })
    expect(await transcribeInboundVoice({ organizationId: "o", source: "WhatsApp", audio: { bytes: BYTES } }))
      .toEqual({ text: "Salam", provider: "openai-whisper", language: "az", durationSeconds: 2 })
  })

  it("nothing when the organization has no transcription (no key, limit spent)", async () => {
    client.available = false
    expect(await transcribeInboundVoice({ organizationId: "o", source: "WhatsApp", audio: { bytes: BYTES } })).toBeNull()
  })

  it("nothing, not an error, when the provider fails or hears nothing", async () => {
    transcribe.mockRejectedValueOnce(new Error("HTTP 500"))
    expect(await transcribeInboundVoice({ organizationId: "o", source: "Telegram", audioUrl: "https://x/v.oga" })).toBeNull()
    transcribe.mockResolvedValueOnce({ transcript: "   ", provider: "openai-whisper" })
    expect(await transcribeInboundVoice({ organizationId: "o", source: "Telegram", audioUrl: "https://x/v.oga" })).toBeNull()
  })

  it("stops waiting so the platform's webhook is still answered in time", async () => {
    transcribe.mockImplementation(() => new Promise(() => {}))
    const started = Date.now()
    expect(await transcribeInboundVoice({ organizationId: "o", source: "Facebook", audioUrl: "https://x/v.mp4", waitMs: 50 })).toBeNull()
    expect(Date.now() - started).toBeLessThan(1_000)
  })

  it("writes «[Səsli mesaj]» and the words as the body", () => {
    expect(voiceMessageBody("Salam")).toBe("[Səsli mesaj]\nSalam")
  })
})

describe("Whisper with the audio already in hand", () => {
  it("uploads the bytes it was given and downloads nothing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: "Salam", language: "az", duration: 1 }), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)
    const audioTransport = vi.fn()
    const whisper = createOpenAIWhisperClient({ apiKey: "k", audioTransport })

    await expect(whisper.transcribe({ audioUrl: "", audio: { bytes: BYTES, contentType: "audio/ogg; codecs=opus" } }))
      .resolves.toMatchObject({ transcript: "Salam" })
    expect(audioTransport).not.toHaveBeenCalled()
    const form = fetchMock.mock.calls[0][1].body as FormData
    const file = form.get("file") as File
    expect(file.name).toBe("audio.ogg")
    expect(file.size).toBe(BYTES.byteLength)
  })

  it("refuses empty audio before paying for it", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    await expect(createOpenAIWhisperClient({ apiKey: "k" }).transcribe({ audioUrl: "", audio: { bytes: new Uint8Array() } }))
      .rejects.toThrow("empty audio")
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("the inbox plays a voice note instead of linking it", () => {
  it.each([
    ["audio", "/uploads/whatsapp/o/a.ogg", true],
    ["voice", "/uploads/whatsapp/o/a.bin", true],
    [undefined, "/uploads/telegram/o/v.oga", true],
    ["document", "/uploads/x/report.pdf", false],
    ["image", "/uploads/x/p.jpg", false],
    ["video", "/uploads/x/clip.ogg", false],
  ])("%s %s → %s", (type, url, plays) => {
    expect(isAudioPreview(type, url)).toBe(plays)
  })
})
