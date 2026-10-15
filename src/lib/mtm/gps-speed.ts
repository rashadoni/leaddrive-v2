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

/**
 * From this speed on, as the screens show it, a fix is «moving»; below it the
 * phone is standing. Owner, 2026-10-15: «3 км/ч».
 *
 * Every reading of «moving» takes it from here: the flag both mobile write
 * paths store, the live status («В пути» / «Стоит») and the stop it keeps
 * («стоит N минут»), the list's speed filter and the ETA. Until then there
 * were three lines for one idea — the writers and the status said above 1
 * km/h (the comments called it 1 m/s, but the stored unit is km/h), the list
 * said above 2.
 *
 * Production, 2026-10-15 (read only, 30 days, real phones): each fix's speed
 * against how far the phone actually went between its neighbours, about 30 s
 * either side. At 1–2 km/h the median track speed was 0.3 km/h — a standing
 * phone's GPS jitter; at 2–3 km/h still mostly standing; from 3 km/h it was
 * 2.6–3.7 km/h, a walk. Above 1 km/h every standing employee flipped to
 * «В пути», and his «стоит N минут» restarted, some 50 times a day; from
 * 3 km/h as shown (2.5 stored) it is some 17. A line at 3.0 stored would make
 * it 12, but then a fix shown as «3 km/h» would read «standing» beside it.
 *
 * A slower walk is not lost: a step 50 m away from where the stop began
 * starts a new one, and the status counts any 50 m within five minutes as
 * movement (src/lib/mtm/live-field-status.ts).
 */
export const MTM_MOVING_FROM_KMH = 3

/**
 * The same line on the stored, unrounded column, for a database filter: the
 * screens round, and 2.5 already reads «3 km/h». {@link mtmSpeedMoving} is
 * true exactly from here — a fix shown as «3 km/h» never reads «standing».
 */
export const MTM_MOVING_MIN_STORED_SPEED = MTM_MOVING_FROM_KMH - 0.5

/** Does this speed say the phone is moving? No usable speed says it is not. */
export function mtmSpeedMoving(speed: number | null | undefined): boolean {
  const kmh = mtmSpeedKmh(speed)
  return kmh != null && kmh >= MTM_MOVING_FROM_KMH
}
