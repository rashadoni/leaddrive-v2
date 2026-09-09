import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

type StaleSession = {
  id: string
  organizationId: string
  userId: string
  reservedSeconds: number
  startedAt: Date
  elevenlabsConversationId: string | null
  lastHeartbeatAt: Date
}
type SessionUpdateArgs = {
  where: { elevenlabsConversationId?: string | null }
  data: { status?: string; billedSeconds?: number }
}

const deps = vi.hoisted(() => ({
  findMany: vi.fn<() => Promise<StaleSession[]>>(),
  updateMany: vi.fn<(args: SessionUpdateArgs) => Promise<{ count: number }>>(async () => ({ count: 1 })),
  settleVoiceSeconds: vi.fn(async () => {}),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: { voiceSession: { findMany: deps.findMany, updateMany: deps.updateMany } },
}))
vi.mock("@/lib/rls-context", () => ({
  runWithRlsBypass: (operation: () => Promise<Response>) => operation(),
}))
vi.mock("@/lib/cron-auth", () => ({ requireCronAuth: vi.fn(() => null) }))
vi.mock("@/lib/ai/voice/budget", () => ({ settleVoiceSeconds: deps.settleVoiceSeconds }))
vi.mock("@/lib/ai/voice/config", () => ({ HEARTBEAT_GRACE_SECONDS: 90 }))

import { POST } from "@/app/api/cron/voice-session-reaper/route"

const NOW = new Date("2026-08-12T12:00:00.000Z")

function stale(id: string, marker: string | null): StaleSession {
  return {
    id,
    organizationId: "org-1",
    userId: "user-1",
    reservedSeconds: 300,
    startedAt: new Date("2026-08-12T11:55:00.000Z"),
    elevenlabsConversationId: marker,
    lastHeartbeatAt: new Date("2026-08-12T11:56:00.000Z"),
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  vi.clearAllMocks()
  deps.findMany.mockResolvedValue([])
  deps.updateMany.mockResolvedValue({ count: 1 })
})

afterEach(() => {
  vi.useRealTimers()
})

describe("voice session reaper settlement", () => {
  it("refunds null/minting/issued markers and charges only connected markers", async () => {
    deps.findMany.mockResolvedValue([
      stale("never", null),
      stale("minting", "gemini:minting:n1"),
      stale("issued", "gemini:issued:n2"),
      stale("connected", "gemini:connected:n3"),
      stale("legacy", "openai:connecting:legacy"),
    ])

    const response = await POST(new NextRequest("http://localhost/api/cron/voice-session-reaper", { method: "POST" }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { scanned: 5, reaped: 5, neverConnected: 3 } })
    expect(deps.updateMany.mock.calls.map(([args]) => ({
      marker: args.where.elevenlabsConversationId,
      status: args.data.status,
      billed: args.data.billedSeconds,
    }))).toEqual([
      { marker: null, status: "never_connected", billed: 0 },
      { marker: "gemini:minting:n1", status: "never_connected", billed: 0 },
      { marker: "gemini:issued:n2", status: "never_connected", billed: 0 },
      { marker: "gemini:connected:n3", status: "abandoned", billed: 300 },
      { marker: "openai:connecting:legacy", status: "abandoned", billed: 300 },
    ])
    expect(deps.settleVoiceSeconds.mock.calls.map((call) => call.slice(2, 4))).toEqual([
      [300, 0],
      [300, 0],
      [300, 0],
      [300, 300],
      [300, 300],
    ])
  })

  it("does not settle when the exact-marker CAS loses", async () => {
    deps.findMany.mockResolvedValue([stale("raced", null)])
    deps.updateMany.mockResolvedValueOnce({ count: 0 })

    const response = await POST(new NextRequest("http://localhost/api/cron/voice-session-reaper", { method: "POST" }))

    expect(await response.json()).toEqual({ data: { scanned: 1, reaped: 0, neverConnected: 0 } })
    expect(deps.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ elevenlabsConversationId: null }),
    }))
    expect(deps.settleVoiceSeconds).not.toHaveBeenCalled()
  })
})
