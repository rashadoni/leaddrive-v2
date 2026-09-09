import type { MtmRouteRecord } from "@/components/mtm/route-types"

interface RouteRangeInput {
  start: string
  endExclusive: string
  orgId?: string
  signal?: AbortSignal
}

const pageSize = 200
const maximumPages = 50

export async function fetchMtmRoutesInRange({ start, endExclusive, orgId, signal }: RouteRangeInput): Promise<MtmRouteRecord[]> {
  const routes: MtmRouteRecord[] = []
  let page = 1
  let total = 0

  do {
    const params = new URLSearchParams({
      start,
      endExclusive,
      limit: String(pageSize),
      page: String(page),
    })
    const response = await fetch(`/api/v1/mtm/routes?${params.toString()}`, {
      headers: orgId ? { "x-organization-id": orgId } : {},
      signal,
    })
    const result = await response.json().catch(() => null)
    if (!response.ok || !result?.success) throw new Error(result?.error || "ROUTE_RANGE_LOAD_FAILED")

    const pageRoutes = Array.isArray(result.data?.routes) ? result.data.routes as MtmRouteRecord[] : []
    routes.push(...pageRoutes)
    total = Number(result.data?.total ?? routes.length)
    page += 1

    if (page > maximumPages && routes.length < total) throw new Error("ROUTE_RANGE_TOO_LARGE")
    if (pageRoutes.length === 0) break
  } while (routes.length < total)

  return routes
}
