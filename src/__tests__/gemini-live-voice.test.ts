import { readFileSync } from "node:fs"
import { describe, expect, it, vi } from "vitest"

import {
  createGeminiLiveToken,
  geminiLiveConfig,
  geminiLiveTokenConfig,
  geminiLiveSystemInstruction,
  GEMINI_LIVE_API_VERSION,
  GEMINI_LIVE_MODEL,
  GEMINI_LIVE_VOICE,
} from "@/lib/ai/voice/gemini-live"
import { voiceTools } from "@/lib/ai/voice/realtime-tool-contract"

describe("Gemini Live CRM voice", () => {
  it("speaks three languages and refuses Turkish, matching the phone agent", () => {
    const instruction = geminiLiveSystemInstruction("az", "Rəşad")
    expect(instruction).toMatch(/Azerbaijani, Russian and English/)
    // Turkish is banned on both surfaces for the same reason: it is close
    // enough to Azerbaijani that a misread phrase can flip a whole session.
    expect(instruction).toMatch(/Never answer in Turkish/)
    expect(instruction).not.toMatch(/or Turkish/)
    expect(instruction).toMatch(/Do not mix languages inside one reply/)
  })

  it("does not tell the model to imitate a voice it is not using", () => {
    // The voice preset is chosen in GEMINI_LIVE_VOICE. Naming a different one
    // in the prompt survived a voice change and contradicted it.
    const instruction = geminiLiveSystemInstruction("az", "Rəşad")
    expect(instruction).not.toMatch(/Kore/)
  })

  it("orders the assistant to call a tool before answering any data question", () => {
    const instruction = geminiLiveSystemInstruction("az", "Rəşad")
    // A rule that only forbids invention leaves answering from memory as the
    // easy path; the duty has to be stated positively and first.
    expect(instruction).toMatch(/MUST be answered by calling a tool first/)
    expect(instruction).toMatch(/you do not know the answer/)
    const forbid = instruction.indexOf("Never invent numbers")
    const require = instruction.indexOf("MUST be answered by calling a tool")
    expect(require).toBeLessThan(forbid)
  })

  it("locks the native audio model, Algieba voice, low-latency VAD, and read-only CRM tools", () => {
    const config = geminiLiveConfig({ locale: "az", firstName: "Rəşad", allowedSections: ["leads"] })
    expect(GEMINI_LIVE_MODEL).toBe("gemini-3.1-flash-live-preview")
    // Owner picked this by ear on 2026-08-17 from side-by-side Azerbaijani
    // samples of every preset. Pinned so the console voice cannot drift back
    // silently; changing it is a decision, not a refactor.
    expect(GEMINI_LIVE_VOICE).toBe("Algieba")
    expect(GEMINI_LIVE_API_VERSION).toBe("v1beta")
    expect(config.responseModalities).toEqual(["AUDIO"])
    expect(config.speechConfig?.voiceConfig?.prebuiltVoiceConfig?.voiceName).toBe("Algieba")
    // Raised from MINIMAL after the assistant answered "five boards" without
    // calling a tool: it needs room to notice a question is about data it
    // cannot see. Pinned so latency tuning cannot quietly reintroduce guessing.
    expect(config.thinkingConfig?.thinkingLevel).toBe("LOW")
    expect(config.inputAudioTranscription).toEqual({})
    expect(config.sessionResumption).toEqual({})
    expect(config.realtimeInputConfig?.automaticActivityDetection).toMatchObject({
      disabled: false,
      // An office ear: a cough must not interrupt the assistant, and the pause
      // before a number must not end the user's turn.
      prefixPaddingMs: 300,
      silenceDurationMs: 900,
      startOfSpeechSensitivity: "START_SENSITIVITY_LOW",
      endOfSpeechSensitivity: "END_SENSITIVITY_LOW",
    })
    expect(config.realtimeInputConfig?.activityHandling).toBe("START_OF_ACTIVITY_INTERRUPTS")
    expect(config.contextWindowCompression).toEqual({ slidingWindow: {} })
    expect(geminiLiveTokenConfig({ locale: "az", firstName: "Rəşad", allowedSections: ["leads"] }).sessionResumption)
      .toBeUndefined()

    const declarations = (config.tools as Array<{ functionDeclarations?: unknown[] }>)[0]?.functionDeclarations ?? []
    expect(declarations.length).toBeGreaterThan(10)
    expect(declarations).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "navigate_to_section" }),
      expect.objectContaining({ name: "get_current_screen" }),
      expect.objectContaining({ name: "open_record" }),
      expect.objectContaining({ name: "get_leads_summary" }),
    ]))
    expect(JSON.stringify(declarations)).not.toContain('"type":"function"')
  })

  it("keeps the CRM truth and permission rules while allowing natural language switching", () => {
    const prompt = geminiLiveSystemInstruction("ru-RU", "Rashad")
    expect(prompt).toContain("Start in Russian")
    expect(prompt).toContain("Azerbaijani, Russian and English")
    expect(prompt).toContain("Address the user as Rashad")
    expect(prompt).toContain("only read CRM data through the supplied tools")
    expect(prompt).toContain("Never claim that you changed, deleted, sent, or created CRM data")
  })

  it("mints a one-use token with the complete session configuration constrained server-side", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ name: "ephemeral-token" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }))
    vi.stubGlobal("fetch", fetchMock)
    const result = await createGeminiLiveToken({
      apiKey: "server-only-key",
      locale: "en",
      firstName: "",
      allowedSections: ["leads"],
      maxSessionSeconds: 3_600,
      now: new Date("2026-08-14T10:00:00.000Z"),
    })
    expect(result).toEqual({
      token: "ephemeral-token",
      expiresAt: "2026-08-14T11:02:00.000Z",
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe("https://generativelanguage.googleapis.com/v1beta/auth_tokens")
    expect(init?.headers).toMatchObject({ "x-goog-api-key": "server-only-key" })
    const body = JSON.parse(String(init?.body))
    expect(body).toMatchObject({
      uses: 1,
      expireTime: "2026-08-14T11:02:00.000Z",
      newSessionExpireTime: "2026-08-14T10:01:00.000Z",
      bidiGenerateContentSetup: {
        model: `models/${GEMINI_LIVE_MODEL}`,
        generationConfig: expect.objectContaining({ responseModalities: ["AUDIO"] }),
      },
    })
    expect(body.bidiGenerateContentSetup.sessionResumption).toBeUndefined()
    expect(body.fieldMask.split(",")).toEqual(expect.arrayContaining([
      "model", "generationConfig", "systemInstruction", "tools",
      "inputAudioTranscription", "realtimeInputConfig", "contextWindowCompression",
    ]))
    expect(body.fieldMask).not.toContain("sessionResumption")
    expect(body.fieldMask).not.toContain("tools.0")
    expect(JSON.stringify(body)).not.toContain("server-only-key")
    vi.unstubAllGlobals()
  })

  it("publishes only sections allowed by the authenticated RBAC snapshot", () => {
    const tools = voiceTools(["leads"], "en")
    const navigate = tools.find((tool) => tool.name === "navigate_to_section")
    const section = navigate?.parameters.properties.section as { enum?: string[] }
    expect(section.enum).toEqual(["leads"])
  })

  it("has no OpenAI handshake, key, fallback, or connect endpoint in the browser voice path", () => {
    const files = [
      "src/components/ai/voice-console.tsx",
      "src/lib/ai/voice/gemini-live.ts",
      "src/app/api/v1/ai/voice/session/token/route.ts",
      "src/lib/ai/voice/config.ts",
    ].map((path) => readFileSync(path, "utf8")).join("\n")
    expect(files).not.toContain("api.openai.com")
    expect(files).not.toContain("OPENAI_API_KEY")
    expect(files).not.toContain("createRealtimeCall")
    expect(files).not.toContain('"/api/v1/ai/voice/session/connect"')
  })

  it("keeps barge-in working while ignoring room noise", () => {
    const config = geminiLiveConfig({ locale: "ru", firstName: "Rəşad", allowedSections: ["leads"] })
    const vad = config.realtimeInputConfig?.automaticActivityDetection

    // Interruption itself must stay on: the complaint was that NOISE stopped
    // the assistant, not that the user could. Turning detection off, or moving
    // activityHandling away from interrupts, would fix the symptom by removing
    // the feature.
    expect(vad?.disabled).toBe(false)
    expect(config.realtimeInputConfig?.activityHandling).toBe("START_OF_ACTIVITY_INTERRUPTS")

    // And the thresholds must stay on the tolerant side of the dial.
    expect(vad?.startOfSpeechSensitivity).toBe("START_SENSITIVITY_LOW")
    expect(vad?.silenceDurationMs).toBeGreaterThanOrEqual(700)
  })

})
