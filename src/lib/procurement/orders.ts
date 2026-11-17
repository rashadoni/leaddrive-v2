import { Prisma } from "@prisma/client"
import { procurementNumber } from "@/lib/procurement/numbering"

export type OrderLineInput = {
  name: string
  unit?: string | null
  quantity: number
  unitPrice: number
  requestItemId?: string | null
  dealLineItemId?: string | null
}

/** Lines as stored: total = quantity × price, rounded to 4 places like the column. */
export function orderLines(orgId: string, lines: readonly OrderLineInput[]) {
  return lines.map((line, index) => {
    const quantity = new Prisma.Decimal(line.quantity)
    const unitPrice = new Prisma.Decimal(line.unitPrice)
    return {
      organizationId: orgId,
      name: line.name,
      unit: line.unit?.trim() || null,
      quantity,
      unitPrice,
      total: quantity.mul(unitPrice).toDecimalPlaces(4),
      requestItemId: line.requestItemId ?? null,
      dealLineItemId: line.dealLineItemId ?? null,
      sortOrder: index,
    }
  })
}

export function orderTotal(lines: readonly { total: Prisma.Decimal }[]): Prisma.Decimal {
  return lines.reduce((sum, line) => sum.add(line.total), new Prisma.Decimal(0))
}

export async function recordOrderEvent(
  tx: Prisma.TransactionClient,
  input: { orgId: string; orderId: string; type: string; actorId?: string | null; fromStatus?: string | null; toStatus?: string | null; data?: Prisma.InputJsonValue },
): Promise<void> {
  await tx.purchaseOrderEvent.create({
    data: {
      organizationId: input.orgId,
      orderId: input.orderId,
      type: input.type,
      actorId: input.actorId ?? null,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus ?? null,
      ...(input.data === undefined ? {} : { data: input.data }),
    },
  })
}

export const ORDER_DETAIL_INCLUDE = {
  supplier: { select: { id: true, name: true, email: true, phone: true, voen: true, address: true } },
  deal: { select: { id: true, name: true, assignedTo: true } },
  request: { select: { id: true, seq: true, title: true, requestedById: true } },
  items: { orderBy: { sortOrder: "asc" } },
  approvals: { orderBy: [{ revision: "desc" }, { stepNo: "asc" }] },
  events: { orderBy: { createdAt: "desc" }, take: 100 },
} satisfies Prisma.PurchaseOrderInclude

export type OrderDetail = Prisma.PurchaseOrderGetPayload<{ include: typeof ORDER_DETAIL_INCLUDE }>

export function presentOrder(order: OrderDetail) {
  return {
    ...order,
    number: procurementNumber("order", order.seq),
    request: order.request ? { ...order.request, number: procurementNumber("request", order.request.seq) } : null,
    // Only the chain of the current revision decides; older ones are history.
    approvals: order.approvals.filter((step) => step.revision === order.revision),
    approvalHistory: order.approvals.filter((step) => step.revision !== order.revision),
  }
}

/** Is the expected date past while goods are still due? */
export function isLate(order: { status: string; expectedDeliveryAt: Date | null }, now = new Date()): boolean {
  if (!order.expectedDeliveryAt) return false
  if (!["approved", "sent", "in_production", "in_transit", "partially_received"].includes(order.status)) return false
  return order.expectedDeliveryAt.getTime() < now.getTime()
}
