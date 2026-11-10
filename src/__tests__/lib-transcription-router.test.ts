/**
 * C4 Call Transcription — provider router tests.
 *
 * The client comes through the AI gateway (src/lib/ai/gateway): the
 * organization's OpenAI key or the platform's, null when it has none it may
 * use or the platform's limit is spent, and every finished transcription is
 * journaled by its audio length. Unknown provider names fail closed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

const gw = vi.hoisted(() => ({
  access: null as null | { apiKey: string; keySource: string; journal: ReturnType<typeof vi.fn> },
  asked: [] as unknown[][],
  whisper: vi.fn(),
}))
vi.mock("@/lib/ai/gateway", async () => {
  const pricing = await import("@/lib/ai/gateway/pricing")
  class Refusal extends Error { reason = "not_connected" }
  return {
    aiKeyOrRefusal: vi.fn(async (...args: unknown[]) => { gw.asked.push(args); return gw.access ?? new Refusal() }),
    isAiUnavailable: (value: unknown) => value instanceof Refusal,
    perMinuteCostUsd: pricing.perMinuteCostUsd,
    UNIT_PRICING: pricing.UNIT_PRICING,
  }
})
vi.mock("@/lib/transcription/providers/openai-whisper", () => ({
  createOpenAIWhisperClient: (cfg: unknown) => { gw.whisper(cfg); return { transcribe: async () => ({ transcript: "salam", durationSeconds: 90, provider: "openai-whisper" }) } },
}))

import { resolveTranscriptionClient } from "@/lib/transcription/transcribe"

const ORIG_ENV = { ...process.env }

beforeEach(() => {
  gw.access = null
  gw.asked = []
  gw.whisper.mockClear()
  delete process.env.OPENAI_BASE_URL
  delete process.env.TRANSCRIPTION_PROVIDER
  delete process.env.TRANSCRIPTION_TIMEOUT_MS
})

afterEach(() => {
  process.env = { ...ORIG_ENV }
})

const withKey = () => { gw.access = { apiKey: "sk-org", keySource: "tenant", journal: vi.fn() }; return gw.access }

describe("resolveTranscriptionClient", () => {
  it("returns null when the organization has no OpenAI key it may use", async () => {
    expect(await resolveTranscriptionClient("org-1", "call-transcription")).toBeNull()
    expect(gw.asked).toEqual([["org-1", "openai", "call-transcription"]])
  })

  it("builds Whisper with the key the gateway chose and journals the audio's length", async () => {
    const access = withKey()
    const client = await resolveTranscriptionClient("org-1", "call-transcription")
    expect(gw.whisper).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "sk-org" }))
    expect((await client!.transcribe({ audioUrl: "https://example.com/a.mp3" })).transcript).toBe("salam")
    // 90 s at $0.006 a minute.
    expect(access.journal).toHaveBeenCalledWith({ model: "whisper-1", costUsd: expect.closeTo(0.009, 9) })
  })

  it("returns null on unknown provider name (fails closed), without asking for a key", async () => {
    withKey()
    process.env.TRANSCRIPTION_PROVIDER = "imaginary"
    expect(await resolveTranscriptionClient("org-1", "call-transcription")).toBeNull()
    expect(gw.asked).toEqual([])
  })

  it("ignores an out-of-range or non-numeric TRANSCRIPTION_TIMEOUT_MS", async () => {
    withKey()
    process.env.TRANSCRIPTION_TIMEOUT_MS = "999999999"
    expect(await resolveTranscriptionClient("org-1", "call-transcription")).not.toBeNull()
    process.env.TRANSCRIPTION_TIMEOUT_MS = "fast"
    expect(await resolveTranscriptionClient("org-1", "call-transcription")).not.toBeNull()
    for (const [cfg] of gw.whisper.mock.calls) expect((cfg as { timeoutMs?: number }).timeoutMs).toBeUndefined()
  })
})
