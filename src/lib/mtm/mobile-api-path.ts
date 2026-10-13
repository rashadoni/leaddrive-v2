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
  // Attendance belongs to Route & Field. The old /mobile/attendance prefix
  // stays withdrawn with Workforce HRM and cannot serve these handlers.
  "/api/v2/mtm/mobile/route-field/attendance/requests",
  "/api/v2/mtm/mobile/route-field/attendance/request-limits",
  "/api/v2/mtm/mobile/route-field/attendance/attachments",
  "/api/v2/mtm/mobile/route-field/attendance/location-consent",
  "/api/v2/mtm/mobile/route-field/attendance/installation",
  "/api/v2/mtm/mobile/route-field/contact-create-requests",
  "/api/v2/mtm/mobile/route-field/contacts",
  "/api/v2/mtm/mobile/route-field/device-tokens",
  "/api/v2/mtm/mobile/route-field/organizations",
  "/api/v2/mtm/mobile/route-field/planning-targets",
  // The employee returns to the workday they closed earlier today. Not under
  // /api/v1/mtm/mobile/workday: that prefix belongs to the withdrawn HRM and
  // the proxy answers 410 there.
  "/api/v2/mtm/mobile/route-field/workday-return",
  "/api/v2/mtm/mobile/sync/routes",
  "/api/v2/mtm/mobile/sync/tasks",
  "/api/v2/mtm/mobile/sync/visits",
  "/api/v2/mtm/mobile/sync/workforce",
])
const V2_MTM_MOBILE_DETAIL_PATH = /^\/api\/v2\/mtm\/mobile\/route-field\/(?:contacts|organizations)\/[^/%]+$/
const V2_MTM_MOBILE_ATTENDANCE_DETAIL_PATH = /^\/api\/v2\/mtm\/mobile\/route-field\/attendance\/(?:requests|attachments)\/[^/%]+$/
// An agent's change request on one client. Without this line the proxy sends
// the app's POST to /login (307): the handler was live on production for an
// hour on 2026-10-04 and unreachable.
const V2_MTM_MOBILE_CONTACT_CHANGE_REQUEST_PATH = /^\/api\/v2\/mtm\/mobile\/route-field\/contacts\/[^/%]+\/change-requests$/
// «Клиент здесь»: an agent's request, sent from the spot, to move one
// organization's pin (and its withdrawal). The same lesson as above — a
// handler the proxy does not admit answers the app with a redirect to /login.
const V2_MTM_MOBILE_ORGANIZATION_LOCATION_REQUEST_PATH = /^\/api\/v2\/mtm\/mobile\/route-field\/organizations\/[^/%]+\/location-request$/

function normalizedPathname(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname
}

function isApprovedV2MtmMobilePath(pathname: string): boolean {
  const normalized = normalizedPathname(pathname)
  return V2_MTM_MOBILE_EXACT_PATHS.has(normalized)
    || V2_MTM_MOBILE_DETAIL_PATH.test(normalized)
    || V2_MTM_MOBILE_ATTENDANCE_DETAIL_PATH.test(normalized)
    || V2_MTM_MOBILE_CONTACT_CHANGE_REQUEST_PATH.test(normalized)
    || V2_MTM_MOBILE_ORGANIZATION_LOCATION_REQUEST_PATH.test(normalized)
}

export function isMtmApiPath(pathname: string): boolean {
  return pathname.startsWith(LEGACY_MTM_API_PREFIX) || isApprovedV2MtmMobilePath(pathname)
}

export function isMtmMobileApiPath(pathname: string): boolean {
  return pathname.startsWith(LEGACY_MTM_MOBILE_API_PREFIX) || isApprovedV2MtmMobilePath(pathname)
}
