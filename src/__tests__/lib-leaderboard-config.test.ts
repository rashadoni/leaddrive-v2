import { describe, it, expect, vi } from "vitest"

// The loader imports `@/lib/prisma` at top-level for its default client; the
// pure resolver never touches it, and the async loader uses an injected client.
vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import {
  resolveLeaderboardConfig,
  loadLeaderboardConfig,
  DEFAULT_MTM_WEIGHTS,
  DEFAULT_STATUS_THRESHOLDS,
} from "@/lib/leaderboard/config-loader"

describe("resolveLeaderboardConfig", () => {
  it("no row → defaults verbatim", () => {
    const c = resolveLeaderboardConfig(null)
    expect(c.mtmWeights).toEqual({ task: 0.5, photo: 0.3, route: 0.2 })
    expect(c.statusThresholds).toEqual({ exceeding: 110, on_track: 90, behind: 70, at_risk: 50 })
  })

  it("shallow per-key merge — present keys override, missing keep default", () => {
    const c = resolveLeaderboardConfig({
      mtmWeights: { task: 0.6, photo: 0.4 }, // route omitted → default 0.2
      statusThresholds: { on_track: 85 }, // others default
    })
    expect(c.mtmWeights).toEqual({ task: 0.6, photo: 0.4, route: 0.2 })
    expect(c.statusThresholds).toEqual({ exceeding: 110, on_track: 85, behind: 70, at_risk: 50 })
  })

  it("malformed overrides → defaults win (no throw)", () => {
    const c = resolveLeaderboardConfig({
      // negative, NaN, string, null, array entries all rejected per-key
      mtmWeights: { task: -1, photo: Number.NaN, route: "0.9" },
      statusThresholds: [110, 90], // array, not a record
    })
    expect(c.mtmWeights).toEqual({ task: 0.5, photo: 0.3, route: 0.2 })
    expect(c.statusThresholds).toEqual({ exceeding: 110, on_track: 90, behind: 70, at_risk: 50 })
  })

  it("non-object override (string / undefined) → defaults", () => {
    const c = resolveLeaderboardConfig({ mtmWeights: "garbage", statusThresholds: undefined })
    expect(c.mtmWeights).toEqual(DEFAULT_MTM_WEIGHTS)
    expect(c.statusThresholds).toEqual(DEFAULT_STATUS_THRESHOLDS)
  })

  it("returns frozen objects (mutation throws in strict mode / no-ops)", () => {
    const c = resolveLeaderboardConfig(null)
    expect(Object.isFrozen(c)).toBe(true)
    expect(Object.isFrozen(c.mtmWeights)).toBe(true)
    expect(Object.isFrozen(c.statusThresholds)).toBe(true)
  })

  it("does not mutate the exported DEFAULT_* constants across calls", () => {
    resolveLeaderboardConfig({ mtmWeights: { task: 0.9 }, statusThresholds: {} })
    expect(DEFAULT_MTM_WEIGHTS.task).toBe(0.5) // still pristine
  })
})

describe("loadLeaderboardConfig (injected client)", () => {
  it("absent row → defaults", async () => {
    const client = { leaderboardConfig: { findUnique: vi.fn().mockResolvedValue(null) } }
    const c = await loadLeaderboardConfig("org_1", client)
    expect(c.mtmWeights).toEqual(DEFAULT_MTM_WEIGHTS)
    expect(client.leaderboardConfig.findUnique).toHaveBeenCalledWith({ where: { organizationId: "org_1" } })
  })

  it("present row → merged overrides", async () => {
    const client = {
      leaderboardConfig: {
        findUnique: vi.fn().mockResolvedValue({ mtmWeights: { route: 0.5 }, statusThresholds: { exceeding: 120 } }),
      },
    }
    const c = await loadLeaderboardConfig("org_2", client)
    expect(c.mtmWeights).toEqual({ task: 0.5, photo: 0.3, route: 0.5 })
    expect(c.statusThresholds.exceeding).toBe(120)
  })
})
