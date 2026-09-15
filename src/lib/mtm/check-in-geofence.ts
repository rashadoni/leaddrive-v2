import type { Prisma } from "@prisma/client"

/**
 * One geofence rule for every check-in writer: web POST /visits, the PWA
 * outbox (sync/push) and the native engine (mobile/sync/push).
 *
 * Before this module the two sync paths clamped the radius to 25..10000 m
 * (anything else → 100 m) while the web form used the raw value, so the same
 * customer with a stored radius of 5 m refused a check-in on the web and
 * accepted it from the phone. The sync paths also created OUT_OF_ZONE alerts
 * even when the organization had turned `alertOutOfZone` off.
 */

export const MIN_CHECK_IN_GEOFENCE_RADIUS_METERS = 25
export const MAX_CHECK_IN_GEOFENCE_RADIUS_METERS = 10_000
export const FALLBACK_CHECK_IN_GEOFENCE_RADIUS_METERS = 100

/** Radius actually enforced: a number in 25..10000 m, otherwise the 100 m fallback. */
export function clampCheckInGeofenceRadius(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed)
    && parsed >= MIN_CHECK_IN_GEOFENCE_RADIUS_METERS
    && parsed <= MAX_CHECK_IN_GEOFENCE_RADIUS_METERS
    ? parsed
    : FALLBACK_CHECK_IN_GEOFENCE_RADIUS_METERS
}

/**
 * F-22: the customer's own radius wins, the organization setting otherwise —
 * then the shared clamp. `null`/`undefined` customer radius means "not set".
 */
export function checkInGeofenceRadius(customerRadius: unknown, organizationRadius: unknown): number {
  return clampCheckInGeofenceRadius(customerRadius != null ? customerRadius : organizationRadius)
}

/**
 * Stored boolean setting read strictly: only an explicit `false` / `"false"`
 * turns a default-on flag off. A missing row keeps the default.
 */
export function storedFlagEnabled(value: unknown, fallback: boolean): boolean {
  if (value === false || value === "false") return false
  if (value === true || value === "true") return true
  return fallback
}

type SettingReader = Pick<Prisma.TransactionClient, "mtmSetting">

/**
 * Per-request memo of `alertOutOfZone`. The row is read lazily — only when a
 * check-in actually lands outside the zone — and at most once per request,
 * through whichever (transaction) client is current at that moment. A failed
 * read is not cached, so it cannot poison later operations of the batch.
 */
export function createAlertOutOfZoneReader(organizationId: string) {
  let cached: boolean | undefined
  return async (client: SettingReader): Promise<boolean> => {
    if (cached !== undefined) return cached
    const row = await client.mtmSetting.findFirst({
      where: { organizationId, key: "alertOutOfZone" },
      select: { value: true },
    })
    cached = storedFlagEnabled(row?.value, true)
    return cached
  }
}
