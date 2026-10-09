import { GoogleGenAI, type Session } from "@google/genai"
import { describe, expect, it } from "vitest"
import {
  createGeminiLiveToken,
  GEMINI_LIVE_API_VERSION,
  geminiLiveModel,
} from "@/lib/ai/voice/gemini-live"
import { checkGeminiLiveProvider, providerCheckPassed } from "@/lib/ai/voice/provider-check"
import { VOICE_SECTION_KEYS } from "@/lib/ai/voice/sections"

// These talk to Google with a real key, so they run only when asked to:
//
//   GEMINI_API_KEY=... GEMINI_LIVE_SETUP_PROBE=1 GEMINI_LIVE_RESUMPTION_PROBE=1 \
//     GEMINI_LIVE_TOOL_FIRST_PROBE=1 npx vitest run src/__tests__/gemini-live-provider-probe.test.ts
//
// The model is whatever VOICE_GEMINI_LIVE_MODEL resolves to, so the same three
// probes answer "will the next model hold a session" before anyone is moved to
// it. Where the key lives only on a server, POST /api/cron/voice-provider-check
// runs the first and third from there.
const enabled = process.env.GEMINI_LIVE_SETUP_PROBE === "1"
const resumptionEnabled = process.env.GEMINI_LIVE_RESUMPTION_PROBE === "1"
const toolFirstEnabled = process.env.GEMINI_LIVE_TOOL_FIRST_PROBE === "1"
const apiKey = process.env.GEMINI_API_KEY ?? ""

describe.runIf(enabled && apiKey.length > 0)("Gemini Live constrained-token provider probe", () => {
  it("reaches setupComplete without sending text or audio", async () => {
    const check = await checkGeminiLiveProvider({ apiKey, model: geminiLiveModel(), turn: false })
    expect(check.failure).toBeNull()
    expect(check.setupComplete).toBe(true)
    expect(GEMINI_LIVE_API_VERSION).toBe("v1beta")
  }, 30_000)
})

describe.runIf(resumptionEnabled && apiKey.length > 0)("Gemini Live same-token resumption probe", () => {
  it("reconnects with a server-issued handle using the same one-use token", async () => {
    const credential = await createGeminiLiveToken({
      apiKey,
      locale: "en",
      firstName: "",
      allowedSections: VOICE_SECTION_KEYS,
      maxSessionSeconds: 300,
    })
    const client = new GoogleGenAI({
      apiKey: credential.token,
      httpOptions: { apiVersion: GEMINI_LIVE_API_VERSION },
    })
    let first: Session | null = null
    let resumed: Session | null = null
    let resolveHandle!: (handle: string) => void
    let rejectHandle!: (error: Error) => void
    const handle = new Promise<string>((resolve, reject) => {
      resolveHandle = resolve
      rejectHandle = reject
    })
    const timeout = setTimeout(() => rejectHandle(new Error("resumption handle timed out")), 25_000)
    try {
      first = await client.live.connect({
        model: credential.model,
        config: { sessionResumption: {} },
        callbacks: {
          onopen: () => {},
          onmessage: (message) => {
            const update = message.sessionResumptionUpdate
            if (update?.resumable && update.newHandle) resolveHandle(update.newHandle)
          },
          onerror: (event) => rejectHandle(new Error(`initial Gemini Live error: ${event.message}`)),
          onclose: () => {},
        },
      })
      // This controlled text turn produces no local audio playback; it exists
      // only because the provider emits a resumable checkpoint after activity.
      first.sendClientContent({ turns: "Reply with the single word ready.", turnComplete: true })
      const resumeHandle = await handle
      first.close()
      first = null

      let setupResolve!: () => void
      let setupReject!: (error: Error) => void
      const setup = new Promise<void>((resolve, reject) => {
        setupResolve = resolve
        setupReject = reject
      })
      resumed = await client.live.connect({
        model: credential.model,
        config: { sessionResumption: { handle: resumeHandle } },
        callbacks: {
          onopen: () => {},
          onmessage: (message) => { if (message.setupComplete) setupResolve() },
          onerror: (event) => setupReject(new Error(`resumed Gemini Live error: ${event.message}`)),
          onclose: (event) => setupReject(new Error(`resumed Gemini Live closed: ${event.reason}`)),
        },
      })
      await Promise.race([
        setup,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("resumed setup timed out")), 20_000)),
      ])
      expect(resumeHandle.length).toBeGreaterThan(0)
    } finally {
      clearTimeout(timeout)
      first?.close()
      resumed?.close()
    }
  }, 55_000)
})

/**
 * The one behaviour a setup-only probe cannot see, and the one a model change
 * puts at risk: does the assistant wait for the CRM before it answers? What is
 * asked and how it is judged is in provider-check.ts; the server route runs the
 * same code.
 */
describe.runIf(toolFirstEnabled && apiKey.length > 0)("Gemini Live tool-first probe", () => {
  it("calls a read tool and does not finish the answer until the result arrives", async () => {
    const check = await checkGeminiLiveProvider({ apiKey, model: geminiLiveModel(), turn: true })
    expect(check.failure).toBeNull()
    expect(check.setupComplete).toBe(true)
    expect(check.toolFirst?.tool, "the model answered a data question without a tool").toBeTruthy()
    expect(check.toolFirst?.waitedForResult, "the model finished its turn while the tool result was withheld").toBe(true)
    expect(check.toolFirst?.audioAfterResult, "no playable audio followed the tool result").toBe(true)
    expect(providerCheckPassed(check)).toBe(true)
  }, 90_000)
})
