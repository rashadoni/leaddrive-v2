import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

vi.mock("@/lib/mobile-auth", () => ({
  resolveMobileAuth: vi.fn(),
}))
vi.mock("@/lib/rls-context", () => ({
  runWithRlsBypass: (callback: () => unknown) => callback(),
  runWithTenant: (_orgId: string, callback: () => unknown) => callback(),
}))

import { resolveMobileAuth } from "@/lib/mobile-auth"
import { withMobileRls } from "@/lib/with-mobile-rls"

const AUTH = {
  orgId: "org-1",
  agentId: "agent-1",
  userId: "user-1",
  email: "agent@example.test",
  name: "Agent",
  role: "AGENT",
  tenantCapabilities: { routeField: true, workforceHrm: false },
}

function request(pathname: string) {
  return new NextRequest(`http://localhost:3000${pathname}`, {
    headers: { Authorization: "Bearer mobile-token" },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveMobileAuth).mockResolvedValue(AUTH as never)
})

describe("withMobileRls v2 capability boundary", () => {
  it("fails closed when a future v2 handler omits its capability contract", async () => {
    const handler = vi.fn(async () => NextResponse.json({ success: true }))
    const route = withMobileRls(handler)

    const response = await route(request("/api/v2/mtm/mobile/future-domain"))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      code: "MOBILE_ENDPOINT_CAPABILITY_UNCONFIGURED",
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it("accepts a v2 handler only after it declares its Route Field capability", async () => {
    const handler = vi.fn(async () => NextResponse.json({ success: true }))
    const route = withMobileRls(handler, { requiredCapability: "route-field" })

    const response = await route(request("/api/v2/mtm/mobile/future-domain"))

    expect(response.status).toBe(200)
    expect(handler).toHaveBeenCalledTimes(1)
  })
})
