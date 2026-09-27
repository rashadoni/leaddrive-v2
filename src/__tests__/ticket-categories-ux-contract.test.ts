import { readFileSync } from "fs"
import path from "path"
import { describe, expect, it } from "vitest"

const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8")

describe("ticket categories UX contract", () => {
  it("puts a compact status line and category tree before management details", () => {
    const page = source("src/app/(dashboard)/settings/ticket-categories/page.tsx")
    expect(page).toContain('aria-label={t("summaryLabel")}')
    expect(page).toContain('role="tree"')
    expect(page).not.toContain("lg:grid-cols-5")
    expect(page).not.toContain("ColorStatCard")
    expect(page).not.toMatch(/text-(?:2xl|3xl|4xl)/)
  })

  it("supports accessible tree disclosure, filter context and focus restoration", () => {
    const page = source("src/app/(dashboard)/settings/ticket-categories/page.tsx")
    expect(page).toContain("aria-expanded={expanded}")
    expect(page).toContain("toggleCollapsed(category.id)")
    expect(page).toContain("contextOnly")
    expect(page).toContain("pendingFocusId")
    expect(page).toContain("rowRefs.current.get(pendingFocusId)?.focus()")
  })

  it("opens create and edit in a full-screen mobile sheet and desktop drawer", () => {
    const page = source("src/app/(dashboard)/settings/ticket-categories/page.tsx")
    const sheet = source("src/components/ui/sheet.tsx")
    expect(page).toContain("!h-[100dvh] !w-full !max-w-none")
    expect(page).toContain("sm:!w-[34rem]")
    expect(page).toContain("motion-reduce:transition-none")
    expect(sheet).toContain("closeLabel")
    expect(sheet).toContain("h-11 w-11")
  })

  it("keeps technical fields inside an explicit advanced disclosure", () => {
    const page = source("src/app/(dashboard)/settings/ticket-categories/page.tsx")
    const disclosure = page.indexOf('aria-controls="ticket-category-advanced"')
    expect(disclosure).toBeGreaterThan(0)
    expect(page.indexOf('id="category-slug"')).toBeGreaterThan(disclosure)
    expect(page.indexOf('id="category-sort-order"')).toBeGreaterThan(disclosure)
    expect(page).toContain("hidden={!advancedOpen}")
  })

  it("localizes business-facing priority/scope/visibility and uses a visible row menu", () => {
    const page = source("src/app/(dashboard)/settings/ticket-categories/page.tsx")
    expect(page).toContain('t("priorityLow")')
    expect(page).toContain('t("priorityCritical")')
    expect(page).toContain("ticketScopeHelp")
    expect(page).toContain("portalVisibleHelp")
    expect(page).toContain("DropdownMenuTrigger")
    expect(page).toContain('aria-label={t("actionsNamed"')
    expect(page).not.toContain('<option value="low">low</option>')
  })

  it("explains deactivation impact and distinguishes all recovery states", () => {
    const page = source("src/app/(dashboard)/settings/ticket-categories/page.tsx")
    expect(page).toContain("deactivateDescription")
    expect(page).toContain("deactivateTarget._count?.tickets")
    expect(page).toContain("deactivateTarget._count?.children")
    expect(page).not.toContain("checked={form.isActive}")
    expect(page).toContain("loadFailedTitle")
    expect(page).toContain("noResultsTitle")
    expect(page).toContain("noCategoriesHint")
    expect(page).toContain("readOnlyHint")
    expect(page).toContain("discardOpen")
    expect(page).toContain("fetchCategories()")
    expect(page).toContain('data-testid="ticket-categories-workspace"')
    expect(page).toContain('data-testid="ticket-categories-load-error"')
    expect(page).toContain("loadErrorRetryable")
  })

  it("avoids decorative AI palette patterns and keeps primary controls touch-safe", () => {
    const page = source("src/app/(dashboard)/settings/ticket-categories/page.tsx")
    expect(page).toContain("min-h-11")
    expect(page).toContain("motion-reduce:animate-none")
    expect(page).toContain("bg-orange-700")
    expect(page).toContain("hover:bg-orange-800")
    expect(page).toContain('className="absolute inset-0 h-full w-full cursor-pointer opacity-0"')
    expect(page).toContain('className="flex flex-col gap-2 sm:shrink-0 sm:flex-row"')
    expect(page).toContain("min-h-11 w-full bg-orange-700")
    expect(page).not.toMatch(/(?:violet|purple|cyan|fuchsia)-/)
    expect(page).not.toContain("bg-gradient")
  })

  it("lifts discard confirmation above the editor and restores it on cancel", () => {
    const page = source("src/app/(dashboard)/settings/ticket-categories/page.tsx")
    expect(page).toContain("setEditorOpen(false)\n      setDiscardOpen(true)")
    expect(page).toContain("discardConfirmedRef.current = true")
    expect(page).toContain("if (!discardConfirmedRef.current) setEditorOpen(true)")
    expect(page).toContain("onOpenChange={setDiscardDialogOpen}")
  })

  it("avoids a nested main landmark and keeps lifecycle rows focusable after state changes", () => {
    const page = source("src/app/(dashboard)/settings/ticket-categories/page.tsx")
    expect(page).not.toContain("<main")
    expect(page).toContain("setShowInactive(true)")
    expect(page).toContain('data-testid="ticket-category-row"')
    expect(page).toContain("data-active={category.isActive")
  })
})
