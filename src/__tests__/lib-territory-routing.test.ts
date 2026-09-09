/**
 * S4 auto-routing: routeNewCompanyToTerritories notifies the member reps of
 * every ACTIVE territory whose rules match a new company's profile.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue({ id: "n1" }),
}))

import { routeNewCompanyToTerritories } from "@/lib/territory-routing"
import { createNotification } from "@/lib/notifications"

function makePrisma(territories: any[]) {
  return { territory: { findMany: vi.fn().mockResolvedValue(territories) } }
}

const company = {
  id: "c1",
  name: "Acme AZ",
  country: "AZ",
  industry: "Retail",
  employeeCount: 120,
}

beforeEach(() => vi.clearAllMocks())

describe("routeNewCompanyToTerritories", () => {
  it("returns 0 and notifies nobody when there are no territories", async () => {
    const prisma = makePrisma([])
    expect(await routeNewCompanyToTerritories(prisma, { orgId: "o1", company })).toBe(0)
    expect(createNotification).not.toHaveBeenCalled()
  })

  it("notifies every member of a matching territory", async () => {
    const prisma = makePrisma([
      {
        id: "t1",
        name: "AZ Retail",
        rules: { countries: ["AZ"], industries: ["Retail"] },
        members: [{ userId: "u1" }, { userId: "u2" }],
      },
    ])
    const n = await routeNewCompanyToTerritories(prisma, { orgId: "o1", company })
    expect(n).toBe(2)
    expect(createNotification).toHaveBeenCalledTimes(2)
    expect(vi.mocked(createNotification).mock.calls[0][0]).toMatchObject({
      organizationId: "o1",
      userId: "u1",
      entityType: "company",
      entityId: "c1",
    })
  })

  it("skips a non-matching territory (returns 0)", async () => {
    const prisma = makePrisma([
      { id: "t1", name: "TR Enterprise", rules: { countries: ["TR"] }, members: [{ userId: "u1" }] },
    ])
    expect(await routeNewCompanyToTerritories(prisma, { orgId: "o1", company })).toBe(0)
    expect(createNotification).not.toHaveBeenCalled()
  })

  it("notifies only matched territories among several (empty rules = match all)", async () => {
    const prisma = makePrisma([
      { id: "t1", name: "AZ Retail", rules: { countries: ["AZ"], industries: ["Retail"] }, members: [{ userId: "u1" }] },
      { id: "t2", name: "TR Enterprise", rules: { countries: ["TR"] }, members: [{ userId: "u2" }] },
      { id: "t3", name: "Catch-all", rules: {}, members: [{ userId: "u3" }] },
    ])
    const n = await routeNewCompanyToTerritories(prisma, { orgId: "o1", company })
    expect(n).toBe(2) // t1 (AZ+Retail) + t3 (empty rules); t2 (TR) excluded
    const userIds = vi.mocked(createNotification).mock.calls.map((c) => (c[0] as any).userId).sort()
    expect(userIds).toEqual(["u1", "u3"])
  })
})
