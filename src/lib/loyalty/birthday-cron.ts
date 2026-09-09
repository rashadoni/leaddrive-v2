/**
 * D8 Loyalty — birthday auto-earn cron helper.
 *
 * For a single org + a `now` clock: find every contact whose `dateOfBirth`
 * month+day equals today's, and award the active `birthday` earn rule via the
 * shared `applyAutoEarn` pipeline (so tier-recalc, expiry stamping, the CAS
 * write, and the audit row are identical to every other earn path).
 *
 * Idempotency: the referenceId is `birthday:<contactId>:<year>` → each member
 * gets the bonus at most once per calendar year, backed by applyAutoEarn's
 * pre-check + the partial unique index on (org, 'earn', referenceId). Re-running
 * the cron the same day is a no-op.
 *
 * Gated by `requireAutoEarnEnabled: true` — applyAutoEarn no-ops unless the
 * tenant set `settings.loyaltyAutoEarn`. Takes `orgId` explicitly + scopes every
 * query by it, so it is safe under the cron's `runWithRlsBypass` (the raw
 * birthday query bypasses RLS, hence the explicit `organizationId` filter).
 *
 * Caveats (MVP, documented):
 *   - Match is on the UTC date (`now.getUTC*`) vs `EXTRACT(... FROM dateOfBirth)`
 *     — consistent, but a member in a far timezone may be awarded ±1 calendar
 *     day from their local date.
 *   - Feb-29 birthdays only match in leap years (no Feb-29 → no award that year).
 */
import { applyAutoEarn } from "./auto-earn"

/** Same loosely-typed RLS-extended client applyAutoEarn takes. */
type BirthdayPrismaClient = (typeof import("@/lib/prisma"))["prisma"]

export interface BirthdayCronResult {
  /** Contacts whose birth month+day == today. */
  contactsMatched: number
  /** Members credited this run. */
  awarded: number
  /** Members already credited this year (idempotent no-op). */
  alreadyAwarded: number
  /** No matching/active birthday rule, auto-earn off, or rounded to 0. */
  skipped: number
  /** applyAutoEarn returned status:"error" or threw. */
  errors: number
  /** Total points awarded across all matched members this run. */
  totalPoints: number
}

export async function runLoyaltyBirthday(
  prisma: BirthdayPrismaClient,
  orgId: string,
  now: Date,
): Promise<BirthdayCronResult> {
  const result: BirthdayCronResult = {
    contactsMatched: 0,
    awarded: 0,
    alreadyAwarded: 0,
    skipped: 0,
    errors: 0,
    totalPoints: 0,
  }

  const month = now.getUTCMonth() + 1 // 1-12
  const day = now.getUTCDate() // 1-31
  const year = now.getUTCFullYear()

  // Org-scoped raw match (parameterized — no injection). The cron runs under
  // runWithRlsBypass, so RLS does NOT auto-scope; the WHERE does it explicitly.
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "contacts"
    WHERE "organizationId" = ${orgId}
      AND "dateOfBirth" IS NOT NULL
      AND EXTRACT(MONTH FROM "dateOfBirth") = ${month}
      AND EXTRACT(DAY FROM "dateOfBirth") = ${day}
  `
  result.contactsMatched = rows.length
  if (rows.length === 0) return result

  for (const { id: contactId } of rows) {
    try {
      const r = await applyAutoEarn(prisma, {
        orgId,
        contactId,
        trigger: "birthday",
        orderAmount: 0, // birthday rules are flat (pointsFlat)
        referenceId: `birthday:${contactId}:${year}`,
        reason: "Birthday bonus",
        requireAutoEarnEnabled: true,
        now,
      })
      if (r.status === "earned") {
        result.awarded++
        result.totalPoints += r.earned
      } else if (r.status === "no_op" && r.reason === "already_awarded") {
        result.alreadyAwarded++
      } else if (r.status === "no_op") {
        result.skipped++ // no_matching_rule | auto_earn_disabled | rounded_to_zero | contact_not_found
      } else {
        result.errors++ // status === "error"
      }
    } catch (e) {
      console.error(`[loyalty-birthday] contact ${contactId} (org ${orgId}) error:`, e)
      result.errors++
    }
  }

  return result
}
