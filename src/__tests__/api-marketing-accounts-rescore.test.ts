import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    marketingAccount: { findMany: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    company: { findMany: vi.fn() },
  },
}))
vi.mock("@/lib/api-auth", () => ({ requireAuth: vi.fn(), isAuthError: vi.fn(() => false) }))
vi.mock("@/lib/audit/compliance-audit", () => ({ recordPiiAccessFromRequest: vi.fn() }))
vi.mock("@/lib/account-engagement/config-loader", () => ({
  loadAccountGradeWeights: vi.fn().mockResolvedValue({
    targetIndustries: ["pharma"],
    disqualifiedIndustries: [],
    icpComponentByTier: {},
    bandComponent: {},
    gradeThresholds: {},
  }),
}))

import { POST } from "@/app/api/v1/marketing-accounts/rescore/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"

const AUTH = { orgId: "org-1", userId: "u1" }
function makeReq(body: unknown) {
  return new NextRequest(new URL("/api/v1/marketing-accounts/rescore", "http://localhost:3000"), {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(requireAuth as any).mockResolvedValue(AUTH)
})

describe("POST /api/v1/marketing-accounts/rescore", () => {
  it("re-derives tier+grade from the linked company's current firmographics", async () => {
    ;(prisma.marketingAccount.findMany as any).mockResolvedValue([{ id: "acc1", companyId: "co1" }])
    ;(prisma.company.findMany as any).mockResolvedValue([
      { id: "co1", name: "ZEYTUN", industry: "Pharma", employeeCount: 1500, annualRevenue: 120_000_000 },
    ])
    const res = await POST(makeReq({ accountId: "acc1" }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.rescored).toBe(1)
    const { where, data } = (prisma.marketingAccount.update as any).mock.calls[0][0]
    expect(where.id).toBe("acc1")
    // strategic(4) + pharma in-target(+2) + 120M(+2) = 8 → tier_1 → grade A
    expect(data.icpTier).toBe("tier_1")
    expect(data.grade).toBe("A")
    expect(data.employeeBand).toBe("strategic")
    expect(data.industrySlug).toBe("pharma")
  })

  it("returns 0 when there are no company-linked accounts", async () => {
    ;(prisma.marketingAccount.findMany as any).mockResolvedValue([])
    const res = await POST(makeReq({}))
    expect((await res.json()).rescored).toBe(0)
    expect(prisma.marketingAccount.update).not.toHaveBeenCalled()
  })

  it("skips an account whose company is missing", async () => {
    ;(prisma.marketingAccount.findMany as any).mockResolvedValue([{ id: "acc1", companyId: "gone" }])
    ;(prisma.company.findMany as any).mockResolvedValue([])
    const res = await POST(makeReq({}))
    const json = await res.json()
    expect(json.rescored).toBe(0)
    expect(json.skipped).toBe(1)
    expect(prisma.marketingAccount.update).not.toHaveBeenCalled()
  })
})
