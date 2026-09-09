import { describe, expect, it } from "vitest"
import { rankSalesAssignees } from "@/lib/inbox/sales-assignment"

describe("inbox sales assignment", () => {
  it("recommends the active salesperson with the fewest leads", () => {
    const ranked = rankSalesAssignees(
      [
        { id: "seller-a", name: "Aysel", email: "aysel@example.com" },
        { id: "seller-b", name: "Kenan", email: "kenan@example.com" },
        { id: "seller-c", name: "Nigar", email: "nigar@example.com" },
      ],
      [
        { assignedTo: "seller-a", _count: { _all: 4 } },
        { assignedTo: "seller-b", _count: { _all: 1 } },
      ],
    )

    expect(ranked.map((candidate) => [candidate.id, candidate.activeLeadCount])).toEqual([
      ["seller-c", 0],
      ["seller-b", 1],
      ["seller-a", 4],
    ])
    expect(ranked[0].recommended).toBe(true)
    expect(ranked.slice(1).every((candidate) => !candidate.recommended)).toBe(true)
  })

  it("uses a stable alphabetical tie-breaker", () => {
    const ranked = rankSalesAssignees(
      [
        { id: "seller-z", name: "Zaur", email: "zaur@example.com" },
        { id: "seller-a", name: "Aysel", email: "aysel@example.com" },
      ],
      [],
    )
    expect(ranked.map((candidate) => candidate.id)).toEqual(["seller-a", "seller-z"])
  })
})
