import { contractAssert, identifier } from "../contract"
import { RECEIVER_RUNTIME_EFFECT_TYPE, type ReceiverEffectMetadata } from "./capture"
import { recordRuntimeSecurityEvent } from "./security-log"
import { pinUtc, type ReceiverSqlTransaction } from "./sql"

export type ReconciliationDecision = "retry" | "succeeded" | "dead"

/**
 * Operator decision for one receiver effect. Must run on a connection whose
 * login role may SET ROLE leaddrive_effect_operator; the application role
 * cannot (database triggers reject it). The decision row is immutable
 * evidence and commits in the same transaction as the state transition.
 *
 * - reconciliation_required → retry | succeeded | dead requires `evidence`
 *   (e.g. the receiver's receipt lookup result or an incident ticket);
 *   `succeeded` also requires the receiver's receipt reference.
 * - definitely_failed → retry | dead is an explicit policy decision.
 *
 * A retry keeps the frozen bytes, idempotency key and event identity: it is
 * the same submission, never a new one. It only works while the encrypted
 * payload has not expired.
 */
export async function reconcileReceiverEffect(tx: ReceiverSqlTransaction, input: {
  organizationId: string
  effectId: string
  decision: ReconciliationDecision
  reason: string
  evidence: Record<string, string | number | boolean>
  providerReference?: string
  operatorId: string
  retryAt?: Date
  retentionDays: number
}) {
  const org = identifier(input.organizationId)
  contractAssert(input.reason.trim().length > 0 && input.reason.length <= 500)
  contractAssert(Object.keys(input.evidence).length > 0 && Object.keys(input.evidence).length <= 20)
  await tx.$executeRawUnsafe(`SET LOCAL ROLE leaddrive_effect_operator`)
  await tx.$queryRawUnsafe(`SELECT set_config('app.org_id', $1, true)`, org)
  await pinUtc(tx)
  const rows = await tx.$queryRawUnsafe<{ status: string; attemptCount: number; payload: ReceiverEffectMetadata }[]>(
    `SELECT "status", "attemptCount", "payload" FROM "effect_outbox"
      WHERE "organizationId" = $1 AND "id" = $2::uuid AND "effectType" = $3 FOR UPDATE`,
    org, input.effectId, RECEIVER_RUNTIME_EFFECT_TYPE,
  )
  const effect = rows[0]
  contractAssert(effect && (effect.status === "reconciliation_required" || (effect.status === "definitely_failed" && input.decision !== "succeeded")))
  if (input.decision === "succeeded") contractAssert(typeof input.providerReference === "string" && identifier(input.providerReference))

  if (effect.status === "reconciliation_required") {
    await tx.$executeRawUnsafe(
      `INSERT INTO "effect_reconciliations" ("organizationId", "effectId", "attemptNumber", "decision", "reason", "providerReference", "evidence")
       VALUES ($1, $2::uuid, $3, $4, $5, $6, $7::jsonb)`,
      org, input.effectId, effect.attemptCount, input.decision, input.reason, input.providerReference ?? null,
      JSON.stringify({ ...input.evidence, operatorId: identifier(input.operatorId) }),
    )
  }
  const status = input.decision === "retry" ? "pending" : input.decision
  const updated = await tx.$executeRawUnsafe(
    `UPDATE "effect_outbox" SET "status" = $3,
            "providerRequestId" = CASE WHEN $3 = 'pending' THEN NULL ELSE "providerRequestId" END,
            "providerResult" = CASE WHEN $3 = 'pending' THEN NULL WHEN $3 = 'succeeded' THEN $4::jsonb ELSE "providerResult" END,
            "lastError" = CASE WHEN $3 = 'pending' THEN NULL ELSE "lastError" END,
            "completedAt" = CASE WHEN $3 = 'pending' THEN NULL ELSE CURRENT_TIMESTAMP END,
            "reconciliationAt" = CASE WHEN $3 = 'pending' THEN NULL ELSE "reconciliationAt" END,
            "availableAt" = CASE WHEN $3 = 'pending' THEN COALESCE($5::timestamp, CURRENT_TIMESTAMP) ELSE "availableAt" END,
            "updatedAt" = CURRENT_TIMESTAMP
      WHERE "organizationId" = $1 AND "id" = $2::uuid AND "status" = $6`,
    org, input.effectId, status,
    JSON.stringify({ receiptId: input.providerReference ?? null, status: "accepted_by_api", source: "reconciliation" }),
    input.retryAt?.toISOString() ?? null, effect.status,
  )
  contractAssert(updated === 1)
  await recordRuntimeSecurityEvent(tx, {
    organizationId: org, environment: effect.payload.environment, instanceId: "operator", category: "administration",
    action: "receipt_lookup", outcome: input.decision === "succeeded" ? "success" : input.decision === "dead" ? "failure" : "unknown",
    severity: "medium", actor: { type: "user", id: identifier(input.operatorId) },
    target: { type: effect.payload.resource, id: effect.payload.externalId }, correlationId: effect.payload.correlationId,
    integrationEventId: effect.payload.eventId, retentionDays: input.retentionDays,
  })
  return { status }
}
