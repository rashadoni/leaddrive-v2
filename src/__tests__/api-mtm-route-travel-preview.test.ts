import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn().mockResolvedValue(null),
  requireAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))

vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

const deps = vi.hoisted(() => ({
  getMtmSettings: vi.fn(),
  resolveGoogleRoutesRuntimeConfig: vi.fn(),
  createGoogleRoutesProvider: vi.fn(),
  calculate: vi.fn(),
  claimMtmRouteTravelPreview: vi.fn(),
  writeMtmAudit: vi.fn(),
  checkRateLimit: vi.fn(),
  hashForRateLimit: vi.fn(),
  logMtmRouteObservability: vi.fn(),
}))

vi.mock("@/lib/mtm-settings", () => ({ getMtmSettings: deps.getMtmSettings }))
vi.mock("@/lib/mtm/google-routes", () => ({
  GOOGLE_ROUTES_MAX_STOPS: 10,
  GOOGLE_ROUTES_PROVIDER_KEY: "google-routes",
  GoogleRoutesProviderError: class GoogleRoutesProviderError extends Error {},
  createGoogleRoutesProvider: deps.createGoogleRoutesProvider,
  resolveGoogleRoutesRuntimeConfig: deps.resolveGoogleRoutesRuntimeConfig,
}))
vi.mock("@/lib/mtm/route-travel-invocation", () => ({
  claimMtmRouteTravelPreview: deps.claimMtmRouteTravelPreview,
}))
vi.mock("@/lib/mtm-audit", () => ({ writeMtmAudit: deps.writeMtmAudit }))
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: deps.checkRateLimit,
  hashForRateLimit: deps.hashForRateLimit,
}))
vi.mock("@/lib/mtm/route-observability", () => ({
  logMtmRouteObservability: deps.logMtmRouteObservability,
}))

import { POST } from "@/app/api/v1/mtm/routes/[id]/travel/preview/route"
import { createMtmRouteTravelCalculationRequest } from "@/lib/mtm/route-travel"
import { requireAuth } from "@/lib/api-auth"
import { getMobileAuth, resolveMobileAuth } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

const ORG = "org-1"
const AGENT = "agent-1"

function route(overrides: Record<string, unknown> = {}) {
  return {
    id: "route-1",
    organizationId: ORG,
    agentId: AGENT,
    status: "DRAFT",
    version: 4,
    assignments: [{ agentId: AGENT, role: "PRIMARY" }],
    points: [
      { id: "point-1", orderIndex: 0, customer: { latitude: 40.4093, longitude: 49.8671 } },
      { id: "point-2", orderIndex: 1, customer: { latitude: 40.42, longitude: 49.88 } },
    ],
    ...overrides,
  }
}

function sourceFingerprint(input = route()) {
  return createMtmRouteTravelCalculationRequest({
    routeId: input.id as string,
    routeVersion: input.version as number,
    points: (input.points as Array<{ id: string; orderIndex: number; customer: { latitude: number; longitude: number } }>).map((point) => ({
      id: point.id,
      orderIndex: point.orderIndex,
      latitude: point.customer.latitude,
      longitude: point.customer.longitude,
    })),
  }).source.fingerprint
}

function request(body: Record<string, unknown>, headers: HeadersInit = {}) {
  return new NextRequest("http://localhost:3000/api/v1/mtm/routes/route-1/travel/preview", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
      "idempotency-key": "preview-key-0001",
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

function payload(input = route()) {
  return {
    schemaVersion: 1,
    expectedVersion: input.version,
    sourceFingerprint: sourceFingerprint(input),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getMobileAuth).mockReturnValue(null)
  vi.mocked(resolveMobileAuth).mockResolvedValue(null)
  vi.mocked(requireAuth).mockResolvedValue({
    orgId: ORG,
    userId: "agent-user",
    agentId: AGENT,
    role: "user",
    email: "agent@example.com",
    name: "Agent",
  } as never)
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: AGENT, role: "AGENT" } as never)
  vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue(route() as never)
  deps.getMtmSettings.mockResolvedValue({ routeTravelEnabled: true, routeTravelNavigationEnabled: false })
  deps.resolveGoogleRoutesRuntimeConfig.mockReturnValue({ apiKey: "server-only-key", dailyLimit: 2, timeoutMs: 5_000 })
  deps.checkRateLimit.mockReturnValue(true)
  deps.hashForRateLimit.mockResolvedValue("rate-key")
  deps.calculate.mockResolvedValue({
    schemaVersion: 1,
    source: createMtmRouteTravelCalculationRequest({
      routeId: "route-1",
      routeVersion: 4,
      points: [
        { id: "point-1", orderIndex: 0, latitude: 40.4093, longitude: 49.8671 },
        { id: "point-2", orderIndex: 1, latitude: 40.42, longitude: 49.88 },
      ],
    }).source,
    provider: { key: "google-routes", resultVersion: "compute-routes-distance-duration-v1" },
    distanceMeters: 12345,
    durationSeconds: 720,
    geometry: null,
  })
  deps.createGoogleRoutesProvider.mockReturnValue({ calculate: deps.calculate })
  deps.claimMtmRouteTravelPreview.mockResolvedValue({ state: "CLAIMED", release: vi.fn().mockResolvedValue(undefined) })
  deps.writeMtmAudit.mockResolvedValue(undefined)
})

