import { GoogleGenAI, type Session } from "@google/genai"
import { describe, expect, it } from "vitest"
import {
  createGeminiLiveToken,
  GEMINI_LIVE_API_VERSION,
  GEMINI_LIVE_MODEL,
} from "@/lib/ai/voice/gemini-live"
import { VOICE_SECTION_KEYS } from "@/lib/ai/voice/sections"

const enabled = process.env.GEMINI_LIVE_SETUP_PROBE === "1"
const resumptionEnabled = process.env.GEMINI_LIVE_RESUMPTION_PROBE === "1"
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
        model: GEMINI_LIVE_MODEL,
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
        model: GEMINI_LIVE_MODEL,
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
        model: GEMINI_LIVE_MODEL,
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
