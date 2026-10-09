import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import {
  GEMINI_TTS_SUCCESSOR,
  geminiTtsModelRetired,
  geminiTtsPcm,
  geminiTtsReadsTextVerbatim,
  geminiTtsRequest,
  geminiTtsTooShort,
  stripWavHeader,
} from "../../scripts/lib/gemini-tts.mjs"

/**
 * The voiceover generators (demo guide, video guides, voice samples) and the
 * two generations of Gemini TTS.
 *
 * Sent a preview-style request, a 3.8 model read the direction aloud - nine
 * seconds of English in front of a one-second phrase, on the live API,
 * 2026-10-08 - and returned a WAV file where the generators expect bare PCM.
 * These tests keep each generation on its own request.
 */
const PREVIEW = ["gemini-2.5-flash-preview-tts", "gemini-2.5-pro-preview-tts", "gemini-3.1-flash-tts-preview"]
const CURRENT = ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts", "gemini-3.9-flash-tts"]

type CurrentBody = {
  model: string
  input: Array<{ content: Array<{ type: string; text: string; annotations?: unknown }> }>
  response_format: unknown
  generation_config: unknown
}
type TtsArgs = { model: string; key: string; text: string; voice: string; direction?: string; style?: string }
/** The request for a 3.8 model, typed as the shape that branch returns. */
function current(args: TtsArgs) {
  return geminiTtsRequest(args) as unknown as { url: string; body: CurrentBody }
}

const PCM = Buffer.alloc(4_800, 7)
function wav(pcm: Buffer, extraChunk = Buffer.alloc(0)): Buffer {
  const fmt = Buffer.concat([Buffer.from("fmt "), Buffer.from([16, 0, 0, 0]), Buffer.alloc(16)])
  const size = Buffer.alloc(4)
  size.writeUInt32LE(pcm.length)
  const body = Buffer.concat([Buffer.from("WAVE"), fmt, extraChunk, Buffer.from("data"), size, pcm])
  const total = Buffer.alloc(4)
  total.writeUInt32LE(body.length)
  return Buffer.concat([Buffer.from("RIFF"), total, body])
}

