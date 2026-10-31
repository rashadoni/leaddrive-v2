import { afterEach, describe, expect, it, vi } from "vitest"
import { isMtmVisitLeftOpen, mtmVisitOpenFor, mtmVisitOpenMinutes, mtmVisitReminderMessage } from "@/lib/mtm/visit-left-open"

/** The visit of 12 October 2026, 21:21 in Baku, seen on 15 October at 20:00. */
const CHECK_IN = "2026-10-12T17:21:51.026Z"
const NOW = new Date("2026-10-15T16:00:00.000Z")

describe("a visit left open", () => {
  it("is an open visit past the tenant's line — never a closed or cancelled one", () => {
    expect(isMtmVisitLeftOpen({ status: "CHECKED_IN", checkInAt: CHECK_IN }, NOW, 120)).toBe(true)
    const fresh = new Date(NOW.getTime() - 119 * 60_000).toISOString()
    expect(isMtmVisitLeftOpen({ status: "CHECKED_IN", checkInAt: fresh }, NOW, 120)).toBe(false)
    expect(isMtmVisitLeftOpen({ status: "CHECKED_IN", checkInAt: new Date(NOW.getTime() - 120 * 60_000).toISOString() }, NOW, 120)).toBe(true)
    expect(isMtmVisitLeftOpen({ status: "CHECKED_OUT", checkInAt: CHECK_IN, checkOutAt: "2026-10-12T18:00:00.000Z" }, NOW, 120)).toBe(false)
    expect(isMtmVisitLeftOpen({ status: "CANCELLED", checkInAt: CHECK_IN }, NOW, 120)).toBe(false)
    // A line that makes no sense falls back to the default two hours.
    expect(isMtmVisitLeftOpen({ status: "CHECKED_IN", checkInAt: fresh }, NOW, 0)).toBe(false)
  })

  it("says how long in one unit: days, else hours, else minutes", () => {
    expect(mtmVisitOpenFor(mtmVisitOpenMinutes(CHECK_IN, NOW))).toEqual({ unit: "days", value: 2 })
    expect(mtmVisitOpenFor(5 * 60 + 59)).toEqual({ unit: "hours", value: 5 })
    expect(mtmVisitOpenFor(40)).toEqual({ unit: "minutes", value: 40 })
    expect(mtmVisitOpenMinutes(new Date(NOW.getTime() + 60_000), NOW)).toBe(0)
  })

  it("reminds the agent in all three languages, on the tenant's clock", () => {
    const message = mtmVisitReminderMessage({ customerName: "Milli Onkologiya Mərkəzi", checkInAt: CHECK_IN, timezone: "Asia/Baku", senderLocale: "ru" })
    expect(message.localizations.ru).toBe("Визит в «Milli Onkologiya Mərkəzi» открыт с 12 октября в 21:21 и всё ещё не закрыт. Закройте его в приложении.")
    expect(message.localizations.en).toContain("open since 12 October")
    expect(message.localizations.en).toContain("21:21")
    expect(message.localizations.az).toContain("21:21")
    expect(message.body).toBe(message.localizations.ru)
    expect(mtmVisitReminderMessage({ customerName: "X", checkInAt: CHECK_IN, timezone: "Asia/Baku", senderLocale: "de" }).body).toContain("Your visit")
  })

  it("names the month in Azerbaijani even where the browser has no Azerbaijani dates, as Chrome", () => {
    // Chrome's Intl knows no Azerbaijani month names: its «az» wrote
    // «M10 30 22:42» into the agent's chat (2026-10-31). Make Intl do the same.
    const Real = Intl.DateTimeFormat
    // A plain function: callers construct it with `new`.
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation((function (locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
      const first = Array.isArray(locales) ? locales[0] : locales
      if (first?.startsWith("az")) {
        const real = new Real("en-GB", options)
        return Object.assign(Object.create(real), { format: (date?: Date | number) => `M${real.formatToParts(date).find((part) => part.type === "month")?.value} ?` })
      }
      return new Real(locales, options)
    }) as unknown as typeof Intl.DateTimeFormat)

    const message = mtmVisitReminderMessage({ customerName: "QA", checkInAt: CHECK_IN, timezone: "Asia/Baku", senderLocale: "az" })
    expect(message.body).toBe("«QA» vizitiniz 12 oktyabr, 21:21 tarixindən açıqdır və hələ bağlanmayıb. Zəhmət olmasa tətbiqdə bağlayın.")
    expect(message.localizations.ru).toContain("12 октября в 21:21")
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })
})
