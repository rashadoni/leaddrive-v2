import type { Prisma } from "@prisma/client"

/**
 * Per-organization numbers for purchase requests (PR-0001) and purchase orders
 * (PO-0001). The next number is read under a transaction-scoped advisory lock,
 * so two people saving at once get two numbers; the unique index
 * (organizationId, seq) is the last guard.
 */
export type ProcurementDocument = "request" | "order"

export async function nextProcurementSeq(
  tx: Prisma.TransactionClient,
  orgId: string,
  kind: ProcurementDocument,
): Promise<number> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`procurement-${kind}:${orgId}`})::bigint)`
  const max = kind === "request"
    ? (await tx.purchaseRequest.aggregate({ where: { organizationId: orgId }, _max: { seq: true } }))._max.seq
    : (await tx.purchaseOrder.aggregate({ where: { organizationId: orgId }, _max: { seq: true } }))._max.seq
  return (max ?? 0) + 1
}

export function procurementNumber(kind: ProcurementDocument, seq: number): string {
  return `${kind === "request" ? "PR" : "PO"}-${String(seq).padStart(4, "0")}`
}