describe("MTM route travel preview API", () => {
  it("loads and scopes the exact route before attempting a provider call", async () => {
    vi.mocked(prisma.mtmRoute.findFirst).mockResolvedValue(null)

    const response = await POST(request(payload()), { params: Promise.resolve({ id: "route-1" }) })

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: "MTM_ROUTE_NOT_FOUND", remedies: [] })
    expect(deps.createGoogleRoutesProvider).not.toHaveBeenCalled()
    expect(prisma.mtmRoute.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "route-1", organizationId: ORG }),
    }))
  })

  it("rejects a stale version or source before it reaches Google", async () => {
    const stale = payload()
    stale.expectedVersion = 3

    const response = await POST(request(stale), { params: Promise.resolve({ id: "route-1" }) })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      code: "MTM_ROUTE_TRAVEL_SOURCE_CONFLICT",
      current: { version: 4 },
      remedies: ["RELOAD_ROUTE"],
    })
    expect(deps.createGoogleRoutesProvider).not.toHaveBeenCalled()
  })

  it("fails closed when the tenant did not opt in, leaving the manual route usable", async () => {
    deps.getMtmSettings.mockResolvedValue({ routeTravelEnabled: false, routeTravelNavigationEnabled: false })

    const response = await POST(request(payload()), { params: Promise.resolve({ id: "route-1" }) })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      code: "MTM_ROUTE_TRAVEL_NOT_CONFIGURED",
      remedies: ["KEEP_MANUAL_ORDER"],
    })
    expect(deps.claimMtmRouteTravelPreview).not.toHaveBeenCalled()
    expect(deps.createGoogleRoutesProvider).not.toHaveBeenCalled()
  })

  it("returns a transient no-store calculation after a version-bound provider call", async () => {
    const response = await POST(request(payload()), { params: Promise.resolve({ id: "route-1" }) })
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0")
    expect(json).toMatchObject({
      success: true,
      data: {
        schemaVersion: 1,
        state: "CALCULATED",
        transient: true,
        source: { routeId: "route-1", routeVersion: 4 },
        calculation: { distanceMeters: 12345, durationSeconds: 720, geometry: null },
      },
    })
    expect(deps.createGoogleRoutesProvider).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "server-only-key" }))
    expect(deps.calculate).toHaveBeenCalledWith(expect.objectContaining({
      source: expect.objectContaining({ fingerprint: sourceFingerprint() }),
    }))
    expect(deps.writeMtmAudit).toHaveBeenCalledWith(expect.objectContaining({
      newData: expect.objectContaining({
        provider: "google-routes",
        routeVersion: 4,
        pointCount: 2,
        outcome: "SUCCESS",
        transient: true,
      }),
    }))
    expect(JSON.stringify(deps.writeMtmAudit.mock.calls)).not.toContain("server-only-key")
    expect(deps.logMtmRouteObservability).toHaveBeenCalledWith(expect.objectContaining({
      operation: "TRAVEL_PREVIEW",
      outcome: "SUCCESS",
      provider: "google-routes",
      rowCount: 2,
      durationMs: expect.any(Number),
    }))
  })

  it("records a provider failure without forwarding upstream diagnostics", async () => {
    deps.calculate.mockRejectedValue(new Error("sensitive upstream diagnostics"))

    const response = await POST(request(payload()), { params: Promise.resolve({ id: "route-1" }) })

    expect(response.status).toBe(503)
    expect(deps.logMtmRouteObservability).toHaveBeenCalledWith(expect.objectContaining({
      operation: "TRAVEL_PREVIEW",
      outcome: "PROVIDER_UNAVAILABLE",
      provider: "google-routes",
      rowCount: 2,
    }))
    expect(JSON.stringify(deps.logMtmRouteObservability.mock.calls)).not.toContain("sensitive upstream diagnostics")
  })

  it("rejects bearer/API-key style calls before parsing or provider access", async () => {
    const response = await POST(request(payload(), { authorization: "Bearer external-client" }), {
      params: Promise.resolve({ id: "route-1" }),
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: "interactive_session_required" })
    expect(prisma.mtmRoute.findFirst).not.toHaveBeenCalled()
    expect(deps.createGoogleRoutesProvider).not.toHaveBeenCalled()
  })
})
