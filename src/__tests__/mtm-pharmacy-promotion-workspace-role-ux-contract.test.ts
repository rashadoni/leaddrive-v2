import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const workspace = readFileSync(
  resolve("src/components/mtm/pharmacy-promotion-workspace.tsx"),
  "utf8",
)

const locales = ["en", "ru", "az"].map((locale) => JSON.parse(readFileSync(
  resolve(`messages/${locale}.json`),
  "utf8",
)) as { mtmPharmacyPromotions?: Record<string, unknown> })

describe("SWM-09 role-aware promotion workspace UX contract", () => {
  it("shows only workspace views supported by the signed-in user's capabilities", () => {
    expect(workspace).toContain("export function pharmacyPromotionWorkspaceViews")
    expect(workspace).toContain('if (capabilities.canConfigure) return capabilities.canReview')
    expect(workspace).toContain('if (capabilities.canReview) return ["review", "registry"]')
    expect(workspace).toContain('return ["registry"]')
    expect(workspace).toContain("availableViews.map")
    expect(workspace).not.toContain('(["registry", "review", "campaigns"] as const).map')
    expect(workspace).toContain("if (!data || savedViewsLoading || defaultViewAppliedRef.current) return")
  })

  it("never preselects a review decision or lets a reviewer change the server step", () => {
    expect(workspace).toContain('useState<"" | "APPROVED" | "REJECTED" | "RETURNED">("")')
    expect(workspace).not.toContain('setDecision("APPROVED")')
    expect(workspace).not.toContain("setLevel(")
    expect(workspace).toContain('data-testid="mtm-pharmacy-review-step"')
    expect(workspace).toContain('disabled={previewing || !inferredStep || !decision}')
  })

  it("keeps review selection and actions absent when bulk review is unavailable", () => {
    expect(workspace).toContain("data?.capabilities.canBulkReview ? <th")
    expect(workspace).toContain("data?.capabilities.canBulkReview ? <td")
    expect(workspace).toContain("data?.capabilities.canBulkReview && row.currentStep")
    expect(workspace).toContain("data?.capabilities.canBulkReview && selected.size > 0")
  })

  it("groups advanced filters and makes applied filters removable", () => {
    expect(workspace).toContain('data-testid="mtm-pharmacy-filter-group-scope"')
    expect(workspace).toContain('data-testid="mtm-pharmacy-filter-group-workflow"')
    expect(workspace).toContain('data-testid="mtm-pharmacy-filter-group-period-points"')
    expect(workspace).toContain('data-testid="mtm-pharmacy-active-filters"')
    expect(workspace).toContain("replaceParams({ [filter.key]: null, page: null })")
    expect(workspace).toContain('data-testid="mtm-pharmacy-filter-sheet"')
    expect(workspace).toContain('data-testid="mtm-pharmacy-filter-reset"')
    expect(workspace).toContain('data-testid="mtm-pharmacy-filter-apply"')
    expect(workspace).toContain("advanced && !compactFilterLayout")
    expect(workspace).toContain("advanced && compactFilterLayout")
  })

  it("provides in-context guidance and complete locale copy", () => {
    expect(workspace).toContain('<HelpButton slug="mtm-promotions" variant="label" className="h-11" />')
    expect(workspace).toContain("mtm-pharmacy-role-guide-${persona}")
    for (const locale of locales) {
      const section = locale.mtmPharmacyPromotions
      expect(section).toBeTruthy()
      expect(section).toHaveProperty("roleGuide.agent.title")
      expect(section).toHaveProperty("roleGuide.reviewer.hint")
      expect(section).toHaveProperty("roleGuide.admin.title")
      expect(section).toHaveProperty("roleGuide.reader.hint")
      expect(section).toHaveProperty("filterGroup.scope")
      expect(section).toHaveProperty("filterGroup.workflow")
      expect(section).toHaveProperty("filterGroup.periodPoints")
      expect(section).toHaveProperty("activeFilters")
      expect(section).toHaveProperty("clearFilter")
      expect(section).toHaveProperty("openReviewQueue")
      expect(section).toHaveProperty("filterSheetTitle")
      expect(section).toHaveProperty("columnChooserTitle")
      expect(section).toHaveProperty("column.source")
      expect(section).toHaveProperty("density.compact")
      expect(section).toHaveProperty("tabletMasterLabel")
    }
  })

  it("uses a landscape master-detail workspace without coupling focus to bulk selection", () => {
    expect(workspace).toContain('const [focusedRowId, setFocusedRowId] = useState<string | null>(null)')
    expect(workspace).toContain('data-testid="mtm-pharmacy-tablet-master-detail"')
    expect(workspace).toContain('data-testid="mtm-pharmacy-tablet-inspector"')
    expect(workspace).toContain("onClick={() => setFocusedRowId(row.id)}")
    expect(workspace).toContain("selected.has(row.id)")
    expect(workspace).toContain("tabletLandscape")
  })

  it("exposes whitelisted saved-view columns and density while keeping identity and actions mandatory", () => {
    expect(workspace).toContain("PHARMACY_PROMOTION_SECONDARY_COLUMNS")
    expect(workspace).toContain('searchParams.get("columns")')
    expect(workspace).toContain("replaceParams({ columns, page: null })")
    expect(workspace).toContain("replaceParams({ density: nextDensity, page: null })")
    expect(workspace).not.toContain("setDraft((current) => ({ ...current, columns }))")
    expect(workspace).not.toContain("setDraft((current) => ({ ...current, density: nextDensity }))")
    expect(workspace).toContain('data-testid="mtm-pharmacy-column-chooser"')
    expect(workspace).toContain('data-testid="mtm-pharmacy-column-toolbar"')
    expect(workspace).toContain("const latestSearchKeyRef = useRef(searchKey)")
    expect(workspace).toContain("const next = new URLSearchParams(latestSearchKeyRef.current)")
    expect(workspace).toContain("visibleColumnsRef.current = nextColumns")
    expect(workspace).toContain('for (const key of ["columns", "density"] as const)')
    expect(workspace).toContain('data-testid={`mtm-pharmacy-column-${column}`}')
  })

  it("keeps desktop identity and actions visible and does not encode status by color alone", () => {
    expect(workspace).toContain("function PromotionStatusBadge")
    expect(workspace).toContain('className="mr-1 h-3 w-3" aria-hidden="true"')
    expect(workspace).toContain('"sticky z-20 bg-muted/95 px-3 py-2 font-semibold')
    expect(workspace).toContain('"sticky right-0 z-20 bg-muted/95 px-3 py-2 font-semibold')
  })
})
