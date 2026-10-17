import { randomUUID } from "node:crypto"
import type { AcceptanceReceipt } from "../contract"
import { parseMappedAcceptance } from "../constructor/receipts"
import { deliveryAllowed, receiverDestination, type RuntimeBinding, type RuntimeSwitches } from "./binding"
import { RECEIVER_RUNTIME_EFFECT_TYPE, type ReceiverEffectMetadata } from "./capture"
import { openReceiverPayload, ReceiverPayloadError } from "./payload-store"
import { recordRuntimeSecurityEvent, type RuntimeLogInput } from "./security-log"
import { pinUtc, type ReceiverDatabase, type ReceiverSqlTransaction } from "./sql"

export interface ReceiverSendRequest {
  binding: RuntimeBinding
  method: "PUT" | "POST"
  path: string
  body: string
  idempotencyKey: string
  payloadHash: string
  correlationId: string
  limits: { connectTimeoutSeconds: number; timeoutSeconds: number; maxBodyKiB: number }
}
/** Resolves with the HTTP response or throws on any transport failure. */
export type ReceiverSender = (request: ReceiverSendRequest) => Promise<{ status: number; body: string; retryAfter?: string }>

export type TerminalOutcome = "succeeded" | "definitely_failed" | "reconciliation_required"
export interface Classified { outcome: TerminalOutcome; reason: string; responseCode: number | null; receipt?: AcceptanceReceipt }

/**
 * 2xx counts only with a receipt that names this exact event/record/version.
 * Anything that may have been applied (timeouts, 5xx, 429, invalid receipt,
 * redirects) is ambiguous and goes to reconciliation — never a blind resend.
 */
export function classifyMappedResponse(metadata: ReceiverEffectMetadata, response: { status: number; body: string } | null): Classified {
  if (response === null) return { outcome: "reconciliation_required", reason: "transport_error", responseCode: null }
  const code = response.status >= 100 && response.status <= 599 ? response.status : null
  if (response.status >= 200 && response.status < 300) {
    try {
      if (Buffer.byteLength(response.body, "utf8") > 16 * 1024) throw new Error("oversized")
      const receipt = parseMappedAcceptance({ receipt: metadata.receipt, expected: { eventId: metadata.eventId, externalId: metadata.externalId, entityVersion: metadata.entityVersion }, body: JSON.parse(response.body) })
      return { outcome: "succeeded", reason: "accepted_by_api", responseCode: code, receipt }
    } catch { return { outcome: "reconciliation_required", reason: "invalid_receipt", responseCode: code } }
  }
  if (response.status === 400 || response.status === 422) return { outcome: "definitely_failed", reason: "invalid_data", responseCode: code }
  if (response.status === 401 || response.status === 403) return { outcome: "definitely_failed", reason: "access_denied", responseCode: code }
  if (response.status === 409) return { outcome: "definitely_failed", reason: "conflict", responseCode: code }
  if ([404, 405, 413, 415].includes(response.status)) return { outcome: "definitely_failed", reason: "contract_mismatch", responseCode: code }
  if (response.status === 429) return { outcome: "reconciliation_required", reason: "rate_limited", responseCode: code }
  if (response.status >= 500 && response.status <= 599) return { outcome: "reconciliation_required", reason: "receiver_error", responseCode: code }
  return { outcome: "reconciliation_required", reason: "unexpected_response", responseCode: code }
}

/** Reasons after which the remaining queue for this destination waits for the next run. */
const STOP_REASONS = new Set(["access_denied", "transport_error", "receiver_error", "rate_limited"])

export interface DeliverySummary {
  status: "disabled" | "paused" | "completed"
  recoveredToPending: number
  recoveredToReconciliation: number
  deferred: number
  claimed: number
  succeeded: number
  failed: number
  uncertain: number
  stoppedBy: string | null
}

interface ClaimedEffect { id: string; attemptCount: number; leaseToken: string; requestId: string; metadata: ReceiverEffectMetadata }

