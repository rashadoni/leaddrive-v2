import { describe, it, expect } from "vitest"
import { buildSalesItems, buildTicketItems, buildDeadlineItems, buildMtmItems } from "@/lib/leaderboard/agent-items"

describe("agent-items pure builders", () => {
  it("buildSalesItems maps name/amount/currency/date as a currency row", () => {
    const d = new Date("2026-06-01T10:00:00Z")
    expect(buildSalesItems([{ id: "d1", name: "Acme deal", valueAmount: 5000, currency: "AZN", date: d }])).toEqual([
      { id: "d1", title: "Acme deal", value: 5000, valueFormat: "currency", currency: "AZN", date: d.toISOString() },
    ])
  })

  it("buildTicketItems maps subject + resolvedAt (no value)", () => {
    const d = new Date("2026-06-02T08:00:00Z")
    expect(buildTicketItems([{ id: "t1", subject: "Login broken", resolvedAt: d }])).toEqual([
      { id: "t1", title: "Login broken", date: d.toISOString() },
    ])
  })

  it("buildDeadlineItems → onTime true when done on/before due", () => {
    const item = buildDeadlineItems([
      { id: "p1", title: "Proj", doneAt: new Date("2026-06-03"), due: new Date("2026-06-05") },
    ])[0]
    expect(item.onTime).toBe(true)
  })

  it("buildDeadlineItems → onTime false when done after due", () => {
    const item = buildDeadlineItems([
      { id: "p2", title: "Late", doneAt: new Date("2026-06-06"), due: new Date("2026-06-05") },
    ])[0]
    expect(item.onTime).toBe(false)
  })

  it("buildDeadlineItems → onTime null when no deadline", () => {
    const item = buildDeadlineItems([{ id: "p3", title: "No deadline", doneAt: new Date("2026-06-04"), due: null }])[0]
    expect(item.onTime).toBe(null)
  })

  it("buildDeadlineItems → exactly-on-deadline counts as on time (<=)", () => {
    const at = new Date("2026-06-05T00:00:00Z")
    expect(buildDeadlineItems([{ id: "p4", title: "Edge", doneAt: at, due: at }])[0].onTime).toBe(true)
  })

  it("buildMtmItems maps a route point (customer title + visited date)", () => {
    const d = new Date("2026-06-04T00:00:00Z")
    // title is the visited customer/store; doneAt is when the point was visited
    expect(buildMtmItems([{ id: "p1", title: "Bravo Market", doneAt: d }])).toEqual([
      { id: "p1", title: "Bravo Market", date: d.toISOString() },
    ])
  })

  it("builders preserve order + map all rows", () => {
    const rows = buildMtmItems([
      { id: "a", title: "A", doneAt: new Date("2026-06-01") },
      { id: "b", title: "B", doneAt: new Date("2026-06-02") },
    ])
    expect(rows.map((r) => r.id)).toEqual(["a", "b"])
  })
})
