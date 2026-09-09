import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }))

vi.mock("@/lib/prisma", () => ({
  prisma: { channelConfig: { findMany: mocks.findMany } },
}))
vi.mock("@/lib/rls-context", () => ({
  runWithTenant: vi.fn((_organizationId: string, fn: () => unknown) => fn()),
}))

import { GET } from "@/app/api/internal/voice-agent/runtime-config/route"
import { TECHNICAL_VOICE_POLICY_VERSION } from "@/lib/voice-agent/default-prompt"

const originalToken = process.env.FANUM_VOICE_RUNTIME_TOKEN
const originalOrg = process.env.VOICE_AGENT_ORGANIZATION_ID

function request(token = "runtime-token") {
  return new NextRequest("http://localhost/api/internal/voice-agent/runtime-config", {
    headers: { authorization: `Bearer ${token}` },
  })
}

function row(settings: Record<string, unknown>) {
  return {
    id: String(settings.voiceAgentPrompt),
    configName: "Asterisk",
    phoneNumber: null,
    apiKey: null,
    settings: {
      provider: "asterisk",
      ariHost: "pbx.internal",
      ariPort: 8088,
      username: "ari-user",
      password: "private-password",
      context: "outbound-routes",
      callerExtension: "100",
      ...settings,
    },
    isActive: true,
  }
}

describe("GET /api/internal/voice-agent/runtime-config", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.FANUM_VOICE_RUNTIME_TOKEN = "runtime-token"
    process.env.VOICE_AGENT_ORGANIZATION_ID = "org-test"
  })

  afterEach(() => {
    if (originalToken === undefined) delete process.env.FANUM_VOICE_RUNTIME_TOKEN
    else process.env.FANUM_VOICE_RUNTIME_TOKEN = originalToken
    if (originalOrg === undefined) delete process.env.VOICE_AGENT_ORGANIZATION_ID
    else process.env.VOICE_AGENT_ORGANIZATION_ID = originalOrg
  })

  it("keeps the technical voice policy identifier stable for UI audits", () => {
    expect(TECHNICAL_VOICE_POLICY_VERSION).toBe("fanum-voice-policy-v1")
  })

  it("prefers the same ready manual outbound config over a newer inbound-only row", async () => {
    mocks.findMany.mockResolvedValue([
      row({
        voiceAgentEnabled: true,
        voiceAgentMode: "inbound",
        voiceAgentPrompt: "Inbound prompt",
      }),
      row({
        voiceAgentEnabled: true,
        voiceAgentMode: "outbound",
        manualLeadAiCallsEnabled: true,
        voiceAgentPrompt: "  Manual outbound prompt  ",
      }),
    ])

    const response = await GET(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      enabled: true,
      prompt: "Manual outbound prompt",
      technicalVoicePolicyVersion: TECHNICAL_VOICE_POLICY_VERSION,
    })
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    }))
  })

  it("keeps the existing inbound-only runtime fallback working", async () => {
    mocks.findMany.mockResolvedValue([
      row({
        voiceAgentEnabled: true,
        voiceAgentMode: "inbound",
        voiceAgentPrompt: "Inbound fallback prompt",
      }),
    ])

    const response = await GET(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      enabled: true,
      prompt: "Inbound fallback prompt",
      technicalVoicePolicyVersion: TECHNICAL_VOICE_POLICY_VERSION,
    })
  })

  it("combines visible CRM conversation rules and product knowledge", async () => {
    mocks.findMany.mockResolvedValue([
      row({
        voiceAgentEnabled: true,
        voiceAgentMode: "outbound",
        manualLeadAiCallsEnabled: true,
        voiceAgentPrompt: "Conversation rules",
        voiceAgentKnowledge: "Verified product fact",
      }),
    ])

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.enabled).toBe(true)
    expect(body.technicalVoicePolicyVersion).toBe(TECHNICAL_VOICE_POLICY_VERSION)
    expect(body.prompt).toContain("Conversation rules")
    expect(body.prompt).toContain("# Şirkət və məhsullar haqqında təsdiqlənmiş biliklər")
    expect(body.prompt).toContain("Verified product fact")
  })

  it("returns the auditable CRM default instead of an empty hidden-fallback prompt", async () => {
    mocks.findMany.mockResolvedValue([
      row({
        voiceAgentEnabled: true,
        voiceAgentMode: "outbound",
        manualLeadAiCallsEnabled: true,
        voiceAgentPrompt: "",
        voiceAgentKnowledge: "",
      }),
    ])

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.enabled).toBe(true)
    expect(body.technicalVoicePolicyVersion).toBe(TECHNICAL_VOICE_POLICY_VERSION)
    expect(body.prompt).toContain("Sən şirkətin AI səsli operatorusan")
    expect(body.prompt.length).toBeGreaterThan(100)
  })

  it("does not expose configuration without the PBX bearer", async () => {
    const response = await GET(request("wrong-token"))
    expect(response.status).toBe(401)
    expect(mocks.findMany).not.toHaveBeenCalled()
  })
})
