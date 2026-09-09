/**
 * B10 milestone-due-calculator — slice-1 pure helper.
 *
 * Given a milestone definition + ticket creation time + ticket severity,
 * compute when the milestone should be considered due.
 *
 * Math:
 *   anchor = anchorTime ?? ticketCreatedAt
 *   multiplier = multiplierOverride ?? SEVERITY_DUE_MULTIPLIERS[severity]
 *   effective = definition.dueWithinSeconds * multiplier
 *   dueAt = anchor + effective seconds
 *
 * Pure function: no DB, no clock.
 *
 * NOTE: Slice-1 uses naive 24x7 wall-clock math. Slice-2 will wire the
 * existing `SlaPolicy.businessHoursOnly` flag — when set, the math
 * needs a business-hours calendar (Mon-Fri 9-18 or per-tenant config)
 * and `dueAt` becomes "now + N business seconds". Documented here as
 * an explicit slice-2 deferral.
 */

import {
  SEVERITY_DUE_MULTIPLIERS,
  type MilestoneDueCalcInput,
  type MilestoneDueResult,
} from "./types"

/**
 * Compute the dueAt timestamp for a milestone.
 *
 * `appliesTo` is true when:
 *   • definition.severityTier === null (definition applies to all severities), OR
 *   • definition.severityTier === input.ticketSeverity (exact match)
 *
 * Slice-2 cron uses `appliesTo` to pick the most-specific definition
 * when multiple definitions exist for the same type but different
 * severity tiers.
 */
export function calculateMilestoneDue(
  input: MilestoneDueCalcInput,
): MilestoneDueResult {
  const { definition, ticketCreatedAt, ticketSeverity } = input
  const anchor = input.anchorTime ?? ticketCreatedAt

  // Defensive: invalid dueWithinSeconds → fallback to base (validated
  // at DB CHECK > 0 but defense-in-depth here too).
  const baseSeconds =
    Number.isFinite(definition.dueWithinSeconds) &&
    definition.dueWithinSeconds > 0
      ? definition.dueWithinSeconds
      : 0

  // Multiplier: explicit override → severity-based default → 1.0 fallback.
  let multiplier: number
  if (
    typeof input.multiplierOverride === "number" &&
    Number.isFinite(input.multiplierOverride) &&
    input.multiplierOverride > 0
  ) {
    multiplier = input.multiplierOverride
  } else {
    multiplier = SEVERITY_DUE_MULTIPLIERS[ticketSeverity] ?? 1.0
  }

  const effectiveDueWithinSeconds = Math.round(baseSeconds * multiplier)
  const dueAt = new Date(anchor.getTime() + effectiveDueWithinSeconds * 1000)

  const appliesTo =
    definition.severityTier === null ||
    definition.severityTier === undefined ||
    definition.severityTier === ticketSeverity

  return {
    dueAt,
    effectiveDueWithinSeconds,
    appliesTo,
  }
}

/**
 * Pure helper for slice-2: given a list of definitions of the same type
 * but different severity tiers, pick the most-specific match for a ticket.
 *
 * Specificity: definition with EXACT severityTier match wins; falls
 * back to the NULL-severity (catch-all) definition; returns null if
 * neither found.
 */
export function pickMostSpecificDefinition<
  T extends { severityTier?: string | null },
>(
  definitions: ReadonlyArray<T>,
  ticketSeverity: string,
): T | null {
  if (definitions.length === 0) return null
  // Exact-severity match wins.
  for (const def of definitions) {
    if (def.severityTier === ticketSeverity) return def
  }
  // Catch-all (NULL severity).
  for (const def of definitions) {
    if (def.severityTier === null || def.severityTier === undefined) {
      return def
    }
  }
  return null
}
