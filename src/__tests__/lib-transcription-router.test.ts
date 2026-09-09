/**
 * C4 Call Transcription — provider router tests.
 *
 * Verifies env-based provider resolution + closed-fail semantics.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { resolveTranscriptionClient } from "@/lib/transcription/transcribe"

const ORIG_ENV = { ...process.env }

beforeEach(() => {
  // Reset env so each test sees a clean slate.
  delete process.env.OPENAI_API_KEY
  delete process.env.OPENAI_BASE_URL
  delete process.env.TRANSCRIPTION_PROVIDER
  delete process.env.TRANSCRIPTION_TIMEOUT_MS
})

afterEach(() => {
  process.env = { ...ORIG_ENV }
})

describe("resolveTranscriptionClient", () => {
  it("returns null when OPENAI_API_KEY is unset", () => {
    expect(resolveTranscriptionClient()).toBeNull()
  })

  it("returns a client when OPENAI_API_KEY is set", () => {
    process.env.OPENAI_API_KEY = "sk-test"
    const client = resolveTranscriptionClient()
    expect(client).not.toBeNull()
    expect(typeof client?.transcribe).toBe("function")
  })

  it("defaults to openai-whisper when TRANSCRIPTION_PROVIDER is unset", () => {
    process.env.OPENAI_API_KEY = "sk-test"
    expect(resolveTranscriptionClient()).not.toBeNull()
  })

  it("returns null on unknown provider name (fails closed)", () => {
    process.env.TRANSCRIPTION_PROVIDER = "imaginary"
    process.env.OPENAI_API_KEY = "sk-test"
    expect(resolveTranscriptionClient()).toBeNull()
  })

  it("ignores TRANSCRIPTION_TIMEOUT_MS when out of range", () => {
    process.env.OPENAI_API_KEY = "sk-test"
    process.env.TRANSCRIPTION_TIMEOUT_MS = "999999999"
    // Doesn't crash — the helper validates the value.
    expect(resolveTranscriptionClient()).not.toBeNull()
  })

  it("ignores non-numeric TRANSCRIPTION_TIMEOUT_MS", () => {
    process.env.OPENAI_API_KEY = "sk-test"
    process.env.TRANSCRIPTION_TIMEOUT_MS = "fast"
    expect(resolveTranscriptionClient()).not.toBeNull()
  })
})
