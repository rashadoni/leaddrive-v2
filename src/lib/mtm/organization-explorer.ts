export const MTM_ORGANIZATION_PAGE_SIZES = [25, 50, 100] as const
export const MTM_ORGANIZATION_BULK_LIMIT = 500
export const MTM_ORGANIZATION_COLUMNS = [
  "code",
  "organization",
  "type",
  "category",
  "medicalCategory",
  "license",
  "location",
  "owner",
  "lastVisit",
  "nextVisit",
  "activity",
] as const
export type OrganizationColumn = (typeof MTM_ORGANIZATION_COLUMNS)[number]
export type OrganizationDensity = "COMPACT" | "COMFORTABLE"
export const MTM_ORGANIZATION_DEFAULT_COLUMNS = [
  "code",
  "organization",
  "type",
  "category",
  "medicalCategory",
  "license",
  "location",
  "owner",
  "lastVisit",
  "nextVisit",
  "activity",
] satisfies OrganizationColumn[]
export const MTM_ORGANIZATION_DEFAULT_COLUMN_WIDTHS: Record<OrganizationColumn, number> = {
  code: 120,
  organization: 320,
  type: 220,
  category: 160,
  medicalCategory: 180,
  license: 150,
  location: 220,
  owner: 190,
  lastVisit: 150,
  nextVisit: 165,
  activity: 150,
}
export const MTM_ORGANIZATION_COLUMN_MIN_WIDTH = 96
export const MTM_ORGANIZATION_COLUMN_MAX_WIDTH = 480

export type OrganizationSort =
  | "name"
  | "updatedAt"
  | "city"
  | "category"
  | "status"

export interface OrganizationExplorerFilters {
  scope: "" | "ALL" | "MINE"
  search: string
  category: string
  status: string
  objectType: string
  region: string
  administrativeDistrict: string
  locality: string
  cityDistrict: string
  specialization: string
  organizationKind: string
  territoryCode: string
  medicalCategoryCode: string
  licenseStatus: string
  polygonCode: string
  managingManagerId: string
  assignedAgentId: string
  assignmentState: string
  sort: OrganizationSort
  direction: "asc" | "desc"
}

export const EMPTY_ORGANIZATION_FILTERS: OrganizationExplorerFilters = {
  scope: "",
  search: "",
  category: "",
  status: "",
  objectType: "",
  region: "",
  administrativeDistrict: "",
  locality: "",
  cityDistrict: "",
  specialization: "",
  organizationKind: "",
  territoryCode: "",
  medicalCategoryCode: "",
  licenseStatus: "",
  polygonCode: "",
  managingManagerId: "",
  assignedAgentId: "",
  assignmentState: "",
  sort: "name",
  direction: "asc",
}

const FILTER_KEYS = Object.keys(
  EMPTY_ORGANIZATION_FILTERS,
) as Array<keyof OrganizationExplorerFilters>

export function organizationQuery(
  filters: OrganizationExplorerFilters,
  page: number,
  limit: number,
): URLSearchParams {
  const params = new URLSearchParams()
  for (const key of FILTER_KEYS) {
    const value = filters[key]
    if (value) params.set(key, value)
  }
  params.set("page", String(Math.max(1, page)))
  params.set("limit", String(limit))
  return params
}

/**
 * Filters sent to the facet endpoint. Pagination and presentation-only sort
 * state must not affect the available filter dictionaries.
 */
export function organizationFacetQuery(
  filters: OrganizationExplorerFilters,
): URLSearchParams {
  const params = organizationQuery(filters, 1, 50)
  params.delete("page")
  params.delete("limit")
  params.delete("sort")
  params.delete("direction")
  return params
}

export function organizationFiltersFromSearchParams(
  params: URLSearchParams,
): OrganizationExplorerFilters {
  const filters = { ...EMPTY_ORGANIZATION_FILTERS }
  for (const key of FILTER_KEYS) {
    const value = params.get(key)
    if (!value) continue
    if (key === "sort") {
      if (["name", "updatedAt", "city", "category", "status"].includes(value)) {
        filters.sort = value as OrganizationSort
      }
      continue
    }
    if (key === "direction") {
      if (value === "asc" || value === "desc") filters.direction = value
      continue
    }
    if (key === "scope") {
      if (value === "ALL" || value === "MINE") filters.scope = value
      continue
    }
    Object.assign(filters, { [key]: value })
  }
  return filters
}

