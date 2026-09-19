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
type RouteHandler<C = unknown> = (
  req: NextRequest,
  auth: AuthContext,
  ctx: C,
) => Promise<Response>

const deps = vi.hoisted(() => ({
  updateDraft: vi.fn(),
  cancelDraft: vi.fn(),
  getActiveDraft: vi.fn(),
  checkVoicePilotAccess: vi.fn(async () => ({ ok: true as const })),
  checkRateLimit: vi.fn(() => true),
}))

vi.mock("@/lib/with-rls", () => ({
  withRlsSessionAuth: <C,>(handler: RouteHandler<C>) => (req: NextRequest, ctx: C) => handler(req, {
    orgId: "org-1",
    userId: "user-1",
    role: "manager",
    email: "manager@example.com",
    name: "Manager",
    principalType: "session",
  }, ctx),
}))

vi.mock("@/lib/ai/voice/gate", () => ({
  checkVoicePilotAccess: deps.checkVoicePilotAccess,
}))

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: deps.checkRateLimit,
}))

vi.mock("@/lib/ai/voice/action-draft", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/voice/action-draft")>(
    "@/lib/ai/voice/action-draft",
  )
  return {
    ...actual,
    updateAiVoiceActionDraft: deps.updateDraft,
    cancelAiVoiceActionDraft: deps.cancelDraft,
    getActiveAiVoiceActionDraft: deps.getActiveDraft,
  }
})

import { PATCH } from "@/app/api/v1/ai/voice/actions/[id]/route"
import { POST as CANCEL } from "@/app/api/v1/ai/voice/actions/[id]/cancel/route"
import { GET as ACTIVE } from "@/app/api/v1/ai/voice/actions/active/route"

const receipt = {
  id: "intent-1",
  voiceSessionId: "voice-1",
  actionType: "create_task",
  state: "awaiting_confirmation",
  revision: 2,
  payloadHash: "a".repeat(64),
  preview: { contract: 1 },
  warnings: [],
  target: null,
  expiresAt: "2026-09-19T12:10:00.000Z",
  createdAt: "2026-09-19T12:00:00.000Z",
  updatedAt: "2026-09-19T12:01:00.000Z",
  replayed: false,
}

function mutationRequest(path: string, method: "PATCH" | "POST", body: unknown, headers = {}) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  })
}

const routeContext = { params: Promise.resolve({ id: "intent-1" }) }

beforeEach(() => {
  vi.clearAllMocks()
  deps.checkVoicePilotAccess.mockResolvedValue({ ok: true })
  deps.checkRateLimit.mockReturnValue(true)
  deps.updateDraft.mockResolvedValue(receipt)
  deps.cancelDraft.mockResolvedValue({ ...receipt, state: "cancelled" })
  deps.getActiveDraft.mockResolvedValue(receipt)
})

describe("AI voice action draft lifecycle routes", () => {
  it("PATCH replaces only the payload at an expected revision", async () => {
    const response = await PATCH(mutationRequest(
      "/api/v1/ai/voice/actions/intent-1",
      "PATCH",
      { expectedRevision: 1, payload: { title: "Edited" } },
    ), routeContext)

    expect(response.status).toBe(200)
    expect(deps.updateDraft).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1", userId: "user-1" }),
      { intentId: "intent-1", expectedRevision: 1, payload: { title: "Edited" } },
    )
  })

  it("cancel requires a strict revision body and same-origin browser mutation", async () => {
    const invalid = await CANCEL(mutationRequest(
      "/api/v1/ai/voice/actions/intent-1/cancel",
      "POST",
      { expectedRevision: 1, organizationId: "attacker-org" },
    ), routeContext)
    expect(invalid.status).toBe(400)

    const crossOrigin = await CANCEL(mutationRequest(
      "/api/v1/ai/voice/actions/intent-1/cancel",
      "POST",
      { expectedRevision: 1 },
      { "sec-fetch-site": "cross-site" },
    ), routeContext)
    expect(crossOrigin.status).toBe(403)
    expect(deps.cancelDraft).not.toHaveBeenCalled()
  })

  it("GET restores the active receipt for an explicit voice session", async () => {
    const response = await ACTIVE(new NextRequest(
      "http://localhost/api/v1/ai/voice/actions/active?voiceSessionId=voice-1",
    ), undefined as never)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      data: { id: "intent-1", state: "awaiting_confirmation" },
    })
    expect(deps.getActiveDraft).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1", userId: "user-1" }),
      "voice-1",
    )
  })

  it("rejects missing active-session IDs and fails closed on the pilot gate", async () => {
    const invalid = await ACTIVE(new NextRequest(
      "http://localhost/api/v1/ai/voice/actions/active",
    ), undefined as never)
    expect(invalid.status).toBe(400)

    deps.checkVoicePilotAccess.mockResolvedValueOnce({
      ok: false,
      reason: "voice_not_granted",
    } as never)
    const forbidden = await PATCH(mutationRequest(
      "/api/v1/ai/voice/actions/intent-1",
      "PATCH",
      { expectedRevision: 1, payload: { title: "Edited" } },
    ), routeContext)
    expect(forbidden.status).toBe(403)
  })

  it("rate-limits each lifecycle surface", async () => {
    deps.checkRateLimit.mockReturnValue(false)
    const response = await CANCEL(mutationRequest(
      "/api/v1/ai/voice/actions/intent-1/cancel",
      "POST",
      { expectedRevision: 1 },
    ), routeContext)
    expect(response.status).toBe(429)
  })
})
