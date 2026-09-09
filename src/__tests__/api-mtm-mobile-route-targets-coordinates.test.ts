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

vi.mock("@/lib/mtm/territory-scope", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mtm/territory-scope")>()
  return { ...actual, resolveAgentScope: vi.fn() }
})

import { GET } from "@/app/api/v1/mtm/mobile/routes/targets/route"
import { resolveMobileAuth } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { resolveAgentScope } from "@/lib/mtm/territory-scope"

const AGENT_AUTH = {
  orgId: "org-1",
  agentId: "agent-1",
  userId: "user-1",
  email: "agent@example.com",
  name: "Aysel",
  role: "AGENT",
}

function request(query: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/v1/mtm/mobile/routes/targets?${query}`, {
    headers: { Authorization: "Bearer mobile" },
  })
}

function storeRow(id: string, latitude: number | null, longitude: number | null) {
  return {
    id,
    name: `Store ${id}`,
    code: id,
    objectType: "STORE",
    category: "B",
    address: null,
    city: "Baku",
    phone: null,
    latitude,
    longitude,
    agentAssignments: [{ effectiveFrom: new Date("2026-09-01T00:00:00.000Z"), effectiveTo: null }],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveMobileAuth).mockResolvedValue(AGENT_AUTH as never)
  vi.mocked(resolveAgentScope).mockResolvedValue({ agentIds: ["agent-1"] } as never)
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({
    id: "agent-1", name: "Aysel", role: "AGENT", status: "ACTIVE", canPlanOwnRoutes: true,
  } as never)
})

describe("GET /api/v1/mtm/mobile/routes/targets — coordinates contract (audit A1)", () => {
  it("returns null on both axes for a stop stored at 0,0 or with a half pair", async () => {
    vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue([
      storeRow("store-ocean", 0, 0),
      storeRow("store-half", 40.4, null),
      storeRow("store-real", 40.4093, 49.8671),
    ] as never)

    const response = await GET(request("agentId=agent-1&date=2026-09-07&targetTypeId=all-customers"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.items.map((item: { customer: { id: string; latitude: number | null; longitude: number | null } }) => item.customer)).toEqual([
      expect.objectContaining({ id: "store-ocean", latitude: null, longitude: null }),
      expect.objectContaining({ id: "store-half", latitude: null, longitude: null }),
      expect.objectContaining({ id: "store-real", latitude: 40.4093, longitude: 49.8671 }),
    ])
  })
})
