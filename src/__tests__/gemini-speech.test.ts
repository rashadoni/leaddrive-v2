import { describe, expect, it } from "vitest"

import { geminiTtsPcm, geminiTtsRequest } from "../../scripts/lib/gemini-tts.mjs"
import {
  GEMINI_SPEECH_SAMPLE_RATE,
  GEMINI_TRANSCRIBE_MODEL,
  geminiApiKey,
  geminiSpeechPcm,
  geminiSpeechRequest,
  geminiTranscribeRequest,
  geminiTranscript,
  pcm16Wav,
  readWav,
} from "@/lib/ai/gemini-speech"
import { encodeWav16, resampleMono } from "@/components/demo-center/journey/demo-voice-capture"
import { DEMO_GUIDE_VOICE, DEMO_GUIDE_VOICE_DIRECTION, DEMO_GUIDE_VOICE_STYLE } from "@/lib/demo-center/guide-voice"

/**
 * The server's Gemini speech (the guide speaking a Da Vinci answer live, and
 * a spoken question to text) against the recording scripts' request builder.
 *
 * A spoken answer has to sound like the recorded step before it: the same
 * model, voice and direction, and — across the 3.8 change that made a model
 * read a preview-style direction aloud — the same request per generation. So
 * the bodies are compared with scripts/lib/gemini-tts.mjs for both
 * generations. The one difference is on purpose: the scripts put the key in
 * the address, the server never does.
 */
const MODELS = ["gemini-2.5-flash-preview-tts", "gemini-3.1-flash-tts-preview", "gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"]
const TEXT = "Bu, lidin balıdır: mənbə və maraq əsasında hesablanır."

