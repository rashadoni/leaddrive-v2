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
  spansClashing,
  subtractSpans,
  BookingHostChips,
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
    busy: [],
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

  it("names the meeting a chosen time runs into, and leaves that meeting's own name in sight", () => {
    const markup = render({ meetings: [AYTEN], pendingStart: minutes(10, 45), pendingEnd: minutes(11, 30) })
    const [meeting] = blockStyles(markup, "timeline-meeting")
    const [pending] = blockStyles(markup, "timeline-pending")
    // The clash is said in words, with whose meeting it is: «переносите» is a
    // decision, and nobody can take it from a red rectangle alone.
    expect(markup).toContain(AYTEN.name)
    expect(markup).toContain(ru.booking.clashTag)
    expect(markup).not.toContain(ru.booking.newMeeting)
    // The meeting keeps the full width and the clashing block starts a third
    // of the way in, so the avatar and the name underneath stay readable.
    expect(meeting.left).toBe("0%")
    expect(Number.parseInt(pending.left, 10)).toBeGreaterThan(0)
  })

  it("draws a time that clashes with nothing as a plain full-width block", () => {
    const markup = render({ meetings: [AYTEN], pendingStart: minutes(12), pendingEnd: minutes(12, 45) })
    const [pending] = blockStyles(markup, "timeline-pending")
    expect(markup).toContain(ru.booking.newMeeting)
    expect(markup).not.toContain(ru.booking.clashTag)
    expect(pending.left).toBe("0%")
  })

  it("counts a cancelled meeting out of a clash, because its hour is free again", () => {
    const cancelled = { ...AYTEN, status: "cancelled" }
    const live = spansClashing({ start: minutes(10, 45), end: minutes(11, 30) }, [AYTEN])
    expect(live.map((item) => item.id)).toEqual([AYTEN.id])
    // The rail hands the helper only the meetings that still hold their hour.
    expect(spansClashing({ start: minutes(10, 45), end: minutes(11, 30) }, [cancelled].filter((item) => item.status !== "cancelled"))).toEqual([])
    // Touching ends do not overlap: 11:15 is free the moment 11:15 arrives.
    expect(spansClashing({ start: minutes(11, 15), end: minutes(12) }, [AYTEN])).toEqual([])
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

  it("draws the «now» line on today, and never stretches the rail to reach it", () => {
    // The day here runs 09:00–11:15, so the rail runs 09:00–12:00.
    expect(render({ nowMinutes: minutes(10, 10) })).toContain("10:10")
    expect(render({ nowMinutes: null })).not.toContain("10:10")
    // Long after the last meeting the marker says nothing the rail does not,
    // and reaching it would draw hours of empty day under the content.
    expect(render({ nowMinutes: minutes(17, 37) })).not.toContain("17:37")
  })
})

