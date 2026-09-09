// @vitest-environment jsdom

import type { LiveServerMessage } from "@google/genai"
import { describe, expect, it } from "vitest"
import {
  base64Pcm16ToFloat32,
  geminiAudioParts,
  geminiFunctionResponse,
  geminiInputTranscript,
  pcm16ToBase64,
} from "@/lib/ai/voice/gemini-live-browser"

describe("Gemini Live browser protocol", () => {
  it("encodes microphone PCM16 little-endian and decodes provider PCM16", () => {
    const input = new Float32Array([-1, -0.5, 0, 0.5, 1])
    const decoded = base64Pcm16ToFloat32(pcm16ToBase64(input))
    expect(Array.from(decoded)).toEqual(expect.arrayContaining([
      -1,
      expect.closeTo(-0.5, 3),
      0,
      expect.closeTo(0.5, 3),
      1,
    ]))
  })

  it("processes every audio part bundled into a Gemini 3.1 server event", () => {
    const message = {
      serverContent: {
        modelTurn: {
          parts: [
            { inlineData: { data: "AAA=", mimeType: "audio/pcm;rate=24000" } },
            { text: "ignored transcript part" },
            { inlineData: { data: "AQI=", mimeType: "audio/pcm;rate=24000" } },
          ],
        },
      },
    }
    expect(geminiAudioParts(message as unknown as LiveServerMessage)).toEqual([
      { data: "AAA=", mimeType: "audio/pcm;rate=24000" },
      { data: "AQI=", mimeType: "audio/pcm;rate=24000" },
    ])
  })

  it("rejects non-PCM output parts and malformed or odd-byte PCM16", () => {
    expect(() => geminiAudioParts({
      serverContent: { modelTurn: { parts: [
        { inlineData: { data: "AAA=", mimeType: "audio/wav" } },
        { inlineData: { data: "AAA=", mimeType: "audio/pcm;rate=16000" } },
      ] } },
    } as unknown as LiveServerMessage)).toThrow("invalid audio payload")
    expect(() => geminiAudioParts({
      serverContent: { modelTurn: { parts: [{ inlineData: { data: "AAA=" } }] } },
    } as unknown as LiveServerMessage)).toThrow("invalid audio payload")
    expect(() => base64Pcm16ToFloat32("")).toThrow("invalid base64")
    expect(() => base64Pcm16ToFloat32("%%%=")).toThrow("invalid base64")
    expect(() => base64Pcm16ToFloat32("AA==")).toThrow("odd PCM16")
  })

  it("keeps structured CRM tool output structured in the function response", () => {
    expect(geminiFunctionResponse(
      { id: "call-1", name: "get_leads_summary", args: {} },
      JSON.stringify({ total: 7 }),
    )).toEqual({
      id: "call-1",
      name: "get_leads_summary",
      response: { output: { total: 7 } },
    })
  })

  it("returns finished input captions without treating them as model input", () => {
    expect(geminiInputTranscript({
      serverContent: { inputTranscription: { text: "show leads", finished: true } },
    } as unknown as LiveServerMessage)).toEqual({ text: "show leads", finished: true })
  })
})
