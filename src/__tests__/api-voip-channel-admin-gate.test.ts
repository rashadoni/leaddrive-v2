import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  role: "sales" as "sales" | "admin" | "superadmin",
  gateChannelsAccess: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn(),
  updateMany: vi.fn(),
  deleteMany: vi.fn(),
  syncTikTok: vi.fn(),
}))

vi.mock("@/lib/channels-access", () => ({
  gateChannelsAccess: mocks.gateChannelsAccess,
}))

vi.mock("@/lib/rls-context", () => ({
  runWithTenant: (_orgId: string, fn: () => unknown) => fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelConfig: {
      findMany: mocks.findMany,
      findFirst: mocks.findFirst,
      create: mocks.create,
      updateMany: mocks.updateMany,
      deleteMany: mocks.deleteMany,
    },
  },
}))

vi.mock("@/lib/channels/platform-connections", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/channels/platform-connections")>()
  return { ...actual, syncTikTokDmConnectionForChannelConfig: mocks.syncTikTok }
})

import { GET, POST } from "@/app/api/v1/channels/route"
import { PUT, DELETE } from "@/app/api/v1/channels/[id]/route"

function request(path: string, method = "GET", body?: unknown) {
  return new NextRequest(`https://app.leaddrivecrm.org${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
}

const params = { params: Promise.resolve({ id: "voip_1" }) }
const voipRow = {
  id: "voip_1",
  organizationId: "org_1",
  channelType: "voip",
  configName: "Asterisk VoIP",
  isActive: true,
  settings: { provider: "asterisk", manualLeadAiCallsEnabled: false },
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.role = "sales"
  mocks.gateChannelsAccess.mockImplementation(async () => ({ orgId: "org_1", role: mocks.role }))
  mocks.syncTikTok.mockResolvedValue(undefined)
})

describe("dedicated VoIP ChannelConfig boundary", () => {
  it("blocks non-admin creation of a VoIP row", async () => {
    const res = await POST(request("/api/v1/channels", "POST", {
      channelType: "voip",
      configName: "Asterisk VoIP",
      settings: { provider: "asterisk", manualLeadAiCallsEnabled: true },
    }))

    expect(res.status).toBe(403)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it("blocks admin creation through the generic channel endpoint", async () => {
    mocks.role = "admin"

    const res = await POST(request("/api/v1/channels", "POST", {
      channelType: "voip",
      configName: "Asterisk VoIP",
      settings: { provider: "asterisk", manualLeadAiCallsEnabled: false },
    }))

    expect(res.status).toBe(403)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it("blocks non-admin updates to an existing VoIP row", async () => {
    mocks.findFirst.mockResolvedValue(voipRow)

    const res = await PUT(request("/api/v1/channels/voip_1", "PUT", {
      settings: { provider: "asterisk", manualLeadAiCallsEnabled: true },
    }), params)

    expect(res.status).toBe(403)
    expect(mocks.updateMany).not.toHaveBeenCalled()
  })

  it("blocks a non-admin from converting an ordinary channel into VoIP", async () => {
    mocks.findFirst.mockResolvedValue({ ...voipRow, channelType: "telegram" })

    const res = await PUT(request("/api/v1/channels/voip_1", "PUT", {
      channelType: "voip",
      settings: { provider: "asterisk", manualLeadAiCallsEnabled: true },
    }), params)

    expect(res.status).toBe(403)
    expect(mocks.updateMany).not.toHaveBeenCalled()
  })

  it("blocks non-admin deletion of a VoIP row", async () => {
    mocks.findFirst.mockResolvedValue(voipRow)

    const res = await DELETE(request("/api/v1/channels/voip_1", "DELETE"), params)

    expect(res.status).toBe(403)
    expect(mocks.deleteMany).not.toHaveBeenCalled()
  })

  it("blocks an admin from updating the VoIP kill switch through the generic endpoint", async () => {
    mocks.role = "admin"
    mocks.findFirst.mockResolvedValue(voipRow)

    const res = await PUT(request("/api/v1/channels/voip_1", "PUT", {
      settings: { provider: "asterisk", manualLeadAiCallsEnabled: true },
    }), params)

    expect(res.status).toBe(403)
    expect(mocks.updateMany).not.toHaveBeenCalled()
  })

  it("blocks a superadmin from deleting VoIP through the generic endpoint", async () => {
    mocks.role = "superadmin"
    mocks.findFirst.mockResolvedValue(voipRow)

    const res = await DELETE(request("/api/v1/channels/voip_1", "DELETE"), params)

    expect(res.status).toBe(403)
    expect(mocks.deleteMany).not.toHaveBeenCalled()
  })

  it("honors a VoIP list filter without exposing provider secrets", async () => {
    mocks.role = "admin"
    mocks.findMany.mockResolvedValue([{ ...voipRow, settings: {
      provider: "asterisk",
      password: "private-password",
      manualLeadAiCallsEnabled: false,
    } }])

    const res = await GET(request("/api/v1/channels?type=voip"))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: "org_1", channelType: "voip" },
    }))
    expect(json.data[0].settings).toEqual({
      provider: "asterisk",
      manualLeadAiCallsEnabled: false,
    })
    expect(JSON.stringify(json)).not.toContain("private-password")
  })
})
