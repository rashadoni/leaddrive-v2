import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

import { DELETE, POST } from "@/app/api/v2/mtm/mobile/route-field/device-tokens/route"
import { prisma } from "@/lib/prisma"
import { resolveMobileAuth } from "@/lib/mobile-auth"

const TOKEN = "fcm-token-000000000000000000000000"

function request(method: "POST" | "DELETE", body: unknown) {
  return new NextRequest("http://localhost/api/v2/mtm/mobile/route-field/device-tokens", {
    method,
    headers: { Authorization: "Bearer mobile", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveMobileAuth).mockResolvedValue({
    orgId: "org-1", agentId: "agent-1", userId: "user-1", role: "AGENT",
    email: "agent@test", name: "Agent",
    tenantCapabilities: { routeField: true, workforceHrm: false },
  } as never)
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", role: "AGENT", canPlanOwnRoutes: true } as never)
  vi.mocked(prisma.mtmDeviceToken.upsert).mockResolvedValue({ id: "device-1", lastSeenAt: new Date() } as never)
  vi.mocked(prisma.mtmDeviceToken.updateMany).mockResolvedValue({ count: 0 } as never)
  vi.mocked(prisma.mtmDeviceToken.deleteMany).mockResolvedValue({ count: 1 } as never)
})

describe("registering a device for push", () => {
  it("stores one row per token inside the tenant", async () => {
    const response = await POST(request("POST", { token: TOKEN, platform: "android", deviceId: "device-abc", appVersion: "3.3.0" }))
    expect(response.status).toBe(200)
    expect(prisma.mtmDeviceToken.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId_token: { organizationId: "org-1", token: TOKEN } },
      create: expect.objectContaining({ organizationId: "org-1", agentId: "agent-1", token: TOKEN }),
    }))
  })

  /**
   * The same phone handed to another agent must not deliver to both: the row
   * moves to whoever is signed in now.
   */
  it("re-points an existing token at the agent who registered it", async () => {
    await POST(request("POST", { token: TOKEN }))
    const call = vi.mocked(prisma.mtmDeviceToken.upsert).mock.calls[0][0] as { update: Record<string, unknown> }
    expect(call.update).toMatchObject({ agentId: "agent-1", disabledAt: null })
  })

  it("retires the old token of a device that was given a new one", async () => {
    await POST(request("POST", { token: TOKEN, deviceId: "device-abc" }))
    expect(prisma.mtmDeviceToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: "org-1", deviceId: "device-abc", token: { not: TOKEN }, disabledAt: null }),
    }))
  })

  it("does not touch other devices when the app cannot name this one", async () => {
    await POST(request("POST", { token: TOKEN }))
    expect(prisma.mtmDeviceToken.updateMany).not.toHaveBeenCalled()
  })

  it("refuses a token that is obviously not one", async () => {
    const response = await POST(request("POST", { token: "short" }))
    expect(response.status).toBe(400)
    expect(prisma.mtmDeviceToken.upsert).not.toHaveBeenCalled()
  })

  it("refuses a manager's token on the field endpoint", async () => {
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", role: "MANAGER" } as never)
    const response = await POST(request("POST", { token: TOKEN }))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: "MTM_ROUTE_FIELD_AGENT_REQUIRED" })
  })
})

describe("signing out of a device", () => {
  /**
   * Deleted, not disabled: the next person to sign in on that phone must not
   * receive the previous agent's notifications.
   */
  it("removes the agent's own row for that token", async () => {
    const response = await DELETE(request("DELETE", { token: TOKEN }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: { removed: 1 } })
    expect(prisma.mtmDeviceToken.deleteMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1", agentId: "agent-1", token: TOKEN },
    })
  })

  it("cannot remove a token that belongs to someone else", async () => {
    await DELETE(request("DELETE", { token: TOKEN }))
    const call = vi.mocked(prisma.mtmDeviceToken.deleteMany).mock.calls[0][0] as { where: Record<string, unknown> }
    expect(call.where).toMatchObject({ agentId: "agent-1" })
  })
})
