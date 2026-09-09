import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

type AuthContext = { orgId: string; userId: string; role: string }
type RouteHandler = (req: NextRequest, auth: AuthContext) => Promise<Response>

const state = vi.hoisted(() => ({
  role: "admin",
  registrations: [] as Array<{ module: string | undefined; action: string | undefined }>,
}))

const service = vi.hoisted(() => ({
  getTenantPaidRunReport: vi.fn(),
  updateTenantPaidRunPolicy: vi.fn(),
}))

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (module: string | undefined, action: string | undefined, handler: RouteHandler) => {
    state.registrations.push({ module, action })
    return (req: NextRequest) => handler(req, { orgId: "org-1", userId: "user-1", role: state.role })
  },
}))

vi.mock("@/lib/social/paid-run-authorization", () => ({
  MAX_TENANT_PAID_RUN_CAP_USD: 100,
  MAX_TENANT_DAILY_PAID_RUN_BUDGET_USD: 10_000,
  MAX_TENANT_MONTHLY_PAID_RUN_BUDGET_USD: 100_000,
  MAX_TENANT_DAILY_RUN_QUOTA: 100,
  getTenantPaidRunReport: service.getTenantPaidRunReport,
  updateTenantPaidRunPolicy: service.updateTenantPaidRunPolicy,
}))

import { GET, PATCH } from "@/app/api/v1/social/paid-run-policy/route"

function request(method: "GET" | "PATCH", body?: unknown) {
  return new NextRequest("http://localhost/api/v1/social/paid-run-policy", {
    method,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  state.role = "admin"
  service.getTenantPaidRunReport.mockResolvedValue({
    policy: { manualRunsEnabled: false, emergencyStopped: true },
    usage: { dayReservedUsd: 0, monthReservedUsd: 0 },
    recentAuthorizations: [{ authorizationId: "authorization-1", requestedByUserId: "user-1" }],
  })
  service.updateTenantPaidRunPolicy.mockResolvedValue({ manualRunsEnabled: true, emergencyStopped: false })
})

describe("/api/v1/social/paid-run-policy", () => {
  it("returns tenant-scoped policy, usage and audit reporting", async () => {
    const response = await GET(request("GET"))
    const json = await response.json()
    expect(response.status).toBe(200)
    expect(service.getTenantPaidRunReport).toHaveBeenCalledWith("org-1")
    expect(json.data).toMatchObject({
      policy: { manualRunsEnabled: false },
      recentAuthorizations: [{ authorizationId: "authorization-1", requestedByUserId: "user-1" }],
    })
  })

  it("redacts paid-run actor identifiers from non-admin reporting", async () => {
    state.role = "manager"
    const response = await GET(request("GET"))
    const json = await response.json()
    expect(response.status).toBe(200)
    expect(json.data.recentAuthorizations).toEqual([
      { authorizationId: "authorization-1", requestedByUserId: null },
    ])
  })

  it("requires admin role for policy mutation", async () => {
    state.role = "manager"
    const response = await PATCH(request("PATCH", { emergencyStopped: true }))
    expect(response.status).toBe(403)
    expect(service.updateTenantPaidRunPolicy).not.toHaveBeenCalled()
  })

  it("validates limits before touching policy storage", async () => {
    const response = await PATCH(request("PATCH", { maxPerRunUsd: 100.01 }))
    expect(response.status).toBe(400)
    expect(service.updateTenantPaidRunPolicy).not.toHaveBeenCalled()
  })

  it("accepts a run-count quota and rejects one above the ceiling", async () => {
    const ok = await PATCH(request("PATCH", { dailyRunQuota: 3, manualRunsEnabled: true, emergencyStopped: false, authorizationConfirmed: true }))
    expect(ok.status).toBe(200)
    expect(service.updateTenantPaidRunPolicy).toHaveBeenCalledWith("org-1", "user-1", expect.objectContaining({ dailyRunQuota: 3 }))
    service.updateTenantPaidRunPolicy.mockClear()
    const tooHigh = await PATCH(request("PATCH", { dailyRunQuota: 101 }))
    expect(tooHigh.status).toBe(400)
    expect(service.updateTenantPaidRunPolicy).not.toHaveBeenCalled()
  })

  it("passes the authenticated admin actor and explicit authorization confirmation", async () => {
    const body = {
      manualRunsEnabled: true,
      emergencyStopped: false,
      maxPerRunUsd: 1,
      dailyBudgetUsd: 4,
      monthlyBudgetUsd: 20,
      authorizationConfirmed: true,
    }
    const response = await PATCH(request("PATCH", body))
    expect(response.status).toBe(200)
    expect(service.updateTenantPaidRunPolicy).toHaveBeenCalledWith("org-1", "user-1", body)
  })

  it("maps a fail-closed policy invariant to conflict", async () => {
    service.updateTenantPaidRunPolicy.mockRejectedValue(new Error("paid_manual_run_emergency_stop_must_be_disabled"))
    const response = await PATCH(request("PATCH", { manualRunsEnabled: true, authorizationConfirmed: true }))
    const json = await response.json()
    expect(response.status).toBe(409)
    expect(json.error).toBe("paid_manual_run_emergency_stop_must_be_disabled")
  })

  it("registers read and write permission gates", () => {
    expect(state.registrations).toContainEqual({ module: "social", action: "read" })
    expect(state.registrations).toContainEqual({ module: "social", action: "write" })
  })
})
