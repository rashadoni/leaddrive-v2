import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    company: { findFirst: vi.fn(), findMany: vi.fn() },
    marketingAccount: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
    },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn(() => false),
}))

vi.mock("@/lib/audit/compliance-audit", () => ({
  recordPiiAccessFromRequest: vi.fn(),
}))

// Real grade calculator + promote mapper run; only the per-tenant config is stubbed.
vi.mock("@/lib/account-engagement/config-loader", () => ({
  loadAccountGradeWeights: vi.fn().mockResolvedValue({
    targetIndustries: ["pharma"],
    disqualifiedIndustries: ["tobacco"],
    icpComponentByTier: {},
    bandComponent: {},
    gradeThresholds: {},
  }),
}))

import { POST } from "@/app/api/v1/marketing-accounts/route"
import { POST as PROMOTE } from "@/app/api/v1/marketing-accounts/promote/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"

const AUTH = { orgId: "org-1", userId: "user-1" }
type CreateArgs = { data: Record<string, unknown> }
type CreateManyArgs = { data: Array<Record<string, unknown>> }

const mockRequireAuth = () => requireAuth as ReturnType<typeof vi.fn>
const mockCompanyFindFirst = () => prisma.company.findFirst as ReturnType<typeof vi.fn>
const mockCompanyFindMany = () => prisma.company.findMany as ReturnType<typeof vi.fn>
const mockMarketingFindFirst = () => prisma.marketingAccount.findFirst as ReturnType<typeof vi.fn>
const mockMarketingFindMany = () => prisma.marketingAccount.findMany as ReturnType<typeof vi.fn>
const mockMarketingCreate = () => prisma.marketingAccount.create as ReturnType<typeof vi.fn>
const mockMarketingCreateMany = () => prisma.marketingAccount.createMany as ReturnType<typeof vi.fn>

function makeRequest(path: string, body?: unknown) {
  const url = new URL(path, "http://localhost:3000")
  return new NextRequest(url, {
    method: "POST",
    ...(body !== undefined
      ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }
      : {}),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireAuth().mockResolvedValue(AUTH)
  mockMarketingCreate().mockImplementation(({ data }: CreateArgs) =>
    Promise.resolve({ id: "acc-1", ...data }),
  )
  mockMarketingCreateMany().mockImplementation(({ data }: CreateManyArgs) =>
    Promise.resolve({ count: data.length }),
  )
})

describe("POST /api/v1/marketing-accounts (single)", () => {
  it("promotes a company, auto-grades it, and serializes BigInt revenue", async () => {
    mockCompanyFindFirst().mockResolvedValue({
      id: "c1",
      name: "Pharma Co",
      industry: "Pharma",
      employeeCount: 500,
      annualRevenue: 20_000_000,
    })
    mockMarketingFindFirst().mockResolvedValue(null)

    const res = await POST(makeRequest("/api/v1/marketing-accounts", { companyId: "c1" }))
    expect(res.status).toBe(201)
    const json = await res.json()
    // auto-ICP tier_1(30) + band(enterprise=20) + industry(pharma target=25) + revenue(20) = 95 → A
    expect(json.account.grade).toBe("A")
    expect(json.account.companyId).toBe("c1")
    expect(json.account.annualRevenueUsd).toBe("20000000")

    const { data } = mockMarketingCreate().mock.calls[0][0] as CreateArgs
    expect(data.industrySlug).toBe("pharma")
    expect(data.employeeBand).toBe("enterprise")
    expect(data.grade).toBe("A")
  })

  it("returns 404 when the company is not in this tenant", async () => {
    mockCompanyFindFirst().mockResolvedValue(null)
    const res = await POST(makeRequest("/api/v1/marketing-accounts", { companyId: "ghost" }))
    expect(res.status).toBe(404)
    expect(prisma.marketingAccount.create).not.toHaveBeenCalled()
  })

  it("returns 409 when the company is already promoted", async () => {
    mockCompanyFindFirst().mockResolvedValue({
      id: "c1", name: "X", industry: null, employeeCount: null, annualRevenue: null,
    })
    mockMarketingFindFirst().mockResolvedValue({ id: "acc-existing" })
    const res = await POST(makeRequest("/api/v1/marketing-accounts", { companyId: "c1" }))
    expect(res.status).toBe(409)
    expect(prisma.marketingAccount.create).not.toHaveBeenCalled()
  })

  it("creates a manual account with no companyId", async () => {
    const res = await POST(
      makeRequest("/api/v1/marketing-accounts", {
        accountName: "Acme Corp",
        employeeBand: "enterprise",
        industrySlug: "pharma",
        annualRevenueUsd: 5_000_000,
      }),
    )
    expect(res.status).toBe(201)
    const { data } = mockMarketingCreate().mock.calls[0][0] as CreateArgs
    expect(data.companyId).toBeNull()
    expect(data.accountName).toBe("Acme Corp")
    expect(data.grade).toBe("B")
  })

  it("rejects a request with neither companyId nor accountName (400)", async () => {
    const res = await POST(makeRequest("/api/v1/marketing-accounts", {}))
    expect(res.status).toBe(400)
    expect(prisma.marketingAccount.create).not.toHaveBeenCalled()
  })

  it("rejects an invalid icpTier (400)", async () => {
    const res = await POST(
      makeRequest("/api/v1/marketing-accounts", { companyId: "c1", icpTier: "tier_9" }),
    )
    expect(res.status).toBe(400)
    expect(prisma.company.findFirst).not.toHaveBeenCalled()
  })
})

describe("POST /api/v1/marketing-accounts/promote (bulk)", () => {
  it("creates the new ones, skips already-promoted, reports not_found", async () => {
    mockCompanyFindMany().mockResolvedValue([
      { id: "c1", name: "A", industry: "Pharma", employeeCount: 500, annualRevenue: 1_000_000 },
      { id: "c2", name: "B", industry: "Pharma", employeeCount: 50, annualRevenue: 500_000 },
    ])
    mockMarketingFindMany().mockResolvedValue([{ companyId: "c2" }])

    const res = await PROMOTE(
      makeRequest("/api/v1/marketing-accounts/promote", { companyIds: ["c1", "c2", "c3"] }),
    )
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.created).toBe(1)
    expect(json.skipped).toBe(1)
    expect(json.notFound).toBe(1)
    expect(json.results).toHaveLength(3)

    const { data } = mockMarketingCreateMany().mock.calls[0][0] as CreateManyArgs
    expect(data).toHaveLength(1)
    expect(data[0].companyId).toBe("c1")
  })

  it("de-dupes repeated ids in the input", async () => {
    mockCompanyFindMany().mockResolvedValue([
      { id: "c1", name: "A", industry: null, employeeCount: null, annualRevenue: null },
    ])
    mockMarketingFindMany().mockResolvedValue([])

    const res = await PROMOTE(
      makeRequest("/api/v1/marketing-accounts/promote", { companyIds: ["c1", "c1"] }),
    )
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.requested).toBe(1)
    expect(json.created).toBe(1)
    expect(json.results).toHaveLength(1)
  })

  it("rejects an empty companyIds array (400)", async () => {
    const res = await PROMOTE(
      makeRequest("/api/v1/marketing-accounts/promote", { companyIds: [] }),
    )
    expect(res.status).toBe(400)
    expect(prisma.marketingAccount.createMany).not.toHaveBeenCalled()
  })
})
