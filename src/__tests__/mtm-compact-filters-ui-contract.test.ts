import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * Owner 2026-09-27, on «Клиенты» and «all the filters in this module»:
 * «слишком много места занимает, не интерактивен, не интуитивен и не юзер
 * френдли». One row of pills per list; the list starts right under it.
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
    expect(bar).toContain('className="absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-full opacity-0"')
  })

  it("offers «Сбросить» only when something is set", () => {
    expect(bar).toContain("if (!show) return null")
  })
})

describe("«Клиенты» filters", () => {
  const explorer = readFileSync("src/components/mtm/contact-explorer.tsx", "utf8")

  it("is one row, not a card of fields, a saved-views panel and stat tiles", () => {
    expect(explorer).toContain('<section data-testid="mtm-contact-filters" className="space-y-2">')
    expect(explorer).toContain("<MtmFilterSearch")
    expect(explorer).not.toContain('<details className="group -mx-4 -mt-4 border-b')
    expect(explorer).not.toContain('<Stat label={t("found")}')
    expect(explorer).not.toContain('<Button type="submit" size="icon"')
    expect(explorer).toContain('tf("found", { count: total })')
  })

  it("keeps the rarer filters behind «Ещё фильтры» and every filter in the URL state it had", () => {
    expect(explorer).toContain('<MtmFilterBar testId="mtm-contact-advanced-filters">')
    for (const key of ["specialtyCode", "profile", "qualificationCategory", "region", "administrativeDistrict", "locality", "cityDistrict", "organizationKind"]) {
      expect(explorer).toContain(`["${key}", `)
    }
    expect(explorer).toContain('updateFilter("coveragePeriod", value)')
    expect(explorer).toContain('updateFilter("objectType", value)')
  })
})

describe("«Учреждения» filters", () => {
  const explorer = readFileSync("src/components/mtm/organization-explorer.tsx", "utf8")

  it("is one row: no stat cells, no «Рабочая область» card, no search button, no folded grid", () => {
    expect(explorer).toContain('<section data-testid="organization-filters" className="space-y-2">')
    expect(explorer).not.toContain('aria-label={tx("explorer.summary")}')
    expect(explorer).not.toContain('{tx("explorer.search")}')
    expect(explorer).not.toContain('{tx("explorer.advancedFilters")}')
    expect(explorer).toContain('<MtmFilterSelect testId="organization-scope"')
    expect(explorer).toContain('<MtmFilterBar testId="organization-advanced-filters">')
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
  ])("%s", (_name, path) => {
    const page = readFileSync(path, "utf8")
    expect(page).toContain('from "@/components/mtm/filter-bar"')
    expect(page).toContain("<MtmFilterBar")
    expect(page).not.toContain("<ColorStatCard")
  })
})
