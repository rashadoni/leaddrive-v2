import { describe, expect, it } from "vitest"
import {
  EMPTY_ORGANIZATION_FILTERS,
  MTM_ORGANIZATION_DEFAULT_COLUMNS,
  MTM_ORGANIZATION_DEFAULT_COLUMN_WIDTHS,
  organizationFacetQuery,
  organizationFiltersFromSearchParams,
  organizationQuery,
  organizationSavedViewFilters,
  organizationSavedViewState,
  selectionScopeLabel,
  updatePageSelection,
} from "@/lib/mtm/organization-explorer"

describe("MTM organization explorer", () => {
  it("serializes only active filters while keeping server paging explicit", () => {
    const params = organizationQuery({
      ...EMPTY_ORGANIZATION_FILTERS,
      search: "clinic",
      region: "Baku",
      assignmentState: "UNASSIGNED",
      sort: "updatedAt",
      direction: "desc",
    }, 3, 25)

    expect(params.toString()).toBe(
      "search=clinic&region=Baku&assignmentState=UNASSIGNED&sort=updatedAt&direction=desc&page=3&limit=25",
    )
  })

  it("sends active list filters to dependent facets without presentation state", () => {
    const params = organizationFacetQuery({
      ...EMPTY_ORGANIZATION_FILTERS,
      search: "clinic",
      region: "Baku",
      administrativeDistrict: "Nasimi",
      polygonCode: "BAKU-01",
      assignmentState: "UNASSIGNED",
      sort: "updatedAt",
      direction: "desc",
    })

    expect(params.toString()).toBe(
      "search=clinic&region=Baku&administrativeDistrict=Nasimi&polygonCode=BAKU-01&assignmentState=UNASSIGNED",
    )
  })

  it("ignores unsupported sort and direction values restored from a URL", () => {
    const filters = organizationFiltersFromSearchParams(
      new URLSearchParams("region=Baku&sort=DROP&direction=sideways"),
    )

    expect(filters.region).toBe("Baku")
    expect(filters.sort).toBe("name")
    expect(filters.direction).toBe("asc")
    expect(filters.scope).toBe("")
  })

  it("round-trips only supported organization workspace scopes", () => {
    expect(organizationFiltersFromSearchParams(new URLSearchParams("scope=MINE")).scope).toBe("MINE")
    expect(organizationFiltersFromSearchParams(new URLSearchParams("scope=ALL")).scope).toBe("ALL")
    expect(organizationFiltersFromSearchParams(new URLSearchParams("scope=OTHER")).scope).toBe("")
  })

  it("adds and removes exactly the current page without losing other rows", () => {
    const selected = new Set(["outside-page", "row-1"])
    const selectedPage = updatePageSelection(selected, ["row-1", "row-2"], true)
    expect([...selectedPage].sort()).toEqual(["outside-page", "row-1", "row-2"])

    const clearedPage = updatePageSelection(selectedPage, ["row-1", "row-2"], false)
    expect([...clearedPage]).toEqual(["outside-page"])
  })

  it("distinguishes current-page selection from all filtered results", () => {
    expect(selectionScopeLabel({
      selectedCount: 25,
      currentPageSelected: 25,
      currentPageCount: 25,
      total: 140,
    })).toBe("FULL_PAGE")
    expect(selectionScopeLabel({
      selectedCount: 140,
      currentPageSelected: 25,
      currentPageCount: 25,
      total: 140,
    })).toBe("ALL_FILTERED")
  })

  it("round-trips a saved view without accepting unsupported values", () => {
    const saved = organizationSavedViewFilters({
      ...EMPTY_ORGANIZATION_FILTERS,
      search: "clinic",
      territoryCode: "NORTH",
      medicalCategoryCode: "A",
      licenseStatus: "LICENSED",
      polygonCode: "BAKU-01",
      sort: "updatedAt",
      direction: "desc",
    }, 25)

    expect(organizationSavedViewState(saved)).toEqual({
      filters: {
        ...EMPTY_ORGANIZATION_FILTERS,
        search: "clinic",
        territoryCode: "NORTH",
        medicalCategoryCode: "A",
        licenseStatus: "LICENSED",
        polygonCode: "BAKU-01",
        sort: "updatedAt",
        direction: "desc",
      },
      limit: 25,
      columns: MTM_ORGANIZATION_DEFAULT_COLUMNS,
      density: "COMFORTABLE",
      columnWidths: MTM_ORGANIZATION_DEFAULT_COLUMN_WIDTHS,
    })

    expect(organizationSavedViewState({
      ...saved,
      sort: "DROP",
      direction: "sideways",
      limit: 999,
    })).toMatchObject({
      filters: { sort: "name", direction: "asc" },
      limit: 50,
    })
  })

  it("sanitizes saved grid layout while keeping identity columns pinned first", () => {
    const restored = organizationSavedViewState({
      columns: ["activity", "organization", "code", "activity", "DROP", "owner"],
      density: "COMPACT",
      columnWidths: {
        code: 20,
        organization: 999,
        owner: 187.6,
        activity: "bad",
      },
    })

    expect(restored.columns).toEqual(["code", "organization", "activity", "owner"])
    expect(restored.density).toBe("COMPACT")
    expect(restored.columnWidths).toMatchObject({
      code: 96,
      organization: 480,
      owner: 188,
      activity: MTM_ORGANIZATION_DEFAULT_COLUMN_WIDTHS.activity,
    })
  })
})
