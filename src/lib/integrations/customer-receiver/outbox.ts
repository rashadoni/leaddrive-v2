import { enqueueEffect, type EventExecutionMode } from "../../event-platform/effects"
import { identifier, type Submission } from "./contract"
import { prepareSubmission, type ReceiverBinding } from "./delivery"

export const RECEIVER_EFFECT_TYPE = "customer_receiver.submit.v1"

/**
 * Call inside the SAME tenant-scoped transaction as the CRM mutation/version.
 * This adapter cannot create that transaction for a caller or make a post-commit
 * webhook durable. CRM command wiring and worker activation are separate gates.
 */
export async function enqueueReceiverSubmission(
  tx: Parameters<typeof enqueueEffect>[0],
  input: {
    binding: ReceiverBinding
    organizationId: string
    submission: Submission
    correlationId: string
    mode: EventExecutionMode
    sourceEventId?: string
  },
) {
  const prepared = prepareSubmission(input.binding, input.organizationId, input.submission)
  return enqueueEffect(tx, {
    organizationId: input.organizationId,
    sourceEventId: input.sourceEventId,
    effectType: RECEIVER_EFFECT_TYPE,
    effectKey: prepared.idempotencyKey,
    destination: `customer-receiver:${input.binding.integrationId}:${input.binding.environment}`,
    mode: input.mode,
    payload: {
      integrationId: input.binding.integrationId,
      environment: input.binding.environment,
      correlationId: identifier(input.correlationId),
      resource: prepared.submission.resource,
      envelope: prepared.submission.envelope,
    },
  })
}
