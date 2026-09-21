import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Audit 2026-09-21, item 3: lines under a heading that retell the screen —
 * «Выберите день, чтобы увидеть маршруты…», «Кто, с кем, где и когда
 * встречался… Нажмите на строку, чтобы открыть визит», «Кнопка
 * «Запланировать» в пустой ячейке выбирает сотрудника…». A heading, a
 * clickable row and a button already say all of that.
 *
 * What is deliberately NOT here: select placeholders («Выберите
 * сотрудника»), sort labels («Сначала новые»), validation errors and
 * blocked-state explanations («Сначала выберите сотрудника и дату») — those
 * tell the reader why nothing is shown or what is missing, and they stay.
 * The keys themselves remain in messages/*.json, where locale-parity tests
 * pin them; only rendering them on a screen is forbidden.
 */
const RETIRED_HINTS = [
  "historyHint",
  "calendarHint",
  "needsAttentionDescription",
  "weekPlannerAddHint",
  "stepAddCustomersHint",
  "tabletWorkspaceHint",
  "tableSettingsHint",
  "personHint",
  "weekPlanHint",
]

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? sources(path) : /\.tsx$/.test(name) ? [path] : []
  })
}

describe("the field module has no lines that retell the screen", () => {
  it.each(RETIRED_HINTS)("does not render %s as a paragraph", (key) => {
    const offenders = [...sources("src/app/(dashboard)/mtm"), ...sources("src/components/mtm")]
      .filter((path) => new RegExp(`<p[^>]*>\\{[^}]*t\\("${key}"\\)`).test(readFileSync(path, "utf8")))
    expect(offenders).toEqual([])
  })
})
