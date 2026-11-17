import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { procurementNumber } from "@/lib/procurement/numbering"
import { COMMITTED_STATUSES, type PurchaseOrderStatus } from "@/lib/procurement/order-status"
import { isLate } from "@/lib/procurement/orders"

/**
 * Where the purchasing for one customer order stands (tasks 4.3, 6.1) — the
 * one reading the deal tab, the deal list and the margin report share.
 *
 * Per line of the deal: the furthest stage any purchase for it reached, the
 * expected date, whether it is late, and its cost — the committed (approved or
 * later) order lines bought for it. Margin = deal lines' revenue − that cost.
 *
 * There are no exchange rates in the product: an order in another currency
 * than the deal is not added to its cost. It is reported as `foreignCost`
 * (per currency) and the margin is then null — a number that looks exact and
 * is wrong is worse than none.
 */
export type LineStage = "not_requested" | "requested" | "quoting" | "ordered" | "approved" | "sent" | "in_production" | "in_transit" | "partially_received" | "received"

const STAGE_ORDER: LineStage[] = ["not_requested", "requested", "quoting", "ordered", "approved", "sent", "in_production", "in_transit", "partially_received", "received"]

function orderStage(status: string): LineStage | null {
  switch (status as PurchaseOrderStatus) {
    case "draft": case "pending_approval": case "rejected": return "ordered"
    case "approved": return "approved"
    case "sent": case "in_production": case "in_transit": case "partially_received": case "received": return status as LineStage
    default: return null
  }
}

const later = (a: LineStage, b: LineStage) => (STAGE_ORDER.indexOf(a) >= STAGE_ORDER.indexOf(b) ? a : b)

type RequestRow = { id: string; seq: number; title: string; status: string; neededBy: Date | null; dealChangedAt: Date | null; items: { dealLineItemId: string | null }[]; _count: { quotes: number } }
type OrderRow = { id: string; seq: number; status: string; currency: string; totalAmount: Prisma.Decimal; expectedDeliveryAt: Date | null; dealChangedAt: Date | null; supplier: { id: string; name: string }; items: { dealLineItemId: string | null; total: Prisma.Decimal }[] }
type LineRow = { id: string; name: string; quantity: Prisma.Decimal; unitPrice: Prisma.Decimal | null; discountPct: Prisma.Decimal }

export async function dealProcurementSummary(orgId: string, dealId: string, now = new Date()) {
  const [deal, requests, orders]: [{ id: string; currency: string; lineItems: LineRow[] } | null, RequestRow[], OrderRow[]] = await Promise.all([
    prisma.deal.findFirst({
      where: { id: dealId, organizationId: orgId },
      select: { id: true, currency: true, lineItems: { orderBy: { sortOrder: "asc" }, select: { id: true, name: true, quantity: true, unitPrice: true, discountPct: true } } },
    }),
    prisma.purchaseRequest.findMany({
      where: { organizationId: orgId, dealId },
      orderBy: { seq: "asc" },
      select: { id: true, seq: true, title: true, status: true, neededBy: true, dealChangedAt: true, items: { select: { dealLineItemId: true } }, _count: { select: { quotes: true } } },
    }),
    prisma.purchaseOrder.findMany({
      where: { organizationId: orgId, dealId },
      orderBy: { seq: "asc" },
      select: { id: true, seq: true, status: true, currency: true, totalAmount: true, expectedDeliveryAt: true, dealChangedAt: true, supplier: { select: { id: true, name: true } }, items: { select: { dealLineItemId: true, total: true } } },
    }),
  ])
  if (!deal) return null

  const lines = deal.lineItems.map((line) => {
    const revenue = line.unitPrice === null ? null : Number(line.quantity) * Number(line.unitPrice) * (1 - Number(line.discountPct) / 100)
    let stage: LineStage = "not_requested"
    let expected: Date | null = null
    let late = false
    let cost = 0
    for (const request of requests) {
      if (request.status === "cancelled" || !request.items.some((item) => item.dealLineItemId === line.id)) continue
      stage = later(stage, request._count.quotes > 0 ? "quoting" : "requested")
    }
    for (const order of orders) {
      const own = order.items.filter((item) => item.dealLineItemId === line.id)
      if (own.length === 0) continue
      const s = orderStage(order.status)
      if (!s) continue
      stage = later(stage, s)
      if (order.expectedDeliveryAt && order.status !== "received" && (!expected || order.expectedDeliveryAt > expected)) expected = order.expectedDeliveryAt
      if (isLate(order, now)) late = true
      if ((COMMITTED_STATUSES as readonly string[]).includes(order.status) && order.currency === deal.currency) cost += own.reduce((sum, item) => sum + Number(item.total), 0)
    }
    return { dealLineItemId: line.id, name: line.name, quantity: Number(line.quantity), revenue, stage, expectedDeliveryAt: expected, late, cost }
  })

  const revenue = lines.reduce((sum, line) => sum + (line.revenue ?? 0), 0)
  // Cost of orders not tied to a line still costs the deal.
  const committed = orders.filter((order) => (COMMITTED_STATUSES as readonly string[]).includes(order.status))
  const cost = committed.filter((order) => order.currency === deal.currency).reduce((sum, order) => sum + Number(order.totalAmount), 0)
  const foreignCost: Record<string, number> = {}
  for (const order of committed) {
    if (order.currency !== deal.currency) foreignCost[order.currency] = (foreignCost[order.currency] ?? 0) + Number(order.totalAmount)
  }
  const exact = Object.keys(foreignCost).length === 0
  const ready = lines.filter((line) => line.stage === "received").length
  const pending = lines.filter((line) => line.expectedDeliveryAt && line.stage !== "received")
  let nextExpected: Date | null = null
  for (const line of pending) {
    if (line.expectedDeliveryAt && (!nextExpected || line.expectedDeliveryAt > nextExpected)) nextExpected = line.expectedDeliveryAt
  }

  return {
    currency: deal.currency,
    lines,
    totals: {
      revenue,
      cost,
      margin: exact ? revenue - cost : null,
      marginPct: exact && revenue > 0 ? Math.round(((revenue - cost) / revenue) * 1000) / 10 : null,
      foreignCost: exact ? null : foreignCost,
    },
    summary: { ready, total: lines.length, late: lines.some((line) => line.late), nextExpected, dealChanged: requests.some((r) => r.dealChangedAt) || orders.some((o) => o.dealChangedAt) },
    requests: requests.map((request: RequestRow) => ({ id: request.id, title: request.title, status: request.status, neededBy: request.neededBy, dealChangedAt: request.dealChangedAt, number: procurementNumber("request", request.seq) })),
    orders: orders.map((order: OrderRow) => ({
      id: order.id, status: order.status, currency: order.currency, totalAmount: order.totalAmount, expectedDeliveryAt: order.expectedDeliveryAt,
      dealChangedAt: order.dealChangedAt, supplier: order.supplier, number: procurementNumber("order", order.seq), late: isLate(order, now),
    })),
  }
}

export type DealProcurementSummary = NonNullable<Awaited<ReturnType<typeof dealProcurementSummary>>>
