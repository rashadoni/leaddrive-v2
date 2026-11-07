/**
 * The picture a service shows on its public page.
 *
 * It is stored as a path, not an address: the column may only ever name a file
 * this CRM wrote into its own public uploads directory. A service that could
 * carry any URL would let an administrator put a third party's tracking pixel —
 * or something worse — on a page their customers open without signing in, and
 * the page would load it from there on every visit.
 *
 * The directory is public on purpose, like logos and e-mail images: the people
 * who open a booking link are not signed in, so a sealed file would show them
 * nothing. It is listed in `PLAIN_BY_DESIGN` in the uploads mirror for exactly
 * that reason — otherwise the host watchdog would report it as a leak.
 */

export const BOOKING_PHOTO_DIRECTORY = "booking-photos"

/** `/uploads/booking-photos/<name>.<png|jpg|jpeg|webp>` and nothing else. */
const PHOTO_PATH = /^\/uploads\/booking-photos\/[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.(png|jpe?g|webp)$/

/**
 * The value as the column may hold it. Anything else — an address somewhere
 * else, a path that climbs out of the directory, a data: URI — is no picture
 * at all, and the service shows none.
 */
export function bookingPhotoPath(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.includes("..") || trimmed.includes("\\")) return null
  return PHOTO_PATH.test(trimmed) ? trimmed : null
}
