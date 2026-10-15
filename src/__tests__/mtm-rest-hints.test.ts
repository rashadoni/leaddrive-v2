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
  ["mtmTaskWorkspace.hint", ["task-actions-panel", "task-workspace", "task-form", "task-edit-form"].map((name) => `src/components/mtm/${name}.tsx`)],
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

describe("the hints of the reports", () => {
  const page = readFileSync("src/app/(dashboard)/mtm/reports/page.tsx", "utf8")
  const apis = ["src/app/api/v1/mtm/reports/route.ts", "src/app/api/v1/mtm/management-reports/route.ts"].map((file) => readFileSync(file, "utf8")).join("\n")
  const produced = new Set([...apis.matchAll(/labelKey: "sum\.(\w+)"/g)].map((match) => match[1]))
  const REPORTS = ["agent", "visit", "photo", "route_execution", "action_compliance", "promises", "sales"]

  it("name, for every summary figure, the report it belongs to — each in three languages", () => {
    const [r, a, e] = ["ru", "az", "en"].map((locale) => at("mtmReports.hint", locale))
    for (const key of Object.keys(r)) {
      if (["period", "exportFull", "exportLoaded", "recordsAgent", "recordsOther"].includes(key)) {
        expect(page, key).toContain(`"hint.${key}"`)
      } else {
        const report = REPORTS.find((name) => key.startsWith(`${name}_`))
        expect(report, key).toBeDefined()
        // The figure is one the server really sends.
        expect(produced.has(key.slice(report!.length + 1)), key).toBe(true)
      }
      expect(typeof a[key] === "string" && a[key].length > 8, `az.${key}`).toBe(true)
      expect(typeof e[key] === "string" && e[key].length > 8, `en.${key}`).toBe(true)
    }
    // And the page asks for them by the report on screen.
    expect(page).toContain("const key = `hint.${selected}_${labelKey.replace(/^sum\\./, \"\")}`")
  })
})
