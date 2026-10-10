/**
 * Product withdrawal is independent of persisted tenant entitlements. Keep
 * Workforce source and history for extraction, but do not serve it from CRM.
 * Re-enabling it requires a reviewed release, never a tenant/admin toggle.
 */
const withdrawnCapabilities = new Set([
  "workforce-hrm",
  "attendance-qr",
  "attendance-device-trust",
])

export function isCrmCapabilityAvailable(capabilityId: string): boolean {
  return !withdrawnCapabilities.has(capabilityId)
}

const withdrawnPathPrefixes = [
  "/workforce",
  "/api/v1/workforce",
  "/api/v1/mtm/mobile/hrm",
  "/api/v1/mtm/mobile/attendance",
  "/api/v1/mtm/mobile/workday",
  "/api/v1/mtm/week/workday",
  "/api/v1/mtm/work-calendar",
  "/api/v1/mtm/operations/hrm",
  "/api/v2/mtm/mobile/sync/workforce",
  "/api/cron/workforce-no-show-review",
  ...Array.from(withdrawnCapabilities, (id) => `/marketplace/demo/${id}`),
]

export function isWithdrawnCrmPath(pathname: string): boolean {
  // App Router decodes route segments; encoded names must not bypass the gate.
  let decoded = pathname
  try { decoded = decodeURIComponent(pathname) } catch { /* Next rejects malformed route escapes. */ }
  return withdrawnPathPrefixes.some((prefix) => decoded === prefix || decoded.startsWith(`${prefix}/`))
}
