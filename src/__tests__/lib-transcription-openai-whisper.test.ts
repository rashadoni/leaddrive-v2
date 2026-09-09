import { afterEach, describe, expect, it, vi } from "vitest"
import { createOpenAIWhisperClient } from "@/lib/transcription/providers/openai-whisper"
import type {
  OutboundWebhookResolver,
  OutboundWebhookTransport,
} from "@/lib/integrations/webhook-url-guard"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("OpenAI Whisper transcription provider", () => {
  it("downloads public audio, uploads it as multipart, and maps the transcript", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        text: "LeadDrive is discussed in this clip",
        language: "en",
        duration: 12.5,
      }), { status: 200, headers: { "content-type": "application/json" } }))
    vi.stubGlobal("fetch", fetchMock)
    const audioTransport = vi.fn<OutboundWebhookTransport>().mockResolvedValue({
      status: 200,
      headers: { "content-type": "audio/mpeg", "content-length": "3" },
      bodyBytes: new Uint8Array([1, 2, 3]),
    })
    const client = createOpenAIWhisperClient({
      apiKey: "test-key",
      timeoutMs: 5_000,
      resolveHost: async () => [{ address: "8.8.8.8", family: 4 }],
      audioTransport,
    })

    await expect(client.transcribe({ audioUrl: "https://cdn.example/clip.mp3", language: "en" })).resolves.toEqual({
      transcript: "LeadDrive is discussed in this clip",
      language: "en",
      durationSeconds: 12.5,
      provider: "openai-whisper",
    })
    expect(audioTransport).toHaveBeenCalledTimes(1)
    expect(audioTransport.mock.calls[0][0]).toMatchObject({
      addresses: [{ address: "8.8.8.8", family: 4 }],
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const upload = fetchMock.mock.calls[0]
    expect(upload[0]).toBe("https://api.openai.com/v1/audio/transcriptions")
    expect(upload[1]).toMatchObject({ method: "POST", headers: { Authorization: "Bearer test-key" } })
    expect(upload[1]?.body).toBeInstanceOf(FormData)
  })

  it("rejects private audio URLs before downloading or billing", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const client = createOpenAIWhisperClient({ apiKey: "test-key" })

    await expect(client.transcribe({ audioUrl: "http://169.254.169.254/latest/audio.mp3" })).rejects.toThrow("invalid audioUrl")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("rejects a public-looking hostname when DNS resolves to a private address", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const client = createOpenAIWhisperClient({
      apiKey: "test-key",
      resolveHost: async () => [{ address: "10.0.0.8", family: 4 }],
    })

    await expect(client.transcribe({ audioUrl: "https://cdn.example/video.mp4" })).rejects.toThrow(/private.*reserved/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("revalidates redirects and rejects an audio hop that resolves privately", async () => {
    const resolver = vi.fn<OutboundWebhookResolver>(async hostname => {
      if (hostname === "cdn.example") {
        return [{ address: "8.8.8.8", family: 4 }]
      }
      if (hostname === "metadata.attacker.example") {
        return [{ address: "169.254.169.254", family: 4 }]
      }
      return []
    })
    const audioTransport = vi.fn<OutboundWebhookTransport>().mockResolvedValueOnce({
      status: 302,
      location: "https://metadata.attacker.example/latest/meta-data",
    })
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const client = createOpenAIWhisperClient({
      apiKey: "test-key",
      resolveHost: resolver,
      audioTransport,
    })

    await expect(client.transcribe({
      audioUrl: "https://cdn.example/audio.mp3",
    })).rejects.toThrow(/private|reserved/i)

    expect(audioTransport).toHaveBeenCalledTimes(1)
    expect(resolver).toHaveBeenCalledWith("cdn.example")
    expect(resolver).toHaveBeenCalledWith("metadata.attacker.example")
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
