/**
 * C7 send-outcome-classifier — slice-1 pure helper.
 *
 * Given the result of a channel-sender call (already invoked by slice-2
 * route), classify it into the canonical send_records outcome enum +
 * normalize the error message. Slice-2 dispatches via existing channel-
 * specific clients (sendEmail / sendSms / etc.) whose return shapes
 * differ — this helper unifies them.
 *
 * Pure function: no I/O.
 */

import { SEND_OUTCOMES, type SendOutcome } from "./types"

export interface SendResult {
  /**
   * Whether the channel client reported a successful handoff. Bounces
   * arrive asynchronously and are recorded by a separate path.
   */
  success: boolean
  /** Optional HTTP-style status code from the underlying transport. */
  statusCode?: number | null
  /** Underlying error message if `success === false`. */
  errorMessage?: string | null
  /** Optional flag: provider explicitly reported the recipient bounced. */
  reportedBounce?: boolean
}

export interface ClassifiedOutcome {
  outcome: SendOutcome
  errorMessage: string | null
}

/**
 * Map a raw send result to the canonical outcome.
 *
 *   reportedBounce=true → bounced
 *   success=false       → failed (errorMessage required by DB CHECK)
 *   success=true        → sent
 *
 * The errorMessage is normalized:
 *   • failed without explicit error → "channel sender returned failure
 *     (status N)" or "channel sender returned failure".
 *   • bounced with explicit error → "bounced: <error>"; without → "bounced".
 *   • sent → null.
 */
export function classifySendOutcome(result: SendResult): ClassifiedOutcome {
  if (result.reportedBounce) {
    const detail = result.errorMessage?.trim()
    return {
      outcome: "bounced",
      errorMessage: detail ? `bounced: ${detail}` : "bounced",
    }
  }
  if (!result.success) {
    const errMsg = result.errorMessage?.trim()
    if (errMsg && errMsg.length > 0) {
      return { outcome: "failed", errorMessage: errMsg }
    }
    if (typeof result.statusCode === "number") {
      return {
        outcome: "failed",
        errorMessage: `channel sender returned failure (status ${result.statusCode})`,
      }
    }
    return {
      outcome: "failed",
      errorMessage: "channel sender returned failure",
    }
  }
  return { outcome: "sent", errorMessage: null }
}

export function isSendOutcome(value: unknown): value is SendOutcome {
  return (
    typeof value === "string" && SEND_OUTCOMES.includes(value as SendOutcome)
  )
}
