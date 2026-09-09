/**
 * Dunning scheduler — D4 slice 1.
 *
 * Given an attempt number (1-indexed) and an initial-failure
 * timestamp, returns when the next retry should fire AND whether
 * this is the final allowed attempt. Slice-3 cron consumes:
 *   - scheduledAt ≤ now() AND attemptedAt IS NULL → fire the retry
 *   - if final && payment fails → auto-cancel + emit "dunning_failed"
 *     and "cancelled" events
 *
 * The retry delays come from a config (defaults to industry-common
 * 1/3/7/14-day cascade). Tenant-custom policies override via
 * DunningConfig.retryDelayDays.
 *
 * Rejects:
 *   - attemptNumber < 1 — invalid index
 *   - attemptNumber > config.retryDelayDays.length — past the cap
 *   - retryDelayDays empty — no retries configured
 *   - retryDelayDays contains non-positive entry — would schedule a
 *     retry in the past
 *
 * Pure synchronous. Caller writes the resulting DunningAttempt row.
 */
import {
  DEFAULT_DUNNING_CONFIG,
  type ScheduleDunningInput,
  type ScheduleDunningResult,
} from "./types"

const MS_PER_DAY = 24 * 60 * 60 * 1000

export function scheduleNextDunningAttempt(
  input: ScheduleDunningInput
): ScheduleDunningResult {
  const { attemptNumber, initialFailureAt } = input
  const config = input.config ?? DEFAULT_DUNNING_CONFIG

  if (!Number.isInteger(attemptNumber) || attemptNumber < 1) {
    return {
      ok: false,
      error: `Invalid attemptNumber ${attemptNumber} — must be a positive integer`,
    }
  }

  if (config.retryDelayDays.length === 0) {
    return {
      ok: false,
      error: "Dunning config has empty retryDelayDays — no retries configured",
    }
  }

  if (attemptNumber > config.retryDelayDays.length) {
    return {
      ok: false,
      error: `Attempt ${attemptNumber} exceeds configured maximum ${config.retryDelayDays.length}`,
    }
  }

  for (let i = 0; i < config.retryDelayDays.length; i++) {
    const d = config.retryDelayDays[i]
    if (!Number.isFinite(d) || d <= 0) {
      return {
        ok: false,
        error: `Dunning config retryDelayDays[${i}] = ${d} must be a positive finite number`,
      }
    }
  }

  // Each delay is measured from the ORIGINAL failure, not the
  // previous attempt — matches Stripe + most SaaS conventions.
  // Cumulative-from-previous-attempt semantics would compound clock
  // drift if a cron skipped a window; absolute-from-anchor is the
  // safer model.
  const delayDays = config.retryDelayDays[attemptNumber - 1]
  const scheduledAt = new Date(initialFailureAt.getTime() + delayDays * MS_PER_DAY)
  const isFinalAttempt = attemptNumber === config.retryDelayDays.length

  return { ok: true, scheduledAt, isFinalAttempt }
}
