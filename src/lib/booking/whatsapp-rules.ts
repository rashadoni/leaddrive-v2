/**
 * When the WhatsApp agent may book by itself, and when a person decides.
 *
 * The salon's consent is given once, as a rule — «these services, these
 * masters, these hours, up to this much: book them yourself» — and not asked
 * again for every client. Asking each time would leave the client waiting for
 * a human anyway, and the administrator would trade writing an answer for
 * pressing a button: the whole saving, gone.
 *
 * So the rules never make the agent slower or quieter. It finds free time and
 * offers it exactly as before; what the rules decide is what happens when the
 * client taps — a meeting, or a request the salon confirms, with the time held
 * meanwhile so nobody loses the chair while they decide.
 *
 * Every field is a narrowing. An empty rule set means «everything» — exactly
 * the behaviour of an organization that never opened this screen.
 */
import { WEEKDAYS, minutesOfDay, type Weekday, type WeeklyHours } from "./availability"

export interface AutonomyRules {
  /** Services the agent books itself; null = any service of the organization. */
  serviceIds: string[] | null
  /** Masters it books itself; null = any master the service allows. */
  hostIds: string[] | null
  /**
   * Hours the MEETING may fall in, on the salon's clock — not the hours the
   * agent works. An evening slot can be free and still be the administrator's
   * call.
   */
  hours: WeeklyHours | null
  /** Services dearer than this go to a person; null = no limit. */
  maxPrice: number | null
  /** Book a client the CRM has never seen before? */
  newClients: boolean
}

export const OPEN_RULES: AutonomyRules = { serviceIds: null, hostIds: null, hours: null, maxPrice: null, newClients: true }

/** Why a booking is the salon's call and not the agent's. */
export type AutonomyReason = "service" | "host" | "hours" | "price" | "new_client"

export type AutonomyVerdict =
  | { allowed: true }
  | { allowed: false; reason: AutonomyReason }

/** The candidate a verdict is about: one service, one master, one slot, one client. */
export interface AutonomyCandidate {
  serviceId: string
  hostId: string
  /** The slot's own weekday and minute of day on the salon's clock. */
  weekday: Weekday
  minuteOfDay: number
  durationMinutes: number
  /** The service's price in the organization's currency; null = none set. */
  price: number | null
  /** Has this phone been seen before — an earlier meeting or a contact? */
  knownClient: boolean
}

function list(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
  // An empty list would read as «no service at all», which no screen can mean:
  // the way to say «none» is to turn the agent off.
  return items.length ? [...new Set(items)].slice(0, 200) : null
}

function hours(value: unknown): WeeklyHours | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const result = {} as WeeklyHours
  let any = false
  for (const day of WEEKDAYS) {
    const raw = Array.isArray(record[day]) ? record[day] as unknown[] : []
    const intervals: { start: string; end: string }[] = []
    for (const item of raw.slice(0, 6)) {
      if (!item || typeof item !== "object") continue
      const { start, end } = item as Record<string, unknown>
      if (typeof start !== "string" || typeof end !== "string") continue
      const from = minutesOfDay(start), to = minutesOfDay(end)
      if (from === null || to === null || from >= to) continue
      intervals.push({ start, end })
      any = true
    }
    result[day] = intervals
  }
  // Nothing readable is «no restriction», not «never»: a malformed rule must
  // not quietly stop the agent from working.
  return any ? result : null
}

export function readAutonomyRules(value: unknown): AutonomyRules {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const price = typeof raw.maxPrice === "number" && Number.isFinite(raw.maxPrice) && raw.maxPrice >= 0 ? raw.maxPrice : null
  return {
    serviceIds: list(raw.serviceIds),
    hostIds: list(raw.hostIds),
    hours: hours(raw.hours),
    maxPrice: price,
    // Absent means yes: an organization that never opened this screen books
    // new clients exactly as it did before the rules existed.
    newClients: raw.newClients !== false,
  }
}

/** True when the rules narrow nothing — the agent decides every booking itself. */
export function rulesAreOpen(rules: AutonomyRules): boolean {
  return !rules.serviceIds && !rules.hostIds && !rules.hours && rules.maxPrice === null && rules.newClients
}

function insideHours(weekly: WeeklyHours, candidate: AutonomyCandidate): boolean {
  // The whole meeting has to fit: half of it inside the permitted hours is
  // still a meeting the salon wanted to see first.
  const end = candidate.minuteOfDay + candidate.durationMinutes
  return (weekly[candidate.weekday] ?? []).some((interval) => {
    const from = minutesOfDay(interval.start), to = minutesOfDay(interval.end)
    return from !== null && to !== null && candidate.minuteOfDay >= from && end <= to
  })
}

/**
 * May the agent book this one itself? The first rule that says no wins, and
 * its name is what the administrator reads on the request.
 */
export function autonomyVerdict(rules: AutonomyRules, candidate: AutonomyCandidate): AutonomyVerdict {
  if (rules.serviceIds && !rules.serviceIds.includes(candidate.serviceId)) return { allowed: false, reason: "service" }
  if (rules.hostIds && !rules.hostIds.includes(candidate.hostId)) return { allowed: false, reason: "host" }
  if (rules.hours && !insideHours(rules.hours, candidate)) return { allowed: false, reason: "hours" }
  // A service with no price set is not «free»: nobody said what it costs, so
  // a price limit cannot clear it.
  if (rules.maxPrice !== null && (candidate.price === null || candidate.price > rules.maxPrice)) return { allowed: false, reason: "price" }
  if (!rules.newClients && !candidate.knownClient) return { allowed: false, reason: "new_client" }
  return { allowed: true }
}
