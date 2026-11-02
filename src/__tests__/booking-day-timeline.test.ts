/**
 * The day view of «Встречи и запись»: a meeting is a block as long as it
 * lasts, free time is a window someone can click, and two meetings at the same
 * hour stand side by side.
 *
 * Three things here are not cosmetic, and each one was a real trap:
 *
 * 1. The screen puts `min-h-11` on every button inside it, for touch. A
 *    meeting block is a button whose height IS its length, so a quarter-hour
 *    block would be stretched to three quarters of an hour — 44 px of block
 *    over a 26 px meeting, overlapping the next one. The height is pinned
 *    inline, where no class can stretch it.
 * 2. Overlapping meetings must both be visible. Drawing them at the same
 *    place hides one, and hiding a meeting is how someone double-books.
 * 3. A key that does not exist in a locale prints its own name on screen
 *    («booking.viewDay»), and nothing else fails. Every literal key these
 *    files ask for is checked against all three locales.
 */
import { readFileSync } from "node:fs"
import { createElement, type ComponentProps } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it } from "vitest"
import {
  BookingDayTimeline,
  BookingWeekStrip,
  mergeFreeWindows,
  minutesFrom,
  packSpans,
  railRange,
  type TimelineMeeting,
} from "@/components/booking/booking-day-timeline"
import { deliveryState, nameInitials, integrationLabel } from "@/components/booking/booking-detail"

import en from "../../messages/en.json"
import ru from "../../messages/ru.json"
import az from "../../messages/az.json"

/** Midnight of 2 November 2026 on the Baku clock, which is UTC+4 all year. */
const DAY_START = Date.parse("2026-11-01T20:00:00.000Z")
const at = (hour: number, minute = 0) => new Date(DAY_START + (hour * 60 + minute) * 60_000).toISOString()
const minutes = (hour: number, minute = 0) => hour * 60 + minute

const SAMIR: TimelineMeeting = { id: "samir", name: "Самир Алиев", status: "completed", subtitle: "Нигяр · Знакомство", start: minutes(9), end: minutes(9, 45) }
const AYTEN: TimelineMeeting = { id: "ayten", name: "Айтен Мамедова", status: "confirmed", subtitle: "Нигяр · Знакомство", start: minutes(10, 30), end: minutes(11, 15) }
const ORHAN: TimelineMeeting = { id: "orhan", name: "Орхан Рзаев", status: "no_show", subtitle: "Кямран · Демонстрация", start: minutes(10, 45), end: minutes(11, 30) }
const QUARTER: TimelineMeeting = { id: "quarter", name: "Лейла Гусейнова", status: "confirmed", subtitle: "Нигяр · Звонок", start: minutes(14), end: minutes(14, 15) }

function render(props: Partial<ComponentProps<typeof BookingDayTimeline>> = {}) {
  const element = createElement(BookingDayTimeline, {
    meetings: [SAMIR, AYTEN],
    windows: [],
    nowMinutes: null,
    selectedId: null,
    pendingStart: null,
    pendingEnd: null,
    onSelect: () => {},
    onBook: null,
    time: (value: number) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`,
    statusLabel: (status: string) => status,
    duration: (value: number) => `${value} мин`,
    ...props,
  })
  return renderToStaticMarkup(createElement(NextIntlClientProvider, { locale: "ru", timeZone: "Asia/Baku", messages: ru, children: element } as ComponentProps<typeof NextIntlClientProvider>))
}

/** Every `style="…"` of the blocks, in the order they are drawn. */
function blockStyles(markup: string, testId: string): Record<string, string>[] {
  const pattern = new RegExp(`data-testid="${testId}"[^>]*?style="([^"]+)"`, "g")
  return [...markup.matchAll(pattern)].map((match) =>
    Object.fromEntries(match[1].split(";").filter(Boolean).map((rule) => {
      const colon = rule.indexOf(":")
      return [rule.slice(0, colon).trim(), rule.slice(colon + 1).trim()]
    })),
  )
}

