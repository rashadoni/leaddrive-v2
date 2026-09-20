import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

/** Both branches, so a denial fixture is assignable to the mock. */
type VoicePilotGate = { ok: true } | { ok: false; reason: string }

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
  resolveProposal: vi.fn(),
  checkVoicePilotAccess: vi.fn<() => Promise<VoicePilotGate>>(async () => ({ ok: true })),
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
}))

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: deps.checkRateLimit,
}))

vi.mock("@/lib/ai/voice/propose-resolve", () => ({
  resolveVoiceProposal: deps.resolveProposal,
}))

vi.mock("@/lib/ai/voice/action-draft", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/voice/action-draft")>(
    "@/lib/ai/voice/action-draft",
  )
  return { ...actual, createAiVoiceActionDraft: deps.createDraft }
})

import { AiVoiceActionDraftError } from "@/lib/ai/voice/action-draft"
import { POST } from "@/app/api/v1/ai/voice/actions/propose/route"

function request(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest("http://localhost/api/v1/ai/voice/actions/propose", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  })
}

function validBody() {
  return {
    voiceSessionId: "voice-1",
    tool: "propose_create_task",
    args: { title: "Call Ali back", assigneeName: "Aysel" },
    providerToolCallId: "gemini-call-1",
    screen: { recordType: "lead", recordId: "lead-5" },
  }
}

const receipt = {
  id: "intent-1",
  voiceSessionId: "voice-1",
  actionType: "create_task",
  state: "awaiting_confirmation",
  revision: 1,
  payloadHash: "a".repeat(64),
  preview: null,
  warnings: [],
  target: null,
  expiresAt: "2026-09-20T12:10:00.000Z",
  createdAt: "2026-09-20T12:00:00.000Z",
  updatedAt: "2026-09-20T12:00:00.000Z",
  replayed: false,
}

beforeEach(() => {
  deps.createDraft.mockReset()
  deps.resolveProposal.mockReset()
  deps.checkRateLimit.mockReset()
  deps.checkRateLimit.mockReturnValue(true)
  deps.checkVoicePilotAccess.mockReset()
  deps.checkVoicePilotAccess.mockResolvedValue({ ok: true })

  deps.resolveProposal.mockResolvedValue({
    kind: "resolved",
    actionType: "create_task",
    payload: { title: "Call Ali back", assignedTo: "user-7" },
  })
  deps.createDraft.mockResolvedValue(receipt)
})