/**
 * One bounded delivery run for one operator binding. Protocol enforced by the
 * effect_outbox triggers: atomic lease → committed `started` attempt BEFORE the
 * network call → terminal attempt evidence and state transition in one
 * transaction. An expired lease with `started` becomes reconciliation_required.
 * Retries of failed/ambiguous effects are operator decisions (see reconcile.ts).
 */
export async function runReceiverDelivery(input: {
  db: ReceiverDatabase
  binding: RuntimeBinding
  switches: RuntimeSwitches
  send: ReceiverSender
  workerId: string
  maxEffects: number
  leaseSeconds?: number
  sleep?: (ms: number) => Promise<void>
}): Promise<DeliverySummary> {
  const summary: DeliverySummary = { status: "completed", recoveredToPending: 0, recoveredToReconciliation: 0, deferred: 0, claimed: 0, succeeded: 0, failed: 0, uncertain: 0, stoppedBy: null }
  const { binding, db } = input
  if (!deliveryAllowed(binding, input.switches)) return { ...summary, status: "disabled" }
  if (!Number.isInteger(input.maxEffects) || input.maxEffects < 1 || input.maxEffects > 500) throw new RangeError("maxEffects")
  const org = binding.organizationId
  const destination = receiverDestination(binding)
  const sleep = input.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  const log = (tx: ReceiverSqlTransaction, entry: Pick<RuntimeLogInput, "action" | "outcome" | "severity" | "target" | "correlationId" | "integrationEventId">) => recordRuntimeSecurityEvent(tx, {
    ...entry, organizationId: org, environment: binding.environment, instanceId: input.workerId, category: "integration",
    actor: { type: "service", id: "receiver-worker" }, retentionDays: binding.securityLogRetentionDays,
  })
  const target = (metadata: ReceiverEffectMetadata) => ({ type: metadata.resource, id: metadata.externalId })

  // 1. Expired leases. No `started` → provably no call → pending again.
  //    `started` without terminal evidence → the outcome is unknown.
  await db.tenant(org, async (tx) => {
    await pinUtc(tx)
    const expired = await tx.$queryRawUnsafe<{ id: string; attemptCount: number; leaseToken: string; providerRequestId: string; payload: ReceiverEffectMetadata; started: boolean }[]>(
      `SELECT e."id"::text AS "id", e."attemptCount", e."leaseToken"::text AS "leaseToken", e."providerRequestId", e."payload",
              EXISTS (SELECT 1 FROM "effect_attempts" a WHERE a."organizationId" = e."organizationId" AND a."effectId" = e."id"
                       AND a."attemptNumber" = e."attemptCount" AND a."leaseToken" = e."leaseToken" AND a."outcome" = 'started') AS "started"
         FROM "effect_outbox" e
        WHERE e."organizationId" = $1 AND e."effectType" = $2 AND e."destination" = $3
          AND e."status" = 'leased' AND e."leaseExpiresAt" < CURRENT_TIMESTAMP
        ORDER BY e."leaseExpiresAt" LIMIT 100 FOR UPDATE OF e SKIP LOCKED`,
      org, RECEIVER_RUNTIME_EFFECT_TYPE, destination,
    )
    for (const row of expired) {
      if (!row.started) {
        await tx.$executeRawUnsafe(
          `UPDATE "effect_outbox" SET "status" = 'pending', "leaseToken" = NULL, "leaseOwner" = NULL, "leaseExpiresAt" = NULL,
                  "providerRequestId" = NULL, "lastError" = 'lease_expired_before_start', "updatedAt" = CURRENT_TIMESTAMP
            WHERE "organizationId" = $1 AND "id" = $2::uuid AND "status" = 'leased'`, org, row.id)
        summary.recoveredToPending++
        continue
      }
      await insertAttempt(tx, org, { id: row.id, attemptCount: row.attemptCount, leaseToken: row.leaseToken, requestId: row.providerRequestId }, "reconciliation_required", null, null, "lease_expired_after_start", { networkCall: "unknown", reason: "lease_expired_after_start" })
      await finishEffect(tx, org, row.id, row.leaseToken, "reconciliation_required", null, "lease_expired_after_start")
      await log(tx, { action: "lease_recovered", outcome: "unknown", severity: "high", target: target(row.payload), correlationId: row.payload.correlationId, integrationEventId: row.payload.eventId })
      summary.recoveredToReconciliation++
    }
  })

  for (let processed = 0; processed < input.maxEffects; processed++) {
    // 2. Claim under a destination lock: backpressure, concurrency, ordering
    //    and customer-version dependencies are decided in one transaction.
    const claim = await db.tenant(org, async (tx): Promise<ClaimedEffect | "paused" | null> => {
      await pinUtc(tx)
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, `${org}|${destination}`)
      const [state] = await tx.$queryRawUnsafe<{ uncertain: bigint; active: bigint }[]>(
        `SELECT count(*) FILTER (WHERE "status" = 'reconciliation_required') AS "uncertain",
                count(*) FILTER (WHERE "status" = 'leased') AS "active"
           FROM "effect_outbox" WHERE "organizationId" = $1 AND "effectType" = $2 AND "destination" = $3`,
        org, RECEIVER_RUNTIME_EFFECT_TYPE, destination,
      )
      if (Number(state.uncertain) >= binding.pauseAfterUncertain) return "paused"
      const candidates = await tx.$queryRawUnsafe<{ id: string; payload: ReceiverEffectMetadata; lastError: string | null }[]>(
        `SELECT "id"::text AS "id", "payload", "lastError" FROM "effect_outbox"
          WHERE "organizationId" = $1 AND "effectType" = $2 AND "destination" = $3
            AND "status" = 'pending' AND "availableAt" <= CURRENT_TIMESTAMP
          ORDER BY "availableAt", "createdAt", "id" LIMIT 20 FOR UPDATE SKIP LOCKED`,
        org, RECEIVER_RUNTIME_EFFECT_TYPE, destination,
      )
      for (const candidate of candidates) {
        const metadata = candidate.payload
        if (Number(state.active) >= Math.min(2, Math.max(1, metadata.limits.concurrency))) return null
        const blocker = await blockingReason(tx, org, destination, metadata)
        if (blocker) {
          await tx.$executeRawUnsafe(
            `UPDATE "effect_outbox" SET "availableAt" = CURRENT_TIMESTAMP + INTERVAL '60 seconds', "lastError" = $3, "updatedAt" = CURRENT_TIMESTAMP
              WHERE "organizationId" = $1 AND "id" = $2::uuid AND "status" = 'pending'`, org, candidate.id, blocker)
          if (candidate.lastError !== blocker) await log(tx, { action: "submission_deferred", outcome: "unknown", severity: "low", target: target(metadata), correlationId: metadata.correlationId, integrationEventId: metadata.eventId })
          summary.deferred++
          continue
        }
        const leaseToken = randomUUID(), requestId = randomUUID()
        const leaseSeconds = input.leaseSeconds ?? metadata.limits.timeoutSeconds + 60
        const leased = await tx.$queryRawUnsafe<{ attemptCount: number }[]>(
          `UPDATE "effect_outbox" SET "status" = 'leased', "attemptCount" = "attemptCount" + 1, "leaseToken" = $3::uuid, "leaseOwner" = $4,
                  "leaseExpiresAt" = CURRENT_TIMESTAMP + make_interval(secs => $5::int), "providerRequestId" = $6, "lastError" = NULL,
                  "updatedAt" = CURRENT_TIMESTAMP
            WHERE "organizationId" = $1 AND "id" = $2::uuid AND "status" = 'pending'
            RETURNING "attemptCount"`,
          org, candidate.id, leaseToken, input.workerId, leaseSeconds, requestId,
        )
        if (!leased[0]) continue
        return { id: candidate.id, attemptCount: leased[0].attemptCount, leaseToken, requestId, metadata }
      }
      return null
    })
    if (claim === "paused") { summary.status = "paused"; break }
    if (claim === null) break
    summary.claimed++
    const { metadata } = claim

    // 3. Committed `started` before any byte leaves the process. A payload that
    //    is gone (TTL) or fails its ledger hash is a definite failure WITHOUT a
    //    network call, recorded as such.
    let opened: string | null
    try { opened = await db.tenant(org, async (tx): Promise<string | null> => {
      await pinUtc(tx)
      let body: string
      try {
        body = await openReceiverPayload(tx, { organizationId: org, effectId: claim.id, bodySha256: metadata.request.bodySha256 })
      } catch (error) {
        if (!(error instanceof ReceiverPayloadError)) throw error
        await insertAttempt(tx, org, claim, "started", null, null, null, { networkCall: false })
        await insertAttempt(tx, org, claim, "definitely_failed", null, null, error.code, { networkCall: false, reason: error.code })
        await finishEffect(tx, org, claim.id, claim.leaseToken, "definitely_failed", null, error.code)
        await log(tx, { action: "submission_rejected", outcome: "failure", severity: "medium", target: target(metadata), correlationId: metadata.correlationId, integrationEventId: metadata.eventId })
        return null
      }
      await insertAttempt(tx, org, claim, "started", null, null, null, { networkCall: true, method: metadata.request.method, bodySha256: metadata.request.bodySha256 })
      await log(tx, { action: "submission_attempted", outcome: "unknown", severity: "info", target: target(metadata), correlationId: metadata.correlationId, integrationEventId: metadata.eventId })
      return body
    }) } catch {
      // `started` was not committed: nothing may be sent. The lease expires and
      // the recovery path returns the effect to pending without ambiguity.
      summary.stoppedBy = "start_not_recorded"
      break
    }
    if (opened === null) { summary.failed++; continue }

    // 4. The only network call: the frozen bytes, key, method and path.
    let response: { status: number; body: string } | null = null
    try {
      response = await input.send({
        binding, method: metadata.request.method, path: metadata.request.path, body: opened,
        idempotencyKey: metadata.request.idempotencyKey, payloadHash: metadata.request.bodySha256, correlationId: metadata.correlationId,
        limits: { connectTimeoutSeconds: metadata.limits.connectTimeoutSeconds, timeoutSeconds: metadata.limits.timeoutSeconds, maxBodyKiB: metadata.limits.maxBodyKiB },
      })
    } catch { response = null }
    const result = classifyMappedResponse(metadata, response)

    // 5. Terminal evidence + transition, atomically. If the lease was lost
    //    meanwhile, the recovery path has already marked it ambiguous.
    const providerResult = result.receipt ? { receiptId: result.receipt.receiptId, operationId: result.receipt.operationId, acceptedAt: result.receipt.acceptedAt, acceptedVersion: result.receipt.acceptedVersion, status: "accepted_by_api" } : null
    try {
      await db.tenant(org, async (tx) => {
        await pinUtc(tx)
        await insertAttempt(tx, org, claim, result.outcome, result.responseCode, result.receipt?.receiptId ?? null, result.outcome === "succeeded" ? null : result.reason, { networkCall: true, reason: result.reason, responseCode: result.responseCode })
        await finishEffect(tx, org, claim.id, claim.leaseToken, result.outcome, providerResult, result.outcome === "succeeded" ? null : result.reason)
        await log(tx, {
          action: result.outcome === "succeeded" ? "submission_accepted" : result.outcome === "definitely_failed" ? "submission_rejected" : "submission_uncertain",
          outcome: result.outcome === "succeeded" ? "success" : result.outcome === "definitely_failed" ? "failure" : "unknown",
          severity: result.outcome === "succeeded" ? "info" : result.outcome === "definitely_failed" ? "medium" : "high",
          target: target(metadata), correlationId: metadata.correlationId, integrationEventId: metadata.eventId,
        })
      })
    } catch {
      // Evidence could not be committed (lease lost or database unavailable).
      // The started row stays; recovery turns the lease into reconciliation.
      await db.tenant(org, async (tx) => log(tx, { action: "submission_uncertain", outcome: "unknown", severity: "high", target: target(metadata), correlationId: metadata.correlationId, integrationEventId: metadata.eventId })).catch(() => undefined)
      summary.uncertain++
      summary.stoppedBy = "evidence_not_recorded"
      break
    }
    if (result.outcome === "succeeded") summary.succeeded++
    else if (result.outcome === "definitely_failed") summary.failed++
    else summary.uncertain++
    if (STOP_REASONS.has(result.reason)) { summary.stoppedBy = result.reason; break }
    await sleep(Math.ceil(1000 / Math.max(1, Math.min(5, metadata.limits.requestsPerSecond))))
  }
  return summary
}

