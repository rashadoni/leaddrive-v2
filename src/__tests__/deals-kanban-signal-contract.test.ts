import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * Доска сделок «выглядела скучно» — на деле она кричала. На одной карточке
 * одновременно горели три предупреждения об одном и том же: янтарная точка
 * «задача не назначена», розовая заливка «застой» и красная подпись с числом
 * дней. Порог застоя у организации 14 дней, а сделки лежат в стадиях по
 * 26–163 дня, поэтому залиты розовым были десять карточек из двенадцати.
 * Сигнал, срабатывающий почти везде, перестаёт быть сигналом.
 *
 * Тест сторожит не палитру, а решения: громкость пропорциональна, акцентный
 * цвет остаётся за действием, цвет стадии живёт в колонке.
 */
const card = readFileSync("src/components/deals/deal-card.tsx", "utf8")
const board = readFileSync("src/components/deals/kanban-board.tsx", "utf8")
const chips = readFileSync("src/components/deals/meddpicc-chips.tsx", "utf8")

describe("staleness is a scale, not a switch", () => {
  it("no longer floods the whole card with one colour", () => {
    expect(card).not.toContain('rotting && "bg-red-50/40')
    expect(card).not.toMatch(/function isRotting/)
  })

  it("grades the edge by how far past the threshold a deal is", () => {
    expect(card).toContain('if (days > threshold * 4) return "critical"')
    expect(card).toContain('if (days > threshold * 2) return "high"')
    // Порог — настройка организации, его менять нельзя: меняется только
    // громкость показа.
    expect(card).toContain("days <= threshold")
  })

  it("stops the default state from reading as a warning", () => {
    // Жёлтая точка значит «задачи не назначено» — это состояние большинства
    // карточек, а не тревога.
    expect(card).toContain('yellow: "bg-transparent ring-1 ring-inset')
    expect(card).not.toContain("animate-pulse")
  })
})

describe("the accent colour belongs to the action", () => {
  it("prints deal money as data, not as a call to action", () => {
    expect(card).not.toContain('text-xs font-semibold text-primary')
  })

  it("collapses eight MEDDPICC circles into one pill on the board", () => {
    expect(card).toContain("compact")
    expect(chips).toContain("compact?: boolean")
  })
})

describe("a card looks like something you can pick up", () => {
  it("carries a shadow at rest, not only on hover", () => {
    // Владелец: «карточки какие-то безрамочные стали и теней нет». В покое
    // была только светло-серая рамка — карточка сливалась с фоном колонки.
    expect(card).toContain("shadow-[0_1px_3px_rgba(16,24,40,0.10),0_1px_2px_rgba(16,24,40,0.06)]")
    expect(card).toContain("dark:shadow-")
  })

  it("lifts further under the cursor", () => {
    expect(card).toMatch(/hover:shadow-\[0_8px_16px/)
  })
})

describe("each column carries its own stage colour", () => {
  it("paints the column, not just a two-pixel dot", () => {
    expect(board).toContain("borderTopColor: stage.color")
    expect(board).toMatch(/backgroundColor: tint\(stage\.color, 0\.\d+\)/)
  })

  it("refuses to build a colour it cannot parse", () => {
    // Цвет стадии приходит из настроек тенанта и может быть чем угодно;
    // приклеенная к мусору альфа даёт невалидный цвет и колонку без фона.
    expect(board).toContain("/^#[0-9a-f]{6}$/i.test(color)")
    expect(board).toContain("return undefined")
  })

  it("names the second currency instead of counting it", () => {
    // «+1» рядом с суммой читается как «ещё одна сделка».
    expect(board).not.toMatch(/\+\{stageExtras\.length\}/)
  })

  it("says the empty-column label in the user's language", () => {
    expect(board).not.toContain(">\n                  No deals\n")
    expect(board).toContain('const emptyLabel = t("noDeals")')
  })
})
