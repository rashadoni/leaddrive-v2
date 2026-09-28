import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const page = readFileSync("src/app/(dashboard)/settings/macros/page.tsx", "utf8")
const applyPage = readFileSync("src/app/(dashboard)/tickets/[id]/page.tsx", "utf8")
const categoryRoute = readFileSync("src/app/api/v1/ticket-macros/categories/route.ts", "utf8")

describe("macros UX contract", () => {
  it("keeps each recovered shell integration import unique", () => {
    for (const moduleName of [
      "did-you-know",
      "help/help-button",
      "page-description",
      "tour/tour-replay-button",
      "tour/tour-provider",
    ]) {
      expect(page.match(new RegExp(`from "@/components/${moduleName}"`, "g"))).toHaveLength(1)
    }
  })

  it("uses a compact searchable list rather than the old card gallery", () => {
    expect(page).toContain("searchPlaceholder")
    expect(page).toContain("md:grid-cols-[minmax(12rem,1.4fr)")
    expect(page).not.toContain("sm:grid-cols-2")
    expect(page).not.toContain("hover:shadow-md")
  })

  it("keeps macro and category actions discoverable in keyboard-accessible menus", () => {
    expect(page).toContain("<DropdownMenu")
    expect(page).toContain("macroMenu")
    expect(page).toContain("categoryMenu")
    expect(page).not.toContain("group-hover:opacity-100")
  })

  it("provides named 44px touch controls and keyboard action reordering", () => {
    expect(page).toContain("h-11 w-11")
    expect(page).toContain("moveUp")
    expect(page).toContain("moveDown")
    expect(page).toContain("removeAction")
  })

  it("uses a scoped agent select and never accepts free-text assignee IDs", () => {
    expect(page).toContain("selectAssignee")
    expect(page).toContain("agents.map")
    expect(page).not.toContain("assigneePlaceholder")
  })

  it("shows an ordered execution preview and preserves optional shortcut discovery", () => {
    expect(page).toContain("previewTitle")
    expect(page).toContain("<ol")
    expect(page).toContain("shortcutsDiscovery")
    expect(page).toContain("Alt+")
  })

  it("checks responses and keeps the editor open on save failure", () => {
    expect(page).toContain("checkedJson")
    expect(page).toContain("saveError")
    expect(page).toContain("setDraft")
    expect(page).not.toContain("catch {}")
  })

  it("lets the dialog capture and restore its trigger before applying initial focus", () => {
    expect(page).toContain("data-dialog-initial-focus")
    expect(page).not.toContain('<Input autoFocus value={draft.name}')
  })

  it("delays destructive requests so macro and category deletion can be undone", () => {
    expect(page).toContain("DELETE_DELAY_MS")
    expect(page).toContain("undoDelete")
    expect(page).toContain("setTimeout(() => void finishDelete")
  })

  it("stores categories in the organization contract and updates macros atomically", () => {
    expect(categoryRoute).toContain("organization.update")
    expect(categoryRoute).toContain("ticketMacro.updateMany")
    expect(categoryRoute).toContain("isolationLevel: \"Serializable\"")
    expect(page).not.toContain("localStorage")
  })

  it("has explicit loading, empty, filtered-empty, error, permission and rollback states", () => {
    for (const marker of ["loading", "loadError", "noMacros", "noResults", "readOnlyTitle", "toggleError", "retry"]) {
      expect(page).toContain(marker)
    }
  })

  it("checks apply responses and surfaces progress, success and failure on ticket detail", () => {
    expect(applyPage).toContain("applyingMacroId")
    expect(applyPage).toContain("if (!response.ok) throw")
    expect(applyPage).toContain("appliedSuccess")
    expect(applyPage).toContain("applyError")
  })

  it("avoids decorative palettes, gradients and oversized headings", () => {
    expect(page).not.toMatch(/PALETTE|bg-gradient|from-(blue|violet|purple|emerald)/)
    expect(page).not.toMatch(/text-(3xl|4xl|5xl)/)
  })
})
