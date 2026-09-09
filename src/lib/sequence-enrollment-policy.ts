/**
 * E6 (Creatio 10X roadmap) — one active enrollment per person.
 *
 * When Organization.settings.sequenceSingleActiveEnrollment is on, a
 * contact/lead may sit in at most ONE active (or paused) sequence at a time —
 * enrolling them into a second is refused with a clear error. Off by default
 * (a person can be in several cadences at once, the pre-E6 behavior).
 */
export function readSingleActiveEnrollment(settings: unknown): boolean {
  if (!settings || typeof settings !== "object") return false
  return (settings as Record<string, unknown>).sequenceSingleActiveEnrollment === true
}
