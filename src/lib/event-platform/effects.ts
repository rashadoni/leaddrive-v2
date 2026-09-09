import { randomUUID } from "node:crypto"
import { hashCanonicalJson } from "./canonical-json"
import { ReplayEffectFenceError } from "./errors"

export type EventExecutionMode = "live" | "shadow" | "replay"

interface EffectTransaction {
  effectOutbox: {
    create(args: Record<string, unknown>): Promise<Record<string, unknown>>
  }
}

export interface EnqueueEffectInput {
  organizationId: string
  sourceEventId?: string
  effectType: string
  effectKey: string
  destination: string
  payload: Record<string, unknown>
  mode: EventExecutionMode
  /** @deprecated Caller assertions cannot make an effect replay-safe. */
  replaySafe?: boolean
  availableAt?: Date
}

/**
 * Creates a durable external-effect request. Replays and shadow builds are
 * fenced by default. Replay safety is an audited platform policy, never a
 * caller-supplied boolean. The registry intentionally starts empty.
 */
export async function enqueueEffect(
  tx: EffectTransaction,
  input: EnqueueEffectInput,
): Promise<Record<string, unknown>> {
  if (input.mode !== "live" && !REPLAY_SAFE_EFFECT_TYPES.has(input.effectType)) {
    throw new ReplayEffectFenceError()
  }
  if (!input.effectType || !input.effectKey || !input.destination) throw new TypeError("effect identity is required")

  return tx.effectOutbox.create({
    data: {
      id: randomUUID(),
      organizationId: input.organizationId,
      sourceEventId: input.sourceEventId ?? null,
      effectType: input.effectType,
      effectKey: input.effectKey,
      destination: input.destination,
      executionMode: input.mode,
      payload: input.payload,
      // DB trigger recomputes this from jsonb; supplying it also makes test
      // doubles and pre-insert observability deterministic.
      payloadHash: hashCanonicalJson(input.payload),
      status: "pending",
      availableAt: input.availableAt ?? new Date(),
    },
  })
}

export function canAutomaticallyRetryEffect(status: string): boolean {
  return status === "pending"
}

/** A definite failure may be retried only by an explicit, audited policy. */
export function canPolicyRetryEffect(status: string): boolean {
  return status === "definitely_failed"
}

export function requiresEffectReconciliation(status: string): boolean {
  return status === "reconciliation_required"
}

// Populated only by a reviewed platform change with a proof that the operation
// is internal and has no sends, money movement, provider call or billable work.
const REPLAY_SAFE_EFFECT_TYPES = new Set<string>()
