export const MTM_CONTACT_PAGE_SIZES = [25, 50, 100, 200] as const
export const MTM_CONTACT_BULK_LIMIT = 200
export const MTM_CONTACT_DEFAULT_COLUMNS = [
  "contact",
  "professional",
  "workplace",
  "visits",
  "communication",
  "owner",
] as const

export interface ContactExplorerFilters {
  search: string
  type: string
  status: string
  category: string
  specialtyCode: string
  profile: string
  qualificationCategory: string
  ownerAgentId: string
  assignmentState: string
  region: string
  administrativeDistrict: string
  locality: string
  cityDistrict: string
  organizationKind: string
  objectType: string
  coveragePeriod: string
}

export const EMPTY_CONTACT_FILTERS: ContactExplorerFilters = {
  search: "",
  type: "",
  status: "ACTIVE",
  category: "",
  specialtyCode: "",
  profile: "",
  qualificationCategory: "",
  ownerAgentId: "",
  assignmentState: "",
  region: "",
  administrativeDistrict: "",
  locality: "",
  cityDistrict: "",
  organizationKind: "",
  objectType: "",
  coveragePeriod: "",
}

const FILTER_KEYS = Object.keys(EMPTY_CONTACT_FILTERS) as Array<keyof ContactExplorerFilters>
const CONTACT_TYPES = new Set(["DOCTOR", "PHARMACIST", "OTHER"])
const CONTACT_STATUSES = new Set(["ACTIVE", "INACTIVE", "PROSPECT", "DUPLICATE", "MERGED"])
const CONTACT_CATEGORIES = new Set(["A", "B", "C", "D"])
const ORGANIZATION_TYPES = new Set(["PHARMACY", "CLINIC", "STORE", "OTHER"])
const ASSIGNMENT_STATES = new Set(["ASSIGNED", "UNASSIGNED"])
const COVERAGE_PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/

export function contactFiltersFromSearchParams(params: URLSearchParams): ContactExplorerFilters {
  const filters = { ...EMPTY_CONTACT_FILTERS }
  for (const key of FILTER_KEYS) {
    if (!params.has(key)) continue
    const value = params.get(key) ?? ""
    if (key === "type" && value && !CONTACT_TYPES.has(value)) continue
    if (key === "status" && value && !CONTACT_STATUSES.has(value)) continue
    if (key === "category" && value && !CONTACT_CATEGORIES.has(value)) continue
    if (key === "objectType" && value && !ORGANIZATION_TYPES.has(value)) continue
    if (key === "assignmentState" && value && !ASSIGNMENT_STATES.has(value)) continue
    if (key === "coveragePeriod" && value && !COVERAGE_PERIOD.test(value)) continue
    Object.assign(filters, { [key]: value })
  }
  return filters
}

export function contactExplorerStateFromSearchParams(params: URLSearchParams): {
  filters: ContactExplorerFilters
  page: number
  limit: number
} {
  const requestedLimit = Number.parseInt(params.get("limit") ?? "50", 10)
  return {
    filters: contactFiltersFromSearchParams(params),
    page: Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1),
    limit: MTM_CONTACT_PAGE_SIZES.includes(
      requestedLimit as (typeof MTM_CONTACT_PAGE_SIZES)[number],
    )
      ? requestedLimit
      : 50,
  }
}

export function contactQuery(
  filters: ContactExplorerFilters,
  page: number,
  limit: number,
): URLSearchParams {
  const params = new URLSearchParams()
  for (const key of FILTER_KEYS) {
    const value = filters[key]
    if (value || key === "status") params.set(key, value)
  }
  params.set("page", String(Math.max(1, page)))
  params.set("limit", String(limit))
  return params
}

export function contactSavedViewState(value: unknown): {
  filters: ContactExplorerFilters
  limit: number
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { filters: { ...EMPTY_CONTACT_FILTERS }, limit: 50 }
  }
  const record = value as Record<string, unknown>
  const params = new URLSearchParams()
  for (const key of FILTER_KEYS) {
    const entry = record[key]
    if (typeof entry === "string") params.set(key, entry)
  }
  const requestedLimit = typeof record.limit === "number"
    ? record.limit
    : Number.parseInt(String(record.limit ?? ""), 10)
  return {
    filters: contactFiltersFromSearchParams(params),
    limit: MTM_CONTACT_PAGE_SIZES.includes(
      requestedLimit as (typeof MTM_CONTACT_PAGE_SIZES)[number],
    )
      ? requestedLimit
      : 50,
  }
}

export function contactSavedViewFilters(
  filters: ContactExplorerFilters,
  limit: number,
): Record<string, string | number> {
  return {
    ...filters,
    limit: MTM_CONTACT_PAGE_SIZES.includes(
      limit as (typeof MTM_CONTACT_PAGE_SIZES)[number],
    )
      ? limit
      : 50,
  }
}
