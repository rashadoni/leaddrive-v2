import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

vi.mock("@/lib/mobile-auth", () => ({
  getMobileAuth: vi.fn(),
  resolveMobileAuth: vi.fn(),
}))
vi.mock("@/lib/rls-context", () => ({
  runWithRlsBypass: (callback: () => unknown) => callback(),
  runWithTenant: (_orgId: string, callback: () => unknown) => callback(),
}))
vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: vi.fn((_module, _action, handler) => handler),
}))

import { withMtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import { getMobileAuth, resolveMobileAuth } from "@/lib/mobile-auth"

const WORKFORCE_ONLY_AUTH = {
  orgId: "org-1",
  agentId: "agent-1",
  userId: "user-1",
  email: "agent@example.test",
  name: "Agent",
  role: "MANAGER",
  tenantCapabilities: { routeField: false, workforceHrm: true },
}

function request() {
  return new NextRequest("http://localhost:3000/api/v1/mtm/routes", {
    headers: { Authorization: "Bearer mobile-token" },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getMobileAuth).mockReturnValue({ agentId: "agent-1" } as never)
  vi.mocked(resolveMobileAuth).mockResolvedValue(WORKFORCE_ONLY_AUTH as never)
})

describe("withMtmRlsAuth mobile capability boundary", () => {
  it("fails closed for a Workforce-only JWT on a legacy MTM route", async () => {
    const handler = vi.fn(async () => NextResponse.json({ success: true }))
    const route = withMtmRlsAuth("mtm", "read", handler)

    const response = await route(request())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      code: "TENANT_CAPABILITY_DISABLED",
      capabilityId: "route-field",
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it("lets an explicit Workforce compatibility adapter use the same mobile JWT", async () => {
    const handler = vi.fn(async () => NextResponse.json({ success: true }))
    const route = withMtmRlsAuth("mtm", "write", handler, {
      mobileCapability: "workforce-hrm",
    })

    const response = await route(request())

    expect(response.status).toBe(200)
    expect(handler).toHaveBeenCalledTimes(1)
  })
})
