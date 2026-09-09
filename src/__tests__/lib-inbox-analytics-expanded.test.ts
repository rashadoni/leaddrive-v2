import { describe, it, expect } from "vitest"
import {
  perConversationFrt, computeFrtStats, summarizeAgentPerformance,
  shapeHeatmap, shapeTrend, computeSlaDistribution, bucketBacklogAging,
  summarizeConversationPlatforms,
  type FrtMessageRow, type AgentConvRow,
} from "@/lib/inbox-analytics"

const T = (mins: number) => new Date(2026, 0, 1, 0, mins).toISOString() // t0 + mins

describe("perConversationFrt", () => {
  it("computes minutes from first inbound to first reply at/after it", () => {
    const rows: FrtMessageRow[] = [
      { conversationId: "a", direction: "inbound", createdAt: T(0) },
      { conversationId: "a", direction: "outbound", createdAt: T(10) },
    ]
    expect(perConversationFrt(rows)).toEqual([{ conversationId: "a", hasInbound: true, frtMin: 10 }])
  })
  it("flags inbound-with-no-reply as hasInbound + frtMin null", () => {
    const rows: FrtMessageRow[] = [{ conversationId: "a", direction: "inbound", createdAt: T(0) }]
    expect(perConversationFrt(rows)[0]).toEqual({ conversationId: "a", hasInbound: true, frtMin: null })
  })
  it("ignores agent-initiated threads (no inbound) → hasInbound false", () => {
    const rows: FrtMessageRow[] = [{ conversationId: "a", direction: "outbound", createdAt: T(0) }]
    expect(perConversationFrt(rows)[0]).toEqual({ conversationId: "a", hasInbound: false, frtMin: null })
  })
  it("sorts internally + ignores an outbound BEFORE the first inbound", () => {
    const rows: FrtMessageRow[] = [
      { conversationId: "a", direction: "outbound", createdAt: T(30) },
      { conversationId: "a", direction: "inbound", createdAt: T(5) },
      { conversationId: "a", direction: "outbound", createdAt: T(2) }, // before inbound — not the reply
    ]
    // first inbound at t5; first outbound >= t5 is t30 → 25
    expect(perConversationFrt(rows)[0].frtMin).toBe(25)
  })
})

describe("computeFrtStats (regression — behaviour unchanged after refactor)", () => {
  it("counts conversations (with inbound), answered, median & avg", () => {
    const rows: FrtMessageRow[] = [
      { conversationId: "a", direction: "inbound", createdAt: T(0) },
      { conversationId: "a", direction: "outbound", createdAt: T(10) }, // frt 10
      { conversationId: "b", direction: "inbound", createdAt: T(0) },
      { conversationId: "b", direction: "outbound", createdAt: T(20) }, // frt 20
      { conversationId: "c", direction: "inbound", createdAt: T(0) },   // unanswered
      { conversationId: "d", direction: "outbound", createdAt: T(0) },  // no inbound — ignored
    ]
    const s = computeFrtStats(rows)
    expect(s.conversations).toBe(3) // a,b,c (d has no inbound)
    expect(s.answered).toBe(2)
    expect(s.unanswered).toBe(1)
    expect(s.medianMinutes).toBe(15) // median of [10,20]
    expect(s.avgMinutes).toBe(15)
  })
})

describe("summarizeAgentPerformance", () => {
  it("rolls up per agent with names, resolution, unread, median FRT; sorts by assigned desc", () => {
    const convs: AgentConvRow[] = [
      { conversationId: "1", assignedTo: "u1", status: "resolved", unreadCount: 0 },
      { conversationId: "2", assignedTo: "u1", status: "open", unreadCount: 3 },
      { conversationId: "3", assignedTo: "u2", status: "resolved", unreadCount: 1 },
      { conversationId: "4", assignedTo: null, status: "open", unreadCount: 5 },
    ]
    const frtRows: FrtMessageRow[] = [
      { conversationId: "1", direction: "inbound", createdAt: T(0) },
      { conversationId: "1", direction: "outbound", createdAt: T(8) }, // u1 frt 8
      { conversationId: "3", direction: "inbound", createdAt: T(0) },
      { conversationId: "3", direction: "outbound", createdAt: T(6) }, // u2 frt 6
    ]
    const out = summarizeAgentPerformance(convs, frtRows, { u1: "Aysel", u2: "Ramil" })
    expect(out[0]).toMatchObject({ agentId: "u1", agentName: "Aysel", assigned: 2, resolved: 1, resolutionRate: 50, medianFrtMinutes: 8, unread: 3 })
    const unassigned = out.find((a) => a.agentId === null)
    expect(unassigned).toMatchObject({ agentName: "", assigned: 1, unread: 5 })
  })
})

