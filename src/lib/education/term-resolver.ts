/**
 * Term resolver — R10 slice 1.
 *
 * Given a tenant's calendar of terms + an "as of" timestamp, return:
 *   • current      — the term whose [startDate, endDate] contains asOf
 *   • registrationOpen — terms whose registration window contains asOf
 *   • upcoming     — terms starting AFTER asOf, sorted earliest-first
 *   • past         — terms ending BEFORE asOf, sorted latest-first
 *
 * Caller pre-fetches the term calendar; helper does NOT query the DB.
 *
 * Pure synchronous.
 */
import type { ResolveTermInput, ResolveTermResult, TermWindow } from "./types"

function isFiniteDate(d: unknown): d is Date {
  return d instanceof Date && Number.isFinite(d.getTime())
}

export function resolveTerms(input: ResolveTermInput): ResolveTermResult {
  if (!isFiniteDate(input.asOf)) {
    return { current: null, registrationOpen: [], upcoming: [], past: [] }
  }
  if (!Array.isArray(input.terms)) {
    return { current: null, registrationOpen: [], upcoming: [], past: [] }
  }

  const asOfMs = input.asOf.getTime()

  // Filter to terms with valid dates only — defensive against
  // mis-fetched rows.
  const validTerms = input.terms.filter(
    (t) =>
      isFiniteDate(t.startDate) &&
      isFiniteDate(t.endDate) &&
      t.endDate.getTime() > t.startDate.getTime()
  )

  // Current — startDate <= asOf < endDate AND status is in a "live"
  // state. `planning` terms whose dates have already passed are
  // intentionally NOT returned as current — admin hasn't moved the
  // term out of draft, so it shouldn't influence student-facing reads.
  // Same for `completed` (term is over even if asOf is somehow within
  // dates due to mis-edits). Architect-pass-1 close-out.
  //
  // Multiple-currents possible if calendar has overlapping terms (rare
  // but legal — e.g. main + summer); helper returns the FIRST one in
  // startDate-ascending order.
  const current = validTerms
    .filter(
      (t) =>
        t.startDate.getTime() <= asOfMs &&
        asOfMs < t.endDate.getTime() &&
        (t.status === "registration" || t.status === "active")
    )
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())[0] ?? null

  // Registration open — registration window contains asOf AND term
  // status is `registration`. Architect-pass-1 close-out: a `completed`
  // term with stale `registrationOpensAt`/`ClosesAt` legacy data must
  // NOT appear here; only an explicitly-in-registration term qualifies.
  // Either window endpoint can be null (open-ended).
  const registrationOpen = validTerms
    .filter((t) => {
      if (t.status !== "registration") return false
      const opens = t.registrationOpensAt?.getTime() ?? null
      const closes = t.registrationClosesAt?.getTime() ?? null
      if (opens !== null && asOfMs < opens) return false
      if (closes !== null && asOfMs >= closes) return false
      // If BOTH are null, registration window is considered "not
      // configured" and the term is NOT in the registrationOpen set.
      // Tenants opting out of explicit windows must set them to wide
      // bounds. See TermWindow JSDoc in types.ts.
      if (opens === null && closes === null) return false
      return true
    })
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())

  // Upcoming — startDate > asOf.
  const upcoming = validTerms
    .filter((t) => t.startDate.getTime() > asOfMs && t.status !== "cancelled")
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())

  // Past — endDate <= asOf.
  const past = validTerms
    .filter((t) => t.endDate.getTime() <= asOfMs && t.status !== "cancelled")
    .sort((a, b) => b.endDate.getTime() - a.endDate.getTime()) // latest-first

  return {
    current,
    registrationOpen,
    upcoming,
    past,
  }
}

/**
 * Convenience: find a term whose calendar window contains asOf, or
 * null if none.
 */
export function termContaining(
  terms: readonly TermWindow[],
  asOf: Date
): TermWindow | null {
  return resolveTerms({ terms, asOf }).current
}
