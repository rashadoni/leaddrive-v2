import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * Field UX audit 2026-09-05, task C14. Delete sat one miss away from the
 * action people press every day — "edit" on the agent card, "resolved" on the
 * alert — and it cannot be undone. It moves into the "⋯" menu, the pattern
 * the visits page already uses.
 */
describe("MTM delete lives in the overflow menu", () => {
  const pages = {
    agents: readFileSync("src/app/(dashboard)/mtm/agents/page.tsx", "utf8"),
    alerts: readFileSync("src/app/(dashboard)/mtm/alerts/page.tsx", "utf8"),
    visits: readFileSync("src/app/(dashboard)/mtm/visits/page.tsx", "utf8"),
  }

  it("has no bare delete button on the row", () => {
    for (const [name, source] of Object.entries(pages)) {
      const bareDeleteButton = /<Button[^>]*onClick=\{\(\) => \{ setDeleteItem\([^)]*\); setDeleteOpen\(true\) \}\}[^>]*>\s*<Trash2/u
      expect(bareDeleteButton.test(source), `${name} still deletes from a bare row button`).toBe(false)
    }
  })

  it("offers delete inside the menu, marked destructive", () => {
    for (const [name, source] of Object.entries(pages)) {
      expect(source, `${name} has no overflow trigger`).toContain("DropdownMenuTrigger")
      expect(source, `${name} does not mark delete destructive`).toContain('className="text-destructive focus:text-destructive"')
      expect(source, `${name} has no labelled trigger`).toContain('aria-label={t("moreActions")}')
    }
  })
})