describe("proposing an action", () => {
  it("resolves the proposal and stores a draft for the receipt to show", async () => {
    const response = await POST(request(validBody()))
    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({ success: true, data: { id: "intent-1" } })

    expect(deps.resolveProposal).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1", userId: "user-1" }),
      "propose_create_task",
      { title: "Call Ali back", assigneeName: "Aysel" },
      { recordType: "lead", recordId: "lead-5" },
    )
    expect(deps.createDraft.mock.calls[0][1]).toMatchObject({
      voiceSessionId: "voice-1",
      actionType: "create_task",
      payload: { title: "Call Ali back", assignedTo: "user-7" },
      providerToolCallId: "gemini-call-1",
    })
  })

  it("keys the draft on the provider tool call, so a retried call replays", async () => {
    await POST(request(validBody()))
    expect(deps.createDraft.mock.calls[0][1].idempotencyKey).toBe("propose:gemini-call-1")
  })

  it("passes a resolved lead target through as the draft's target", async () => {
    deps.resolveProposal.mockResolvedValue({
      kind: "resolved",
      actionType: "update_lead",
      payload: { phone: "+994501234567" },
      targetEntityId: "lead-9",
    })
    await POST(request({ ...validBody(), tool: "propose_update_lead" }))
    expect(deps.createDraft.mock.calls[0][1].targetEntityId).toBe("lead-9")
  })

  it("reports a replayed draft with 200 rather than a second 201", async () => {
    deps.createDraft.mockResolvedValue({ ...receipt, replayed: true })
    const response = await POST(request(validBody()))
    expect(response.status).toBe(200)
  })

  // The assistant has a well-formed question to ask; that is not an error, and
  // it must get the candidate names in order to ask it.
  it("returns a clarification instead of choosing between two colleagues", async () => {
    deps.resolveProposal.mockResolvedValue({
      kind: "clarify",
      code: "ASSIGNEE_AMBIGUOUS",
      field: "assigneeName",
      candidates: [
        { id: "user-7", label: "Aysel Memmedova" },
        { id: "user-8", label: "Aysel Qasimova" },
      ],
    })

    const response = await POST(request(validBody()))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: false,
      needsClarification: true,
      code: "ASSIGNEE_AMBIGUOUS",
      field: "assigneeName",
      candidates: ["Aysel Memmedova", "Aysel Qasimova"],
    })
    expect(deps.createDraft).not.toHaveBeenCalled()
  })

  it("does not hand the model the identifiers behind those candidates", async () => {
    deps.resolveProposal.mockResolvedValue({
      kind: "clarify",
      code: "LEAD_AMBIGUOUS",
      field: "leadName",
      candidates: [{ id: "lead-secret", label: "Ali Mammadov" }],
    })
    const response = await POST(request({ ...validBody(), tool: "propose_update_lead" }))
    expect(JSON.stringify(await response.json())).not.toContain("lead-secret")
  })

  it("rejects an unusable proposal without storing anything", async () => {
    deps.resolveProposal.mockResolvedValue({
      kind: "invalid",
      issues: [{ path: "title", message: "Required" }],
    })
    const response = await POST(request(validBody()))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ code: "INVALID_PROPOSAL" })
    expect(deps.createDraft).not.toHaveBeenCalled()
  })
})

describe("who may propose", () => {
  it("rejects a bearer caller outright", async () => {
    const response = await POST(request(validBody(), { authorization: "Bearer token" }))
    expect(response.status).toBe(403)
    expect(deps.resolveProposal).not.toHaveBeenCalled()
  })

  it("rejects a cross-origin request", async () => {
    const response = await POST(request(validBody(), { "sec-fetch-site": "cross-site" }))
    expect(response.status).toBe(403)
    expect(deps.resolveProposal).not.toHaveBeenCalled()
  })

  it("rejects a caller outside the voice pilot", async () => {
    deps.checkVoicePilotAccess.mockResolvedValue({ ok: false, reason: "not_in_pilot" })
    const response = await POST(request(validBody()))
    expect(response.status).toBe(403)
    expect(deps.resolveProposal).not.toHaveBeenCalled()
  })

  it("rate-limits a model that proposes in a loop", async () => {
    deps.checkRateLimit.mockReturnValue(false)
    const response = await POST(request(validBody()))
    expect(response.status).toBe(429)
    expect(deps.resolveProposal).not.toHaveBeenCalled()
  })
})

describe("what the request may contain", () => {
  it("rejects a tool that is not a proposal tool", async () => {
    const response = await POST(request({ ...validBody(), tool: "commit_create_task" }))
    expect(response.status).toBe(400)
    expect(deps.resolveProposal).not.toHaveBeenCalled()
  })

  it("rejects an unknown record type in the screen context", async () => {
    const response = await POST(request({
      ...validBody(),
      screen: { recordType: "database", recordId: "x" },
    }))
    expect(response.status).toBe(400)
  })

  it("rejects an unexpected top-level field", async () => {
    const response = await POST(request({ ...validBody(), targetEntityId: "lead-9" }))
    expect(response.status).toBe(400)
    expect(deps.resolveProposal).not.toHaveBeenCalled()
  })

  it("surfaces a draft-layer refusal with its own code and status", async () => {
    deps.createDraft.mockRejectedValue(
      new AiVoiceActionDraftError("ACTIVE_INTENT_EXISTS", "Already one active draft", 409),
    )
    const response = await POST(request(validBody()))
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ code: "ACTIVE_INTENT_EXISTS" })
  })
})
