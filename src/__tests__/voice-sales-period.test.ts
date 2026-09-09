import { describe, it, expect } from "vitest"
import { resolveSalesPeriod, type SalesPeriodInput } from "@/lib/ai/voice/sales-period"

/**
 * Boundaries only. Every bug this resolver can have is an off-by-one at the
 * edge of a month or a year, and those are invisible until you run December
 * and January against each other.
 */
const AUG_9 = new Date(2026, 7, 9, 14, 30)
const JAN_5 = new Date(2026, 0, 5, 9, 0)
const BAKU_AFTER_MIDNIGHT = new Date("2026-08-31T20:30:00.000Z")

describe("resolveSalesPeriod — названный месяц", () => {
  it("июль означает весь июль, а не «до сегодня»", () => {
    const { from, to, label } = resolveSalesPeriod({ month: 7 }, AUG_9)
    expect(from.getUTCMonth()).toBe(6)
    expect(from.getUTCDate()).toBe(1)
    expect(to.getUTCMonth()).toBe(6)
    expect(to.getUTCDate()).toBe(31)
    expect(label).toBe("июль 2026")
  })

  it("месяц, который ещё не наступил, читается как прошлогодний", () => {
    // Спрошено в январе про декабрь: декабрь этого года не настал, и ответ
    // «ноль» был бы уверенной ложью.
    const { from, label } = resolveSalesPeriod({ month: 12 }, JAN_5)
    expect(from.getUTCFullYear()).toBe(2025)
    expect(label).toBe("декабрь 2025")
  })

  it("явный год всегда сильнее догадки", () => {
    const { from } = resolveSalesPeriod({ month: 12, year: 2026 }, JAN_5)
    expect(from.getUTCFullYear()).toBe(2026)
  })

  it("февраль високосного года кончается 29-м", () => {
    const { to } = resolveSalesPeriod({ month: 2, year: 2024 }, AUG_9)
    expect(to.getUTCDate()).toBe(29)
  })
})

describe("resolveSalesPeriod — относительные окна", () => {
  it("прошлый месяц берётся целиком", () => {
    const { from, to, label } = resolveSalesPeriod({ period: "last_month" }, AUG_9)
    expect(from.getUTCMonth()).toBe(6)
    expect(to.getUTCDate()).toBe(31)
    expect(label).toBe("июль 2026")
  })

  it("в январе прошлый месяц — декабрь прошлого года", () => {
    const { from, label } = resolveSalesPeriod({ period: "last_month" }, JAN_5)
    expect(from.getUTCFullYear()).toBe(2025)
    expect(from.getUTCMonth()).toBe(11)
    expect(label).toBe("декабрь 2025")
  })

  it("текущие окна заканчиваются сейчас, а не в конце периода", () => {
    // Иначе «продажи за этот год» включали бы будущее и выглядели провалом.
    expect(resolveSalesPeriod({ period: "this_year" }, AUG_9).to).toEqual(AUG_9)
    expect(resolveSalesPeriod({ period: "this_quarter" }, AUG_9).to).toEqual(AUG_9)
  })

  it("прошлый год закрыт по 31 декабря", () => {
    const { from, to, label } = resolveSalesPeriod({ period: "last_year" }, AUG_9)
    expect(from.getUTCFullYear()).toBe(2025)
    expect(to.getUTCMonth()).toBe(11)
    expect(to.getUTCDate()).toBe(31)
    expect(label).toBe("2025 год")
  })

  it("без аргументов отвечает про текущий месяц, а не про всё время", () => {
    const { from, label } = resolveSalesPeriod({}, AUG_9)
    expect(from.getUTCMonth()).toBe(7)
    expect(label).toBe("август 2026")
  })

  it("третий квартал начинается в июле", () => {
    const { from, label } = resolveSalesPeriod({ period: "this_quarter" }, AUG_9)
    expect(from.getUTCMonth()).toBe(6)
    expect(label).toBe("3 квартал 2026")
  })

  it("берёт календарный месяц пользователя после полуночи в Баку", () => {
    const { from, label, timezone } = resolveSalesPeriod(
      { period: "this_month" },
      BAKU_AFTER_MIDNIGHT,
      "Asia/Baku",
    )
    expect(from.toISOString()).toBe("2026-08-31T20:00:00.000Z")
    expect(label).toBe("сентябрь 2026")
    expect(timezone).toBe("Asia/Baku")
  })

  it("закрывает прошлый месяц полуоткрытой границей в локальной зоне", () => {
    const { from, toExclusive } = resolveSalesPeriod(
      { period: "last_month" },
      BAKU_AFTER_MIDNIGHT,
      "Asia/Baku",
    )
    expect(from.toISOString()).toBe("2026-07-31T20:00:00.000Z")
    expect(toExclusive.toISOString()).toBe("2026-08-31T20:00:00.000Z")
  })
})

describe("SalesPeriodInput — compile-time contract", () => {
  it("keeps the resolver input aligned with the three validated request shapes", () => {
    const accepted: SalesPeriodInput[] = [
      {},
      { period: "last_month" },
      { month: 7 },
      { month: 7, year: 2025 },
    ]
    expect(accepted).toHaveLength(4)

    // @ts-expect-error year is meaningless without a month
    const yearAlone: SalesPeriodInput = { year: 2025 }
    // @ts-expect-error relative period cannot be combined with a calendar month
    const mixedSelectors: SalesPeriodInput = { period: "last_month", month: 7 }
    expect([yearAlone, mixedSelectors]).toHaveLength(2)
  })
})
