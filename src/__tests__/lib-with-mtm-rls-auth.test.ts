import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/mobile-auth", () => ({
  getMobileAuth: vi.fn(),
}))

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: vi.fn((_module, _action, handler) =>
    async (req: NextRequest, ctx?: unknown) => handler(req, {
      orgId: "org-web",
      userId: "user-web",
      role: "admin",
      email: "web@example.test",
      name: "Web User",
    }, ctx)),
}))

vi.mock("@/lib/with-mobile-rls", () => ({
  withMobileRls: vi.fn((handler) =>
    async (req: NextRequest, ctx?: unknown) => handler(req, {
      orgId: "org-mobile",
      userId: "user-mobile",
      agentId: "agent-1",
      role: "AGENT",
      email: "agent@example.test",
      name: "Field Agent",
    }, ctx)),
}))

vi.mock("@/lib/tenant-capability-access", () => ({
  requireTenantCapabilityAccessResponse: vi.fn(),
}))

import { getMobileAuth } from "@/lib/mobile-auth"
import { requireTenantCapabilityAccessResponse } from "@/lib/tenant-capability-access"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { withRlsAuth } from "@/lib/with-rls"
import {
  mtmMobileModuleForPath,
  withRouteFieldRlsAuth,
  withRouteFieldWebRlsAuth,
} from "@/lib/with-mtm-rls-auth"

const request = () => new NextRequest("http://localhost/api/v1/mtm/routes")

describe("withRouteFieldRlsAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("keeps web RBAC but defers only the legacy mtm module gate to the RLS capability boundary", async () => {
    vi.mocked(getMobileAuth).mockReturnValue(null)
    const handler = vi.fn(async () => new Response("ok"))
    const route = withRouteFieldRlsAuth("read", handler)

    const response = await route(request(), { params: Promise.resolve({ id: "route-1" }) })

    expect(response.status).toBe(200)
    expect(withRlsAuth).toHaveBeenCalledWith(
      "mtm",
      "read",
      expect.any(Function),
      { deferLegacyModuleGate: "mtm" },
    )
    expect(withMobileRls).toHaveBeenCalledWith(
      expect.any(Function),
      { requiredCapability: "route-field" },
    )
    expect(handler).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.objectContaining({ orgId: "org-web", agentId: null, principal: "web" }),
      expect.anything(),
    )
  })

  it("selects the mobile capability boundary for a verified mobile bearer", async () => {
    vi.mocked(getMobileAuth).mockReturnValue({ agentId: "agent-1" } as never)
    const handler = vi.fn(async () => new Response("ok"))
    const route = withRouteFieldRlsAuth("write", handler)

    const response = await route(request())

    expect(response.status).toBe(200)
    expect(handler).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.objectContaining({ orgId: "org-mobile", agentId: "agent-1", principal: "mobile" }),
      undefined,
    )
  })

  it("keeps web-only Route & Field endpoints behind the granular capability boundary", async () => {
    vi.mocked(requireTenantCapabilityAccessResponse).mockResolvedValue(new Response("disabled", { status: 403 }) as never)
    const handler = vi.fn(async () => new Response("ok"))
    const route = withRouteFieldWebRlsAuth("read", handler)

    const response = await route(request())

    expect(response.status).toBe(403)
    expect(handler).not.toHaveBeenCalled()
    expect(withRlsAuth).toHaveBeenCalledWith(
      "mtm",
      "read",
      expect.any(Function),
      { deferLegacyModuleGate: "mtm" },
    )
    expect(requireTenantCapabilityAccessResponse).toHaveBeenCalledWith("org-web", "route-field")
  })
})

describe("MTM mobile direct-route capability classifier", () => {
  it("keeps Field direct APIs behind route-field for a mobile principal", () => {
    expect(mtmMobileModuleForPath("/api/v1/mtm/routes/route-1/publish")).toBe("routeField")
    expect(mtmMobileModuleForPath("/api/v1/mtm/visits/visit-1/actions")).toBe("routeField")
    expect(mtmMobileModuleForPath("/api/v1/mtm/tasks/task-1")).toBe("routeField")
    expect(mtmMobileModuleForPath("/api/v1/mtm/customer-create-requests")).toBe("routeField")
  })

  it("does not guess GPS/media or manager-only operation ownership", () => {
    expect(mtmMobileModuleForPath("/api/v1/mtm/operations/hrm/request-1/decision")).toBeNull()
    expect(mtmMobileModuleForPath("/api/v1/mtm/locations")).toBeNull()
    expect(mtmMobileModuleForPath("/api/v1/mtm/mobile/documents/upload")).toBeNull()
    expect(mtmMobileModuleForPath("/api/v1/mtm/tasks/task-1/documents")).toBeNull()
  })
})