export function organizationSavedViewState(value: unknown): {
  filters: OrganizationExplorerFilters
  limit: number
  columns: OrganizationColumn[]
  density: OrganizationDensity
  columnWidths: Record<OrganizationColumn, number>
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      filters: { ...EMPTY_ORGANIZATION_FILTERS },
      limit: 50,
      columns: [...MTM_ORGANIZATION_DEFAULT_COLUMNS],
      density: "COMFORTABLE",
      columnWidths: { ...MTM_ORGANIZATION_DEFAULT_COLUMN_WIDTHS },
    }
  }

  const record = value as Record<string, unknown>
  const params = new URLSearchParams()
  for (const key of FILTER_KEYS) {
    const entry = record[key]
    if (typeof entry === "string" && entry) params.set(key, entry)
  }

  const requestedLimit = typeof record.limit === "number"
    ? record.limit
    : Number.parseInt(String(record.limit ?? ""), 10)
  const limit = MTM_ORGANIZATION_PAGE_SIZES.includes(
    requestedLimit as (typeof MTM_ORGANIZATION_PAGE_SIZES)[number],
  )
    ? requestedLimit
    : 50
  const requestedColumns = Array.isArray(record.columns)
    ? record.columns.filter((entry): entry is OrganizationColumn => (
        typeof entry === "string" && MTM_ORGANIZATION_COLUMNS.includes(entry as OrganizationColumn)
      ))
    : []
  const uniqueColumns = [...new Set(requestedColumns)]
  const optionalColumns = uniqueColumns.filter((column) => (
    column !== "code" && column !== "organization"
  ))
  const columns: OrganizationColumn[] = uniqueColumns.length === 0
    ? [...MTM_ORGANIZATION_DEFAULT_COLUMNS]
    : uniqueColumns.includes("code")
      ? ["code", "organization", ...optionalColumns]
      : ["organization", ...optionalColumns]
  const density: OrganizationDensity = record.density === "COMPACT" ? "COMPACT" : "COMFORTABLE"
  const requestedWidths = record.columnWidths && typeof record.columnWidths === "object" && !Array.isArray(record.columnWidths)
    ? record.columnWidths as Record<string, unknown>
    : {}
  const columnWidths = Object.fromEntries(MTM_ORGANIZATION_COLUMNS.map((column) => {
    const requested = Number(requestedWidths[column])
    return [column, Number.isFinite(requested)
      ? Math.min(MTM_ORGANIZATION_COLUMN_MAX_WIDTH, Math.max(MTM_ORGANIZATION_COLUMN_MIN_WIDTH, Math.round(requested)))
      : MTM_ORGANIZATION_DEFAULT_COLUMN_WIDTHS[column]]
  })) as Record<OrganizationColumn, number>

  return {
    filters: organizationFiltersFromSearchParams(params),
    limit,
    columns,
    density,
    columnWidths,
  }
}

export function organizationSavedViewFilters(
  filters: OrganizationExplorerFilters,
  limit: number,
  density: OrganizationDensity = "COMFORTABLE",
  columnWidths: Record<OrganizationColumn, number> = MTM_ORGANIZATION_DEFAULT_COLUMN_WIDTHS,
): Record<string, unknown> {
  return {
    ...filters,
    limit: MTM_ORGANIZATION_PAGE_SIZES.includes(
      limit as (typeof MTM_ORGANIZATION_PAGE_SIZES)[number],
    )
      ? limit
      : 50,
    density,
    columnWidths,
  }
}

export function updatePageSelection(
  selected: ReadonlySet<string>,
  pageIds: readonly string[],
  shouldSelect: boolean,
): Set<string> {
  const next = new Set(selected)
  for (const id of pageIds) {
    if (shouldSelect) next.add(id)
    else next.delete(id)
  }
  return next
}

export function selectionScopeLabel(input: {
  selectedCount: number
  currentPageSelected: number
  currentPageCount: number
  total: number
}): "NONE" | "PARTIAL_PAGE" | "FULL_PAGE" | "ALL_FILTERED" | "MIXED" {
  if (input.selectedCount === 0) return "NONE"
  if (input.selectedCount === input.total && input.total > 0) return "ALL_FILTERED"
  if (
    input.currentPageCount > 0
    && input.currentPageSelected === input.currentPageCount
    && input.selectedCount === input.currentPageCount
  ) {
    return "FULL_PAGE"
  }
  if (input.selectedCount === input.currentPageSelected) return "PARTIAL_PAGE"
  return "MIXED"
}
