/**
 * Customer coordinates: "no data" is `null` on both axes, never `0`.
 *
 * (0, 0) is Null Island in the Gulf of Guinea; nothing this product tracks is
 * there. Older imports and the field app used `0` as "unknown", which made the
 * web route map draw a marker in the ocean and the field app show "6745.7 km"
 * from Baku (field UX audit 2026-09-05, findings M-02 and W-09).
 *
 * The database now rejects the pair and any half-filled pair
 * (`mtm_customers_coordinates_check`). Every write path runs through
 * {@link normalizeMtmCoordinates} so the constraint is never hit by the app,
 * and the mobile read paths re-apply it so a row that predates the migration
 * cannot reach a client as a number.
 */
export type MtmCoordinateInput = { latitude?: number | null; longitude?: number | null }
export type MtmCoordinates = { latitude: number | null; longitude: number | null }
export type MtmKnownCoordinates = { latitude: number; longitude: number }

const NO_COORDINATES: Readonly<MtmCoordinates> = Object.freeze({ latitude: null, longitude: null })

function inRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
}

/**
 * Returns the pair as stored: both numbers, or both `null`. A missing axis,
 * a non-finite value, an out-of-range value, or the (0, 0) pair all mean
 * "coordinates unknown".
 */
export function normalizeMtmCoordinates(input: MtmCoordinateInput | null | undefined): MtmCoordinates {
  if (!input) return { ...NO_COORDINATES }
  const { latitude, longitude } = input
  if (!inRange(latitude, -90, 90) || !inRange(longitude, -180, 180)) return { ...NO_COORDINATES }
  if (latitude === 0 && longitude === 0) return { ...NO_COORDINATES }
  return { latitude, longitude }
}

/** True when the row carries a usable pair after normalization. */
export function hasMtmCoordinates<T extends MtmCoordinateInput>(input: T | null | undefined): input is T & MtmKnownCoordinates {
  return normalizeMtmCoordinates(input).latitude !== null
}

/** Copies the row with its coordinate pair normalized; other fields are untouched. */
export function withNormalizedCoordinates<T extends MtmCoordinateInput>(row: T): T & MtmCoordinates {
  return { ...row, ...normalizeMtmCoordinates(row) }
}
