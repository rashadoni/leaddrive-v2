// The two longest MTM pages, shortened (owner 2026-10-31, from a before/after
// picture): «Giriş və icazələr» was 6.6 screens, «Fəaliyyət jurnalı» 5.5.
import { readFileSync } from "fs"
import { describe, expect, it } from "vitest"

const source = (path: string) => readFileSync(path, "utf8")

describe("MTM long pages", () => {
  it("splits «Giriş və icazələr» into two tabs that open on the people", () => {
    const panel = source("src/components/mtm/access-panel.tsx")
    expect(panel).toContain('useState<"people" | "agent">("people")')
    expect(panel).toContain('role="tablist"')
    // One tab at a time: the matrix is not drawn under the roster.
    expect(panel).toMatch(/tab === "people" \? \([\s\S]*\) : \([\s\S]*<MtmAgentPermissionMatrix/)
  })

  it("draws every agent rule on one line with its explanation under the cursor", () => {
    const matrix = source("src/components/mtm/agent-permission-matrix.tsx")
    expect(matrix).toContain('className="grid gap-4 lg:grid-cols-2"')
    expect(matrix).toContain("<HintValue text={explanation}>{name}</HintValue>")
    expect(matrix).not.toContain('<p className="mt-0.5 text-xs text-muted-foreground">{t(`perm_${row.id}_hint`')
  })

  it("opens the activity journal on today and widens an empty today once, saying so", () => {
    const page = source("src/app/(dashboard)/mtm/activity/page.tsx")
    expect(page).toContain('useState<Period>("today")')
    expect(page).toContain('setWidenedFrom("today")')
    for (const locale of ["az", "ru", "en"]) {
      const messages = JSON.parse(source(`messages/${locale}.json`))
      expect(messages.mtmActivity.widenedNotice, locale).toMatch(/\{from\}[\s\S]*\{to\}/)
    }
  })
})