/** Per-record version order and the customer version a contact/deal snapshot referenced. */
async function blockingReason(tx: ReceiverSqlTransaction, org: string, destination: string, metadata: ReceiverEffectMetadata): Promise<string | null> {
  const earlier = await tx.$queryRawUnsafe<unknown[]>(
    `SELECT 1 FROM "effect_outbox"
      WHERE "organizationId" = $1 AND "effectType" = $2 AND "destination" = $3
        AND "payload"->>'resource' = $4 AND "payload"->>'externalId' = $5
        AND ("payload"->>'entityVersion')::bigint < $6::bigint
        AND "status" IN ('pending', 'leased', 'reconciliation_required')
      LIMIT 1`,
    org, RECEIVER_RUNTIME_EFFECT_TYPE, destination, metadata.resource, metadata.externalId, metadata.entityVersion,
  )
  if (earlier.length) return "earlier_version_pending"
  if (!metadata.dependsOn) return null
  const accepted = await tx.$queryRawUnsafe<unknown[]>(
    `SELECT 1 FROM "effect_outbox"
      WHERE "organizationId" = $1 AND "effectType" = $2 AND "destination" = $3 AND "status" = 'succeeded'
        AND "payload"->>'resource' = 'customers' AND "payload"->>'externalId' = $4
        AND ("payload"->>'entityVersion')::bigint >= $5::bigint
      LIMIT 1`,
    org, RECEIVER_RUNTIME_EFFECT_TYPE, destination, metadata.dependsOn.externalId, metadata.dependsOn.minimumVersion,
  )
  return accepted.length ? null : "customer_version_not_accepted"
}

