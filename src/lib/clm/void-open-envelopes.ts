/**
 * Voids the e-sign envelopes of a contract that are still out for signing —
 * inside the caller's transaction, the way a recall does it
 * (…/documents/[docId]/esign DELETE): the envelope becomes "voided" with a
 * reason, every unsigned link dies, and the e-sign trail records it.
 *
 *  - scope "contract": only the contract's own envelopes (documentId null) —
 *    a paper signature makes an invitation to sign the contract moot;
 *  - scope "all": the contract's and its documents' — a contract terminated or
 *    cancelled is signed no more; a protocol or act that was out for signing
 *    goes back to draft, as after a recall.
 */
import type { Prisma } from "@prisma/client"
import { buildAuditEvent } from "@/lib/esign/audit-event-builder"
import { canEnvelopeTransition } from "@/lib/esign/state-machine"
import type { EnvelopeStatus } from "@/lib/esign/types"

export class EnvelopeVoidConflict extends Error {}

export async function voidOpenEnvelopes(
  tx: Prisma.TransactionClient,
  input: {
    orgId: string
    contractId: string
    scope: "contract" | "all"
    reason: string
    /** null — the system (a scheduled termination). */
    actorUserId: string | null
    at: Date
    ipAddress?: string | null
    userAgent?: string | null
  },
): Promise<number> {
  const open = await tx.esignEnvelope.findMany({
    where: {
      organizationId: input.orgId,
      contractId: input.contractId,
      status: { in: ["created", "sent", "in_progress"] },
      ...(input.scope === "contract" ? { documentId: null } : {}),
    },
    select: { id: true, status: true, documentId: true },
  })
  let voidedCount = 0
  for (const env of open as Array<{ id: string; status: string; documentId: string | null }>) {
    if (!canEnvelopeTransition(env.status as EnvelopeStatus, "voided").ok) continue
    const voided = await tx.esignEnvelope.updateMany({
      where: { id: env.id, status: env.status },
      data: { status: "voided", voidedAt: input.at, voidedBy: input.actorUserId ?? "system", voidReason: input.reason },
    })
    if (voided.count !== 1) throw new EnvelopeVoidConflict("The envelope changed concurrently")
    voidedCount++
    await tx.esignSigner.updateMany({ where: { envelopeId: env.id, status: { in: ["pending", "sent", "viewed"] } }, data: { tokenHash: null } })
    const event = buildAuditEvent({
      organizationId: input.orgId,
      envelopeId: env.id,
      signerId: null,
      eventType: "envelope_voided",
      actorType: input.actorUserId ? "user" : "system",
      actorId: input.actorUserId ?? undefined,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      metadata: { reason: input.reason, ...(env.documentId ? { documentId: env.documentId } : {}) },
      at: input.at,
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (event.ok) await tx.esignAuditEvent.create({ data: event.record as any })
    if (env.documentId) {
      await tx.contractDocument.updateMany({
        where: { id: env.documentId, contractId: input.contractId, organizationId: input.orgId, status: "in_signing" },
        data: { status: "draft", signedBody: null, contentHash: null },
      })
    }
  }
  return voidedCount
}
