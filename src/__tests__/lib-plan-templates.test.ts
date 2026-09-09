import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: { planTemplate: { findFirst: vi.fn(), findMany: vi.fn() } },
}))

import { getPlanDefaults } from "@/lib/plan-templates"
import { prisma } from "@/lib/prisma"

beforeEach(() => vi.clearAllMocks())

describe("getPlanDefaults", () => {
  it("returns the DB row when an active plan exists", async () => {
    vi.mocked(prisma.planTemplate.findFirst).mockResolvedValue({
      key: "pharma", maxUsers: 40, maxContacts: 9000, features: ["deals"], addons: ["ai"],
    } as any)
    const d = await getPlanDefaults("pharma")
    expect(d).toEqual({ maxUsers: 40, maxContacts: 9000, features: ["deals"], addons: ["ai"] })
  })
  it("falls back to the const for a legacy key when DB is empty", async () => {
    vi.mocked(prisma.planTemplate.findFirst).mockResolvedValue(null)
    const d = await getPlanDefaults("starter")
    // Group-vocab fallback mirrors scripts/seed-plan-templates.mjs starter row.
    expect(d).toEqual({ maxUsers: 3, maxContacts: 500, features: ["crm", "sales", "settings"], addons: [] })
  })
  it("throws for an unknown/inactive key with no DB row", async () => {
    vi.mocked(prisma.planTemplate.findFirst).mockResolvedValue(null)
    await expect(getPlanDefaults("ghost")).rejects.toThrow(/Unknown or inactive plan/)
  })
})
