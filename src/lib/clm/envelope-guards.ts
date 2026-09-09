/**
 * In-flight e-sign envelope guard (closes the [P2] body-route asymmetry,
 * deferred 2026-06-09).
 *
 * An envelope in `created | sent | in_progress` was bound to the contract body
 * at send time. Bound envelopes already protect the SIGNED bytes (they pin a
 * frozen ContractVersion), so a body edit can't corrupt a live signature — but
 * editing mid-signing is still confusing (re-sends, "what did they see?") and
 * /amend has always blocked it. This module is the single source of truth for
 * that rule; /amend, PUT /body and POST /import-docx all gate through it.
 */
import { prisma } from "@/lib/prisma"

/** EsignEnvelope statuses that mean a signing flow is actively in progress. */
export const IN_FLIGHT_ENVELOPE_STATUSES = ["created", "sent", "in_progress"] as const

/** Count in-flight envelopes for a contract (org-scoped). */
export async function countInFlightEnvelopes(orgId: string, contractId: string): Promise<number> {
  return prisma.esignEnvelope.count({
    where: {
      contractId,
      organizationId: orgId,
      status: { in: [...IN_FLIGHT_ENVELOPE_STATUSES] },
    },
  })
}
