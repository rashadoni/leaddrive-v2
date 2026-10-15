/**
 * A GPS fix's speed as the whole km/h every screen shows.
 *
 * `mtm_agent_locations.speed` is stored in km/h. Android measures m/s
 * (`Location.getSpeed()`), and the field app multiplies by 3.6 before it
 * uploads — `uploadPosition` in leaddrive-mtm
 * `MTMobileApp/src/services/location.android.ts`, and so since the app's first
 * commit; no write path of the server converts it again. Production agrees
 * (2026-10-15, read only): on 902 pairs of consecutive fixes of one agent,
 * 10–90 s apart, both within 25 m and covering at least 15 km/h, the stored
 * speed divided by distance over time in km/h has a median of 1.002 (quartiles
 * 0.91 and 1.09) — in September and October, on both app versions in use. In
 * m/s it would be 0.28.
 *
 * History alone read the field as m/s and multiplied it by 3.6 again: a
 * 52 km/h drive showed as 187.9 km/h, while the live map's list said 52. The
 * screens also rounded differently (whole numbers, one decimal). Every screen
 * now takes the number from here, so one fix reads the same everywhere.
 *
 * `null` when the fix has no usable speed; the server refuses a negative one.
 */
export function mtmSpeedKmh(speed: number | null | undefined): number | null {
  if (typeof speed !== "number" || !Number.isFinite(speed) || speed < 0) return null
  return Math.round(speed)
}
