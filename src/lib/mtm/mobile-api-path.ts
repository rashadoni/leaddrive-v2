/**
 * The only MTM paths that may receive a mobile JWT at the edge.
 *
 * v1 is a historic compatibility namespace and remains prefix-scoped. v2 is
 * intentionally an exact allowlist of reviewed mobile handlers: a future v2
 * web/admin endpoint must not silently inherit a tenant principal from a raw
 * mobile bearer. Keep this module edge-safe and dependency-free because the
 * proxy uses it before any handler authentication runs.
 */
const LEGACY_MTM_API_PREFIX = "/api/v1/mtm/"
const LEGACY_MTM_MOBILE_API_PREFIX = "/api/v1/mtm/mobile/"
const V2_MTM_MOBILE_EXACT_PATHS = new Set([
  "/api/v2/mtm/mobile/location/batch",
  "/api/v2/mtm/mobile/route-field/contacts",
  "/api/v2/mtm/mobile/route-field/organizations",
  "/api/v2/mtm/mobile/route-field/planning-targets",
  "/api/v2/mtm/mobile/sync/routes",
  "/api/v2/mtm/mobile/sync/tasks",
  "/api/v2/mtm/mobile/sync/visits",
  "/api/v2/mtm/mobile/sync/workforce",
])
const V2_MTM_MOBILE_DETAIL_PATH = /^\/api\/v2\/mtm\/mobile\/route-field\/(?:contacts|organizations)\/[^/%]+$/

function normalizedPathname(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname
}

function isApprovedV2MtmMobilePath(pathname: string): boolean {
  const normalized = normalizedPathname(pathname)
  return V2_MTM_MOBILE_EXACT_PATHS.has(normalized) || V2_MTM_MOBILE_DETAIL_PATH.test(normalized)
}

export function isMtmApiPath(pathname: string): boolean {
  return pathname.startsWith(LEGACY_MTM_API_PREFIX) || isApprovedV2MtmMobilePath(pathname)
}

export function isMtmMobileApiPath(pathname: string): boolean {
  return pathname.startsWith(LEGACY_MTM_MOBILE_API_PREFIX) || isApprovedV2MtmMobilePath(pathname)
}
