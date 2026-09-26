import type { Prisma } from "@prisma/client"
import { coerceMtmBooleanSetting } from "@/lib/mtm/setting-values"

/**
 * One geofence rule for every check-in writer: web POST /visits, the PWA
 * outbox (sync/push) and the native engine (mobile/sync/push).
 *
 * Before this module the two sync paths clamped the radius to 25..10000 m
 * (anything else → 100 m) while the web form used the raw value, so the same
 * customer with a stored radius of 5 m refused a check-in on the web and
 * accepted it from the phone; an out-of-range value on the phone became 100 m. The sync paths also created OUT_OF_ZONE alerts
 * even when the organization had turned `alertOutOfZone` off.
 */

export const MIN_CHECK_IN_GEOFENCE_RADIUS_METERS = 25
export const MAX_CHECK_IN_GEOFENCE_RADIUS_METERS = 10_000
export const FALLBACK_CHECK_IN_GEOFENCE_RADIUS_METERS = 100

/**
 * Radius actually enforced. A usable value is clamped to the NEAREST bound
 * (5 m → 25 m, 20 000 m → 10 000 m), so an old wide zone stays as wide as the
 * system allows instead of collapsing to 100 m. Only a missing, non-numeric or
 * non-positive value falls back to 100 m.
 */
export function clampCheckInGeofenceRadius(value: unknown): number {
  if (value == null || value === "") return FALLBACK_CHECK_IN_GEOFENCE_RADIUS_METERS
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return FALLBACK_CHECK_IN_GEOFENCE_RADIUS_METERS
  return Math.min(MAX_CHECK_IN_GEOFENCE_RADIUS_METERS, Math.max(MIN_CHECK_IN_GEOFENCE_RADIUS_METERS, parsed))
}

/** True when a stored radius is set but outside what check-in enforces. */
export function geofenceRadiusOutOfRange(value: number | null | undefined): boolean {
  return typeof value === "number" && (value < MIN_CHECK_IN_GEOFENCE_RADIUS_METERS || value > MAX_CHECK_IN_GEOFENCE_RADIUS_METERS)
}

/**
 * F-22: the customer's own radius wins, the organization setting otherwise —
 * then the shared clamp. `null`/`undefined` customer radius means "not set".
 */
export function checkInGeofenceRadius(customerRadius: unknown, organizationRadius: unknown): number {
  return clampCheckInGeofenceRadius(customerRadius != null ? customerRadius : organizationRadius)
}

type SettingReader = Pick<Prisma.TransactionClient, "mtmSetting">

export interface MtmVisitPlaceSnapshot {
  checkInCustomerLat: number | null
  checkInCustomerLng: number | null
  checkInGeofenceRadius: number
}

/**
 * What a new visit stores about where it was supposed to happen: the
 * customer's pin and the enforced zone at check-in. 2026-09-15: moving a
 * customer's pin turned two finished visits from «Zonada 44 m» into
 * «Zonadan kənar 10.5 km», because every page measured old visits against the
 * current pin. `organizationRadius` skips the setting read when the caller
 * already has it.
 */
export async function mtmVisitPlaceSnapshot(
  client: SettingReader,
  organizationId: string,
  customer: { latitude: number | null; longitude: number | null; geofenceRadius: number | null },
  organizationRadius?: unknown,
): Promise<MtmVisitPlaceSnapshot> {
  let orgRadius = organizationRadius
  if (customer.geofenceRadius == null && orgRadius === undefined) {
    const setting = await client.mtmSetting.findFirst({
      where: { organizationId, key: "geofenceRadius" },
      select: { value: true },
    })
    orgRadius = setting?.value
  }
  return {
    checkInCustomerLat: customer.latitude,
    checkInCustomerLng: customer.longitude,
    checkInGeofenceRadius: Math.round(checkInGeofenceRadius(customer.geofenceRadius, orgRadius)),
  }
}

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
    cached = coerceMtmBooleanSetting(row?.value, true)
    return cached
  }
}
