/**
 * The hints of tasks, photos, alerts, team communication, the activity
 * journal, the rating and team results (owner, 2026-10-15: «подсказок в
 * модуле очень мало»): words in all three languages for every key asked for,
 * the same blanks, none unused.
 */
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

type Messages = { [key: string]: string | Messages }
const messages = (locale: string) => JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")) as Messages
const at = (path: string, locale: string) => {
  let node: unknown = messages(locale)
  for (const part of path.split(".")) node = (node as Messages | undefined)?.[part]
  return ((node as Messages | undefined) ?? {}) as Record<string, string>
}
const blanks = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
const used = (files: readonly string[]) => {
  const keys = new Set(files.flatMap((file) => [...readFileSync(file, "utf8").matchAll(/"hint\.(\w+)"/g)].map((match) => match[1])))
  // The task status chips name their hint by the chip: `hint.chip${chip.value}`.
  if (files.some((file) => readFileSync(file, "utf8").includes("t(`hint.chip${chip.value}`)"))) {
    for (const status of ["OPEN", "OVERDUE", "AWAITING_REVIEW", "COMPLETED", "CANCELLED"]) keys.add(`chip${status}`)
  }
  return keys
}

describe.each([
  ["mtmTasksPage.hint", ["src/app/(dashboard)/mtm/tasks/page.tsx"]],
  ["mtmTaskWorkspace.hint", ["src/components/mtm/task-actions-panel.tsx"]],
  ["mtmPhotosPage.hint", ["src/app/(dashboard)/mtm/photos/page.tsx"]],
  ["mtmAlertsPage.hint", ["src/app/(dashboard)/mtm/alerts/page.tsx"]],
  ["mtmOperationsPage.hint", ["src/app/(dashboard)/mtm/operations/page.tsx"]],
  ["mtmActivity.hint", ["src/app/(dashboard)/mtm/activity/page.tsx"]],
  ["mtmLeaderboard.hint", ["src/app/(dashboard)/mtm/leaderboard/page.tsx"]],
  ["mtmTeamResults.hint", ["src/components/mtm/team-results.tsx"]],
] as const)("the hints of %s", (path, files) => {
  const keys = used(files)
  it("are written for every key the screen asks for, in Russian, Azerbaijani and English, with the same blanks", () => {
    expect(keys.size).toBeGreaterThan(0)
    const [r, a, e] = ["ru", "az", "en"].map((locale) => at(path, locale))
    const missing: string[] = []
    for (const key of keys) {
      for (const [locale, texts] of [["ru", r], ["az", a], ["en", e]] as const) {
        if (typeof texts[key] !== "string" || texts[key].trim().length < 8) missing.push(`${locale}.${key}`)
      }
      if (typeof r[key] === "string") {
        expect(blanks(a[key] ?? ""), `az.${key}`).toEqual(blanks(r[key]))
        expect(blanks(e[key] ?? ""), `en.${key}`).toEqual(blanks(r[key]))
      }
    }
    expect(missing).toEqual([])
  })
  it("has no words the screen never shows", () => {
    expect(Object.keys(at(path, "ru")).filter((key) => !keys.has(key))).toEqual([])
  })
})
