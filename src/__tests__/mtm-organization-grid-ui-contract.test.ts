import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

function source(path: string): string {
  return readFileSync(path, "utf8")
}

function leafPaths(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [prefix]
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, entry]) => leafPaths(entry, prefix ? `${prefix}.${key}` : key))
}

describe("SWM-08 dense organization grid UI contract", () => {
  it("keeps stable identity and actions visible in a dense keyboard-navigable grid", () => {
    const ui = source("src/components/mtm/organization-explorer.tsx")

    expect(ui).toContain('data-density={density}')
    expect(ui).toContain('data-testid="mtm-organization-grid-settings"')
    expect(ui).toContain('data-testid={`mtm-organization-density-${value.toLowerCase()}`}')
    expect(ui).toContain('aria-pressed={density === value}')
    expect(ui).toContain('data-testid="mtm-organization-grid-scroll"')
    expect(ui).toContain('data-column={column}')
    expect(ui).toContain('data-column="actions"')
    expect(ui).toContain('xl:sticky xl:right-0 xl:z-20')
    expect(ui).toContain('data-grid-cell')
    expect(ui).toContain('onKeyDown={handleGridKeyDown}')
    expect(ui).toContain('contentVisibility: "auto"')
    expect(ui).toContain('column === "code" ? { position: "sticky"')
    expect(ui).toContain('column === "organization" ? { position: "sticky"')
    expect(ui).toContain('organization.code || "—"')
  })

  it("persists layout controls and bounds all-filtered export to the existing bulk limit", () => {
    const ui = source("src/components/mtm/organization-explorer.tsx")
    const model = source("src/lib/mtm/organization-explorer.ts")

    expect(ui).toContain("setVisibleColumns(restored.columns)")
    expect(ui).toContain("setDensity(restored.density)")
    expect(ui).toContain("setColumnWidths(restored.columnWidths)")
    expect(ui).toContain("organizationSavedViewFilters(filters, limit, density, columnWidths)")
    expect(ui).toContain("columns: visibleColumns")
    expect(ui).toContain("total > MTM_ORGANIZATION_BULK_LIMIT")
    expect(ui).toContain("for (let requestPage = 1; requestPage <= requestCount; requestPage += 1)")
    expect(model).toContain('export type OrganizationDensity = "COMPACT" | "COMFORTABLE"')
  })

  it("uses task-focused phone cards with factual visit evidence and 44px actions", () => {
    const ui = source("src/components/mtm/organization-explorer.tsx")

    expect(ui).toContain('className="grid gap-2 md:hidden"')
    expect(ui).toContain('data-testid="mtm-organization-card"')
    expect(ui).toContain('tx("explorer.mobileRowIdentity"')
    expect(ui).toContain('const lastVisit = organization.visits[0]')
    expect(ui).toContain('visitDate.format(new Date(lastVisit.checkInAt))')
    expect(ui).toContain('className="min-h-11 min-w-11"')
    expect(ui).toContain('tx("explorer.noVisits")')
    expect(ui).toContain('const nextVisit = organization.routePoints[0]')
    expect(ui).toContain('href={routePlanningHref(organization.id)}')
    expect(ui).toContain('https://www.google.com/maps/dir/?api=1&destination=')
  })

  it("connects desktop, single selection, and phone cards to route planning", () => {
    const ui = source("src/components/mtm/organization-explorer.tsx")

    expect(ui).toContain('data-testid={`mtm-add-organization-to-route-${organization.id}`}')
    expect(ui).toContain('tx("explorer.addToRouteFor", { name: organization.name })')
    expect(ui).toContain('selectedOrganizationId ? (')
    expect(ui).toContain('href={routePlanningHref(selectedOrganizationId)}')
    expect(ui).toContain('mtmRoutePlanningHref({')
    expect(ui).toContain('testId={`mtm-organization-select-${organization.id}`}')
    expect(ui).toContain('data-testid="mtm-organization-assign-open"')
    expect(ui).toContain('data-testid="mtm-organization-assignment-dialog"')
    expect(ui).not.toContain('effectiveScope === "MINE" ? (\n                    <div className="mt-3 grid')
  })

  it("uses the same explorer for an exact current-actor assignment scope", () => {
    const ui = source("src/components/mtm/organization-explorer.tsx")
    const route = source("src/app/api/v1/mtm/organizations/route.ts")

    expect(ui).toContain('effectiveScope = filters.scope || data?.effectiveScope || "ALL"')
    expect(ui).toContain('setExplorerScope("MINE")')
    expect(route).toContain('actor.role === "AGENT"')
    expect(route).toContain('effectiveScope === "MINE"')
    expect(route).toContain('agentId: actor.agentId')
    expect(route).toContain('...activeFieldAssignmentWindow(asOf)')
  })

  it("explains an empty personal scope and offers a direct catalogue recovery action", () => {
    const ui = source("src/components/mtm/organization-explorer.tsx")

    expect(ui).toContain('emptyMineAssignmentGap ? "explorer.emptyMineTitle"')
    expect(ui).toContain('canOpenAllScope ? "explorer.emptyMineDescription" : "explorer.emptyMineAgentDescription"')
    expect(ui).toContain('data?.capabilities.actorRole !== "AGENT"')
    expect(ui).toContain('data-testid="mtm-organizations-open-all"')
    expect(ui).toContain('onClick={() => setExplorerScope("ALL")}')
  })

  it("keeps new grid copy aligned in RU, AZ, and EN", () => {
    const locales = ["ru", "az", "en"]
    const namespaces = locales.map((locale) => (
      JSON.parse(source(`messages/${locale}.json`)).mtmCustomers.explorer as Record<string, unknown>
    ))
    const baseline = leafPaths(namespaces[0]).sort()

    expect(leafPaths(namespaces[1]).sort()).toEqual(baseline)
    expect(leafPaths(namespaces[2]).sort()).toEqual(baseline)
    for (const [index, namespace] of namespaces.entries()) {
      for (const key of [
        "configureGrid",
        "gridSettingsHint",
        "gridLabel",
        "exportFiltered",
        "noVisits",
        "mobileRowIdentity",
        "scopeMine",
        "scopeMineHint",
        "emptyMineTitle",
        "emptyMineDescription",
        "emptyMineAgentDescription",
        "openAllOrganizations",
        "notPlanned",
        "navigate",
        "planVisit",
        "addToRoute",
        "addToRouteFor",
      ]) {
        expect(namespace[key], `${locales[index]}.${key} is missing`).toEqual(expect.any(String))
      }
    }
  })
})
