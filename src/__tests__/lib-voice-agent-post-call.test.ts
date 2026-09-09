import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  analyzeVoiceCall,
  fallbackPostCallAnalysis,
  formatVoiceTranscript,
  toConversationInsight,
  voiceAgentCallResultSchema,
} from "@/lib/voice-agent/post-call"

const originalApiKey = process.env.OPENAI_API_KEY

describe("voice-agent post-call analysis", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-api-key"
    vi.stubGlobal("fetch", vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = originalApiKey
  })

  it("accepts legacy transcript results and explicit terminal outcomes", () => {
    const legacy = voiceAgentCallResultSchema.safeParse({
      callId: "9f5fa15c-a6f0-4f6f-af73-c5049e3d9de7",
      durationSeconds: 42,
      turns: [{ role: "customer", text: "Mən maraqlanıram." }],
    })
    expect(legacy.success).toBe(true)

    const noAnswer = voiceAgentCallResultSchema.safeParse({
      callId: "9f5fa15c-a6f0-4f6f-af73-c5049e3d9de7",
      durationSeconds: 12,
      providerOutcome: "no_answer",
    })
    expect(noAnswer.success).toBe(true)
    if (noAnswer.success) expect(noAnswer.data.turns).toEqual([])
  })

  it("accepts an explicit connected hangup even when no transcript was finalized", () => {
    expect(voiceAgentCallResultSchema.safeParse({
      callId: "9f5fa15c-a6f0-4f6f-af73-c5049e3d9de7",
      durationSeconds: 42,
      turns: [],
    }).success).toBe(false)
    expect(voiceAgentCallResultSchema.safeParse({
      callId: "9f5fa15c-a6f0-4f6f-af73-c5049e3d9de7",
      durationSeconds: 42,
      providerOutcome: "connected",
      turns: [],
    }).success).toBe(true)
    expect(voiceAgentCallResultSchema.safeParse({
      callId: "9f5fa15c-a6f0-4f6f-af73-c5049e3d9de7",
      durationSeconds: 42,
      providerOutcome: "unknown",
      turns: [],
    }).success).toBe(false)
  })

  it("formats a seller-readable transcript without metadata", () => {
    expect(formatVoiceTranscript([
      { role: "agent", text: "Salam." },
      { role: "customer", text: "Ətraflı məlumat verin." },
    ])).toBe("AI operator: Salam.\nMüştəri: Ətraflı məlumat verin.")
  })

  it("creates a safe extractive fallback when analysis is unavailable", () => {
    const fallback = fallbackPostCallAnalysis([
      { role: "agent", text: "Salam." },
      { role: "customer", text: "Sabah yenidən zəng edin." },
    ])
    expect(fallback.summary).toContain("Sabah yenidən zəng edin.")
    expect(fallback.disposition).toBe("other")
    expect(fallback.nextStep).toBeNull()
  })

  it("requests strict structured analysis and maps it to existing CRM insights", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      model: "post-call-model",
      output_text: JSON.stringify({
        summary: "Müştəri təkliflə maraqlandı.",
        sentiment: "positive",
        sentimentScore: 0.8,
        topics: ["qiymət"],
        disposition: "callback",
        nextStep: "Sabah yenidən zəng edin.",
      }),
    }), { status: 200 }))

    const result = await analyzeVoiceCall({
      organizationId: "org-test",
      callId: "9f5fa15c-a6f0-4f6f-af73-c5049e3d9de7",
      turns: [{ role: "customer", text: "Qiyməti danışaq." }],
    })

    const [, init] = vi.mocked(fetch).mock.calls[0]
    const requestBody = JSON.parse(String(init?.body))
    expect(requestBody.safety_identifier).toMatch(/^[a-f0-9]{64}$/)
    expect(requestBody.text.format.strict).toBe(true)
    expect(requestBody.input).toContain("Müştəri: Qiyməti danışaq.")
    expect(requestBody.input).not.toContain("org-test")

    const insight = toConversationInsight(result.analysis, result.model)
    expect(insight.summary).toBe("Müştəri təkliflə maraqlandı.")
    expect(insight.actionItems).toEqual([{
      text: "Sabah yenidən zəng edin.",
      owner: "agent",
      dueDateHint: null,
    }])
  })
})
