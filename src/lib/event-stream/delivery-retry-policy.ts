/**
 * G6 delivery-retry-policy — slice-1 pure helper.
 *
 * Given a failed delivery attempt's `attemptNumber` + the subscription's
 * `maxAttempts` + a retry-policy config, decide:
 *   • Should we retry (or escalate to dead-letter)?
 *   • If retry: what's the next-attempt delay in ms?
 *
 * Slice-2 dispatcher reads the result, schedules the next attempt, and
 * either retries or inserts a dead-letter row.
 */

import {
  DEFAULT_RETRY_POLICY,
  type RetryPolicyConfig,
} from "./types"

export interface RetryDecision {
  /** true = schedule another attempt; false = escalate to dead-letter. */
  shouldRetry: boolean
  /** Delay in ms before the next attempt. 0 if shouldRetry=false. */
  delayMs: number
  /** Computed attempt number for the next try (current + 1). */
  nextAttemptNumber: number
  /**
   * The raw (pre-jitter, pre-cap) exponential delay — exposed for slice-2
   * observability + slice-1 testing.
   */
  rawDelayMs: number
}

export interface RetryDecisionInput {
  /** The attempt that just failed (1-based). */
  failedAttemptNumber: number
  /** Subscription's configured cap. */
  maxAttempts: number
  /** Policy config (defaults filled). */
  config?: Partial<RetryPolicyConfig>
  /**
   * Optional jitter sample in [0, 1). Slice-2 dispatcher passes Math.random()
   * (or a seeded RNG for testing). Defaulted to 0 so tests with `jitter:
   * "none"` are deterministic.
   */
  jitterSample?: number
}

/**
 * Pure decision function — no clock dependency, no side effects.
 *
 * Math:
 *   rawDelayMs = initialDelayMs * (exponentBase ^ (failedAttemptNumber - 1))
 *   capped     = min(rawDelayMs, maxDelayMs)
 *   jittered   = applyJitter(capped, config.jitter, jitterSample)
 *
 * If failedAttemptNumber >= maxAttempts → shouldRetry: false (escalate).
 */
export function decideRetry(input: RetryDecisionInput): RetryDecision {
  const config: RetryPolicyConfig = {
    ...DEFAULT_RETRY_POLICY,
    ...input.config,
    // maxAttempts on the row wins over config default.
    maxAttempts: input.maxAttempts,
  }
  const failed = Math.max(1, Math.floor(input.failedAttemptNumber))
  const nextAttemptNumber = failed + 1

  // Exhausted?
  if (failed >= config.maxAttempts) {
    return {
      shouldRetry: false,
      delayMs: 0,
      nextAttemptNumber,
      rawDelayMs: 0,
    }
  }

  // Raw exponential.
  const rawDelayMs =
    config.initialDelayMs * Math.pow(config.exponentBase, failed - 1)
  const capped = Math.min(rawDelayMs, config.maxDelayMs)
  const jitterSample = clamp01(input.jitterSample ?? 0)
  const jittered = applyJitter(capped, config.jitter, jitterSample)

  return {
    shouldRetry: true,
    delayMs: Math.max(0, Math.round(jittered)),
    nextAttemptNumber,
    rawDelayMs: Math.round(rawDelayMs),
  }
}

/**
 * Apply jitter to a delay. Exported so slice-2 can re-use for non-event
 * retry scenarios (and so tests can hit it directly).
 */
export function applyJitter(
  delayMs: number,
  strategy: RetryPolicyConfig["jitter"],
  sample01: number,
): number {
  switch (strategy) {
    case "none":
      return delayMs
    case "full":
      // Uniform in [0, delay].
      return sample01 * delayMs
    case "equal":
      // delay/2 + uniform [0, delay/2] — keeps a minimum wait.
      return delayMs / 2 + sample01 * (delayMs / 2)
    default:
      return delayMs
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value >= 1) return 0.999_999
  return value
}
