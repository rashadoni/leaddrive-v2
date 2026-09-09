/**
 * C9 #12 — engagement weighting + de-dup policy.
 */
import { describe, it, expect } from "vitest"
import {
  engagementWeight,
  dedupeTouchpoints,
  applyEngagementWeighting,
  DEFAULT_ENGAGEMENT_WEIGHT,
} from "@/lib/marketing-attribution/engagement-weights"
import type { TouchpointForAttribution, TouchpointWeight } from "@/lib/marketing-attribution/types"

const tp = (
  id: string,
  campaignId: string,
  date: string,
  type?: string,
): TouchpointForAttribution => ({
  touchpointId: id,
  campaignId,
  occurredAt: new Date(date),
  touchpointType: type,
})

describe("C9 #12 — engagementWeight", () => {
  it("a click outweighs an open outweighs a bare send", () => {
    expect(engagementWeight("email_clicked")).toBeGreaterThan(engagementWeight("email_opened"))
    expect(engagementWeight("email_opened")).toBeGreaterThan(engagementWeight("email_sent"))
  })
  it("unknown / absent type → neutral default", () => {
    expect(engagementWeight("totally_unknown")).toBe(DEFAULT_ENGAGEMENT_WEIGHT)
    expect(engagementWeight(undefined)).toBe(DEFAULT_ENGAGEMENT_WEIGHT)
  })
})

describe("C9 #12 — dedupeTouchpoints", () => {
  it("collapses same (campaign, type) repeats, keeping the latest", () => {
    const out = dedupeTouchpoints([
      tp("t1", "c1", "2026-05-01", "email_opened"),
      tp("t2", "c1", "2026-05-05", "email_opened"), // later repeat → wins
      tp("t3", "c1", "2026-05-03", "email_opened"),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].touchpointId).toBe("t2")
  })
  it("keeps distinct engagement types of the same campaign", () => {
    const out = dedupeTouchpoints([
      tp("t1", "c1", "2026-05-01", "email_opened"),
      tp("t2", "c1", "2026-05-02", "email_clicked"),
    ])
    expect(out).toHaveLength(2)
  })
  it("keeps different campaigns even with the same type", () => {
    const out = dedupeTouchpoints([
      tp("t1", "c1", "2026-05-01", "email_clicked"),
      tp("t2", "c2", "2026-05-02", "email_clicked"),
    ])
    expect(out).toHaveLength(2)
  })
  it("never collapses untyped touchpoints", () => {
    const out = dedupeTouchpoints([
      tp("t1", "c1", "2026-05-01"),
      tp("t2", "c1", "2026-05-02"),
      tp("t3", "c1", "2026-05-03"),
    ])
    expect(out).toHaveLength(3)
  })
  it("returns occurredAt-ascending order", () => {
    const out = dedupeTouchpoints([
      tp("late", "c1", "2026-05-09", "email_clicked"),
      tp("early", "c2", "2026-05-01", "email_clicked"),
    ])
    expect(out.map((t) => t.touchpointId)).toEqual(["early", "late"])
  })
})

describe("C9 #12 — applyEngagementWeighting", () => {
  const w = (id: string, campaignId: string, weight: number): TouchpointWeight => ({
    touchpointId: id,
    campaignId,
    weight,
  })

  it("scales by engagement then renormalizes to 1.0; the click ends up heavier", () => {
    // Two equal positional weights (0.5 each): a click (1.0) vs an open (0.5).
    const out = applyEngagementWeighting(
      [w("t1", "c1", 0.5), w("t2", "c2", 0.5)],
      new Map([
        ["t1", "email_clicked"],
        ["t2", "email_opened"],
      ]),
    )
    // raw = [0.5*1.0, 0.5*0.5] = [0.5, 0.25] → /0.75 = [2/3, 1/3].
    expect(out[0].weight).toBeCloseTo(2 / 3, 6)
    expect(out[1].weight).toBeCloseTo(1 / 3, 6)
    expect(out[0].weight + out[1].weight).toBeCloseTo(1, 6)
  })

  it("absent types fall back to the neutral default (uniform → unchanged)", () => {
    const out = applyEngagementWeighting(
      [w("t1", "c1", 0.5), w("t2", "c2", 0.5)],
      new Map(),
    )
    expect(out[0].weight).toBeCloseTo(0.5, 6)
    expect(out[1].weight).toBeCloseTo(0.5, 6)
  })

  it("degenerate all-zero scaled weights are returned unchanged", () => {
    const out = applyEngagementWeighting([w("t1", "c1", 0)], new Map([["t1", "email_sent"]]))
    expect(out[0].weight).toBe(0)
  })
})
