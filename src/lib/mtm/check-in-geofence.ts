import type { Prisma } from "@prisma/client"
import { calculateDistance } from "@/lib/geo-utils"
import { normalizeMtmCoordinates } from "@/lib/mtm/geo-coordinates"
import { coerceMtmBooleanSetting } from "@/lib/mtm/setting-values"
import { agentPermissionEnabled } from "@/lib/mtm/agent-permissions"

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

/**
 * Per-request memo of the organization's switch that lets a field agent check
 * in from outside the customer's zone (matrix row `checkInOutsideZone`).
 *
 * Owner, 2026-10-07: «нужна возможность отключения из настроек — если агент
 * не на месте, но мог делать чек-ин, и потом проверить». Read like
 * `alertOutOfZone`: lazily, only when a check-in actually lands outside the
 * zone, once per request, through whichever client is current. Anything but a
 * stored `true` keeps the zone a hard rule — a failed or odd read never opens
 * it.
 */
export function createOutsideZoneCheckInReader(organizationId: string) {
  let cached: boolean | undefined
  return async (client: SettingReader): Promise<boolean> => {
    if (cached !== undefined) return cached
    const row = await client.mtmSetting.findFirst({
      where: { organizationId, key: "agentCheckInOutsideZone" },
      select: { value: true },
    })
    cached = agentPermissionEnabled(
      { agentCheckInOutsideZone: coerceMtmBooleanSetting(row?.value, false) },
      "checkInOutsideZone",
    )
    return cached
  }
}

/** The place a waiting «Клиент здесь» request names, and how far from it the check-in was made. */
export interface WaitingLocationPlace {
  /** The request the visit leans on. */
  id: string
  latitude: number
  longitude: number
  distanceMeters: number
}

type WaitingLocationReader = Pick<Prisma.TransactionClient, "mtmCustomerLocationRequest" | "mtmSetting">

/**
 * «Клиент здесь», while the request waits.
 *
 * An agent who has told a manager «the customer is not where its pin stands —
 * it is here» is at the customer, and the pin he would be measured against is
 * the very thing he reported as wrong. Until 2026-10-12 he was refused (too
 * far, or no pin at all) and could not start the visit he had come for until
 * a manager answered.
 *
 * The owner's decision that day: let him in, and show a manager such a visit
 * as what it is — «адрес на проверке». So this answers one narrow question
 * for all three check-in writers alike: is this check-in made by the agent
 * who sent the waiting request about this customer, from within the
 * customer's zone around the place the request names? If so the visit is
 * accepted and carries the request's id (`MtmVisit.locationRequestId`).
 *
 * What it deliberately does not do:
 *  - it does not move the pin: the visit keeps the customer's real pin in its
 *    place snapshot, so every page goes on reading «вне зоны N км» for it
 *    until a manager accepts the request (the decision route then rewrites
 *    the snapshot of exactly these visits);
 *  - it covers nobody else: a colleague at the same door is measured against
 *    the pin as it stands;
 *  - it covers no check-in without a position, and none outside the zone
 *    around the proposed place — the request names a door, not a district.
 *
 * Asked only where a check-in is about to be refused or flagged — a customer
 * with no pin, or a position outside the zone — so an ordinary check-in costs
 * no extra query.
 */
export async function waitingLocationRequestCovers(
  client: WaitingLocationReader,
  input: {
    organizationId: string
    customerId: string
    agentId: string
    latitude: unknown
    longitude: unknown
    customerRadius: number | null | undefined
    /** Skips the setting read when the caller already has it. */
    organizationRadius?: unknown
  },
): Promise<WaitingLocationPlace | null> {
  const fix = normalizeMtmCoordinates({
    latitude: typeof input.latitude === "number" ? input.latitude : null,
    longitude: typeof input.longitude === "number" ? input.longitude : null,
  })
  if (fix.latitude === null || fix.longitude === null) return null
  const request = await client.mtmCustomerLocationRequest.findFirst({
    where: {
      organizationId: input.organizationId,
      customerId: input.customerId,
      requestedByAgentId: input.agentId,
      status: "SUBMITTED",
    },
    select: { id: true, proposedLatitude: true, proposedLongitude: true },
  })
  if (!request) return null
  let organizationRadius = input.organizationRadius
  if (input.customerRadius == null && organizationRadius === undefined) {
    const setting = await client.mtmSetting.findFirst({
      where: { organizationId: input.organizationId, key: "geofenceRadius" },
      select: { value: true },
    })
    organizationRadius = setting?.value
  }
  const radius = checkInGeofenceRadius(input.customerRadius, organizationRadius)
  const distance = calculateDistance(fix.latitude, fix.longitude, request.proposedLatitude, request.proposedLongitude)
  if (distance > radius) return null
  return { id: request.id, latitude: request.proposedLatitude, longitude: request.proposedLongitude, distanceMeters: Math.round(distance) }
}
