import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/api-auth", () => ({ requireAuth: vi.fn(), isAuthError: (value: unknown) => value instanceof Response }))
vi.mock("@/lib/mtm/field-access", async (original) => ({ ...(await original<object>()), resolveMtmFieldScope: vi.fn() }))

import { GET } from "@/app/api/v1/mtm/field-reports/route"
import { requireAuth } from "@/lib/api-auth"
import { resolveMtmFieldScope } from "@/lib/mtm/field-access"
import { prisma } from "@/lib/prisma"

const request = (query = "") => new NextRequest(`http://localhost:3000/api/v1/mtm/field-reports${query}`)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1", userId: "u-1", role: "manager", email: "m@example.az", name: "M" } as never)
  vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([] as never)
})

describe("GET /api/v1/mtm/field-reports", () => {
  it("never shows an agent the ratings of joint visits — not even their count", async () => {
    vi.mocked(resolveMtmFieldScope).mockResolvedValue({ kind: "agents", actor: { role: "AGENT", agentId: "a-1" }, agentIds: ["a-1"] } as never)
    expect((await GET(request("?type=joint_evaluations&period=week"))).status).toBe(403)
    const overview = await (await GET(request("?period=week"))).json()
    expect(overview.data.counts).not.toHaveProperty("joint_evaluations")
    expect(prisma.mtmVisitEvaluation.findMany).not.toHaveBeenCalled()
  })

  it("keeps a manager to his own agents", async () => {
    vi.mocked(resolveMtmFieldScope).mockResolvedValue({ kind: "agents", actor: { role: "MANAGER", agentId: "m-1" }, agentIds: ["a-1", "a-2"] } as never)
    vi.mocked(prisma.mtmVisitEvaluation.findMany).mockResolvedValue([] as never)
    const response = await GET(request("?type=joint_evaluations&period=week"))
    expect(response.status).toBe(200)
    expect(vi.mocked(prisma.mtmVisitEvaluation.findMany).mock.calls[0][0]).toMatchObject({ where: { organizationId: "org-1", agentId: { in: ["a-1", "a-2"] } } })
  })

  it("refuses a period turned around, and an unknown report", async () => {
    vi.mocked(resolveMtmFieldScope).mockResolvedValue({ kind: "organization", actor: { role: "ADMIN" } } as never)
    expect((await GET(request("?type=coverage&from=2026-11-08&to=2026-11-01"))).status).toBe(400)
    expect((await GET(request("?type=unknown"))).status).toBe(404)
  })
})
