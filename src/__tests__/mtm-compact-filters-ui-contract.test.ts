import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * Owner 2026-09-27, on «Клиенты» and «all the filters in this module»:
 * «слишком много места занимает, не интерактивен, не интуитивен и не юзер
 * френдли». One row of pills per list; the list starts right under it.
 * «Клиенты» and «Учреждения» moved on to labelled fields on 2026-10-02 (below).
 */
const bar = readFileSync("src/components/mtm/filter-bar.tsx", "utf8")

describe("the shared MTM filter row", () => {
  it("searches as you type and on Enter, with no separate search button", () => {
    expect(bar).toContain("window.setTimeout(() => onChangeRef.current(draft.trim()), delayMs)")
    expect(bar).toContain('if (event.key === "Enter")')
    // Our own debounced value coming back must not eat a trailing space.
    expect(bar).toContain("if (draft.trim() !== value) setDraft(value)")
  })

  it("shows what a filter is set to, clears it with ×, and keeps a native select for phone and keyboard", () => {
    expect(bar).toContain("{active || showValue ? `${label}: ${current}` : label}")
    expect(bar).toContain("onClick={() => onChange(emptyValue)}")
    expect(bar).toContain('className="absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-full opacity-0 disabled:cursor-not-allowed"')
  })

  it("offers «Сбросить» only when something is set", () => {
    expect(bar).toContain("if (!show) return null")
  })
})

/**
 * Owner 2026-10-02, on the pill row in «Клиенты» and «Учреждения»: «он не
 * интуитивен и не юзер френдли», with a screenshot of the filter he wants — a
 * named field per thing you look by. These two lists use labelled fields; what
 * the fields find is checked in mtm-contact-filter-fields.test.ts.
 */
describe("the labelled filter fields", () => {
  it("puts a name over every field and tints the ones that are set", () => {
    expect(bar).toContain("export function MtmFilterGrid(")
    expect(bar).toContain('className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3 xl:grid-cols-4"')
    expect(bar).toContain("<MtmFilterFieldLabel htmlFor={id}>{label}</MtmFilterFieldLabel>")
    expect(bar).toContain("${value ? FIELD_SET : FIELD_IDLE}")
  })

  it("keeps a native select for one choice, and a checklist for several", () => {
    expect(bar).toContain("export function MtmFilterSelectField(")
    expect(bar).toContain("export function MtmFilterMultiField(")
    expect(bar).toContain('<input type="checkbox" className="sr-only" value={option.value} checked={checked} onChange={() => toggle(option.value)} />')
  })
})

describe("«Клиенты» filters", () => {
  const explorer = readFileSync("src/components/mtm/contact-explorer.tsx", "utf8")

  it("is a grid of named fields — no pill row, no saved-views panel, no stat tiles", () => {
    expect(explorer).toContain('<section data-testid="mtm-contact-filters" className="space-y-3">')
    expect(explorer).toContain("<MtmFilterGrid>")
    expect(explorer).not.toContain("<MtmFilterBar")
    expect(explorer).not.toContain("<MtmFilterSearch")
    expect(explorer).not.toContain('<details className="group -mx-4 -mt-4 border-b')
    expect(explorer).not.toContain('<Stat label={t("found")}')
    expect(explorer).not.toContain('<Button type="submit" size="icon"')
    expect(explorer).toContain('tf("found", { count: total })')
  })

  it("offers employee, several specialties, client name, address, district and institution on the page", () => {
    for (const testId of ["mtm-contact-owner", "mtm-contact-specialties", "mtm-contact-name", "mtm-contact-address", "mtm-contact-area", "mtm-contact-workplace", "mtm-contact-type", "mtm-contact-status"]) {
      expect(explorer).toContain(`testId="${testId}"`)
    }
    expect(explorer).toContain("<MtmFilterMultiField testId=\"mtm-contact-specialties\"")
    expect(explorer.indexOf('testId="mtm-contact-status"')).toBeLessThan(explorer.indexOf("{advancedOpen ? ("))
  })

  it("keeps the rarer filters behind «Ещё фильтры» and every filter in the URL state it had", () => {
    for (const key of ["profile", "qualificationCategory", "region", "administrativeDistrict", "locality", "cityDistrict", "organizationKind"]) {
      expect(explorer).toContain(`["${key}", `)
    }
    expect(explorer).toContain('updateFilter("coveragePeriod", value)')
    expect(explorer).toContain('updateFilter("objectType", value)')
    expect(explorer).toContain('updateFilter("search", value)')
    // A reference dropdown appears only where there is something to choose.
    expect(explorer).toContain("return offered || filters[key] ? (")
  })
})

