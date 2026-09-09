import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

type AuthContext = { orgId: string; userId: string; role: string }
type RouteHandler = (req: NextRequest, auth: AuthContext) => Promise<Response>
type Orphan = { id: string; reservedSeconds: number; startedAt: Date; elevenlabsConversationId: string | null }
type FindManyArgs = { where: { startedAt: { lt: Date } } }

const deps = vi.hoisted(() => ({
  findMany: vi.fn<(args: FindManyArgs) => Promise<Orphan[]>>(async () => [{
    id: "old-session",
    reservedSeconds: 300,
    startedAt: new Date("2026-08-12T11:00:00.000Z"),
    elevenlabsConversationId: null,
  }]),
  updateMany: vi.fn(async () => ({ count: 1 })),
  create: vi.fn(async () => ({ id: "new-session" })),
  settleVoiceSeconds: vi.fn(async () => {}),
  reserveVoiceSeconds: vi.fn(async () => ({ ok: true as const, remainingSeconds: 6_900 })),
}))

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: RouteHandler) =>
    (req: NextRequest) => handler(req, { orgId: "org-1", userId: "user-1", role: "admin" }),
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    voiceSession: {
      findMany: deps.findMany,
      updateMany: deps.updateMany,
      create: deps.create,
    },
    user: { findFirst: vi.fn(async () => ({ name: "Rashad Rahimov" })) },
  },
  logAudit: vi.fn(async () => {}),
}))
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(() => true) }))
vi.mock("@/lib/ai/voice/gate", () => ({
  checkVoicePilotAccess: vi.fn(async () => ({ ok: true })),
}))
vi.mock("@/lib/api-auth", () => ({
  getOrgModuleContext: vi.fn(async () => ({ plan: "enterprise", addons: [], modules: { ai: true } })),
}))
vi.mock("@/lib/ai/voice/read-access", () => ({
  accessibleVoiceSectionKeys: vi.fn(() => ["leads"]),
}))
vi.mock("@/lib/ai/voice/rls-assert", () => ({ assertVoiceRlsPolicies: vi.fn(async () => {}) }))
vi.mock("@/lib/ai/voice/budget", () => ({
  settleVoiceSeconds: deps.settleVoiceSeconds,
  reserveVoiceSeconds: deps.reserveVoiceSeconds,
}))
vi.mock("@/lib/social/review-apply-request", () => ({
  guardInteractiveJsonMutation: vi.fn(() => null),
}))
vi.mock("@/lib/ai/voice/config", () => ({
  MAX_SESSION_SECONDS: 300,
  MAX_TOOL_CALLS: 60,
  HEARTBEAT_INTERVAL_SECONDS: 15,
  SESSION_TOKEN_TTL_SECONDS: 360,
}))

import { POST } from "@/app/api/v1/ai/voice/session/route"

function request() {
  return new NextRequest("http://localhost/api/v1/ai/voice/session", {
    method: "POST",
    headers: { "content-type": "application/json", "x-locale": "az" },
    body: "{}",
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  deps.findMany.mockResolvedValue([{
    id: "old-session",
    reservedSeconds: 300,
    startedAt: new Date("2026-08-12T11:00:00.000Z"),
    elevenlabsConversationId: null,
  }])
  deps.updateMany.mockResolvedValue({ count: 1 })
  deps.create.mockResolvedValue({ id: "new-session" })
  deps.reserveVoiceSeconds.mockResolvedValue({ ok: true, remainingSeconds: 6_900 })
})

describe("voice session start orphan cleanup", () => {
  it("supersedes and refunds an active session whose provider marker is pre-connection", async () => {
    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(deps.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        userId: "user-1",
        status: "active",
        OR: expect.arrayContaining([
          { elevenlabsConversationId: null },
          { elevenlabsConversationId: { startsWith: "gemini:minting:" } },
          { elevenlabsConversationId: { startsWith: "gemini:issued:" } },
        ]),
        startedAt: { lt: expect.any(Date) },
      }),
    }))
    expect(deps.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        userId: "user-1",
        status: "active",
        elevenlabsConversationId: null,
        startedAt: { lt: expect.any(Date) },
      }),
      data: expect.objectContaining({ status: "superseded", billedSeconds: 0 }),
    }))
    expect(deps.settleVoiceSeconds).toHaveBeenCalledWith(
      "org-1", "user-1", 300, 0, new Date("2026-08-12T11:00:00.000Z"),
    )
  })

  it.each(["gemini:minting:nonce", "gemini:issued:nonce"])(
    "refunds a stale retry reservation in %s before reserving again",
    async (marker) => {
      deps.findMany.mockResolvedValueOnce([{
        id: "old-session",
        reservedSeconds: 300,
        startedAt: new Date("2026-08-12T11:00:00.000Z"),
        elevenlabsConversationId: marker,
      }])

      expect((await POST(request())).status).toBe(200)
      expect(deps.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ elevenlabsConversationId: marker }),
      }))
      expect(deps.settleVoiceSeconds).toHaveBeenCalledWith(
        "org-1", "user-1", 300, 0, new Date("2026-08-12T11:00:00.000Z"),
      )
    },
  )

  it("does not refund when connect wins the exact-marker race", async () => {
    deps.updateMany.mockResolvedValueOnce({ count: 0 })

    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(deps.settleVoiceSeconds).not.toHaveBeenCalled()
    expect(deps.create).toHaveBeenCalledTimes(1)
  })

  it("cannot supersede a newer active session created after this request began", async () => {
    const requestCutoff = new Date("2026-08-12T12:00:00.000Z")
    const newerSession = {
      id: "newer-session",
      reservedSeconds: 300,
      startedAt: new Date("2026-08-12T12:00:00.001Z"),
      elevenlabsConversationId: null,
    }
    const realDate = Date
    vi.stubGlobal("Date", class extends realDate {
      constructor(value?: string | number | Date) {
        super(value ?? requestCutoff)
      }
      static now() { return requestCutoff.getTime() }
    })
    deps.findMany.mockImplementationOnce(async ({ where }) => (
      newerSession.startedAt < where.startedAt.lt ? [newerSession] : []
    ))

    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(deps.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ startedAt: { lt: requestCutoff } }),
    }))
    expect(deps.updateMany).not.toHaveBeenCalled()
    expect(deps.settleVoiceSeconds).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
