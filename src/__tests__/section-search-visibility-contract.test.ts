import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * Поиск по разделу собран вручную примерно на полусотне страниц и ещё раз
 * внутри DataTable. Единственное, что их объединяет, — разметка: иконка
 * Search, сразу за ней input. Стиль поэтому живёт одним правилом в
 * globals.css, а не в файлах страниц.
 *
 * Тест сторожит не красоту, а три решения, которые легко потерять при
 * следующей правке стилей.
 */
describe("section search field stands out", () => {
  const css = readFileSync("src/app/globals.css", "utf8")
  const sidebar = readFileSync("src/components/sidebar.tsx", "utf8")
  const dataTable = readFileSync("src/components/data-table.tsx", "utf8")

  it("styles the field through the library class, not through page utilities", () => {
    // `lucide-search` пишет createLucideIcon, а не наш код: правило переживёт
    // переписывание классов Tailwind на любой отдельной странице.
    expect(css).toContain("main .lucide-search + input:not(.ai-search-input)")
    expect(css).toContain("background-color: hsl(var(--card))")
    expect(css).toContain("main .lucide-search:has(+ input:not(.ai-search-input))")
  })

  it("keeps the rule inside main so the dark sidebar search is untouched", () => {
    // В сайдбаре поиск на тёмном фоне со своей белой иконкой. Если область
    // действия расширят с `main` до всего документа, там появится белое поле
    // с оранжевой лупой — дыра в тёмной панели.
    expect(css).not.toMatch(/^\.lucide-search \+ input/m)
    expect(sidebar).toContain("text-white/40")
  })

  it("covers the shared table, not just hand-rolled pages", () => {
    // DataTable рисует ту же пару «иконка + Input»; если её разметку поменяют,
    // девять страниц тихо вернутся к невидимому полю.
    expect(dataTable).toMatch(/<Search className="[^"]*absolute[^"]*"/)
    expect(dataTable).toMatch(/<Input[\s\S]{0,200}className="pl-9"/)
  })
})