describe("«Учреждения» filters", () => {
  const explorer = readFileSync("src/components/mtm/organization-explorer.tsx", "utf8")

  it("is a grid of named fields: no stat cells, no «Рабочая область» card, no search button, no pill row", () => {
    expect(explorer).toContain('<section data-testid="organization-filters" className="space-y-3">')
    expect(explorer).toContain("<MtmFilterGrid>")
    expect(explorer).not.toContain("<MtmFilterBar")
    expect(explorer).not.toContain("<MtmFilterSearch")
    expect(explorer).not.toContain('aria-label={tx("explorer.summary")}')
    expect(explorer).not.toContain('{tx("explorer.search")}')
    expect(explorer).not.toContain('{tx("explorer.advancedFilters")}')
  })

  it("offers employee, name, address, district, type, category, status and assignment on the page", () => {
    for (const testId of ["organization-assignedAgentId", "organization-name", "organization-address", "organization-area", "organization-object-type", "organization-category", "organization-status", "organization-assignment"]) {
      expect(explorer).toContain(`testId="${testId}"`)
      expect(explorer.indexOf(`testId="${testId}"`)).toBeLessThan(explorer.indexOf("{advancedOpen ? ("))
    }
    expect(explorer).toContain('<MtmFilterSelectField testId="organization-scope"')
    expect(explorer.indexOf('testId="organization-scope"')).toBeGreaterThan(explorer.indexOf("{advancedOpen ? ("))
  })
})

describe("every MTM list uses the one filter row, with no stat tiles above it", () => {
  it.each([
    ["visits", "src/app/(dashboard)/mtm/visits/page.tsx"],
    ["photos", "src/app/(dashboard)/mtm/photos/page.tsx"],
    ["alerts", "src/app/(dashboard)/mtm/alerts/page.tsx"],
    ["activity", "src/app/(dashboard)/mtm/activity/page.tsx"],
    ["agents", "src/app/(dashboard)/mtm/agents/page.tsx"],
    ["map", "src/app/(dashboard)/mtm/map/page.tsx"],
    ["routes", "src/app/(dashboard)/mtm/routes/page.tsx"],
    ["tasks", "src/app/(dashboard)/mtm/tasks/page.tsx"],
    ["panel", "src/components/mtm/operational-week-home.tsx"],
    ["trip history", "src/components/mtm/location-history-panel.tsx"],
    ["pharmacy promotions", "src/components/mtm/pharmacy-promotion-workspace.tsx"],
  ])("%s", (_name, path) => {
    const page = readFileSync(path, "utf8")
    expect(page).toContain('from "@/components/mtm/filter-bar"')
    expect(page).toContain("<MtmFilterBar")
    expect(page).not.toContain("<ColorStatCard")
  })
})

describe("«Аптечные промоакции» filters", () => {
  const workspace = readFileSync("src/components/mtm/pharmacy-promotion-workspace.tsx", "utf8")

  it("applies search, department and employee at once, keeps the rarer filters' draft with its own «Показать»", () => {
    expect(workspace).toContain("onChange={(value) => applyNow({ departmentId: value, employeeId: \"\" })}")
    expect(workspace).toContain('<Button onClick={applyFilters} className="min-h-11 lg:min-h-9"><Filter className="mr-2 h-4 w-4" />{t("showResults")}</Button>')
    expect(workspace).not.toContain("<SummaryCard")
    expect(workspace).not.toContain('<details aria-label={t("savedViewsLabel")}')
  })
})
