import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

type AuthContext = {
  orgId: string
  userId: string
  role: "manager"
  email: string
  name: string
  principalType: "session"
}
type RouteHandler = (req: NextRequest, auth: AuthContext) => Promise<Response>

const deps = vi.hoisted(() => ({
  createDraft: vi.fn(),
  checkVoicePilotAccess: vi.fn(async () => ({ ok: true as const })),
  checkRateLimit: vi.fn(() => true),
}))

vi.mock("@/lib/with-rls", () => ({
  withRlsSessionAuth: (handler: RouteHandler) => (req: NextRequest) => handler(req, {
    orgId: "org-1",
    userId: "user-1",
    role: "manager",
    email: "manager@example.com",
    name: "Manager",
    principalType: "session",
  }),
}))

vi.mock("@/lib/ai/voice/gate", () => ({
  checkVoicePilotAccess: deps.checkVoicePilotAccess,
  // Write routes run the write gate, which wraps the pilot gate.
  checkVoiceWriteAccess: deps.checkVoicePilotAccess,
}))

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: deps.checkRateLimit,
}))

vi.mock("@/lib/ai/voice/action-draft", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/voice/action-draft")>(
    "@/lib/ai/voice/action-draft",
  )
  return { ...actual, createAiVoiceActionDraft: deps.createDraft }
})

import { AiVoiceActionDraftError } from "@/lib/ai/voice/action-draft"
import { POST } from "@/app/api/v1/ai/voice/actions/draft/route"

function request(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest("http://localhost/api/v1/ai/voice/actions/draft", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  })
}

function validBody() {
  return {
    voiceSessionId: "voice-1",
    actionType: "create_lead",
    payload: { contactName: "Ali Mammadov", phone: "+994501234567" },
    idempotencyKey: "draft:lead:0001",
    providerToolCallId: "gemini-call-1",
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  deps.checkVoicePilotAccess.mockResolvedValue({ ok: true })
  deps.checkRateLimit.mockReturnValue(true)
  deps.createDraft.mockResolvedValue({
    id: "intent-1",
    voiceSessionId: "voice-1",
    actionType: "create_lead",
    state: "awaiting_confirmation",
    revision: 1,
    payloadHash: "a".repeat(64),
    preview: { contract: 1 },
    warnings: [],
    target: null,
    expiresAt: "2026-09-19T12:10:00.000Z",
    createdAt: "2026-09-19T12:00:00.000Z",
    updatedAt: "2026-09-19T12:00:00.000Z",
    replayed: false,
  })
})

describe("POST /api/v1/ai/voice/actions/draft", () => {
  it("creates a receipt through the authenticated session identity", async () => {
    const response = await POST(request(validBody()))

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      success: true,
      data: { id: "intent-1", state: "awaiting_confirmation", replayed: false },
    })
    expect(deps.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-1",
        userId: "user-1",
        principalType: "session",
      }),
      validBody(),
    )
  })

  it("returns 200 for an idempotent replay", async () => {
    deps.createDraft.mockResolvedValueOnce({
      id: "intent-1",
      voiceSessionId: "voice-1",
      actionType: "create_lead",
      state: "awaiting_confirmation",
      revision: 1,
      payloadHash: "a".repeat(64),
      preview: { contract: 1 },
      warnings: [],
      target: null,
      expiresAt: "2026-09-19T12:10:00.000Z",
      createdAt: "2026-09-19T12:00:00.000Z",
      updatedAt: "2026-09-19T12:00:00.000Z",
      replayed: true,
    })

    const response = await POST(request(validBody()))

    expect(response.status).toBe(200)
    expect((await response.json()).data.replayed).toBe(true)
  })

  it("rejects unknown actions, extra envelope fields, and malformed keys", async () => {
    for (const body of [
      { ...validBody(), actionType: "delete_lead" },
      { ...validBody(), organizationId: "attacker-org" },
      { ...validBody(), idempotencyKey: "bad key" },
    ]) {
      const response = await POST(request(body))
      expect(response.status).toBe(400)
      expect((await response.json()).code).toBe("INVALID_DRAFT_REQUEST")
    }
    expect(deps.createDraft).not.toHaveBeenCalled()
  })

  it("requires same-origin JSON and rejects bearer credentials", async () => {
    const bearer = await POST(request(validBody(), { authorization: "Bearer ld_not_allowed" }))
    expect(bearer.status).toBe(403)
    expect(await bearer.json()).toEqual({ error: "interactive_session_required" })

    const crossOrigin = await POST(request(validBody(), { "sec-fetch-site": "cross-site" }))
    expect(crossOrigin.status).toBe(403)
    expect(await crossOrigin.json()).toEqual({ error: "cross_origin_request_rejected" })
  })

  it("fails closed on the voice gate and request rate limit", async () => {
    deps.checkVoicePilotAccess.mockResolvedValueOnce({
      ok: false,
      reason: "voice_not_granted",
    } as never)
    const forbidden = await POST(request(validBody()))
    expect(forbidden.status).toBe(403)
    expect(await forbidden.json()).toEqual({
      error: "Forbidden",
      reason: "voice_not_granted",
    })

    deps.checkRateLimit.mockReturnValueOnce(false)
    const limited = await POST(request(validBody()))
    expect(limited.status).toBe(429)
  })

  it("maps safe draft errors without exposing internal failures", async () => {
    deps.createDraft.mockRejectedValueOnce(new AiVoiceActionDraftError(
      "ACTIVE_INTENT_EXISTS",
      "This voice session already has an active action draft",
      409,
      { activeIntentId: "intent-active" },
    ))
    const conflict = await POST(request(validBody()))
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toEqual({
      error: "This voice session already has an active action draft",
      code: "ACTIVE_INTENT_EXISTS",
      details: { activeIntentId: "intent-active" },
    })

    deps.createDraft.mockRejectedValueOnce(new Error("database exploded"))
    const internal = await POST(request(validBody()))
    expect(internal.status).toBe(500)
    expect(await internal.json()).toEqual({ error: "Internal server error" })
  })
})
