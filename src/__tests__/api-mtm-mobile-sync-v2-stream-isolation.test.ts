/* eslint-disable @typescript-eslint/no-explicit-any */
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
vi.mock("@/lib/mtm/mobile-sync-v2-rate-guard", () => ({
  consumeMtmMobileSyncV2RateLimit: vi.fn(async () => ({
    allowed: true,
    retryAfterSeconds: 0,
    unavailable: false,
  })),
}))

import { GET as getRoutes } from "@/app/api/v2/mtm/mobile/sync/routes/route"
import { GET as getWorkforce } from "@/app/api/v2/mtm/mobile/sync/workforce/route"
import { resolveMobileAuth } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { consumeMtmMobileSyncV2RateLimit } from "@/lib/mtm/mobile-sync-v2-rate-guard"

const ORG = "org-isolation"
const AGENT = "agent-isolation"
const DEVICE = "device-isolation"

function request(stream: "routes" | "workforce") {
  return new NextRequest(`http://localhost:3000/api/v2/mtm/mobile/sync/${stream}?limit=1`, {
    headers: {
      Authorization: "Bearer valid-token",
      "x-field-device-id": DEVICE,
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveMobileAuth).mockResolvedValue({
    orgId: ORG,
    agentId: AGENT,
    userId: "user-isolation",
    email: "agent@example.test",
    name: "Agent",
    role: "AGENT",
    tenantCapabilities: { routeField: true, workforceHrm: true },
  } as any)
  vi.mocked(prisma.organization.findFirst).mockResolvedValue({
    id: ORG,
    plan: "enterprise",
    addons: [],
    features: ["mtm"],
    modules: { mtm: true },
  } as never)
  vi.mocked(prisma.mtmMobileSyncCohort.findFirst).mockResolvedValue({ id: "cohort" } as never)
  vi.mocked(prisma.mtmMobileSyncStream.findUnique).mockResolvedValue({
    revision: 0n,
    retentionFloorRevision: 0n,
  } as never)
  vi.mocked(prisma.mtmMobileSyncSnapshot.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmMobileSyncSnapshot.create).mockResolvedValue({ id: "snapshot" } as never)
  vi.mocked(prisma.mtmMobileSyncSnapshotItem.createMany).mockResolvedValue({ count: 0 } as never)
  vi.mocked(prisma.mtmMobileSyncSnapshotItem.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmMobileSyncChange.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmAgentWorkday.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
  vi.mocked(prisma.$queryRaw).mockResolvedValue([{ scopeRevision: 0n, leaseToken: "claimed" }] as never)
  vi.mocked(consumeMtmMobileSyncV2RateLimit).mockResolvedValue({
    allowed: true,
    retryAfterSeconds: 0,
    unavailable: false,
  })
})

describe("MTM mobile sync v2 stream failure isolation", () => {
  it("keeps Routes available while the Workforce protection dependency is unavailable", async () => {
    vi.mocked(consumeMtmMobileSyncV2RateLimit).mockImplementation(async (input) => (
      input.stream === "workforce"
        ? { allowed: false, retryAfterSeconds: 1, unavailable: true }
        : { allowed: true, retryAfterSeconds: 0, unavailable: false }
    ))

    const [workforce, routes] = await Promise.all([
      getWorkforce(request("workforce")),
      getRoutes(request("routes")),
    ])

    expect(workforce.status).toBe(503)
    expect(workforce.headers.get("Retry-After")).toBe("5")
    expect(await workforce.json()).toMatchObject({ code: "MOBILE_SYNC_V2_UNAVAILABLE" })
    expect(routes.status).toBe(200)
    expect(await routes.json()).toMatchObject({ stream: "routes", complete: true })
    expect(consumeMtmMobileSyncV2RateLimit).toHaveBeenCalledWith(expect.objectContaining({ stream: "workforce" }))
    expect(consumeMtmMobileSyncV2RateLimit).toHaveBeenCalledWith(expect.objectContaining({ stream: "routes" }))
  })

  it("keeps Workforce available after a Route snapshot dependency failure", async () => {
    vi.mocked(prisma.mtmRoute.findMany).mockRejectedValueOnce(new Error("route database timeout"))
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined)

    const routes = await getRoutes(request("routes"))
    const workforce = await getWorkforce(request("workforce"))

    expect(routes.status).toBe(503)
    expect(routes.headers.get("Retry-After")).toBe("5")
    expect(await routes.json()).toMatchObject({ code: "MOBILE_SYNC_V2_UNAVAILABLE" })
    expect(workforce.status).toBe(200)
    expect(await workforce.json()).toMatchObject({ stream: "workforce", complete: true })
    expect(error).toHaveBeenCalledTimes(1)
  })
})
