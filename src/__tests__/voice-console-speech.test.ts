import { describe, expect, it, vi } from "vitest"
import {
  CONSOLE_SPEECH_MODEL,
  CONSOLE_SPEECH_VOICE,
  consoleSpeechChunks,
  consoleSpeechConfig,
  consoleSpeechRequest,
  consoleSpeechStyle,
} from "@/lib/ai/voice/console-speech"
import { ZEYTUN_INBOUND_SPEECH } from "@/lib/voice-agent/pharmacy/zeytun-inbound-pilot"
import { geminiLiveConfig } from "@/lib/ai/voice/gemini-live"
import { lastSentenceEnd, pcm16BytesToFloat32, SpeechRelay } from "@/lib/ai/voice/speech-relay"

/**
 * Владелец 2026-11-09: «точь-в-точь ставь голос, какой на звонке» — у
 * собственного голоса Live «провинциальный акцент». Помощник озвучивает ответы
 * той же моделью и тем же голосом, что телефонная линия.
 */

const CONFIG = { project: "leaddrive-voice", key: "k".repeat(39) }

describe("console speech: the phone line's voice", () => {
  it("uses exactly the line's model and voice", () => {
    expect(CONSOLE_SPEECH_MODEL).toBe(ZEYTUN_INBOUND_SPEECH.model)
    expect(CONSOLE_SPEECH_VOICE).toBe(ZEYTUN_INBOUND_SPEECH.voice)
    const { url, body } = consoleSpeechRequest(CONFIG, "Salam", "warm")
    expect(url).toBe("https://aiplatform.googleapis.com/v1/projects/leaddrive-voice/locations/global/publishers/google/models/gemini-3.8-flash-tts:streamGenerateContent?alt=sse")
    // Ключ — только в заголовке, никогда в адресе.
    expect(url).not.toContain(CONFIG.key)
    expect(body).toEqual({
      contents: [{ role: "user", parts: [{ text: "Salam", speechMetadata: { style: "warm" } }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Sulafat" } } },
      },
    })
  })

  it("carries the line's manner and names the language of the phrase", () => {
    const manner = "warm and smiling, natural unhurried pace with small natural pauses"
    expect(ZEYTUN_INBOUND_SPEECH.style).toContain(manner)
    expect(consoleSpeechStyle("Bu gün üç sövdələşmə var.", "ru")).toMatch(/^always Azerbaijani as spoken in Baku/)
    // Азербайджанский без своих букв звучал по-английски (линия, 2026-11-03).
    expect(consoleSpeechStyle("Ketonal geli 10 qutu.", "az")).toMatch(/^always Azerbaijani/)
    expect(consoleSpeechStyle("Сегодня три сделки.", "az")).toMatch(/^always Russian/)
    expect(consoleSpeechStyle("Three deals today.", "en")).toMatch(/^always English/)
    expect(consoleSpeechStyle("Three deals today.", "en")).toContain(manner)
  })

  it("is off without a Vertex key — never the Gemini API key with its 100 a day", () => {
    expect(consoleSpeechConfig({})).toBeNull()
    expect(consoleSpeechConfig({ GEMINI_API_KEY: "g".repeat(39) })).toBeNull()
    expect(consoleSpeechConfig({ VOICE_TTS_VERTEX_PROJECT: "leaddrive-voice", VOICE_TTS_VERTEX_KEY: "short" })).toBeNull()
    expect(consoleSpeechConfig({ VOICE_TTS_VERTEX_PROJECT: "Bad Project", VOICE_TTS_VERTEX_KEY: CONFIG.key })).toBeNull()
    expect(consoleSpeechConfig({ VOICE_TTS_VERTEX_PROJECT: "leaddrive-voice", VOICE_TTS_VERTEX_KEY: CONFIG.key })).toEqual(CONFIG)
  })

  it("reads the audio out of a streamed event", () => {
    const pcm = Buffer.from([1, 0, 2, 0])
    expect(consoleSpeechChunks({ candidates: [{ content: { parts: [{ inlineData: { data: pcm.toString("base64") } }] } }] }))
      .toEqual([pcm])
    expect(consoleSpeechChunks({ usageMetadata: {} })).toEqual([])
  })

  it("asks Live for the text of its own answers only when the line's voice speaks them", () => {
    const base = { locale: "az", firstName: "Rəşad", allowedSections: ["leads"] }
    expect(geminiLiveConfig(base)).not.toHaveProperty("outputAudioTranscription")
    expect(geminiLiveConfig({ ...base, speechRelay: true }).outputAudioTranscription).toEqual({})
  })
})

function audioResponse(chunks: number[][]): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk))
      controller.close()
    },
  }), { status: 200 })
}

