import { describe, expect, it } from "vitest"
import { compareLeads, DEFAULT_LEAD_SORT, type SortableLead } from "@/lib/leads/sort"

function lead(overrides: Partial<SortableLead> & Pick<SortableLead, "id" | "createdAt">): SortableLead {
  return {
    score: 0,
    contactName: "Lead",
    companyName: null,
    source: null,
    status: "new",
    ...overrides,
  }
}

describe("lead ordering", () => {
  it("defaults to newest-first so a new zero-score omnichannel lead stays on top", () => {
    const olderScored = lead({ id: "older", createdAt: "2026-08-10T10:00:00.000Z", score: 95 })
    const newUnscored = lead({ id: "new", createdAt: "2026-08-11T10:00:00.000Z", score: 0 })

    expect(DEFAULT_LEAD_SORT).toBe("newest")
    expect([olderScored, newUnscored].sort((a, b) => compareLeads(a, b, DEFAULT_LEAD_SORT)))
      .toEqual([newUnscored, olderScored])
  })

  it("keeps Da Vinci score ordering available as an explicit choice", () => {
    const olderScored = lead({ id: "older", createdAt: "2026-08-10T10:00:00.000Z", score: 95 })
    const newUnscored = lead({ id: "new", createdAt: "2026-08-11T10:00:00.000Z", score: 0 })

    expect([newUnscored, olderScored].sort((a, b) => compareLeads(a, b, "score_desc")))
      .toEqual([olderScored, newUnscored])
  })

  it("uses newest-first as a deterministic tie-breaker for equal values", () => {
    const older = lead({ id: "older", createdAt: "2026-08-10T10:00:00.000Z", score: 50 })
    const newer = lead({ id: "newer", createdAt: "2026-08-11T10:00:00.000Z", score: 50 })

    expect([older, newer].sort((a, b) => compareLeads(a, b, "score_desc")))
      .toEqual([newer, older])
  })
})
