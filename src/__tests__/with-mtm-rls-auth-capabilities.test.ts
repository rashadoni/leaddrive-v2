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

vi.mock("@/lib/tenant-capability-access", () => ({
  // The tenant has both field capabilities in the web tests below; what is
  // under test there is the per-user list, not the tenant entitlement.
  requireTenantCapabilityAccessResponse: vi.fn(async () => null),
}))

import {
  withMtmRlsAuth,
  withRouteFieldWebRlsAuth,
  withWorkforceHrmRlsAuth,
} from "@/lib/with-mtm-rls-auth"
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

// requireAuth defers its per-user module check on these routes along with the
// tenant gate (the `mtm` scope holds two capabilities), so the wrapper is the
// only place a hidden Route & Field / Workforce HRM is refused for web callers.
describe("withMtmRlsAuth web boundary: modules hidden from the caller", () => {
  // `withRlsAuth` is mocked to hand back its handler, so the wrapped route is
  // called the way withRlsAuth would call it: (req, auth, ctx).
  type WebRoute = (req: NextRequest, auth: unknown, ctx?: unknown) => Promise<Response>
  const webAuth = (hiddenModules?: string[]) => ({
    orgId: "org-1", userId: "user-1", role: "manager", email: "m@example.test", name: "M",
    principalType: "session", ...(hiddenModules ? { hiddenModules } : {}),
  })
  const webRequest = () => new NextRequest("http://localhost:3000/api/v1/mtm/routes")

  it("refuses a Route & Field route to someone it was hidden from", async () => {
    const handler = vi.fn(async () => NextResponse.json({ success: true }))
    const route = withRouteFieldWebRlsAuth("read", handler) as unknown as WebRoute

    const response = await route(webRequest(), webAuth(["mtm"]))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ error: "Forbidden" })
    expect(handler).not.toHaveBeenCalled()
  })

  it("still serves Workforce HRM to that same person", async () => {
    vi.mocked(getMobileAuth).mockReturnValue(null as never)
    const handler = vi.fn(async () => NextResponse.json({ success: true }))
    // The dual-principal wrapper routes a non-mobile request to its web branch,
    // which the withRlsAuth mock exposes as (req, auth).
    const route = withWorkforceHrmRlsAuth("read", handler) as unknown as WebRoute

    const response = await route(webRequest(), webAuth(["mtm"]))

    expect(response.status).toBe(200)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it("refuses Workforce HRM when that is what was hidden, and keeps the routes", async () => {
    vi.mocked(getMobileAuth).mockReturnValue(null as never)
    const hrm = vi.fn(async () => NextResponse.json({ success: true }))
    const routes = vi.fn(async () => NextResponse.json({ success: true }))

    const hrmResponse = await (withWorkforceHrmRlsAuth("read", hrm) as unknown as WebRoute)(
      webRequest(), webAuth(["workforce-hrm"]),
    )
    const routesResponse = await (withRouteFieldWebRlsAuth("read", routes) as unknown as WebRoute)(
      webRequest(), webAuth(["workforce-hrm"]),
    )

    expect(hrmResponse.status).toBe(403)
    expect(hrm).not.toHaveBeenCalled()
    expect(routesResponse.status).toBe(200)
  })

  it("changes nothing for an unrestricted caller", async () => {
    const handler = vi.fn(async () => NextResponse.json({ success: true }))
    const route = withRouteFieldWebRlsAuth("read", handler) as unknown as WebRoute

    expect((await route(webRequest(), webAuth())).status).toBe(200)
  })
})
