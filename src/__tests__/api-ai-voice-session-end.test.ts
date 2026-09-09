import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

type AuthContext = { orgId: string; userId: string; role: string }
type RouteHandler = (req: NextRequest, auth: AuthContext) => Promise<Response>
type Session = {
  id: string
  status: string
  reservedSeconds: number
  startedAt: Date
  elevenlabsConversationId: string | null
}
type SessionUpdateArgs = {
  where: { elevenlabsConversationId?: string | null }
  data: { status?: string; billedSeconds?: number }
}

const deps = vi.hoisted(() => ({
  findFirst: vi.fn<() => Promise<Session | null>>(),
  updateMany: vi.fn<(args: SessionUpdateArgs) => Promise<{ count: number }>>(async () => ({ count: 1 })),
  settleVoiceSeconds: vi.fn(async () => {}),
  logAudit: vi.fn(async () => {}),
}))

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: RouteHandler) =>
    (req: NextRequest) => handler(req, { orgId: "org-1", userId: "user-1", role: "admin" }),
}))
vi.mock("@/lib/prisma", () => ({
  prisma: { voiceSession: { findFirst: deps.findFirst, updateMany: deps.updateMany } },
  logAudit: deps.logAudit,
}))
vi.mock("@/lib/ai/voice/budget", () => ({ settleVoiceSeconds: deps.settleVoiceSeconds }))

import { POST } from "@/app/api/v1/ai/voice/session/end/route"

const NOW = new Date("2026-08-12T12:00:00.000Z")

function session(marker: string | null): Session {
  return {
    id: "voice-session-1",
    status: "active",
    reservedSeconds: 300,
    startedAt: new Date(NOW.getTime() - 30_000),
    elevenlabsConversationId: marker,
  }
}

function request(elapsedSeconds = 20) {
  return new NextRequest("http://localhost/api/v1/ai/voice/session/end", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ voiceSessionId: "voice-session-1", elapsedSeconds }),
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  vi.clearAllMocks()
  deps.findFirst.mockResolvedValue(session("gemini:connected:nonce"))
  deps.updateMany.mockResolvedValue({ count: 1 })
})

afterEach(() => {
  vi.useRealTimers()
})

describe("voice session end settlement", () => {
  it("refunds a never-requested provider session in full", async () => {
    deps.findFirst.mockResolvedValueOnce(session(null))

    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { billedSeconds: 0 } })
    expect(deps.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ elevenlabsConversationId: null }),
      data: expect.objectContaining({ status: "never_connected", billedSeconds: 0 }),
    }))
    expect(deps.settleVoiceSeconds).toHaveBeenCalledWith(
      "org-1", "user-1", 300, 0, new Date("2026-08-12T11:59:30.000Z"),
    )
  })

  it.each(["gemini:minting:nonce", "gemini:issued:nonce"])(
    "fully refunds a pre-connection marker (%s)",
    async (marker) => {
      deps.findFirst.mockResolvedValueOnce(session(marker))

      const response = await POST(request())

      expect(await response.json()).toEqual({ data: { billedSeconds: 0 } })
      expect(deps.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ elevenlabsConversationId: marker }),
        data: expect.objectContaining({ status: "never_connected", billedSeconds: 0 }),
      }))
    },
  )

  it("bills a connected session by trusted wall clock", async () => {
    deps.findFirst.mockResolvedValueOnce(session("gemini:connected:nonce"))

    const response = await POST(request(2))

    expect(await response.json()).toEqual({ data: { billedSeconds: 30 } })
    expect(deps.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ elevenlabsConversationId: "gemini:connected:nonce" }),
      data: expect.objectContaining({ status: "ended", billedSeconds: 30 }),
    }))
  })

  it("keeps conservative billing for a legacy OpenAI in-flight marker", async () => {
    deps.findFirst.mockResolvedValueOnce(session("openai:connecting:legacy"))

    const response = await POST(request(2))

    expect(await response.json()).toEqual({ data: { billedSeconds: 30 } })
    expect(deps.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ elevenlabsConversationId: "openai:connecting:legacy" }),
      data: expect.objectContaining({ status: "ended", billedSeconds: 30 }),
    }))
  })

  it("re-reads and settles the winning marker after a lost CAS", async () => {
    deps.findFirst
      .mockResolvedValueOnce(session("gemini:issued:nonce"))
      .mockResolvedValueOnce(session("gemini:connected:nonce"))
    deps.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 })

    const response = await POST(request(2))

    expect(await response.json()).toEqual({ data: { billedSeconds: 30 } })
    expect(deps.findFirst).toHaveBeenCalledTimes(2)
    expect(deps.updateMany.mock.calls[0][0].where.elevenlabsConversationId).toBe("gemini:issued:nonce")
    expect(deps.updateMany.mock.calls[1][0].where.elevenlabsConversationId).toBe("gemini:connected:nonce")
    expect(deps.settleVoiceSeconds).toHaveBeenCalledTimes(1)
  })

  it("survives the full null-to-minting-to-issued-to-connected race", async () => {
    deps.findFirst
      .mockResolvedValueOnce(session(null))
      .mockResolvedValueOnce(session("gemini:minting:nonce"))
      .mockResolvedValueOnce(session("gemini:issued:nonce"))
      .mockResolvedValueOnce(session("gemini:connected:nonce"))
    deps.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 })

    const response = await POST(request(2))

    expect(await response.json()).toEqual({ data: { billedSeconds: 30 } })
    expect(deps.findFirst).toHaveBeenCalledTimes(4)
    expect(deps.updateMany.mock.calls.map(([args]) => args.where.elevenlabsConversationId)).toEqual([
      null,
      "gemini:minting:nonce",
      "gemini:issued:nonce",
      "gemini:connected:nonce",
    ])
    expect(deps.settleVoiceSeconds).toHaveBeenCalledTimes(1)
  })

  it("does not settle when all exact-marker CAS attempts lose", async () => {
    deps.updateMany.mockResolvedValue({ count: 0 })

    const response = await POST(request())

    expect(await response.json()).toEqual({ data: { alreadyClosed: true } })
    expect(deps.findFirst).toHaveBeenCalledTimes(4)
    expect(deps.settleVoiceSeconds).not.toHaveBeenCalled()
    expect(deps.logAudit).not.toHaveBeenCalled()
  })
})
