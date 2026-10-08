import { readFileSync } from "node:fs"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  createGeminiLiveToken,
  DEFAULT_GEMINI_LIVE_MODEL,
  geminiLiveConfig,
  geminiLiveModel,
  geminiLiveTokenConfig,
  geminiLiveSystemInstruction,
  GEMINI_LIVE_API_VERSION,
  GEMINI_LIVE_VOICE,
  usableGeminiLiveModelId,
} from "@/lib/ai/voice/gemini-live"
import { voiceTools } from "@/lib/ai/voice/realtime-tool-contract"

const LEGACY_MODEL = "gemini-3.1-flash-live-preview"
const NEXT_MODEL = "gemini-3.8-live"

type Declaration = { name?: string; behavior?: string }

function declarationsOf(config: { tools?: unknown }): Declaration[] {
  return (config.tools as Array<{ functionDeclarations?: Declaration[] }>)[0]?.functionDeclarations ?? []
}

/** The setup Google actually receives when a token is minted. */
async function mintedSetup(): Promise<{
  result: Awaited<ReturnType<typeof createGeminiLiveToken>>
  body: {
    fieldMask: string
    bidiGenerateContentSetup: {
      model: string
      generationConfig: Record<string, unknown>
      tools: Array<{ functionDeclarations: Declaration[] }>
    }
  }
}> {
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
    maxSessionSeconds: 300,
  })
  return { result, body: JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)) }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

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
    // Google retires this preview no earlier than 2026-11-17. It stays the
    // default until the provider check has opened a real 3.8 session on
    // production; moving it is one constant and this line.
    expect(DEFAULT_GEMINI_LIVE_MODEL).toBe(LEGACY_MODEL)
    expect(geminiLiveModel().id).toBe(LEGACY_MODEL)
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
    // This used to pin "all available CRM tools are read-only". The propose_*
    // tools made that false, and the rules below say something stronger: the
    // assistant may prepare, must not claim it did anything, and must not
    // decide on its own that the user confirmed: the app hears the answer.
    expect(prompt).toContain("Never say that something was created, changed, converted or saved")
    expect(prompt).toContain("only PREPARE a draft")
    expect(prompt).toContain("The app itself hears the user's own short answer")
    expect(prompt).not.toContain("all available CRM tools are read-only")
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
      model: DEFAULT_GEMINI_LIVE_MODEL,
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
        model: `models/${DEFAULT_GEMINI_LIVE_MODEL}`,
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