async function insertAttempt(tx: ReceiverSqlTransaction, org: string, claim: { id: string; attemptCount: number; leaseToken: string; requestId: string }, outcome: "started" | TerminalOutcome, responseCode: number | null, providerReference: string | null, errorCode: string | null, evidence: Record<string, unknown>) {
  await tx.$executeRawUnsafe(
    `INSERT INTO "effect_attempts" ("organizationId", "effectId", "attemptNumber", "leaseToken", "requestId", "outcome",
       "responseCode", "providerReference", "evidence", "errorMessage", "attemptedAt", "completedAt")
     VALUES ($1, $2::uuid, $3, $4::uuid, $5, $6, $7, $8, $9::jsonb, $10, CURRENT_TIMESTAMP, CASE WHEN $6 = 'started' THEN NULL ELSE CURRENT_TIMESTAMP END)`,
    org, claim.id, claim.attemptCount, claim.leaseToken, claim.requestId, outcome, responseCode, providerReference, JSON.stringify(evidence), errorCode,
  )
}

async function finishEffect(tx: ReceiverSqlTransaction, org: string, effectId: string, leaseToken: string, outcome: TerminalOutcome, providerResult: Record<string, unknown> | null, errorCode: string | null) {
  const updated = await tx.$executeRawUnsafe(
    `UPDATE "effect_outbox" SET "status" = $4, "leaseToken" = NULL, "leaseOwner" = NULL, "leaseExpiresAt" = NULL,
            "providerResult" = $5::jsonb, "lastError" = $6,
            "completedAt" = CASE WHEN $4 IN ('succeeded', 'definitely_failed') THEN CURRENT_TIMESTAMP ELSE NULL END,
            "reconciliationAt" = CASE WHEN $4 = 'reconciliation_required' THEN CURRENT_TIMESTAMP ELSE NULL END,
            "updatedAt" = CURRENT_TIMESTAMP
      WHERE "organizationId" = $1 AND "id" = $2::uuid AND "status" = 'leased' AND "leaseToken" = $3::uuid`,
    org, effectId, leaseToken, outcome, providerResult === null ? null : JSON.stringify(providerResult), errorCode,
  )
  if (updated !== 1) throw new Error("effect_lease_lost")
}