describe("meetings day view — what the rail covers", () => {
  it("covers the hours the day uses and no more, early or late", () => {
    // A day that ends at 15:30 used to draw the working day out to 19:00, and
    // those three and a half empty hours were most of what the screen showed.
    expect(railRange([{ start: minutes(9), end: minutes(15, 30) }])).toEqual({ from: 9, to: 16 })
    expect(railRange([{ start: minutes(8, 20), end: minutes(9) }])).toEqual({ from: 8, to: 11 })
    expect(railRange([{ start: minutes(19, 30), end: minutes(20, 15) }])).toEqual({ from: 19, to: 22 })
    // A whole day of meetings is still one rail, not a clipped one.
    expect(railRange([{ start: 0, end: minutes(23, 59) }])).toEqual({ from: 0, to: 24 })
  })

  it("falls back to the working day only when the day holds nothing at all", () => {
    expect(railRange([])).toEqual({ from: 9, to: 19 })
  })

  it("never collapses to a rail with no height", () => {
    const range = railRange([{ start: minutes(10), end: minutes(10, 30) }], { from: 10, to: 10 })
    expect(range.to - range.from).toBeGreaterThanOrEqual(2)
    expect(railRange([{ start: minutes(23, 30), end: minutes(23, 59) }]).to).toBe(24)
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


describe("meetings day view — time taken by something that is not a meeting", () => {
  it("cuts the meetings out of a busy span and keeps what is still taken", () => {
    const meeting = { start: minutes(10), end: minutes(11) }
    // Wholly covered by the meeting: nothing to draw a second time.
    expect(subtractSpans({ start: minutes(10), end: minutes(11) }, [meeting])).toEqual([])
    // Half covered: the free-looking half must still read as taken.
    expect(subtractSpans({ start: minutes(9, 30), end: minutes(11, 30) }, [meeting]))
      .toEqual([{ start: minutes(9, 30), end: minutes(10) }, { start: minutes(11), end: minutes(11, 30) }])
    // Untouched, and a span with no blocks at all.
    expect(subtractSpans({ start: minutes(13), end: minutes(14) }, [meeting])).toEqual([{ start: minutes(13), end: minutes(14) }])
    expect(subtractSpans({ start: minutes(13), end: minutes(14) }, [])).toEqual([{ start: minutes(13), end: minutes(14) }])
  })

  it("draws a busy span grey, with its hours and no name", () => {
    const markup = render({ meetings: [], busy: [{ start: minutes(12, 30), end: minutes(13, 30) }] })
    expect(blockStyles(markup, "timeline-busy")).toHaveLength(1)
    expect(markup).toContain(ru.booking.busyBlock)
    expect(markup).toContain("12:30–13:30")
  })

  it("says what a connected calendar has there, and which calendar it is", () => {
    // The point of the whole thing: one window. An hour arranged in Outlook
    // is on the same rail as the salon's own meetings, and it says so.
    const outlook = render({ meetings: [], busy: [{ start: minutes(12, 30), end: minutes(13, 30), label: "Планёрка с поставщиком", source: "microsoft" as const }] })
    expect(outlook).toContain("Планёрка с поставщиком")
    expect(outlook).toContain(ru.booking.calendarOutlook)
    expect(outlook).not.toContain(ru.booking.busyBlock)
    const google = render({ meetings: [], busy: [{ start: minutes(15), end: minutes(16), source: "google" as const }] })
    expect(google).toContain(ru.booking.calendarGoogle)
    // Somebody else's calendar sends no title, and then the block says only
    // what the grey block always said.
    expect(google).toContain(ru.booking.busyBlock)
  })

  it("stretches the rail to cover a busy hour outside the meetings", () => {
    expect(railRange([{ start: minutes(9), end: minutes(10) }, { start: minutes(17), end: minutes(18) }]))
      .toEqual({ from: 9, to: 18 })
  })
})

describe("meetings day view — the shared control styles", () => {
  it("keeps the day and the meeting out of the filter look, which paints every control white", () => {
    // crm-workspace.css gives [data-crm-filter] a white background, grey text
    // and a smaller radius. On the day cell and the meeting block that erased
    // the chosen state and the status tint — the two things the rail is for.
    const markup = render({ meetings: [AYTEN], selectedId: AYTEN.id })
    expect(markup).not.toContain("data-crm-filter")
    expect(markup).toContain('data-crm-color-role="toggle"')
    const strip = renderToStaticMarkup(createElement(NextIntlClientProvider, {
      locale: "ru", timeZone: "Asia/Baku", messages: ru,
      children: createElement(BookingWeekStrip, {
        days: ["2026-11-02"], counts: {}, selectedDay: "2026-11-02", today: "2026-11-02", loading: false,
        onSelect: () => {}, weekdayLabel: () => "Пн", dayNumber: () => "2",
      }),
    } as ComponentProps<typeof NextIntlClientProvider>))
    expect(strip).not.toContain("data-crm-filter")
    expect(strip).toContain('data-crm-color-role="toggle"')
  })
})

describe("meetings day view — whose day it is", () => {
  const chips = (selected: string) => renderToStaticMarkup(createElement(NextIntlClientProvider, {
    locale: "ru", timeZone: "Asia/Baku", messages: ru,
    children: createElement(BookingHostChips, {
      hosts: [{ id: "samir", name: "Самир Алиев", meta: "3 встречи", count: 3 }, { id: "nigar", name: "Нигяр Гусейнова", meta: "1 встреча", count: 1 }],
      anyMeta: "4 встречи", selected, onSelect: () => {},
    }),
  } as ComponentProps<typeof NextIntlClientProvider>))

  it("puts how busy each host is beside the name, where it is the reason to pick one", () => {
    const markup = chips("")
    expect(markup).toContain("Самир Алиев")
    expect(markup).toContain("3 встречи")
    expect(markup).toContain("1 встреча")
    expect(markup).toContain("4 встречи")
  })

  it("marks the chosen host, and «the whole team» when none is chosen", () => {
    expect(chips("")).toContain(`aria-pressed="true"`)
    const picked = chips("samir")
    // Exactly one chip is pressed, and it is the host's, not the team's.
    expect([...picked.matchAll(/aria-pressed="true"/g)]).toHaveLength(1)
    const pressed = picked.slice(picked.indexOf(`aria-pressed="true"`))
    expect(pressed.slice(0, pressed.indexOf("</button>"))).toContain("Самир Алиев")
  })

  it("says which of the two a chip is, so the button guard can tell a filter from an action", () => {
    expect([...chips("").matchAll(/data-crm-filter=""/g)]).toHaveLength(3)
  })

  it("marks the selected chip with data-state, which is what the shared filter style reads", () => {
    const picked = chips("samir")
    expect([...picked.matchAll(/data-state="active"/g)]).toHaveLength(1)
    expect([...picked.matchAll(/data-state="inactive"/g)]).toHaveLength(2)
  })
})

/**
 * A real organization had thirty colleagues with booking access, and the row
 * drew a chip for every one of them — twenty-eight reading «0 meetings». They
 * filled the screen and pushed the day itself below the fold, which is the one
 * thing this view exists to show. So the row is allowed to grow only with the
 * people the day is actually about.
 */
describe("meetings day view — a big team does not bury the day", () => {
  const team = (busy: number, size: number) => Array.from({ length: size }, (_, index) => ({
    id: `u${index}`, name: `Сотрудник ${index}`, count: index < busy ? 1 : 0,
    meta: index < busy ? "1 встреча" : "0 встреч",
  }))
  const render = (hosts: ReturnType<typeof team>, selected = "") => renderToStaticMarkup(createElement(NextIntlClientProvider, {
    locale: "ru", timeZone: "Asia/Baku", messages: ru,
    children: createElement(BookingHostChips, { hosts, anyMeta: "2 встречи", selected, onSelect: () => {} }),
  } as ComponentProps<typeof NextIntlClientProvider>))
  /** Names drawn as chips — the picker renders its list only once opened. */
  const chipNames = (markup: string) => [...markup.matchAll(/Сотрудник (\d+)<\/span>/g)].map((match) => Number(match[1]))

  it("gives a chip only to the colleagues who have something that day", () => {
    const markup = render(team(2, 30))
    expect(chipNames(markup)).toEqual([0, 1])
  })

  it("puts the rest behind one field instead of twenty-eight more chips", () => {
    // Unfolding thirty names who have nothing that day is the wall this row
    // exists to avoid: the day itself goes off the screen.
    const markup = render(team(2, 30))
    expect(markup).toContain("Ещё 28 сотрудников")
    // Three chips — the whole team, and the two with a meeting — and one
    // field. The twenty-eight names live in the field's own list, which it
    // builds when opened, so none of them is on the screen until asked for.
    expect([...markup.matchAll(/data-crm-filter=""/g)]).toHaveLength(3)
    expect(markup).not.toContain("Сотрудник 7")
  })

  it("keeps the chosen colleague as a chip even with an empty day, or the filter could not be undone", () => {
    const markup = render(team(2, 30), "u17")
    expect(chipNames(markup)).toContain(17)
    expect(markup).toContain("Ещё 27 сотрудников")
  })

  it("leaves a small team whole — a field to search four names helps nobody", () => {
    const markup = render(team(1, 4))
    expect(chipNames(markup)).toEqual([0, 1, 2, 3])
    expect(markup).not.toContain("Ещё")
  })

  it("shows no field when everyone is busy anyway", () => {
    const markup = render(team(30, 30))
    expect(chipNames(markup)).toHaveLength(30)
    expect(markup).not.toContain("Ещё")
  })
})

describe("meetings day view — translations", () => {
  const sources = [
    "src/components/booking/booking-day-timeline.tsx",
    "src/components/booking/booking-detail.tsx",
    "src/components/booking/booking-workspace.tsx",
    "src/components/booking/booking-create-panel.tsx",
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
