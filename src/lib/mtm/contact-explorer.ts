import { contactSpecialtyKey } from "@/lib/mtm/contact-specialties"

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

/** How many specialties one filter may carry (a URL has to stay a URL). */
export const MTM_CONTACT_SPECIALTY_FILTER_LIMIT = 50
const SPECIALTY_FILTER_MAX_LENGTH = 120

export interface ContactExplorerFilters {
  /** One box over every field — kept for old links and saved views. */
  search: string
  /** The four typed fields of the filter: each narrows only what it names. */
  name: string
  address: string
  area: string
  workplace: string
  type: string
  status: string
  category: string
  /** Any of these specialties; empty means «all». URL key `specialty`, repeated. */
  specialties: string[]
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
  name: "",
  address: "",
  area: "",
  workplace: "",
  type: "",
  status: "ACTIVE",
  category: "",
  specialties: [],
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

export type ContactTextFilterKey = Exclude<keyof ContactExplorerFilters, "specialties">
const FILTER_KEYS = Object.keys(EMPTY_CONTACT_FILTERS) as Array<keyof ContactExplorerFilters>
// `type` holds a client category code: a built-in type or one the tenant made.
const CONTACT_CATEGORY_CODE = /^[A-Z0-9][A-Z0-9_-]{0,79}$/
const CONTACT_STATUSES = new Set(["ACTIVE", "INACTIVE", "PROSPECT", "DUPLICATE", "MERGED"])
const CONTACT_CATEGORIES = new Set(["A", "B", "C", "D"])
const ORGANIZATION_TYPES = new Set(["PHARMACY", "CLINIC", "STORE", "OTHER"])
const ASSIGNMENT_STATES = new Set(["ASSIGNED", "UNASSIGNED"])
const COVERAGE_PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/

/** Trimmed, de-duplicated (case-insensitively), bounded — from a URL or a saved view. */
export function contactSpecialtyFilterValues(values: readonly unknown[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const entry of values) {
    if (typeof entry !== "string") continue
    const value = entry.trim()
    if (!value || value.length > SPECIALTY_FILTER_MAX_LENGTH) continue
    const key = contactSpecialtyKey(value)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(value)
    if (result.length >= MTM_CONTACT_SPECIALTY_FILTER_LIMIT) break
  }
  return result
}

export function contactFiltersFromSearchParams(params: URLSearchParams): ContactExplorerFilters {
  const filters: ContactExplorerFilters = { ...EMPTY_CONTACT_FILTERS, specialties: [] }
  for (const key of FILTER_KEYS) {
    if (key === "specialties") continue
    if (!params.has(key)) continue
    const value = params.get(key) ?? ""
    if (key === "type" && value && !CONTACT_CATEGORY_CODE.test(value)) continue
    if (key === "status" && value && !CONTACT_STATUSES.has(value)) continue
    if (key === "category" && value && !CONTACT_CATEGORIES.has(value)) continue
    if (key === "objectType" && value && !ORGANIZATION_TYPES.has(value)) continue
    if (key === "assignmentState" && value && !ASSIGNMENT_STATES.has(value)) continue
    if (key === "coveragePeriod" && value && !COVERAGE_PERIOD.test(value)) continue
    Object.assign(filters, { [key]: value })
  }
  // `specialtyCode` is the single-choice filter this one replaced: a link or a
  // saved view made before still selects its one specialty.
  filters.specialties = contactSpecialtyFilterValues([
    ...params.getAll("specialty"),
    ...params.getAll("specialtyCode"),
  ])
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
    if (key === "specialties") {
      for (const specialty of contactSpecialtyFilterValues(filters.specialties)) params.append("specialty", specialty)
      continue
    }
    const value = filters[key]
    if (value || key === "status") params.set(key, value)
  }
  params.set("page", String(Math.max(1, page)))
  params.set("limit", String(limit))
  return params
}

/** True when the filter differs from the one a fresh page opens with. */
export function contactFilterIsActive(
  filters: ContactExplorerFilters,
  key: keyof ContactExplorerFilters,
): boolean {
  if (key === "specialties") return filters.specialties.length > 0
  return filters[key] !== EMPTY_CONTACT_FILTERS[key]
}

export function contactSavedViewState(value: unknown): {
  filters: ContactExplorerFilters
  limit: number
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { filters: { ...EMPTY_CONTACT_FILTERS, specialties: [] }, limit: 50 }
  }
  const record = value as Record<string, unknown>
  const params = new URLSearchParams()
  for (const key of FILTER_KEYS) {
    const entry = record[key]
    if (key === "specialties") {
      if (Array.isArray(entry)) for (const specialty of entry) if (typeof specialty === "string") params.append("specialty", specialty)
      continue
    }
    if (typeof entry === "string") params.set(key, entry)
  }
  if (typeof record.specialtyCode === "string") params.append("specialtyCode", record.specialtyCode)
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
): Record<string, string | number | string[]> {
  return {
    ...filters,
    limit: MTM_CONTACT_PAGE_SIZES.includes(
      limit as (typeof MTM_CONTACT_PAGE_SIZES)[number],
    )
      ? limit
      : 50,
  }
}
