import { describe, it, expect, vi } from "vitest"
import { selectEligibleJourneys, enrollAccountInJourneys } from "./abm-enrollment"

const J = (over: Partial<{ id: string; status: string; targetIcpTiers: string[]; targetStages: string[] }>) => ({
  id: "j",
  status: "active",
  targetIcpTiers: [] as string[],
  targetStages: [] as string[],
  ...over,
})

describe("selectEligibleJourneys", () => {
  it("matches active journeys by tier + stage (empty filter = any)", () => {
    const journeys = [
      J({ id: "any" }),
      J({ id: "tier1only", targetIcpTiers: ["tier_1"] }),
      J({ id: "mqlonly", targetStages: ["mql"] }),
      J({ id: "draft", status: "draft" }),
      J({ id: "tier2", targetIcpTiers: ["tier_2"] }),
    ]
    const ids = selectEligibleJourneys({ icpTier: "tier_1", lifecycleStage: "mql" }, journeys).map((j) => j.id)
    expect(ids).toEqual(["any", "tier1only", "mqlonly"])
  })

  it("excludes when the stage filter misses", () => {
    const r = selectEligibleJourneys(
      { icpTier: "tier_1", lifecycleStage: "target" },
      [J({ targetStages: ["mql"] })],
    )
    expect(r).toHaveLength(0)
  })
})

function makeClient() {
  return {
    abmJourney: { findMany: vi.fn() },
    abmJourneyEnrollment: {
      findMany: vi.fn().mockResolvedValue([]),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  }
}

describe("enrollAccountInJourneys", () => {
  it("enrolls into eligible, not-yet-enrolled journeys (idempotent createMany)", async () => {
    const c = makeClient()
    c.abmJourney.findMany.mockResolvedValue([
      J({ id: "j1" }),
      J({ id: "j2", targetStages: ["mql"] }),
      J({ id: "j3", targetIcpTiers: ["tier_3"] }),
    ])
    c.abmJourneyEnrollment.findMany.mockResolvedValue([])
    c.abmJourneyEnrollment.createMany.mockResolvedValue({ count: 2 })

    const res = await enrollAccountInJourneys(
      "org-1",
      "acc-1",
      { icpTier: "tier_1", lifecycleStage: "mql" },
      c as any,
    )
    expect(res).toMatchObject({ eligible: 2, enrolled: 2 })
    const arg = c.abmJourneyEnrollment.createMany.mock.calls[0][0]
    expect(arg.skipDuplicates).toBe(true)
    expect(arg.data.map((d: any) => d.journeyId).sort()).toEqual(["j1", "j2"])
    expect(arg.data[0].status).toBe("enrolled")
  })

  it("skips already-enrolled journeys", async () => {
    const c = makeClient()
    c.abmJourney.findMany.mockResolvedValue([J({ id: "j1" })])
    c.abmJourneyEnrollment.findMany.mockResolvedValue([{ journeyId: "j1" }])
    const res = await enrollAccountInJourneys("o", "a", { icpTier: "tier_1", lifecycleStage: "mql" }, c as any)
    expect(res).toMatchObject({ eligible: 1, enrolled: 0, alreadyEnrolled: 1 })
    expect(c.abmJourneyEnrollment.createMany).not.toHaveBeenCalled()
  })

  it("no-ops when no journey matches", async () => {
    const c = makeClient()
    c.abmJourney.findMany.mockResolvedValue([J({ id: "j1", targetIcpTiers: ["tier_4"] })])
    const res = await enrollAccountInJourneys("o", "a", { icpTier: "tier_1", lifecycleStage: "mql" }, c as any)
    expect(res).toMatchObject({ eligible: 0, enrolled: 0 })
    expect(c.abmJourneyEnrollment.findMany).not.toHaveBeenCalled()
  })
})
