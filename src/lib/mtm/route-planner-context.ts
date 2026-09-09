import type { MtmRouteTargetDirection } from "@/lib/mtm/route-target-types"

const dateKeyPattern = /^\d{4}-\d{2}-\d{2}$/
const directions = new Set<MtmRouteTargetDirection>(["DOCTOR", "PHARMACY", "ORGANIZATION"])

export type MtmRoutePlannerFilters = {
  region: string
  administrativeDistrict: string
  customerId: string
  specialtyCode: string
  psychotype: string
}

export type MtmRoutePlannerContext = {
  schemaVersion: 1
  date: string | null
  agentId: string | null
  direction: MtmRouteTargetDirection | null
  search: string
  filters: MtmRoutePlannerFilters
}

export type MtmRoutePlannerContextPatch = Partial<Omit<MtmRoutePlannerContext, "schemaVersion">>

const emptyFilters = (): MtmRoutePlannerFilters => ({
  region: "",
  administrativeDistrict: "",
  customerId: "",
  specialtyCode: "",
  psychotype: "",
})

export function emptyMtmRoutePlannerContext(): MtmRoutePlannerContext {
  return {
    schemaVersion: 1,
    date: null,
    agentId: null,
    direction: null,
    search: "",
    filters: emptyFilters(),
  }
}

function readText(value: unknown, maximumLength: number): string {
  if (typeof value !== "string") return ""
  const normalized = value.trim()
  return normalized.length <= maximumLength ? normalized : ""
}

function readDate(value: unknown): string | null {
  const date = readText(value, 10)
  return dateKeyPattern.test(date) ? date : null
}

function readDirection(value: unknown): MtmRouteTargetDirection | null {
  return typeof value === "string" && directions.has(value as MtmRouteTargetDirection)
    ? value as MtmRouteTargetDirection
    : null
}

function readFilters(value: unknown): MtmRoutePlannerFilters {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}

  return {
    region: readText(source.region, 120),
    administrativeDistrict: readText(source.administrativeDistrict, 120),
    customerId: readText(source.customerId, 120),
    specialtyCode: readText(source.specialtyCode, 120),
    psychotype: readText(source.psychotype, 120),
  }
}

function contextRecord(value: unknown): Record<string, unknown> | null {
  if (!value) return null
  if (typeof value === "string") {
    try {
      return contextRecord(JSON.parse(value))
    } catch {
      return null
    }
  }
  return typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function parseMtmRoutePlannerContext(value: unknown): MtmRoutePlannerContext {
  const source = contextRecord(value)
  if (!source) return emptyMtmRoutePlannerContext()

  return {
    schemaVersion: 1,
    date: readDate(source.date),
    agentId: readText(source.agentId, 120) || null,
    direction: readDirection(source.direction),
    search: readText(source.search, 160),
    filters: readFilters(source.filters),
  }
}

export function mergeMtmRoutePlannerContext(
  current: MtmRoutePlannerContext,
  patch: MtmRoutePlannerContextPatch,
): MtmRoutePlannerContext {
  return parseMtmRoutePlannerContext({
    date: patch.date === undefined ? current.date : patch.date,
    agentId: patch.agentId === undefined ? current.agentId : patch.agentId,
    direction: patch.direction === undefined ? current.direction : patch.direction,
    search: patch.search === undefined ? current.search : patch.search,
    filters: patch.filters === undefined ? current.filters : patch.filters,
  })
}

export function mtmRoutePlannerContextsEqual(left: MtmRoutePlannerContext, right: MtmRoutePlannerContext): boolean {
  return left.date === right.date
    && left.agentId === right.agentId
    && left.direction === right.direction
    && left.search === right.search
    && left.filters.region === right.filters.region
    && left.filters.administrativeDistrict === right.filters.administrativeDistrict
    && left.filters.customerId === right.filters.customerId
    && left.filters.specialtyCode === right.filters.specialtyCode
    && left.filters.psychotype === right.filters.psychotype
}

export function mtmRoutePlannerContextStorageKey(organizationId: string, viewerKey: string): string {
  return `leaddrive:mtm:route-planner-context:${encodeURIComponent(organizationId)}:${encodeURIComponent(viewerKey)}`
}
