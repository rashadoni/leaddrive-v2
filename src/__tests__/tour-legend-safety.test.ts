import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * Кадры тура уезжают на публичный сайт. Значит легенда стенда — это то, что
 * увидит любой посетитель, и в ней не может быть ни одного настоящего имени.
 *
 * Проверка нужна именно тестом, а не вниманием: в остальных демо-сидерах
 * репозитория 151 упоминание живых брендов, и попали они туда не злым умыслом,
 * а потому что «взял из реального примера, потом заменю». Один такой недосмотр
 * в легенде — и настоящая компания появляется на витрине чужого продукта.
 */
const legend = readFileSync("scripts/seeds/tour-legend.mjs", "utf8")
const seeder = readFileSync("scripts/seeds/tour-stand.mjs", "utf8")

// Список не претендует на полноту — он ловит ровно те бренды, которые уже
// лежат в других сидерах этого репозитория, то есть самый вероятный источник
// копирования.
const REAL_BRANDS = [
  "Azercell", "SOCAR", "Pasha", "Kapital", "Bravo", "Azersun", "AzerGold",
  "Silk Way", "ASAN", "Pepsi", "Mars Overseas", "Araz", "Neptun", "KFC",
  "McDonald", "CinemaPlus", "Ramada", "Hilton", "Chenot", "TABİA", "Zeytun",
]

describe("tour stand legend stays invented", () => {
  it("carries no real brand that already lives in other seeders", () => {
    for (const brand of REAL_BRANDS) {
      expect(legend, `в легенде настоящий бренд: ${brand}`).not.toContain(brand)
      expect(seeder, `в сидере тура настоящий бренд: ${brand}`).not.toContain(brand)
    }
  })

  it("uses no round numbers", () => {
    // Круглое число читается как заглушка и убивает доверие к кадру быстрее,
    // чем плохая вёрстка. Ловим тысячи и «ровные» проценты.
    const numbers = (legend.match(/\b\d{2,}\b/g) || []).map(Number)
    expect(numbers.length).toBeGreaterThan(6)
    for (const n of numbers) {
      expect(n % 1000, `круглое число в легенде: ${n}`).not.toBe(0)
    }
    for (const pct of [0, 25, 50, 75, 100]) {
      expect(legend, `ровный процент в легенде: ${pct}`).not.toMatch(
        new RegExp(`(probability|was|now|overheadGrowth):\\s*${pct}\\b`),
      )
    }
  })

  it("refuses to run without an explicit target and confirmation", () => {
    // Сидер пишет в базу. Оба предохранителя проверяются текстом, потому что
    // выполнить его в тесте нельзя — он ходит в Prisma.
    expect(seeder).toContain("if (!process.env.CONFIRM_PROD)")
    expect(seeder).toContain("--slug=")
    expect(seeder).toContain("process.exit(1)")
  })

  it("deletes only what it created", () => {
    // Снос идёт по меткам, а не по «всё в организации». Если это правило
    // ослабят, пересев стенда снесёт чужие данные того же тенанта.
    expect(seeder).toContain("endsWith: `@${TOUR_MARKER}`")
    expect(seeder).toContain('tags: { has: "tour-stand" }')
    expect(seeder).toContain("invoiceNumber: STORY.invoice.number")
    // Ни одного deleteMany, ограниченного только организацией.
    const wide = seeder.match(/deleteMany\(\{\s*where:\s*\{\s*organizationId:\s*orgId\s*\}\s*\}\)/g)
    expect(wide, "есть deleteMany по всей организации").toBeNull()
  })
})
