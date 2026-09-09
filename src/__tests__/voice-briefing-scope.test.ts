import { beforeEach, describe, expect, it, vi } from "vitest"

const findFirst = vi.hoisted(() => vi.fn())

vi.mock("@/lib/prisma", () => ({
  prisma: { advisorSignalSnapshot: { findFirst } },
}))

import { buildVoiceBriefing } from "@/lib/ai/voice/summaries"

const NOW = new Date("2026-08-12T08:00:00.000Z")

beforeEach(() => {
  vi.clearAllMocks()
  findFirst.mockResolvedValue({
    snapshotAt: new Date("2026-08-12T07:00:00.000Z"),
    totalSignals: 4,
    criticalCount: 1,
    highCount: 2,
    moneyAtRisk: 1250,
    domainCounts: { sales: 3, finance: 1 },
  })
})
describe("voice briefing snapshot scope", () => {
  it("fails closed when a stored aggregate contains a currently hidden domain", async () => {
    await expect(buildVoiceBriefing("org-1", NOW, ["sales"], {
      userId: "manager-1",
      role: "manager",
    })).resolves.toEqual({
      available: false,
      scopeRestricted: true,
      snapshotAt: null,
      totalSignals: 0,
      criticalCount: 0,
      highCount: 0,
      moneyAtRisk: 0,
      staleHours: null,
    })
  })

  it("returns the snapshot only when every contributing domain is visible", async () => {
    await expect(buildVoiceBriefing("org-1", NOW, ["sales", "finance"], {
      userId: "admin-1",
      role: "admin",
    })).resolves.toMatchObject({
      available: true,
      scopeRestricted: false,
      totalSignals: 4,
      criticalCount: 1,
      highCount: 2,
      moneyAtRisk: 1250,
      staleHours: 1,
    })
  })

  it("treats a malformed legacy domain map as restricted instead of leaking totals", async () => {
    findFirst.mockResolvedValue({
      snapshotAt: new Date("2026-08-12T07:00:00.000Z"),
      totalSignals: 4,
      criticalCount: 1,
      highCount: 2,
      moneyAtRisk: 1250,
      domainCounts: null,
    })

    const result = await buildVoiceBriefing("org-1", NOW, ["sales", "finance"], {
      userId: "admin-1",
      role: "admin",
    })
    expect(result).toMatchObject({ available: false, scopeRestricted: true, totalSignals: 0 })
  })
})