describe("which request a Gemini TTS model gets", () => {
  it("tells the two generations apart by id", () => {
    for (const model of PREVIEW) expect(geminiTtsReadsTextVerbatim(model), model).toBe(false)
    for (const model of CURRENT) expect(geminiTtsReadsTextVerbatim(model), model).toBe(true)
    expect(geminiTtsReadsTextVerbatim(GEMINI_TTS_SUCCESSOR)).toBe(true)
  })

  it.each(PREVIEW)("%s keeps the request the generators have always sent", (model) => {
    // Byte for byte what scripts/demo-guide/generate-voice.ts built itself.
    expect(geminiTtsRequest({ model, key: "k", text: "Salam.", voice: "Kore", direction: "Sakit oxu:", style: "calm" })).toEqual({
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=k`,
      body: {
        contents: [{ parts: [{ text: "Sakit oxu:\nSalam." }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
        },
      },
    })
    // ...and what produce-guides.mjs and tts-voice-samples.mjs built: text alone.
    expect(geminiTtsRequest({ model, key: "k", text: "Salam.", voice: "Kore" }).body.contents)
      .toEqual([{ parts: [{ text: "Salam." }] }])
  })

  it.each(CURRENT)("%s is sent only the words to record", (model) => {
    const { url, body } = current({
      model, key: "k", text: "Salam.", voice: "Kore", direction: "Sakit oxu:", style: "calm, unhurried",
    })
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions?key=k")
    expect(body.model).toBe(model)
    // Every word in the text is a word in the recording.
    const texts = body.input.flatMap((turn) => turn.content.map((block) => block.text))
    expect(texts).toEqual(["Salam."])
    expect(JSON.stringify(body)).not.toContain("Sakit oxu")
    // The delivery goes where it cannot be spoken.
    expect(body.input[0]!.content[0]!.annotations).toEqual([{ type: "speech_metadata", style: "calm, unhurried" }])
    // Bare PCM by name; the default for this call is a WAV file.
    expect(body.response_format).toEqual({ type: "audio", mime_type: "audio/l16" })
    expect(body.generation_config).toEqual({ speech_config: [{ voice: "Kore" }] })
  })

  it("sends no style block when there is no style to send", () => {
    const { body } = current({ model: "gemini-3.8-flash-tts", key: "k", text: "Salam.", voice: "Kore" })
    expect(body.input[0]!.content[0]).toEqual({ type: "text", text: "Salam." })
  })
})

describe("the audio that comes back", () => {
  const encoded = (bytes: Buffer) => bytes.toString("base64")

  it("is read from a preview model's answer", () => {
    const json = { candidates: [{ content: { parts: [{ text: "" }, { inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: encoded(PCM) } }] } }] }
    expect(geminiTtsPcm(json, "gemini-2.5-flash-preview-tts")?.equals(PCM)).toBe(true)
  })

  it("is read from a 3.8 model's answer, in the shape the live API returned", () => {
    const json = { steps: [
      { type: "user_input", content: [{ type: "text", text: "Salam." }] },
      { type: "model_output", content: [{ type: "audio", mime_type: "audio/l16; rate=24000; channels=1", data: encoded(PCM) }] },
    ] }
    expect(geminiTtsPcm(json, "gemini-3.8-flash-tts")?.equals(PCM)).toBe(true)
  })

  it("never keeps a WAV header: ffmpeg is told the bytes are bare samples", () => {
    const json = { steps: [{ type: "model_output", content: [{ type: "audio", mime_type: "audio/wav", data: encoded(wav(PCM)) }] }] }
    expect(geminiTtsPcm(json, "gemini-3.8-flash-tts")?.equals(PCM)).toBe(true)
  })

  it("finds the samples past other chunks and leaves bare audio alone", () => {
    const list = Buffer.concat([Buffer.from("LIST"), Buffer.from([5, 0, 0, 0]), Buffer.from("abcde"), Buffer.from([0])])
    expect(stripWavHeader(wav(PCM, list)).equals(PCM)).toBe(true)
    expect(stripWavHeader(PCM).equals(PCM)).toBe(true)
    expect(stripWavHeader(Buffer.from("RIFF")).toString()).toBe("RIFF")
    expect(() => stripWavHeader(Buffer.concat([Buffer.from("RIFF"), Buffer.from([4, 0, 0, 0]), Buffer.from("WAVE")]))).toThrow(/without audio/)
  })

  it("is null when the model returned none, so a silent file is never written", () => {
    expect(geminiTtsPcm({ candidates: [{ content: { parts: [{ text: "sorry" }] } }] }, "gemini-2.5-flash-preview-tts")).toBeNull()
    expect(geminiTtsPcm({ steps: [{ type: "model_output", content: [{ type: "text", text: "sorry" }] }] }, "gemini-3.8-flash-tts")).toBeNull()
    expect(geminiTtsPcm({ steps: [{ type: "model_output", content: [{ type: "audio", data: encoded(wav(Buffer.alloc(0))) }] }] }, "gemini-3.8-flash-tts")).toBeNull()
    expect(geminiTtsPcm({}, "gemini-3.8-flash-tts")).toBeNull()
  })

  it("takes the model's audio, not anything echoed from the request", () => {
    const first = encoded(Buffer.alloc(20))
    const json = { steps: [
      { type: "user_input", content: [{ type: "audio", data: first }] },
      { type: "model_output", content: [{ type: "audio", data: first }, { type: "audio", data: encoded(PCM) }] },
    ] }
    expect(geminiTtsPcm(json, "gemini-3.8-flash-tts")?.equals(PCM)).toBe(true)
    expect(geminiTtsPcm({ steps: [{ type: "user_input", content: [{ type: "audio", data: first }] }] }, "gemini-3.8-flash-tts")).toBeNull()
  })
})

describe("audio that cannot be the text", () => {
  const seconds = (value: number) => Buffer.alloc(Math.round(value * 24_000) * 2)
  const SENTENCE = "Mən yalnız bu demo və LeadDrive barədə suallara cavab verirəm. Ekranda gördüyünüz hər şeyi izah edə bilərəm."

  it("catches the tenth of a second the preview model returned for a whole sentence", () => {
    // Measured: 0.1 s for this text, where a real reading runs 8-10 s.
    expect(geminiTtsTooShort(seconds(0.1), SENTENCE)).toBe(true)
    expect(geminiTtsTooShort(seconds(8.5), SENTENCE)).toBe(false)
  })

  it("does not reject fast but real speech, or a short phrase", () => {
    // Half the pace of the shipped recordings is still a reading of the text.
    expect(geminiTtsTooShort(seconds(SENTENCE.length * 0.04), SENTENCE)).toBe(false)
    // "Bir saniyə." really is about one second.
    expect(geminiTtsTooShort(seconds(1.1), "Bir saniyə.")).toBe(false)
    expect(geminiTtsTooShort(seconds(0.05), "Bir saniyə.")).toBe(true)
  })
})

describe("a preview model Google has shut down", () => {
  it("is recognised by the 404 it answers with, and only for a preview id", () => {
    expect(geminiTtsModelRetired("gemini-2.5-flash-preview-tts", 404)).toBe(true)
    // Busy, forbidden or failing is not gone.
    for (const status of [429, 403, 500, 400, 200]) {
      expect(geminiTtsModelRetired("gemini-2.5-flash-preview-tts", status), String(status)).toBe(false)
    }
    // A 404 on the successor is a mistake to surface, not a reason to loop.
    expect(geminiTtsModelRetired(GEMINI_TTS_SUCCESSOR, 404)).toBe(false)
  })
})

describe("the generators", () => {
  const generators = [
    "scripts/demo-guide/generate-voice.ts",
    "scripts/produce-guides.mjs",
    "scripts/tts-voice-samples.mjs",
  ]

  it.each(generators)("%s builds its request and reads its audio in the one shared place", (file) => {
    const source = readFileSync(file, "utf8")
    expect(source).toContain("geminiTtsRequest(")
    expect(source).toContain("geminiTtsPcm(")
    // ...and does not save a clip that is too short to be its text.
    expect(source).toMatch(/geminiTtsTooShort\(audio, text\)[^\n]*\{[\s\S]{0,260}continue/)
    // A request assembled by hand is one that knows a single generation.
    expect(source).not.toContain(":generateContent")
    expect(source).not.toContain("inlineData")
  })

  it("the video generators move to the successor when the preview model is gone", () => {
    for (const file of ["scripts/produce-guides.mjs", "scripts/tts-voice-samples.mjs"]) {
      const source = readFileSync(file, "utf8")
      expect(source, file).toMatch(/geminiTtsModelRetired\([^)]*\)\) \{[\s\S]{0,260}= GEMINI_TTS_SUCCESSOR;\s*continue;/)
    }
  })

  it("the demo guide refuses instead: one phrase in a newer voice is a different narrator", () => {
    const source = readFileSync("scripts/demo-guide/generate-voice.ts", "utf8")
    const [, afterCheck] = source.split("geminiTtsModelRetired(DEMO_GUIDE_VOICE.model, response.status)")
    expect(afterCheck).toBeDefined()
    expect(afterCheck!.slice(0, 120)).toContain("throw new Error(")
    expect(source).toContain("every phrase is re-recorded under a new name")
  })
})
