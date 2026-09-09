import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

type RouteHandler = (req: NextRequest, auth: { orgId: string; userId: string; role: string }) => Promise<Response>
const connectionId = "17de9868-8f83-4baf-85dc-5e6ac5eb3622"

const state = vi.hoisted(() => ({ marker: "" }))
const deps = vi.hoisted(() => ({
  updateMany: vi.fn(async (args: { where: { elevenlabsConversationId: string }; data: { elevenlabsConversationId: string } }) => {
    if (state.marker !== args.where.elevenlabsConversationId) return { count: 0 }
    state.marker = args.data.elevenlabsConversationId
    return { count: 1 }
  }),
  findFirst: vi.fn(async (args: { where: { elevenlabsConversationId: string } }) =>
    state.marker === args.where.elevenlabsConversationId ? { id: "voice-session-1" } : null),
}))

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: RouteHandler) =>
    (req: NextRequest) => handler(req, { orgId: "org-1", userId: "user-1", role: "admin" }),
}))
vi.mock("@/lib/prisma", () => ({
  prisma: { voiceSession: { updateMany: deps.updateMany, findFirst: deps.findFirst } },
}))
vi.mock("@/lib/ai/voice/gate", () => ({ checkVoicePilotAccess: vi.fn(async () => ({ ok: true })) }))
vi.mock("@/lib/social/review-apply-request", () => ({ guardInteractiveJsonMutation: vi.fn(() => null) }))

import { POST } from "@/app/api/v1/ai/voice/session/connected/route"

function request(id = connectionId) {
  return new NextRequest("http://localhost/api/v1/ai/voice/session/connected", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ voiceSessionId: "voice-session-1", connectionId: id }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  state.marker = `gemini:issued:${connectionId}`
})

describe("Gemini setupComplete billing latch", () => {
  it("moves the exact issued marker to connected", async () => {
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(state.marker).toBe(`gemini:connected:${connectionId}`)
  })

  it("is idempotent when the successful response is retried", async () => {
    expect((await POST(request())).status).toBe(200)
    const replay = await POST(request())
    expect(replay.status).toBe(200)
    expect(await replay.json()).toEqual({ data: { connected: true, replay: true } })
    expect(deps.updateMany).toHaveBeenCalledTimes(2)
  })

  it("allows only one CAS winner under concurrent confirmations", async () => {
    const responses = await Promise.all([POST(request()), POST(request())])
    expect(responses.map((response) => response.status)).toEqual([200, 200])
    expect(state.marker).toBe(`gemini:connected:${connectionId}`)
  })

  it("rejects an unrelated token nonce", async () => {
    const response = await POST(request("8e8577aa-03d4-4ec9-8cce-37c437c1f04a"))
    expect(response.status).toBe(409)
    expect(state.marker).toBe(`gemini:issued:${connectionId}`)
  })
})
