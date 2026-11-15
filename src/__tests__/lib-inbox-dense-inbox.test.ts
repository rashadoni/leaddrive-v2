/**
 * The dense inbox's rules (owner-approved mock-up, 2026-11-15), without the
 * page: who waits for an answer, who answers, which labels a row shows, where
 * the thread draws its «12 noyabr · Instagram» line, and the «Bu gün» card's
 * numbers — including the cases where the card must show NOTHING rather than a
 * zero that reads as a measurement.
 */
import { describe, expect, it } from "vitest"
import {
  conversationResponder, conversationRowChips, dayKey, formatReplyDuration, isAwaitingReply,
  labelCounts, localDayKey, localDayStart, separatorDayLabel, shiftDayKey, tagTone,
  threadChannelCounts, threadSeparators, todayCardModel,
} from "@/lib/inbox/dense-inbox"
import { convMatchesView } from "@/lib/inbox-channels"

const text = { awaiting: "Cavab gözləyir", stage: null as string | null, aiAnswered: "AI cavabladı" }

describe("Cavab gözləyir", () => {
  it("is the conversations where the customer wrote last — the rail view uses the same rule", () => {
    expect(isAwaitingReply({ lastDirection: "inbound" })).toBe(true)
    expect(isAwaitingReply({ lastDirection: "outbound" })).toBe(false)
    expect(isAwaitingReply({ lastDirection: null })).toBe(false)
    expect(convMatchesView({ lastDirection: "inbound" }, "awaiting", "me")).toBe(true)
    expect(convMatchesView({ lastDirection: "outbound" }, "awaiting", "me")).toBe(false)
  })
})

describe("who answers a conversation", () => {
  const agents = [{ id: "u-gunel", name: "Günel Həsənova" }]
  it("is the colleague it is assigned to, before the AI", () => {
    expect(conversationResponder({ assignedTo: "u-gunel", botHandled: true }, agents)).toEqual({ kind: "agent", id: "u-gunel", name: "Günel Həsənova" })
  })
  it("is the AI when nobody is assigned and the auto-reply answered", () => {
    expect(conversationResponder({ assignedTo: null, botHandled: true }, agents)).toEqual({ kind: "ai" })
  })
  it("is nobody when neither", () => {
    expect(conversationResponder({ assignedTo: null, botHandled: false }, agents)).toBeNull()
  })
  it("still shows an assignee the agents list no longer knows", () => {
    expect(conversationResponder({ assignedTo: "u-left" }, agents)).toEqual({ kind: "agent", id: "u-left", name: "?" })
  })
})

describe("the row's coloured labels", () => {
  it("shows «waits for our answer» only on a read row — an unread one already shows its count", () => {
    const read = conversationRowChips({ lastDirection: "inbound", unreadCount: 0 }, text)
    expect(read.chips.map((c) => c.key)).toEqual(["awaiting"])
    expect(read.chips[0].tone).toBe("red")
    const unread = conversationRowChips({ lastDirection: "inbound", unreadCount: 2 }, text)
    expect(unread.chips).toEqual([])
  })

  it("puts the stage first, then the labels, and never hides «AI cavabladı» behind +N", () => {
    const { chips, more } = conversationRowChips(
      { lastDirection: "outbound", conversationTags: ["VIP", "Çatdırılma", "Sifariş"], botHandled: true },
      { ...text, stage: "Lid" },
    )
    expect(chips.map((c) => c.text)).toEqual(["Lid", "VIP", "AI cavabladı"])
    expect(chips.at(-1)?.ai).toBe(true)
    expect(more).toBe(2)
  })

  it("gives one label the same colour everywhere, and never the stage's, the AI's or the alarm's", () => {
    expect(tagTone("VIP")).toBe(tagTone("  vip "))
    for (const tag of ["VIP", "Çatdırılma", "Şikayət", "Sifariş", "Korporativ", "40 ölçü", "Bağlanır"]) {
      expect(["red", "orange", "violet"]).not.toContain(tagTone(tag))
    }
  })

  it("counts each label once per conversation, most used first", () => {
    expect(labelCounts([
      { conversationTags: ["VIP", "VIP", "Çatdırılma"] },
      { conversationTags: ["Çatdırılma"] },
      { conversationTags: [] },
      {},
    ])).toEqual([{ tag: "Çatdırılma", count: 2 }, { tag: "VIP", count: 1 }])
  })
})

describe("the thread's channel chips", () => {
  it("count messages per channel, most first, with the calls last", () => {
    expect(threadChannelCounts([
      { channelType: "whatsapp" }, { channelType: "instagram" }, { channelType: "instagram" },
      { channelType: "" },
    ], 1)).toEqual([
      { channel: "instagram", count: 2 },
      { channel: "whatsapp", count: 1 },
      { channel: "voip", count: 1 },
    ])
  })
  it("draw no «Zənglər» chip for a thread without calls", () => {
    expect(threadChannelCounts([{ channelType: "whatsapp" }], 0)).toEqual([{ channel: "whatsapp", count: 1 }])
  })
})

