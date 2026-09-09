import { describe, it, expect } from "vitest"
import {
  summarizeMessageAnalytics, summarizeConversationStats, computeFrtStats, pct,
  type MessageGroupRow, type ConversationStatusRow, type FrtMessageRow,
} from "@/lib/inbox-analytics"

const row = (channelType: string, direction: string, n: number): MessageGroupRow =>
  ({ channelType, direction, _count: { _all: n } })

describe("summarizeMessageAnalytics", () => {
  it("folds totals + in/out splits across channels", () => {
    const r = summarizeMessageAnalytics([
      row("email", "inbound", 10), row("email", "outbound", 5),
      row("sms", "inbound", 3), row("sms", "outbound", 7),
    ])
    expect(r.total).toBe(25)
    expect(r.inbound).toBe(13)
    expect(r.outbound).toBe(12)
  })

  it("byChannel sorted by total DESC, channel name ASC breaks ties", () => {
    const r = summarizeMessageAnalytics([
      row("sms", "inbound", 2), row("email", "inbound", 10), row("telegram", "inbound", 2),
    ])
    expect(r.byChannel.map((c) => c.channel)).toEqual(["email", "sms", "telegram"])
  })

  it("per-channel in/out is correct", () => {
    const r = summarizeMessageAnalytics([row("whatsapp", "inbound", 4), row("whatsapp", "outbound", 6)])
    expect(r.byChannel[0]).toEqual({ channel: "whatsapp", total: 10, inbound: 4, outbound: 6 })
  })

  it("skips zero/negative counts; an unknown direction counts to total but neither split", () => {
    const r = summarizeMessageAnalytics([
      row("email", "inbound", 0), row("email", "outbound", 5), row("email", "system", 2),
    ])
    expect(r.total).toBe(7)
    expect(r.inbound).toBe(0)
    expect(r.outbound).toBe(5)
    expect(r.byChannel[0]).toEqual({ channel: "email", total: 7, inbound: 0, outbound: 5 })
  })

  it("empty input → all zeros", () => {
    expect(summarizeMessageAnalytics([])).toEqual({ total: 0, inbound: 0, outbound: 0, byChannel: [] })
  })

  it("folds a null channelType under 'unknown' (never passes null downstream)", () => {
    const r = summarizeMessageAnalytics([
      { channelType: null, direction: "inbound", _count: { _all: 3 } },
      { channelType: null, direction: "outbound", _count: { _all: 1 } },
    ])
    expect(r.byChannel).toEqual([{ channel: "unknown", total: 4, inbound: 3, outbound: 1 }])
  })
})

describe("pct", () => {
  it("integer percentage; 0 when whole is 0", () => {
    expect(pct(1, 4)).toBe(25)
    expect(pct(1, 3)).toBe(33)
    expect(pct(0, 0)).toBe(0)
    expect(pct(5, 0)).toBe(0)
  })
})

const sRow = (status: string, n: number): ConversationStatusRow => ({ status, _count: { _all: n } })

describe("summarizeConversationStats", () => {
  it("folds status counts; resolution rate is resolved/total ONLY (archived excluded)", () => {
    const r = summarizeConversationStats([sRow("open", 2), sRow("resolved", 6), sRow("archived", 2)])
    // archived (2) is in the breakdown + total but NOT the rate → 6/10 = 60, not 80.
    expect(r).toMatchObject({ total: 10, open: 2, resolved: 6, archived: 2, other: 0, resolutionRate: 60 })
  })

  it("an unknown status → other: counts to total but not the resolution rate", () => {
    const r = summarizeConversationStats([sRow("open", 5), sRow("weird", 5)])
    expect(r.other).toBe(5)
    expect(r.total).toBe(10)
    expect(r.resolutionRate).toBe(0)
  })

  it("skips <=0 counts; empty input → zeros + 0% rate", () => {
    expect(summarizeConversationStats([sRow("open", 0)])).toMatchObject({ total: 0, resolutionRate: 0 })
    expect(summarizeConversationStats([])).toMatchObject({
      total: 0, open: 0, resolved: 0, archived: 0, other: 0, resolutionRate: 0,
    })
  })
})

const fm = (conversationId: string, direction: string, createdAt: string): FrtMessageRow =>
  ({ conversationId, direction, createdAt })

describe("computeFrtStats", () => {
  it("FRT = first inbound → first outbound after it, in minutes", () => {
    const r = computeFrtStats([
      fm("c1", "inbound", "2025-01-01T10:00:00Z"),
      fm("c1", "outbound", "2025-01-01T10:05:00Z"),
    ])
    expect(r).toMatchObject({ conversations: 1, answered: 1, unanswered: 0, medianMinutes: 5, avgMinutes: 5 })
  })

  it("ignores an outbound BEFORE the first inbound (reply must be at/after)", () => {
    const r = computeFrtStats([
      fm("c1", "outbound", "2025-01-01T09:00:00Z"),
      fm("c1", "inbound", "2025-01-01T10:00:00Z"),
      fm("c1", "outbound", "2025-01-01T10:10:00Z"),
    ])
    expect(r.answered).toBe(1)
    expect(r.medianMinutes).toBe(10)
  })

  it("inbound with no later outbound → unanswered, excluded from the median", () => {
    const r = computeFrtStats([
      fm("c1", "inbound", "2025-01-01T10:00:00Z"),
      fm("c2", "inbound", "2025-01-01T11:00:00Z"),
      fm("c2", "outbound", "2025-01-01T11:02:00Z"),
    ])
    expect(r).toMatchObject({ conversations: 2, answered: 1, unanswered: 1, medianMinutes: 2 })
  })

  it("an agent-initiated thread (no inbound) is not counted", () => {
    expect(computeFrtStats([fm("c1", "outbound", "2025-01-01T10:00:00Z")])).toMatchObject({
      conversations: 0, answered: 0, unanswered: 0, medianMinutes: null, avgMinutes: null,
    })
  })

  it("median over an even count averages the two middles; sorts internally", () => {
    const rows = [
      fm("d", "outbound", "2025-01-01T10:08:00Z"), fm("d", "inbound", "2025-01-01T10:00:00Z"), // 8
      fm("a", "inbound", "2025-01-01T10:00:00Z"), fm("a", "outbound", "2025-01-01T10:02:00Z"), // 2
      fm("c", "inbound", "2025-01-01T10:00:00Z"), fm("c", "outbound", "2025-01-01T10:06:00Z"), // 6
      fm("b", "inbound", "2025-01-01T10:00:00Z"), fm("b", "outbound", "2025-01-01T10:04:00Z"), // 4
    ]
    expect(computeFrtStats(rows)).toMatchObject({ answered: 4, medianMinutes: 5, avgMinutes: 5 })
  })

  it("skips messages with an unparseable createdAt", () => {
    const r = computeFrtStats([
      fm("c1", "inbound", "2025-01-01T10:00:00Z"),
      fm("c1", "outbound", "not-a-date"),
    ])
    expect(r).toMatchObject({ conversations: 1, answered: 0, unanswered: 1, medianMinutes: null })
  })

  it("empty input → zeros + null medians", () => {
    expect(computeFrtStats([])).toEqual({
      conversations: 0, answered: 0, unanswered: 0, medianMinutes: null, avgMinutes: null,
    })
  })
})