describe("Gemini speech on the server", () => {
  it("sends the recording scripts' body for every generation, and never the key in the address", () => {
    for (const model of MODELS) {
      const input = { model, text: TEXT, voice: "Kore", direction: DEMO_GUIDE_VOICE_DIRECTION, style: DEMO_GUIDE_VOICE_STYLE }
      const script = geminiTtsRequest({ ...input, key: "SCRIPT-KEY" })
      const server = geminiSpeechRequest(input)
      // An Interactions call is not kept at Google (its default is 55 days); otherwise the same body.
      const expected = server.url.endsWith("/interactions") ? { ...(script.body as object), store: false } : script.body
      expect(server.body, model).toEqual(expected)
      expect(server.url, model).toBe(script.url.replace(/\?key=SCRIPT-KEY$/, ""))
      expect(server.url, model).not.toContain("key=")
    }
  })

  it("speaks with the guide's own recording model and voice", () => {
    expect(geminiSpeechRequest({ model: DEMO_GUIDE_VOICE.model, voice: DEMO_GUIDE_VOICE.voice, text: TEXT }).url)
      .toBe(`https://generativelanguage.googleapis.com/v1beta/models/${DEMO_GUIDE_VOICE.model}:generateContent`)
    expect(DEMO_GUIDE_VOICE.voice).toBe("Kore")
  })

  it("reads the audio out of either generation's answer as the scripts do", () => {
    const pcm = Buffer.alloc(9_600, 3)
    const preview = { candidates: [{ content: { parts: [{ inlineData: { data: pcm.toString("base64") } }] } }] }
    const current = { steps: [{ type: "model_output", content: [{ type: "audio", data: pcm16Wav(pcm, 24_000).toString("base64") }] }] }
    expect(geminiSpeechPcm(preview, "gemini-2.5-flash-preview-tts")?.equals(geminiTtsPcm(preview, "gemini-2.5-flash-preview-tts"))).toBe(true)
    expect(geminiSpeechPcm(current, "gemini-3.8-flash-tts")?.equals(pcm)).toBe(true)
    expect(geminiSpeechPcm({}, "gemini-3.8-flash-tts")).toBeNull()
    expect(geminiSpeechPcm({ candidates: [] }, "gemini-2.5-flash-preview-tts")).toBeNull()
  })

  it("wraps and reads a WAV file", () => {
    const wav = readWav(pcm16Wav(Buffer.alloc(GEMINI_SPEECH_SAMPLE_RATE * 2 * 2), GEMINI_SPEECH_SAMPLE_RATE))
    expect(wav).toMatchObject({ format: 1, channels: 1, sampleRate: 24_000, bitsPerSample: 16, seconds: 2 })
    expect(readWav(Buffer.from("not a wav"))).toBeNull()
  })

  it("takes the first key of the dev box's comma-separated pair, and none from an empty value", () => {
    expect(geminiApiKey({ GEMINI_API_KEY: "first-key, second-key" })).toBe("first-key")
    expect(geminiApiKey({ GEMINI_API_KEY: "only" })).toBe("only")
    expect(geminiApiKey({ GEMINI_API_KEY: " " })).toBeNull()
    expect(geminiApiKey({})).toBeNull()
  })

  it("asks Google's speech-to-text model, inline, in the three languages, and not to keep the interaction", () => {
    const wav = Buffer.from("RIFF-clip")
    const { url, body } = geminiTranscribeRequest({ model: GEMINI_TRANSCRIBE_MODEL, wav })
    expect(GEMINI_TRANSCRIBE_MODEL).toBe("gemini-3.5-transcribe")
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions")
    expect(body).toEqual({
      model: "gemini-3.5-transcribe",
      input: [{ type: "audio", data: wav.toString("base64"), mime_type: "audio/wav" }],
      generation_config: {
        transcription_config: {
          language_codes: ["az-AZ", "ru-RU", "en-US"],
          custom_vocabulary: ["LeadDrive", "Da Vinci", "CRM", "WhatsApp", "Instagram", "Telegram"],
          mode: "smart",
        },
      },
      store: false,
    })
  })

  it("reads only the model output's text back", () => {
    // The answer's shape as the live API gave it on 2026-10-20.
    const live = {
      status: "completed",
      usage: { total_tokens: 152 },
      steps: [{ content: [{ text: "Salam, sövdələşmələri göstərin. LeadDrive necə işləyir?", type: "text" }], type: "model_output" }],
      object: "interaction",
      model: "gemini-3.5-transcribe",
    }
    expect(geminiTranscript(live)).toBe("Salam, sövdələşmələri göstərin. LeadDrive necə işləyir?")
    expect(geminiTranscript({ steps: [{ type: "user_input", content: [{ type: "text", text: "not the answer" }] }, { type: "model_output", content: [{ type: "text", text: "  iki   söz " }] }] })).toBe("iki söz")
    expect(geminiTranscript({ output_text: "only this" })).toBe("only this")
    expect(geminiTranscript({})).toBe("")
    expect(geminiTranscript(null)).toBe("")
  })
})

describe("the page's clip", () => {
  it("is a 16 kHz mono 16-bit WAV the server reads back to the same length", () => {
    const device = new Float32Array(48_000 * 2).map((_, index) => Math.sin(index / 10) * 0.5)
    const samples = resampleMono(device, 48_000)
    expect(samples.length).toBe(32_000)
    const wav = readWav(Buffer.from(encodeWav16(samples)))
    expect(wav).toMatchObject({ format: 1, channels: 1, sampleRate: 16_000, bitsPerSample: 16, seconds: 2 })
  })

  it("brings 44.1 kHz down to 16 kHz too, and leaves a 16 kHz device alone", () => {
    expect(resampleMono(new Float32Array(44_100), 44_100).length).toBe(16_000)
    const same = new Float32Array(16_000)
    expect(resampleMono(same, 16_000)).toBe(same)
  })

  it("clips loud input instead of wrapping it around", () => {
    const wav = readWav(Buffer.from(encodeWav16(new Float32Array([2, -2, 0]))))!
    expect([wav.data.readInt16LE(0), wav.data.readInt16LE(2), wav.data.readInt16LE(4)]).toEqual([32767, -32768, 0])
  })
})