describe("the «12 noyabr · Instagram» line", () => {
  const tz = "Asia/Baku"
  const at = (iso: string) => new Date(iso).getTime()

  it("goes before the first item and wherever the day or the channel changes", () => {
    const marks = [
      { at: at("2026-11-12T10:20:00Z"), channel: "instagram" },
      { at: at("2026-11-12T10:22:00Z"), channel: "instagram" },
      { at: at("2026-11-13T07:05:00Z"), channel: "whatsapp" },
      { at: at("2026-11-13T07:31:00Z"), channel: "whatsapp" },
      { at: at("2026-11-13T09:00:00Z"), channel: "voip" },
      { at: at("2026-11-13T09:10:00Z"), channel: "voip" },
    ]
    expect(threadSeparators(marks, tz)).toEqual([
      { day: "2026-11-12", channel: "instagram" },
      null,
      { day: "2026-11-13", channel: "whatsapp" },
      null,
      { day: "2026-11-13", channel: "voip" },
      null,
    ])
  })

  it("reads the day on the company's clock: 23:30 and 00:30 in Baku are two days", () => {
    const marks = [
      { at: at("2026-11-14T19:30:00Z"), channel: "instagram" },
      { at: at("2026-11-14T20:30:00Z"), channel: "instagram" },
    ]
    expect(threadSeparators(marks, tz).map((s) => s?.day ?? null)).toEqual(["2026-11-14", "2026-11-15"])
    expect(threadSeparators(marks, "UTC")[1]).toBeNull()
  })

  it("does not repeat the line for an internal note between two messages of one channel", () => {
    const marks = [
      { at: at("2026-11-12T10:00:00Z"), channel: "instagram" },
      { at: at("2026-11-12T10:01:00Z"), channel: null },
      { at: at("2026-11-12T10:02:00Z"), channel: "instagram" },
    ]
    expect(threadSeparators(marks, tz)).toEqual([{ day: "2026-11-12", channel: "instagram" }, null, null])
  })

  it("says «Bu gün» and «Dünən», then the date — with the year only when it is another year", () => {
    const now = at("2026-11-15T12:00:00Z")
    const words = { today: "Bu gün", yesterday: "Dünən" }
    const fmt = (d: Date, withYear: boolean) => `${d.getDate()}.${d.getMonth() + 1}${withYear ? `.${d.getFullYear()}` : ""}`
    expect(separatorDayLabel("2026-11-15", now, words, fmt, tz)).toBe("Bu gün")
    expect(separatorDayLabel("2026-11-14", now, words, fmt, tz)).toBe("Dünən")
    expect(separatorDayLabel("2026-11-12", now, words, fmt, tz)).toBe("12.11")
    expect(separatorDayLabel("2025-12-31", now, words, fmt, tz)).toBe("31.12.2025")
    expect(shiftDayKey("2026-03-01", -1)).toBe("2026-02-28")
    expect(dayKey(at("2026-11-14T20:30:00Z"), tz)).toBe("2026-11-15")
  })
})

describe("the «Bu gün» card", () => {
  const now = new Date(2026, 10, 15, 18, 42).getTime()
  const day = (offset: number) => localDayKey(localDayStart(now, offset))

  it("is today's incoming messages, seven bars ending today, and the change against yesterday so far", () => {
    const model = todayCardModel({
      nowMs: now,
      trend: [
        { date: day(-6), inbound: 62 }, { date: day(-4), inbound: 70 },
        { date: day(-1), inbound: 140 }, { date: day(0), inbound: 128 },
        { date: day(-30), inbound: 999 },
      ],
      yesterdaySoFar: 100,
      firstReply: { answered: 9, medianMinutes: 1.67 },
    })
    expect(model).not.toBeNull()
    expect(model!.today).toBe(128)
    expect(model!.bars.map((b) => b.value)).toEqual([62, 0, 70, 0, 0, 140, 128])
    expect(model!.bars.at(-1)!.day).toBe(day(0))
    expect(model!.deltaPct).toBe(28)
    expect(model!.medianFirstReplyMinutes).toBe(1.67)
  })

  it("draws no card when seven days hold no incoming message — not seven empty bars and a zero", () => {
    expect(todayCardModel({ nowMs: now, trend: [], yesterdaySoFar: 0, firstReply: null })).toBeNull()
    expect(todayCardModel({ nowMs: now, trend: [{ date: day(-9), inbound: 40 }], yesterdaySoFar: 0, firstReply: null })).toBeNull()
  })

  it("draws no change when yesterday had nothing up to this hour, and no reply line before a first reply", () => {
    const model = todayCardModel({
      nowMs: now,
      trend: [{ date: day(0), inbound: 3 }],
      yesterdaySoFar: 0,
      firstReply: { answered: 0, medianMinutes: null },
    })
    expect(model!.deltaPct).toBeNull()
    expect(model!.medianFirstReplyMinutes).toBeNull()
    expect(todayCardModel({ nowMs: now, trend: [{ date: day(0), inbound: 3 }], yesterdaySoFar: null, firstReply: null })!.deltaPct).toBeNull()
  })

  it("keeps a real zero today when earlier days had messages", () => {
    const model = todayCardModel({ nowMs: now, trend: [{ date: day(-2), inbound: 5 }], yesterdaySoFar: 4, firstReply: null })
    expect(model!.today).toBe(0)
    expect(model!.deltaPct).toBe(-100)
  })

  it("says the reply time in words: seconds, minutes and seconds, hours and minutes", () => {
    const words = {
      hoursMinutes: (h: number, m: number) => `${h} saat ${m} dəq`,
      minutesSeconds: (m: number, s: number) => `${m} dəq ${s} san`,
      seconds: (s: number) => `${s} san`,
    }
    expect(formatReplyDuration(0.5, words)).toBe("30 san")
    expect(formatReplyDuration(1 + 40 / 60, words)).toBe("1 dəq 40 san")
    expect(formatReplyDuration(125, words)).toBe("2 saat 5 dəq")
  })
})
