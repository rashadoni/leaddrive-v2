import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

type RouteHandler = (
  req: NextRequest,
  auth: { orgId: string; userId: string; role: string },
) => Promise<Response>

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  importApifyProviderRun: vi.fn(),
  reconcileBrightDataProviderRuns: vi.fn(),
  registrations: [] as Array<{ module: string | undefined; action: string | undefined }>,
  role: "admin",
}))

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (module: string | undefined, action: string | undefined, handler: RouteHandler) => {
    mocks.registrations.push({ module, action })
    return (req: NextRequest) => handler(req, {
      orgId: "org-1",
      userId: "user-1",
      role: mocks.role,
    })
  },
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    socialProviderRun: { findMany: mocks.findMany },
  },
}))

vi.mock("@/lib/social/apify-async-adapter", () => ({
  importApifyProviderRun: mocks.importApifyProviderRun,
}))

vi.mock("@/lib/social/bright-data-reconcile", () => ({
  reconcileBrightDataProviderRuns: mocks.reconcileBrightDataProviderRuns,
}))

import { GET, POST } from "@/app/api/v1/social/provider-runs/route"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.role = "admin"
  mocks.findMany.mockResolvedValue([])
  mocks.importApifyProviderRun.mockResolvedValue({ status: "IMPORTED", imported: 4 })
  mocks.reconcileBrightDataProviderRuns.mockResolvedValue([])
})

describe("GET /api/v1/social/provider-runs", () => {
  it("filters progress by a bounded tenant-scoped provider id list", async () => {
    const response = await GET(new NextRequest(
      "http://localhost/api/v1/social/provider-runs?ids=provider-a,provider-b&limit=50",
    ))

    expect(response.status).toBe(200)
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId: "org-1",
        purgedAt: null,
        OR: [
          { id: { in: ["provider-a", "provider-b"] } },
          { parentRunId: { in: ["provider-a", "provider-b"] } },
        ],
      },
      take: 50,
      select: expect.objectContaining({ collectorRunId: true }),
    }))
  })

  it("rejects an invalid or unbounded provider id list", async () => {
    const response = await GET(new NextRequest(
      `http://localhost/api/v1/social/provider-runs?ids=${"x".repeat(161)}`,
    ))

    expect(response.status).toBe(400)
    expect(mocks.findMany).not.toHaveBeenCalled()
  })

  it("redacts provider charges for tenant roles", async () => {
    mocks.findMany.mockResolvedValue([
      { id: "run-1", providerKey: "bright-data", reservedChargeUsd: 1.5, actualChargeUsd: 0.75 },
    ])

    const response = await GET(new NextRequest("http://localhost/api/v1/social/provider-runs?ids=run-1"))
    const { data } = await response.json()

    expect(data).toEqual([
      { id: "run-1", providerKey: "bright-data", reservedChargeUsd: null, actualChargeUsd: null },
    ])
  })

  it("returns provider charges to the superadmin", async () => {
    mocks.role = "superadmin"
    mocks.findMany.mockResolvedValue([
      { id: "run-1", providerKey: "bright-data", reservedChargeUsd: 1.5, actualChargeUsd: 0.75 },
    ])

    const response = await GET(new NextRequest("http://localhost/api/v1/social/provider-runs?ids=run-1"))
    const { data } = await response.json()

    expect(data).toEqual([
      { id: "run-1", providerKey: "bright-data", reservedChargeUsd: 1.5, actualChargeUsd: 0.75 },
    ])
  })

  it("registers the route on social read permission", () => {
    expect(mocks.registrations).toContainEqual({ module: "social", action: "read" })
  })
})

describe("POST /api/v1/social/provider-runs", () => {
  it("reconciles only requested runs resolved inside the current tenant", async () => {
    mocks.findMany.mockResolvedValue([
      { id: "apify-1", providerKey: "APIFY" },
      { id: "bright-1", providerKey: "bright-data" },
    ])
    mocks.reconcileBrightDataProviderRuns.mockResolvedValue([
      { id: "bright-1", status: "IMPORTED" },
    ])

    const response = await POST(new NextRequest(
      "http://localhost/api/v1/social/provider-runs",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: ["provider-root"] }),
      },
    ))

    expect(response.status).toBe(200)
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        purgedAt: null,
        OR: [
          { id: { in: ["provider-root"] } },
          { parentRunId: { in: ["provider-root"] } },
        ],
        status: { in: ["RUNNING", "SUCCEEDED", "IMPORTING"] },
      },
      select: { id: true, providerKey: true },
    })
    expect(mocks.importApifyProviderRun).toHaveBeenCalledWith("apify-1")
    expect(mocks.reconcileBrightDataProviderRuns).toHaveBeenCalledWith(
      1,
      undefined,
      { organizationId: "org-1", ids: ["bright-1"] },
    )
  })

  it("rejects invalid ids without reconciling anything", async () => {
    const response = await POST(new NextRequest(
      "http://localhost/api/v1/social/provider-runs",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [] }),
      },
    ))

    expect(response.status).toBe(400)
    expect(mocks.findMany).not.toHaveBeenCalled()
    expect(mocks.importApifyProviderRun).not.toHaveBeenCalled()
    expect(mocks.reconcileBrightDataProviderRuns).not.toHaveBeenCalled()
  })

  it("registers reconciliation on social write permission", () => {
    expect(mocks.registrations).toContainEqual({ module: "social", action: "write" })
  })
})