describe("shapeHeatmap", () => {
  it("fills a 7×24 grid of INBOUND counts only, coerces string dow/hour, ignores out-of-range", () => {
    const grid = shapeHeatmap([
      { dow: 1, hour: 9, direction: "inbound", count: 4 },
      { dow: "1", hour: "9", direction: "inbound", count: 2 }, // strings → same cell, +2
      { dow: 1, hour: 9, direction: "outbound", count: 99 },   // outbound ignored
      { dow: 9, hour: 9, direction: "inbound", count: 5 },     // out of range ignored
    ])
    expect(grid.length).toBe(7)
    expect(grid[0].length).toBe(24)
    expect(grid[1][9]).toBe(6)
  })
})

describe("shapeTrend", () => {
  it("groups by date, splits in/out, sorts ascending", () => {
    const out = shapeTrend([
      { day: "2026-01-02", direction: "inbound", count: 3 },
      { day: "2026-01-01", direction: "inbound", count: 5 },
      { day: "2026-01-01", direction: "outbound", count: 2 },
    ])
    expect(out).toEqual([
      { date: "2026-01-01", inbound: 5, outbound: 2 },
      { date: "2026-01-02", inbound: 3, outbound: 0 },
    ])
  })
})

describe("computeSlaDistribution", () => {
  it("computes SLA-met % (<=threshold) and a fixed FRT histogram", () => {
    const rows: FrtMessageRow[] = [3, 10, 20, 45, 90].flatMap((m, i) => [
      { conversationId: `c${i}`, direction: "inbound", createdAt: T(0) },
      { conversationId: `c${i}`, direction: "outbound", createdAt: T(m) },
    ])
    const s = computeSlaDistribution(rows, 30)
    expect(s.answered).toBe(5)
    expect(s.slaMetPct).toBe(60) // 3,10,20 <= 30 → 3/5
    expect(s.distribution.map((d) => d.count)).toEqual([1, 1, 1, 1, 1]) // <5,5-15,15-30,30-60,>60
  })
  it("counts a boundary FRT of exactly the threshold as met", () => {
    const rows: FrtMessageRow[] = [
      { conversationId: "c", direction: "inbound", createdAt: T(0) },
      { conversationId: "c", direction: "outbound", createdAt: T(30) },
    ]
    expect(computeSlaDistribution(rows, 30).slaMetPct).toBe(100)
  })
})

describe("bucketBacklogAging", () => {
  it("buckets open-conversation ages and reports oldest", () => {
    const a = bucketBacklogAging([0.5, 2, 10, 50])
    expect(a.buckets.map((b) => b.count)).toEqual([1, 1, 1, 1]) // <1h,1-4h,4-24h,>24h
    expect(a.total).toBe(4)
    expect(a.oldestHours).toBe(50)
  })
  it("is empty-safe (oldestHours null)", () => {
    expect(bucketBacklogAging([])).toEqual({
      buckets: [
        { label: "<1h", count: 0 }, { label: "1–4h", count: 0 },
        { label: "4–24h", count: 0 }, { label: ">24h", count: 0 },
      ],
      total: 0,
      oldestHours: null,
    })
  })
})

describe("summarizeConversationPlatforms", () => {
  it("folds (platform,status) into per-platform open/resolved, sorted by total desc", () => {
    const out = summarizeConversationPlatforms([
      { platform: "whatsapp", status: "open", _count: { _all: 5 } },
      { platform: "whatsapp", status: "resolved", _count: { _all: 3 } },
      { platform: "email", status: "open", _count: { _all: 2 } },
    ])
    expect(out).toEqual([
      { platform: "whatsapp", total: 8, open: 5, resolved: 3 },
      { platform: "email", total: 2, open: 2, resolved: 0 },
    ])
  })
})
