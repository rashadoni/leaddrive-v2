/**
 * A class: one time, several customers.
 *
 * Everything else in this module treats a time as taken the moment one person
 * books it, because a chair holds one person. A yoga class, a workshop or a
 * group lesson is the other shape — the time stays open until the seats run
 * out, and every seat is the *same* class, so it is the same master.
 *
 * That second part is why a class cannot simply be «a service that allows
 * overlapping bookings»: eight seats spread over eight masters would be eight
 * private lessons at the same hour, which is the opposite of what the salon
 * sold.
 */

/** A class of more than fifty is a hall, and halls are booked another way. */
export const MAX_CAPACITY = 50

/** How many people this service takes at once; anything unreadable is one. */
export function serviceCapacity(page: { capacity?: number | null }): number {
  const capacity = typeof page.capacity === "number" ? Math.trunc(page.capacity) : 1
  if (!Number.isFinite(capacity) || capacity < 1) return 1
  return Math.min(capacity, MAX_CAPACITY)
}

/** Whether this service is a class rather than a one-to-one appointment. */
export function isGroupService(page: { capacity?: number | null }): boolean {
  return serviceCapacity(page) > 1
}

/** Seats still free, never below zero — an overbooked class is still full. */
export function seatsLeft(page: { capacity?: number | null }, taken: number): number {
  return Math.max(0, serviceCapacity(page) - Math.max(0, taken))
}

/**
 * The seats already taken, by the instant the class starts. The key is the
 * ISO instant, because that is what a slot carries and what the customer
 * tapped — not a local clock reading, which repeats itself twice a year.
 */
export function seatsByStart(bookings: readonly { startsAt: Date }[]): Map<string, number> {
  const seats = new Map<string, number>()
  for (const booking of bookings) {
    const key = booking.startsAt.toISOString()
    seats.set(key, (seats.get(key) ?? 0) + 1)
  }
  return seats
}
