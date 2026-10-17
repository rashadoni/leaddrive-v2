import { createHash } from "node:crypto"
import { canonicalJson } from "../../event-platform/canonical-json"
import {
  contractAssert, identifier, parseAcceptanceReceipt, parseSubmission,
  type AcceptanceReceipt, type ReceiverEnvironment, type Submission,
} from "./contract"

/** Loaded by a trusted server-side configuration owner, never from a CRM request body. */
export interface ReceiverBinding {
  integrationId: string
  organizationId: string
  environment: ReceiverEnvironment
  enabled: boolean
  contractApproved: boolean
}

export type DeliveryOutcome =
  | { status: "accepted_by_api"; receipt: AcceptanceReceipt }
  | { status: "rejected"; reason: "invalid_data" | "access_denied" | "contract_mismatch" | "conflict" }
  | { status: "unknown"; reason: "transport_error" | "invalid_receipt" | "receiver_error" | "unexpected_response" | "rate_limited" }

export function validateBinding(binding: ReceiverBinding, organizationId: string): void {
  identifier(binding.integrationId)
  identifier(binding.organizationId)
  contractAssert(binding.organizationId === identifier(organizationId))
  contractAssert(binding.environment === "TEST" || binding.environment === "PROD")
  contractAssert(binding.enabled === true && binding.contractApproved === true)
}

export function deliveryKey(binding: ReceiverBinding, submission: Submission): string {
  // Content is deliberately NOT in the key: changing the payload of an event
  // must raise a conflict, never masquerade as a new delivery.
  return createHash("sha256").update(canonicalJson([
    identifier(binding.organizationId), identifier(binding.integrationId),
    binding.environment, submission.resource, submission.envelope.eventId,
  ])).digest("hex")
}

export function prepareSubmission(binding: ReceiverBinding, organizationId: string, input: Submission) {
  validateBinding(binding, organizationId)
  const submission = parseSubmission(input.resource, input.envelope)
  const body = canonicalJson(submission.envelope)
  contractAssert(Buffer.byteLength(body, "utf8") <= 256 * 1024)
  return {
    submission, body, idempotencyKey: deliveryKey(binding, submission),
    payloadHash: createHash("sha256").update(body).digest("hex"),
    relativePath: `/integration/v1/${submission.resource}/${encodeURIComponent(submission.envelope.externalId)}`,
  }
}

/** Unknown outcomes must be reconciled, not turned into an automatic new send. */
export function classifyDeliveryResponse(
  submitted: Submission,
  response: { status: number; body: string } | null,
): DeliveryOutcome {
  if (response === null) return { status: "unknown", reason: "transport_error" }
  if (response.status >= 200 && response.status < 300) {
    try {
      contractAssert(Buffer.byteLength(response.body, "utf8") <= 16 * 1024)
      return { status: "accepted_by_api", receipt: parseAcceptanceReceipt(JSON.parse(response.body), submitted) }
    } catch {
      return { status: "unknown", reason: "invalid_receipt" }
    }
  }
  if (response.status === 400 || response.status === 422) return { status: "rejected", reason: "invalid_data" }
  if (response.status === 401 || response.status === 403) return { status: "rejected", reason: "access_denied" }
  if (response.status === 409) return { status: "rejected", reason: "conflict" }
  if ([404, 405, 413, 415].includes(response.status)) return { status: "rejected", reason: "contract_mismatch" }
  if (response.status === 429) return { status: "unknown", reason: "rate_limited" }
  if (response.status >= 500 && response.status <= 599) return { status: "unknown", reason: "receiver_error" }
  // Includes redirects: credentials must never be forwarded to a new destination.
  return { status: "unknown", reason: "unexpected_response" }
}

export type RecoveryAction = "stop_accepted" | "manual_review" | "lookup_receipt" | "retry_same_event"

/** A missing receipt is not proof of no effect; retries need receiver dedup guarantees. */
export function recoveryAction(input: {
  outcome: DeliveryOutcome
  receiptLookupCompleted: boolean
  durableIdempotencyConfirmed: boolean
  attempt: number
  maximumAttempts: number
}): RecoveryAction {
  contractAssert(Number.isSafeInteger(input.attempt) && input.attempt >= 1)
  contractAssert(Number.isSafeInteger(input.maximumAttempts) && input.maximumAttempts >= 1 && input.maximumAttempts <= 128)
  if (input.outcome.status === "accepted_by_api") return "stop_accepted"
  if (input.outcome.status === "rejected") return "manual_review"
  if (!input.receiptLookupCompleted) return "lookup_receipt"
  if (!input.durableIdempotencyConfirmed || input.attempt >= input.maximumAttempts) return "manual_review"
  return "retry_same_event"
}

/** Schedule only AFTER recoveryAction allows a retry; never bypass reconciliation. */
export function nextRetryTime(input: {
  firstAttemptAt: number
  now: number
  attempt: number
  retryAfter?: string
  /** Supplied random value makes scheduling deterministic in tests. */
  jitter: number
}): number | null {
  contractAssert(Number.isSafeInteger(input.now) && Number.isSafeInteger(input.firstAttemptAt))
  contractAssert(input.firstAttemptAt >= 0 && input.now >= input.firstAttemptAt)
  contractAssert(Number.isSafeInteger(input.attempt) && input.attempt >= 1)
  contractAssert(Number.isFinite(input.jitter) && input.jitter >= 0 && input.jitter <= 1)
  const base = [60_000, 300_000, 900_000, 3_600_000][Math.min(input.attempt - 1, 3)]
  let due = input.now + base + Math.floor(base * 0.1 * input.jitter)
  if (input.retryAfter !== undefined && input.retryAfter.length > 128) return null
  if (input.retryAfter !== undefined) {
    const value = input.retryAfter.trim()
    const delay = /^\d+$/.test(value) ? Number(value) * 1000 : null
    // Only HTTP-date syntax; Date.parse otherwise accepts surprising inputs.
    const date = /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value) ? Date.parse(value) : NaN
    if (delay !== null) due = Math.max(due, input.now + delay)
    else if (Number.isFinite(date)) due = Math.max(due, date)
  }
  // An overlong Retry-After must not be clamped into an earlier retry.
  return due < input.firstAttemptAt + 24 * 60 * 60 * 1000 ? due : null
}