async function settle() {
  for (let turn = 0; turn < 20; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

describe("speech relay in the tab", () => {
  it("cuts the answer into phrases only after the end mark is followed by a space", () => {
    expect(lastSentenceEnd("Bu gün üç sövdələşmə var. İkinci")).toBe(25)
    // «3.» may still become «3.5».
    expect(lastSentenceEnd("Məbləğ 3.")).toBe(-1)
    expect(lastSentenceEnd("Hazırdır! Nə edək? ")).toBe(18)
  })

  it("turns little-endian PCM16 into samples", () => {
    expect([...pcm16BytesToFloat32(new Uint8Array([0, 0x40, 0, 0xc0]))]).toEqual([0.5, -0.5])
  })

  it("speaks the phrases in order, asking for the next while one plays", async () => {
    const played: number[] = []
    const asked: string[] = []
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const text = JSON.parse(String(init?.body)).text as string
      asked.push(text)
      return audioResponse(text.startsWith("Bir") ? [[0, 0x40], [0, 0x40]] : [[0, 0xc0]])
    })
    const onAudio = vi.fn()
    const relay = new SpeechRelay({
      voiceSessionId: "voice-1",
      play: (samples) => played.push(...samples),
      onAudio,
      onFallback: vi.fn(),
      fetch: fetchMock as unknown as typeof fetch,
    })
    relay.addText("Birinci cümlə. ")
    relay.addText("İkinci")
    relay.endTurn()
    await settle()
    expect(asked).toEqual(["Birinci cümlə.", "İkinci"])
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ voiceSessionId: "voice-1", text: "Birinci cümlə." })
    expect(played).toEqual([0.5, 0.5, -0.5])
    expect(onAudio).toHaveBeenCalledTimes(2)
  })

  it("falls back to the model's own voice when the line's voice does not answer", async () => {
    const onFallback = vi.fn()
    const relay = new SpeechRelay({
      voiceSessionId: "voice-1",
      play: vi.fn(),
      onFallback,
      fetch: vi.fn(async () => new Response("{}", { status: 502 })) as unknown as typeof fetch,
    })
    relay.addText("Salam. ")
    await settle()
    expect(onFallback).toHaveBeenCalledWith(false)
    // The rest of this turn is the model's own voice; the next turn tries again.
    expect(relay.speaking).toBe(false)
    relay.endTurn()
    expect(relay.speaking).toBe(true)
  })

  it("gives up for the conversation after three failures in a row", async () => {
    const relay = new SpeechRelay({
      voiceSessionId: "voice-1",
      play: vi.fn(),
      onFallback: vi.fn(),
      fetch: vi.fn(async () => new Response("{}", { status: 502 })) as unknown as typeof fetch,
    })
    for (let turn = 0; turn < 3; turn += 1) {
      relay.addText("Salam. ")
      await settle()
      relay.endTurn()
    }
    expect(relay.speaking).toBe(false)
  })

  it("drops what has not been spoken when the user interrupts", async () => {
    const played: number[] = []
    const aborted: boolean[] = []
    let release: () => void = () => {}
    const relay = new SpeechRelay({
      voiceSessionId: "voice-1",
      play: (samples) => played.push(...samples),
      onFallback: vi.fn(),
      fetch: vi.fn(async (_url: string, init?: RequestInit) => {
        init?.signal?.addEventListener("abort", () => aborted.push(true))
        await new Promise<void>((resolve) => { release = resolve })
        return audioResponse([[0, 0x40]])
      }) as unknown as typeof fetch,
    })
    relay.addText("Uzun cavab. ")
    relay.interrupt()
    release()
    await settle()
    expect(aborted).toEqual([true])
    expect(played).toEqual([])
  })
})