describe("Gemini Live model selection", () => {
  it("sends 3.8 Live a setup it accepts: no thinking level, every tool blocking", async () => {
    vi.stubEnv("VOICE_GEMINI_LIVE_MODEL", NEXT_MODEL)
    const { result, body } = await mintedSetup()
    const setup = body.bidiGenerateContentSetup

    expect(result.model).toBe(NEXT_MODEL)
    expect(setup.model).toBe(`models/${NEXT_MODEL}`)
    // Absent, not null and not MINIMAL: the provider rejects the field itself.
    expect(setup.generationConfig).not.toHaveProperty("thinkingConfig")
    expect(JSON.stringify(body)).not.toContain("thinkingLevel")
    // 3.8 keeps talking while a tool runs unless told otherwise. One tool left
    // on that default is one answer spoken before its data.
    const declarations = setup.tools[0]!.functionDeclarations
    expect(declarations.length).toBeGreaterThan(10)
    expect(declarations.filter((declaration) => declaration.behavior !== "BLOCKING")).toEqual([])
    // Still locked as a whole: the browser cannot drop the tools or their mode.
    expect(body.fieldMask.split(",")).toEqual(expect.arrayContaining(["model", "generationConfig", "tools"]))
  })

  it("sends 3.1 the setup it has been running on", async () => {
    vi.stubEnv("VOICE_GEMINI_LIVE_MODEL", LEGACY_MODEL)
    const { result, body } = await mintedSetup()
    const setup = body.bidiGenerateContentSetup

    expect(result.model).toBe(LEGACY_MODEL)
    expect(setup.model).toBe(`models/${LEGACY_MODEL}`)
    // Raised from MINIMAL after "five boards". Going back to 3.1 by env must
    // not quietly lose that.
    expect(setup.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "LOW" })
    // 3.1 has no async mode and was never sent this field.
    expect(JSON.stringify(body)).not.toContain("behavior")
  })

  it("reads the switch on every mint, not once at start-up", () => {
    expect(geminiLiveModel().id).toBe(DEFAULT_GEMINI_LIVE_MODEL)
    vi.stubEnv("VOICE_GEMINI_LIVE_MODEL", NEXT_MODEL)
    expect(geminiLiveModel()).toEqual({ id: NEXT_MODEL, thinkingLevel: null, toolBehavior: "BLOCKING" })
    vi.stubEnv("VOICE_GEMINI_LIVE_MODEL", LEGACY_MODEL)
    expect(geminiLiveModel()).toEqual({ id: LEGACY_MODEL, thinkingLevel: "LOW", toolBehavior: null })
    vi.stubEnv("VOICE_GEMINI_LIVE_MODEL", "gemini-3.9-live")
    // A later id gets the current setup; nobody has to release code to try it.
    expect(geminiLiveModel()).toEqual({ id: "gemini-3.9-live", thinkingLevel: null, toolBehavior: "BLOCKING" })
  })

  it("treats an empty variable as unset", () => {
    // The deploy tooling exports unset variables as empty strings.
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    for (const empty of ["", "   "]) {
      vi.stubEnv("VOICE_GEMINI_LIVE_MODEL", empty)
      expect(geminiLiveModel().id).toBe(DEFAULT_GEMINI_LIVE_MODEL)
    }
    expect(log).not.toHaveBeenCalled()
  })

  it("falls back to the default, loudly, on a value that cannot work", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const unusable = [
      // Async-only tools, and turnComplete stops meaning "finished".
      "gemini-3.8-live-extended-thinking",
      // Not Live models at all.
      "gemini-3.8-flash",
      "gemini-3.8-flash-tts",
      // Not model ids.
      "models/gemini-3.8-live",
      "gemini-3.8-live\nx-goog-api-key: other",
      "Gemini-3.8-Live",
    ]
    for (const value of unusable) {
      vi.stubEnv("VOICE_GEMINI_LIVE_MODEL", value)
      expect(usableGeminiLiveModelId(value), value).toBe(false)
      expect(geminiLiveModel(), value).toEqual(geminiLiveModel(DEFAULT_GEMINI_LIVE_MODEL))
    }
    expect(log).toHaveBeenCalledTimes(unusable.length)

    vi.stubEnv("VOICE_GEMINI_LIVE_MODEL", "gemini-3.8-live-extended-thinking")
    const { result, body } = await mintedSetup()
    expect(result.model).toBe(DEFAULT_GEMINI_LIVE_MODEL)
    expect(body.bidiGenerateContentSetup.model).toBe(`models/${DEFAULT_GEMINI_LIVE_MODEL}`)
  })

  it("keeps the id and its setup together when a caller passes the model in", () => {
    const base = { locale: "az", firstName: "", allowedSections: ["leads"] }
    const legacy = geminiLiveConfig({ ...base, model: geminiLiveModel(LEGACY_MODEL) })
    expect(legacy.thinkingConfig).toEqual({ thinkingLevel: "LOW" })
    expect(declarationsOf(legacy).some((declaration) => "behavior" in declaration)).toBe(false)

    const next = geminiLiveConfig({ ...base, model: geminiLiveModel(NEXT_MODEL) })
    expect(next).not.toHaveProperty("thinkingConfig")
    expect(declarationsOf(next).every((declaration) => declaration.behavior === "BLOCKING")).toBe(true)
    // The model changes two fields and nothing else: same tools, same prompt.
    expect(declarationsOf(next).map((declaration) => declaration.name))
      .toEqual(declarationsOf(legacy).map((declaration) => declaration.name))
    expect(next.systemInstruction).toBe(legacy.systemInstruction)
    expect(next.realtimeInputConfig).toEqual(legacy.realtimeInputConfig)
    expect(next.speechConfig).toEqual(legacy.speechConfig)
  })
})
