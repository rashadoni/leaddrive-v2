import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

type Marker = string | null
type AuthContext = { orgId: string; userId: string; role: string }
type RouteHandler = (req: NextRequest, auth: AuthContext) => Promise<Response>

const state = vi.hoisted(() => ({
  marker: null as Marker,
  status: "active",
  loseFinalize: false,
}))

const deps = vi.hoisted(() => ({
  createGeminiLiveToken: vi.fn(async () => ({
    token: "short-lived-token",
    expiresAt: "2026-08-14T11:02:00.000Z",
  })),
  updateMany: vi.fn(async (args: {
    where: { status?: string; elevenlabsConversationId?: Marker }
    data: { elevenlabsConversationId?: Marker }
  }) => {
    const expected = args.where.elevenlabsConversationId
    if (state.status !== (args.where.status ?? state.status) || state.marker !== expected) return { count: 0 }
    if (args.data.elevenlabsConversationId?.startsWith("gemini:issued:") && state.loseFinalize) {
      state.status = "ended"
      return { count: 0 }
    }
    if ("elevenlabsConversationId" in args.data) state.marker = args.data.elevenlabsConversationId ?? null
    return { count: 1 }
  }),
}))

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: RouteHandler) =>
    (req: NextRequest) => handler(req, { orgId: "org-1", userId: "user-1", role: "admin" }),
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    voiceSession: {
      findFirst: vi.fn(async () => ({ locale: "az", expiresAt: new Date(Date.now() + 60_000) })),
      updateMany: deps.updateMany,
    },
    user: { findFirst: vi.fn(async () => ({ name: "Rashad Rahimov" })) },
  },
}))
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(() => true) }))
vi.mock("@/lib/ai/voice/gate", () => ({ checkVoicePilotAccess: vi.fn(async () => ({ ok: true })) }))
vi.mock("@/lib/api-auth", () => ({
  getOrgModuleContext: vi.fn(async () => ({ plan: "enterprise", addons: [], modules: { ai: true } })),
}))
vi.mock("@/lib/ai/voice/read-access", () => ({ accessibleVoiceSectionKeys: vi.fn(() => ["leads"]) }))
vi.mock("@/lib/ai/voice/config", () => ({
  MAX_SESSION_SECONDS: 3_600,
  readVoicePilotConfig: vi.fn(() => ({ geminiApiKey: "server-key" })),
}))
vi.mock("@/lib/ai/voice/gemini-live", () => ({
  createGeminiLiveToken: deps.createGeminiLiveToken,
  GEMINI_LIVE_MODEL: "gemini-3.1-flash-live-preview",
  GEMINI_LIVE_API_VERSION: "v1beta",
}))
vi.mock("@/lib/social/review-apply-request", () => ({ guardInteractiveJsonMutation: vi.fn(() => null) }))

import { POST } from "@/app/api/v1/ai/voice/session/token/route"

function request(body: Record<string, unknown> = { voiceSessionId: "voice-session-1" }) {
  return new NextRequest("http://localhost/api/v1/ai/voice/session/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  state.marker = null
  state.status = "active"
  state.loseFinalize = false
  deps.createGeminiLiveToken.mockResolvedValue({
    token: "short-lived-token",
    expiresAt: "2026-08-14T11:02:00.000Z",
  })
})

describe("Gemini Live ephemeral token one-shot lifecycle", () => {
  it("mints one constrained token and blocks a sequential replay before provider dispatch", async () => {
    const first = await POST(request())
    const replay = await POST(request())

    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({
      data: expect.objectContaining({
        token: "short-lived-token",
        expiresAt: "2026-08-14T11:02:00.000Z",
        model: "gemini-3.1-flash-live-preview",
        apiVersion: "v1beta",
        connectionId: expect.any(String),
      }),
    })
    expect(first.headers.get("cache-control")).toBe("no-store, private")
    expect(replay.status).toBe(409)
    expect(deps.createGeminiLiveToken).toHaveBeenCalledTimes(1)
    expect(deps.createGeminiLiveToken).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: "server-key",
      allowedSections: ["leads"],
      maxSessionSeconds: 3_600,
    }))
    expect(state.marker).toMatch(/^gemini:issued:/)
  })

  it("atomically admits only one of two concurrent token requests", async () => {
    let releaseProvider!: () => void
    const providerStarted = new Promise<void>((resolve) => {
      deps.createGeminiLiveToken.mockImplementationOnce(async () => {
        resolve()
        await new Promise<void>((release) => { releaseProvider = release })
        return { token: "short-lived-token", expiresAt: "2026-08-14T11:02:00.000Z" }
      })
    })
    const firstPromise = POST(request())
    await providerStarted
    const replayPromise = POST(request())
    releaseProvider()
    const responses = await Promise.all([firstPromise, replayPromise])
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409])
    expect(deps.createGeminiLiveToken).toHaveBeenCalledTimes(1)
  })

  it("keeps the claim after an ambiguous mint failure and blocks retry", async () => {
    deps.createGeminiLiveToken.mockRejectedValueOnce(new Error("network outcome unknown"))
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const failed = await POST(request())
    const replay = await POST(request())
    expect(failed.status).toBe(502)
    expect(replay.status).toBe(409)
    expect(deps.createGeminiLiveToken).toHaveBeenCalledTimes(1)
    expect(state.marker).toMatch(/^gemini:minting:/)
    expect(consoleSpy).toHaveBeenCalledWith("[voice] Gemini Live token mint failed")
    consoleSpy.mockRestore()
  })

  it("does not return the token when exact-marker finalization loses", async () => {
    state.loseFinalize = true
    const response = await POST(request())
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: "Session is no longer active" })
    expect(state.status).toBe("ended")
  })

  it("uses the same nonce for connecting and connected CAS markers", async () => {
    expect((await POST(request())).status).toBe(200)
    const [claim, finalize] = deps.updateMany.mock.calls.map(([args]) => args)
    const connecting = claim.data.elevenlabsConversationId as string
    const connected = finalize.data.elevenlabsConversationId as string
    expect(claim.where.elevenlabsConversationId).toBeNull()
    expect(finalize.where.elevenlabsConversationId).toBe(connecting)
    expect(connected.replace("gemini:issued:", "")).toBe(connecting.replace("gemini:minting:", ""))
  })

  it("rejects legacy SDP input instead of exposing a hidden handshake path", async () => {
    const response = await POST(request({
      voiceSessionId: "voice-session-1",
      sdp: "v=0 old OpenAI offer",
    }))
    expect(response.status).toBe(400)
    expect(deps.createGeminiLiveToken).not.toHaveBeenCalled()
  })
})
