import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Field UX audit 2026-09-05, W-02 / task C2: the MTM module formats every
 * date through src/lib/format-date.ts. ICU builds without Azerbaijani data
 * (Chrome, prod Node) render direct Intl calls as "2026 M09 5, Sat" and
 * "Mon/Tue/Wed" inside an Azerbaijani interface. ESLint is not part of CI,
 * so this scan is the gate; the eslint rule of the same name helps in the
 * editor.
 */
const ROOTS = ["src/components/mtm", "src/app/(dashboard)/mtm"]
/**
 * Two library files the MTM screens reach dates through. Scanning the folders
 * alone left them uncovered, and a screen that had switched to the helper
 * still rendered "2026 M09 5" once its date came back from here — the second
 * C2 tail. They are listed one by one rather than by widening the scan to
 * src/lib, because most of that tree formats machine values (YYYY-MM-DD for
 * an <input type="date">, an offset string to parse) where a pinned locale is
 * the correct answer, and a gate that flags those teaches people to silence it.
 */
const FILES = ["src/lib/timezone.ts", "src/lib/mtm/activity-actions.tsx"]
const FORBIDDEN = [/\.toLocaleDateString\(/, /\.toLocaleTimeString\(/, /new Intl\.DateTimeFormat\(/]
const ALLOW_MARKER = "eslint-disable-next-line no-restricted-syntax"

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) sources(path, out)
    else if (/\.tsx?$/.test(entry)) out.push(path)
  }
  return out
}

describe("MTM web module date formatting", () => {
  it.each(ROOTS)("%s formats dates only through the shared helper", (root) => {
    const offenders: string[] = []
    for (const file of sources(root)) {
      const lines = readFileSync(file, "utf8").split("\n")
      lines.forEach((line, index) => {
        if (!FORBIDDEN.some((pattern) => pattern.test(line))) return
        if ((lines[index - 1] ?? "").includes(ALLOW_MARKER)) return
        offenders.push(`${file}:${index + 1}`)
      })
    }
    expect(offenders).toEqual([])
  })

  it.each(FILES)("%s formats dates only through the shared helper", (file) => {
    const offenders: string[] = []
    const lines = readFileSync(file, "utf8").split("\n")
    lines.forEach((line, index) => {
      if (!FORBIDDEN.some((pattern) => pattern.test(line))) return
      if ((lines[index - 1] ?? "").includes(ALLOW_MARKER)) return
      offenders.push(`${file}:${index + 1}`)
    })
    expect(offenders).toEqual([])
  })

  it("sends the whole timezone helper through format-date", () => {
    // Eleven MTM components format task deadlines, GPS history and route
    // drafts through formatInTimezone; one direct Intl call here undoes the
    // Azerbaijani fix in all of them at once.
    const tz = readFileSync("src/lib/timezone.ts", "utf8")
    expect(tz).toContain('createDateFormatter(locale, { timeZone: tz, ...options }).format(d)')
  })

  it("keeps the team week and the clock on the helper's weekday names", () => {
    const week = readFileSync("src/components/mtm/route-week-plan.tsx", "utf8")
    expect(week).toContain('formatDate(day, locale, { weekday: "short" })')
    const home = readFileSync("src/app/(dashboard)/mtm/page.tsx", "utf8")
    expect(home).toMatch(/formatDate\(clock, locale, \{ weekday: "long"/)
  })
})
