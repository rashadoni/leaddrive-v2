import { GoogleGenAI, type FunctionCall, type LiveServerMessage, type Session } from "@google/genai"
import { describe, expect, it } from "vitest"
import {
  createGeminiLiveToken,
  GEMINI_LIVE_API_VERSION,
} from "@/lib/ai/voice/gemini-live"
import {
  geminiAudioParts,
  geminiFunctionCalls,
  geminiFunctionResponse,
} from "@/lib/ai/voice/gemini-live-browser"
import { VOICE_SECTION_KEYS } from "@/lib/ai/voice/sections"

// These talk to Google with a real key, so they run only when asked to:
//
//   GEMINI_API_KEY=... GEMINI_LIVE_SETUP_PROBE=1 GEMINI_LIVE_RESUMPTION_PROBE=1 \
//     GEMINI_LIVE_TOOL_FIRST_PROBE=1 npx vitest run src/__tests__/gemini-live-provider-probe.test.ts
//
// The model is whatever VOICE_GEMINI_LIVE_MODEL resolves to, so the same three
// probes answer "will the next model open a session" before anyone switches.
const enabled = process.env.GEMINI_LIVE_SETUP_PROBE === "1"
const resumptionEnabled = process.env.GEMINI_LIVE_RESUMPTION_PROBE === "1"
const toolFirstEnabled = process.env.GEMINI_LIVE_TOOL_FIRST_PROBE === "1"
const apiKey = process.env.GEMINI_API_KEY ?? ""

describe.runIf(enabled && apiKey.length > 0)("Gemini Live constrained-token provider probe", () => {
  it("reaches setupComplete without sending text or audio", async () => {
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
    let live: Session | null = null
    const setupComplete = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Gemini Live setupComplete timed out")), 20_000)
      void client.live.connect({
        model: credential.model,
        config: { sessionResumption: {} },
        callbacks: {
          onopen: () => {},
          onmessage: (message) => {
            if (!message.setupComplete) return
            clearTimeout(timeout)
            resolve()
          },
          onerror: (event) => {
            clearTimeout(timeout)
            reject(new Error(`Gemini Live setup error: ${event.message}`))
          },
          onclose: (event) => {
            if (live) return
            clearTimeout(timeout)
            reject(new Error(`Gemini Live closed before setup: ${event.reason}`))
          },
        },
      }).then((session) => { live = session }, reject)
    })
    try {
      await setupComplete
      expect(GEMINI_LIVE_API_VERSION).toBe("v1beta")
    } finally {
      ;(live as Session | null)?.close()
    }
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
 * The one behaviour a setup-only probe cannot see, and the one the model
 * change puts at risk: does the assistant wait for the CRM before it answers?
 *
 * 3.8 Live runs tools asynchronously unless every declaration says BLOCKING,
 * and it takes no thinking level, which is what kept 3.1 from answering "five
 * boards" from memory. So this asks a data question in text, withholds the
 * tool result, and requires the model to still be waiting. Then it answers
 * with the browser's own response shape and requires speech in the format the
 * console can play.
 */
describe.runIf(toolFirstEnabled && apiKey.length > 0)("Gemini Live tool-first probe", () => {
  it("calls a read tool and does not finish the answer until the result arrives", async () => {
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

    const HOLD_MS = 5_000
    let live: Session | null = null
    let firstCall: FunctionCall | null = null
    let answered = false
    let turnCompleteWhileWaiting = false
    let audioPartsAfterAnswer = 0
    let failure: Error | null = null
    let closing = false
    let finish!: () => void
    const finished = new Promise<void>((resolve) => { finish = resolve })
    const fail = (error: Error) => { failure ??= error; finish() }

    const onmessage = (message: LiveServerMessage) => {
      try {
        // Throws on anything but 24 kHz PCM16 - the same check that ends a
        // real conversation with "connection lost".
        const audio = geminiAudioParts(message)
        if (answered) audioPartsAfterAnswer += audio.length

        const calls = geminiFunctionCalls(message)
        if (calls.length > 0 && !firstCall) {
          firstCall = calls[0]!
          setTimeout(() => {
            if (!live || failure) return
            answered = true
            live.sendToolResponse({
              functionResponses: calls.map((call) => geminiFunctionResponse(call, JSON.stringify({ total: 7 }))),
            })
          }, HOLD_MS)
        }

        if (message.serverContent?.turnComplete) {
          if (!answered) turnCompleteWhileWaiting = true
          finish()
        }
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)))
      }
    }

    const timeout = setTimeout(() => fail(new Error("no complete answer within 60 s")), 60_000)
    try {
      live = await client.live.connect({
        model: credential.model,
        config: { sessionResumption: {} },
        callbacks: {
          onopen: () => {},
          onmessage,
          onerror: (event) => fail(new Error(`Gemini Live error: ${event.message}`)),
          onclose: (event) => {
            if (!closing) fail(new Error(`Gemini Live closed: ${event.code} ${event.reason}`))
          },
        },
      })
      live.sendClientContent({ turns: "How many leads do we have right now?", turnComplete: true })
      await finished
    } finally {
      clearTimeout(timeout)
      closing = true
      const session = live as Session | null
      live = null
      session?.close()
    }

    if (failure) throw failure
    // It asked the CRM instead of answering from memory...
    expect((firstCall as FunctionCall | null)?.name, "the model answered a data question without a tool").toBeTruthy()
    // ...waited for the answer instead of talking past it...
    expect(turnCompleteWhileWaiting, "the model finished its turn while the tool result was withheld").toBe(false)
    // ...and then spoke, in audio the console can decode.
    expect(audioPartsAfterAnswer).toBeGreaterThan(0)
  }, 90_000)
})
