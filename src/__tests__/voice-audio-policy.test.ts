import { describe, expect, it } from "vitest"

import {
  audioModeInstruction,
  DEFAULT_VOICE_AUDIO_MODE,
  isVoiceAudioMode,
  realtimeInputPolicy,
  VOICE_AUDIO_MODES,
} from "@/lib/ai/voice/audio-policy"
import { geminiLiveConfig, geminiLiveSystemInstruction } from "@/lib/ai/voice/gemini-live"

/**
 * Roadmap A3.1, A3.11, A3.12 — the noisy-room mode.
 *
 * The local loudness meter has not been able to interrupt anything since the
 * Phase 2 hotfix. What remains is the provider's own detector, and to a
 * voice-activity detector, music with vocals is the thing it is looking for.
 * Sensitivity is already at its lowest on both ends.
 *
 * So this mode does not try to hear better. It removes the consequence: in a
 * noisy room nothing the microphone hears may cut the assistant off. These
 * tests pin that this is one field, that detection is NOT loosened with it,
 * and that the policy stays locked into the server-minted token.
 */
describe("the two rooms", () => {
  it("offers exactly two modes and defaults to the desk", () => {
    expect([...VOICE_AUDIO_MODES]).toEqual(["auto", "noisy"])
    expect(DEFAULT_VOICE_AUDIO_MODE).toBe("auto")
  })

  it("lets speech interrupt at a desk", () => {
    expect(realtimeInputPolicy("auto").activityHandling).toBe("START_OF_ACTIVITY_INTERRUPTS")
  })

  it("lets nothing the microphone hears interrupt in a noisy room", () => {
    expect(realtimeInputPolicy("noisy").activityHandling).toBe("NO_INTERRUPTION")
  })

  // The detector is what tells the assistant the user has finished speaking.
  // Loosening it here would trade interruptions for half-heard questions.
  it("changes only the consequence, never the detection", () => {
    const auto = realtimeInputPolicy("auto")
    const noisy = realtimeInputPolicy("noisy")
    expect(noisy.automaticActivityDetection).toEqual(auto.automaticActivityDetection)
    expect(noisy.turnCoverage).toBe(auto.turnCoverage)
    expect(noisy.automaticActivityDetection?.disabled).toBe(false)
  })

  it("keeps the office ear on both ends in both modes", () => {
    for (const mode of VOICE_AUDIO_MODES) {
      const detection = realtimeInputPolicy(mode).automaticActivityDetection
      expect(detection?.startOfSpeechSensitivity, mode).toBe("START_SENSITIVITY_LOW")
      expect(detection?.endOfSpeechSensitivity, mode).toBe("END_SENSITIVITY_LOW")
      expect(detection?.prefixPaddingMs, mode).toBe(300)
      expect(detection?.silenceDurationMs, mode).toBe(900)
    }
  })

  it("recognises only its own modes", () => {
    expect(isVoiceAudioMode("auto")).toBe(true)
    expect(isVoiceAudioMode("noisy")).toBe(true)
    for (const value of ["", "quiet", "NOISY", null, undefined, 1, {}]) {
      expect(isVoiceAudioMode(value), String(value)).toBe(false)
    }
  })
})

describe("what the assistant is told about the room", () => {
  it("says nothing extra at a desk", () => {
    expect(audioModeInstruction("auto")).toBeNull()
    expect(geminiLiveSystemInstruction("ru", "Rashad", "auto"))
      .toBe(geminiLiveSystemInstruction("ru", "Rashad"))
  })

  // Without this it keeps the habits of a quiet desk: pausing for a reply it
  // cannot be interrupted into, and apologising for talking over someone it
  // cannot talk over.
  it("tells it plainly that it cannot be interrupted in a noisy room", () => {
    const instruction = geminiLiveSystemInstruction("ru", "Rashad", "noisy")
    expect(instruction).toMatch(/cannot be interrupted by speech/i)
    expect(instruction).toMatch(/finish each sentence/i)
    expect(instruction).toMatch(/never apologise for talking over/i)
  })

  it("keeps every other rule in the noisy prompt", () => {
    const quiet = geminiLiveSystemInstruction("ru", "Rashad", "auto")
    const noisy = geminiLiveSystemInstruction("ru", "Rashad", "noisy")
    for (const line of quiet.split("\n")) {
      expect(noisy, line.slice(0, 40)).toContain(line)
    }
    expect(noisy.split("\n").length).toBe(quiet.split("\n").length + 1)
  })
})

describe("the session configuration", () => {
  it("carries the chosen mode into the Gemini config", () => {
    const base = { locale: "az", firstName: "Rəşad", allowedSections: ["leads"] }
    expect(geminiLiveConfig({ ...base, audioMode: "noisy" }).realtimeInputConfig?.activityHandling)
      .toBe("NO_INTERRUPTION")
    expect(geminiLiveConfig({ ...base, audioMode: "auto" }).realtimeInputConfig?.activityHandling)
      .toBe("START_OF_ACTIVITY_INTERRUPTS")
  })

  it("stays on the desk policy when no mode is asked for", () => {
    const config = geminiLiveConfig({ locale: "az", firstName: "Rəşad", allowedSections: ["leads"] })
    expect(config.realtimeInputConfig?.activityHandling).toBe("START_OF_ACTIVITY_INTERRUPTS")
  })

  it("changes nothing else about the session", () => {
    const base = { locale: "az", firstName: "Rəşad", allowedSections: ["leads"] }
    const quiet = geminiLiveConfig({ ...base, audioMode: "auto" })
    const noisy = geminiLiveConfig({ ...base, audioMode: "noisy" })
    // The model, the voice, the tools and the transcription are not the room's
    // business; only the prompt's last line and one policy field differ.
    expect(noisy.speechConfig).toEqual(quiet.speechConfig)
    expect(noisy.tools).toEqual(quiet.tools)
    expect(noisy.thinkingConfig).toEqual(quiet.thinkingConfig)
    expect(noisy.inputAudioTranscription).toEqual(quiet.inputAudioTranscription)
    expect(noisy.responseModalities).toEqual(quiet.responseModalities)
  })
})
