import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

function source(path: string): string {
  return readFileSync(path, "utf8")
}

function localeKeys(locale: string): Record<string, unknown> {
  return JSON.parse(source(`messages/${locale}.json`)).mtmRoutesPage as Record<string, unknown>
}

describe("SWM-16 route builder filter UI contract", () => {
  const builder = source("src/components/mtm/route-builder.tsx")

  it("keeps the employee, date, direction, period, and active constraints visible", () => {
    expect(builder).toContain('data-testid="mtm-planning-filter-summary"')
    expect(builder).toContain("selectedAgentName")
    expect(builder).toContain("planningDateLabel(date, locale)")
    expect(builder).toContain("activeCandidateFilters.map")
    expect(builder).toContain("removeCandidateFilter(filter.key)")
    expect(builder).toContain("CandidateOrganizationSelect")
  })

  it("loads the large candidate workspace only when the user asks to add customers", () => {
    expect(builder).toContain("const [customerPickerOpen, setCustomerPickerOpen] = useState(true)")
    expect(builder).toContain("!primaryAgentId || !date || !customerPickerOpen")
    expect(builder).toContain('data-testid="mtm-route-customer-picker"')
    expect(builder).toContain('t("planningTools")')
    expect(builder).toContain("open={advancedOpen}")
  })

  it("defaults to organizations, honours tenant-configured target types, and hides doctor-only constraints elsewhere", () => {
    expect(builder).toContain('useState<CandidateDirection>("ORGANIZATION")')
    expect(builder).toContain("enabledRouteTargetTypes.map((target)")
    expect(builder).toContain("onClick={() => changeRouteTargetType(target)}")
    expect(builder).toContain("setDirection(target.direction)")
    expect(builder).toContain('direction === "DOCTOR" ? candidateFilters.specialtyCode : ""')
    expect(builder).toContain('{direction === "DOCTOR" ? (')
  })

  it("reports only rendered candidates and offers bounded incremental rendering", () => {
    expect(builder).toContain('shown: visibleCandidates.length')
    expect(builder).toContain("candidateResults.slice(0, visibleCandidateLimit)")
    expect(builder).toContain("setVisibleCandidateLimit((current) => current + candidateDisplayPageSize)")
    expect(builder).toContain("const candidateDisplayPageSize = 8")
    expect(builder).not.toContain("max-h-[min(38dvh,20rem)]")
    expect(builder).not.toContain("max-h-[min(70vh,32rem)]")
  })

  it("explains whether search, filters, or assignments hid the customer list", () => {
    expect(builder).toContain('t("candidateSearchEmptyHint")')
    expect(builder).toContain('t("candidateFiltersEmptyHint")')
    expect(builder).toContain('t("inlineAssignmentRecoveryHint"')
    expect(builder).toContain('onClick={() => setCustomerSearch("")}')
    expect(builder).toContain("onClick={clearAllCandidateFilters}")
  })

  it("localizes scope, filter recovery, and incremental result copy", () => {
    for (const locale of ["ru", "az", "en"]) {
      const messages = localeKeys(locale)
      for (const key of [
        "filterSearch",
        "filterOrganization",
        "planningScope",
        "agentNotSelected",
        "dateNotSelected",
        "activeCandidateFilters",
        "noActiveCandidateFilters",
        "removeCandidateFilter",
        "showMoreCandidates",
        "stepChooseAgent",
        "stepAddCustomers",
        "stepReviewRoute",
        "directionOrganizations",
        "planningTools",
        "addAnotherCustomer",
        "finishAddingCustomers",
        "noCustomersWithFilters",
        "candidateSearchEmptyHint",
        "candidateFiltersEmptyHint",
      ]) {
        expect(messages[key], `${locale}.${key} is missing`).toEqual(expect.any(String))
        expect((messages[key] as string).trim(), `${locale}.${key} is empty`).not.toBe("")
      }
    }
  })
})
