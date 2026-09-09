import type { Prisma } from "@prisma/client"

export const PROVIDER_UNKNOWN_NO_REDIAL = "provider_unknown_no_redial"

/**
 * A human decided the attempt is over and accepted that it is never redialed.
 * Releasing the fence needs both this marker and a non-null `endedAt`: the
 * fence below also blocks on an attempt that never terminated, so an
 * acknowledgement that leaves `endedAt` null would release nothing.
 */
export const OPERATOR_CLOSED_UNKNOWN_NO_REDIAL = "operator_closed_unknown_no_redial"

/** Exact-phone fence for an outbound attempt without proven terminal truth. */
export function buildUnresolvedOutboundCallWhere(params: {
  organizationId: string
  targetPhoneE164: string
  callModes: Array<"human" | "ai">
}): Prisma.CallLogWhereInput {
  return {
    organizationId: params.organizationId,
    direction: "outbound",
    targetPhoneE164: params.targetPhoneE164,
    callMode: { in: params.callModes },
    providerOutcome: null,
    OR: [
      { endedAt: null },
      { conversationOutcome: PROVIDER_UNKNOWN_NO_REDIAL },
    ],
  }
}