describe("meetings day view — the rail", () => {
  it("measures a meeting from midnight on the organization's clock", () => {
    expect(minutesFrom(DAY_START, at(10, 30))).toBe(630)
    expect(minutesFrom(DAY_START, at(0))).toBe(0)
    // An instant before the day shown is negative, which is how the caller
    // tells that a time being booked belongs to another day.
    expect(minutesFrom(DAY_START, new Date(DAY_START - 60_000).toISOString())).toBe(-1)
  })

  it("says who meets whom on a block with the room for it, and only the time on one without", () => {
    expect(render({ meetings: [AYTEN] })).toContain(AYTEN.subtitle)
    const tight = render({ meetings: [QUARTER] })
    expect(tight).toContain(QUARTER.name)
    expect(tight).not.toContain(QUARTER.subtitle)
  })

  it("keeps a quarter-hour meeting a quarter of an hour tall, whatever the page asks of buttons", () => {
    const [style] = blockStyles(render({ meetings: [QUARTER] }), "timeline-meeting")
    expect(style.height).toBe(style["min-height"])
    expect(Number.parseInt(style.height, 10)).toBeLessThan(44)
    expect(style["min-width"]).toMatch(/^0/)
  })

  it("stands overlapping meetings side by side and leaves a lone meeting the full width", () => {
    const [ayten, orhan] = blockStyles(render({ meetings: [AYTEN, ORHAN] }), "timeline-meeting")
    expect(ayten.left).not.toBe(orhan.left)
    expect(ayten.width).toBe("calc(50% - 0.25rem)")
    const [alone] = blockStyles(render({ meetings: [SAMIR] }), "timeline-meeting")
    expect(alone.left).toBe("0%")
    expect(alone.width).toBe("calc(100% - 0.25rem)")
  })

  it("puts the time being booked beside the meeting it clashes with, not over it", () => {
    const markup = render({ meetings: [AYTEN], pendingStart: minutes(10, 45), pendingEnd: minutes(11, 30) })
    const [meeting] = blockStyles(markup, "timeline-meeting")
    expect(markup).toContain(ru.booking.newMeeting)
    const pending = markup.slice(markup.indexOf(ru.booking.newMeeting) - 400, markup.indexOf(ru.booking.newMeeting))
    const left = /left:([^;"]+)/.exec(pending)?.[1]
    expect(left).toBeDefined()
    expect(left).not.toBe(meeting.left)
  })

  it("offers a free window as one button, and stops offering it while a time is being taken", () => {
    const windows = mergeFreeWindows([{ startsAt: at(12), endsAt: at(12, 45) }], DAY_START)
    const offered = render({ windows, onBook: () => {} })
    expect(blockStyles(offered, "timeline-window")).toHaveLength(1)
    expect(offered).toContain(ru.booking.createMeeting)
    // Read-only coordinators get the window as context, with nothing to press.
    expect(blockStyles(render({ windows, onBook: null }), "timeline-window")).toHaveLength(0)
    // And while a time is already being taken, the windows go quiet.
    expect(blockStyles(render({ windows, onBook: () => {}, pendingStart: minutes(12), pendingEnd: minutes(12, 45) }), "timeline-window")).toHaveLength(0)
  })

  it("draws the «now» line only on the day that is today", () => {
    expect(render({ nowMinutes: minutes(13, 10) })).toContain("13:10")
    expect(render({ nowMinutes: null })).not.toContain("13:10")
  })
})

describe("meetings day view — what the rail covers", () => {
  it("grows past the working day for a meeting that starts before it or ends after", () => {
    expect(railRange([])).toEqual({ from: 9, to: 19 })
    expect(railRange([{ start: minutes(8, 20), end: minutes(9) }])).toEqual({ from: 8, to: 19 })
    expect(railRange([{ start: minutes(19, 30), end: minutes(20, 15) }])).toEqual({ from: 9, to: 21 })
    // A whole day of meetings is still one rail, not a clipped one.
    expect(railRange([{ start: 0, end: minutes(23, 59) }])).toEqual({ from: 0, to: 24 })
  })

  it("never collapses to a rail with no height", () => {
    const range = railRange([{ start: minutes(10), end: minutes(10, 30) }], { from: 10, to: 10 })
    expect(range.to - range.from).toBeGreaterThanOrEqual(2)
  })
})

describe("meetings day view — free time", () => {
  it("reads consecutive and overlapping slots as one window, and keeps a gap a gap", () => {
    const windows = mergeFreeWindows([
      { startsAt: at(12), endsAt: at(12, 45) },
      { startsAt: at(12, 30), endsAt: at(13, 15) },
      { startsAt: at(13), endsAt: at(13, 45) },
      { startsAt: at(16, 30), endsAt: at(17, 15) },
    ], DAY_START)
    expect(windows.map((item) => [item.start, item.end])).toEqual([[minutes(12), minutes(13, 45)], [minutes(16, 30), minutes(17, 15)]])
    // The window keeps the first bookable instant, not its own merged start.
    expect(windows[0].startsAt).toBe(at(12))
  })

  it("ignores a slot of no length and survives a day with none", () => {
    expect(mergeFreeWindows([{ startsAt: at(12), endsAt: at(12) }], DAY_START)).toEqual([])
    expect(mergeFreeWindows([], DAY_START)).toEqual([])
  })

  it("packs three meetings in the same hour into three columns", () => {
    const packed = packSpans([
      { start: minutes(10), end: minutes(11) },
      { start: minutes(10, 15), end: minutes(11, 15) },
      { start: minutes(10, 30), end: minutes(11, 30) },
      { start: minutes(15), end: minutes(16) },
    ])
    expect(packed.slice(0, 3).map((entry) => entry.column)).toEqual([0, 1, 2])
    expect(packed.slice(0, 3).every((entry) => entry.columns === 3)).toBe(true)
    // The quiet afternoon is not narrowed by the busy morning.
    expect(packed[3]).toMatchObject({ column: 0, columns: 1 })
  })

  it("reuses a column once its meeting has ended", () => {
    const packed = packSpans([
      { start: minutes(10), end: minutes(11) },
      { start: minutes(10, 30), end: minutes(11, 30) },
      { start: minutes(11), end: minutes(12) },
    ])
    expect(packed.map((entry) => entry.column)).toEqual([0, 1, 0])
    expect(packed.every((entry) => entry.columns === 2)).toBe(true)
  })
})

describe("meetings day view — the week strip", () => {
  const strip = (counts: Record<string, number>, loading = false) => renderToStaticMarkup(createElement(NextIntlClientProvider, {
    locale: "ru", timeZone: "Asia/Baku", messages: ru,
    children: createElement(BookingWeekStrip, {
      days: ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"],
      counts, selectedDay: "2026-11-02", today: "2026-11-02", loading,
      onSelect: () => {},
      weekdayLabel: (day: string) => day.slice(-2),
      dayNumber: (day: string) => String(Number(day.slice(-2))),
    }),
  } as ComponentProps<typeof NextIntlClientProvider>))

  it("says how many meetings a day holds in words, not only in dots", () => {
    const markup = strip({ "2026-11-03": 3 })
    expect(markup).toContain("3 встречи")
    expect(markup).toContain(ru.booking.dayEmpty)
    expect(markup).toContain(ru.booking.dayToday)
  })

  it("counts a busy day beyond three in a number instead of a row of dots", () => {
    const markup = strip({ "2026-11-04": 9 })
    expect(markup).toContain("+6")
    // Three dots at most: on a phone a day is about 44 px wide.
    expect([...markup.matchAll(/rounded-full/g)]).toHaveLength(3)
  })
})

describe("meetings detail — what has been sent", () => {
  it("names the three outcomes an operator has to tell apart", () => {
    expect(deliveryState({ status: "succeeded" })).toBe("sent")
    expect(deliveryState({ status: "pending" })).toBe("waiting")
    expect(deliveryState({ status: "queued" })).toBe("waiting")
    // Anything the server is unsure about is "check", never a green tick.
    expect(deliveryState({ status: "reconciliation_required" })).toBe("check")
    expect(deliveryState({ status: "definitely_failed" })).toBe("check")
    expect(deliveryState({ status: "succeeded", requiresAttention: true })).toBe("check")
  })

  it("keeps a label for every delivery the booking API emits", () => {
    for (const type of ["booking.push", "booking.host-email", "booking.calendar", "booking.email", "booking.project", "booking.notify"]) {
      const key = integrationLabel(type)
      expect(key, type).not.toBe("deliveryOther")
      expect(en.booking, type).toHaveProperty(key)
    }
    expect(integrationLabel("booking.something-new")).toBe("deliveryOther")
  })

  it("builds initials from the first two words, in any alphabet", () => {
    expect(nameInitials("Айтен Мамедова")).toBe("АМ")
    expect(nameInitials("Nigar")).toBe("N")
    expect(nameInitials("  Orxan   Rzayev Oğlu ")).toBe("OR")
    expect(nameInitials("")).toBe("?")
  })
})

describe("meetings day view — translations", () => {
  const sources = [
    "src/components/booking/booking-day-timeline.tsx",
    "src/components/booking/booking-detail.tsx",
    "src/components/booking/booking-workspace.tsx",
  ]

  it("asks for no key that a locale is missing", () => {
    const asked = new Set<string>()
    for (const file of sources) {
      for (const match of readFileSync(file, "utf8").matchAll(/\bt\("([A-Za-z0-9_]+)"/g)) asked.add(match[1])
    }
    expect(asked.size).toBeGreaterThan(30)
    for (const [locale, messages] of [["en", en], ["ru", ru], ["az", az]] as const) {
      const missing = [...asked].filter((key) => !(key in messages.booking))
      expect(missing, `${locale}.json`).toEqual([])
    }
  })
})
