import { prisma } from "@/lib/prisma"
import { procurementNumber } from "@/lib/procurement/numbering"
import { COMMITTED_STATUSES } from "@/lib/procurement/order-status"
import { isLate } from "@/lib/procurement/orders"

/**
 * Purchasing reports (docs/sales-procurement/README.md, task 7.1) for orders
 * created in a period: the orders themselves; suppliers — spend, on time or
 * late, average delay; deals — revenue, cost, margin; and how long approval
 * takes. Money is never added across currencies (no exchange rates in the
 * product): spend is per supplier and currency, and a deal with an order in
 * another currency gets no margin.
 */
const DAY = 86_400_000

type OrderRow = {
  id: string; seq: number; status: string; currency: string; totalAmount: { toString(): string }
  createdAt: Date; submittedAt: Date | null; approvedAt: Date | null; sentAt: Date | null; receivedAt: Date | null; expectedDeliveryAt: Date | null
  supplier: { id: string; name: string }; deal: { id: string; name: string; currency: string } | null
}

export interface ProcurementReport {
  period: { from: string; to: string }
  kpis: {
    orders: number
    committedByCurrency: Record<string, number>
    received: number
    onTimePct: number | null
    averageDelayDays: number | null
    lateOpen: number
    averageApprovalHours: number | null
  }
  orders: { id: string; number: string; supplier: string; deal: string | null; status: string; currency: string; total: number; createdAt: string; expectedDeliveryAt: string | null; receivedAt: string | null; delayDays: number | null; late: boolean }[]
  suppliers: { supplierId: string; supplier: string; currency: string; orders: number; spend: number; received: number; onTime: number; late: number; averageDelayDays: number | null }[]
  deals: { dealId: string; deal: string; currency: string; revenue: number; cost: number | null; margin: number | null; marginPct: number | null; otherCurrency: boolean }[]
}

const round1 = (value: number) => Math.round(value * 10) / 10
/** Calendar days the goods came after the due date (UTC days); 0 = on time. */
const dayNumber = (date: Date) => Math.floor(date.getTime() / DAY)
const delayDays = (order: { expectedDeliveryAt: Date | null; receivedAt: Date | null }) =>
  order.expectedDeliveryAt && order.receivedAt ? Math.max(0, dayNumber(order.receivedAt) - dayNumber(order.expectedDeliveryAt)) : null

export async function procurementReport(orgId: string, from: Date, to: Date, now = new Date()): Promise<ProcurementReport> {
  const orders: OrderRow[] = await prisma.purchaseOrder.findMany({
    where: { organizationId: orgId, createdAt: { gte: from, lt: to } },
    orderBy: [{ seq: "asc" }],
    take: 5000,
    select: {
      id: true, seq: true, status: true, currency: true, totalAmount: true, createdAt: true, submittedAt: true, approvedAt: true, sentAt: true, receivedAt: true, expectedDeliveryAt: true,
      supplier: { select: { id: true, name: true } },
      deal: { select: { id: true, name: true, currency: true } },
    },
  })
  const committed = orders.filter((order) => (COMMITTED_STATUSES as readonly string[]).includes(order.status))
  const received = orders.filter((order) => order.status === "received")
  const judged = received.filter((order) => order.expectedDeliveryAt)
  const onTime = judged.filter((order) => (delayDays(order) ?? 0) === 0)
  const delays = judged.map((order) => delayDays(order) ?? 0)
  const approvals = orders.filter((order) => order.submittedAt && order.approvedAt).map((order) => (order.approvedAt!.getTime() - order.submittedAt!.getTime()) / 3_600_000)

  const committedByCurrency: Record<string, number> = {}
  for (const order of committed) committedByCurrency[order.currency] = (committedByCurrency[order.currency] ?? 0) + Number(order.totalAmount.toString())

  const suppliers = new Map<string, ProcurementReport["suppliers"][number] & { delaySum: number; delayCount: number }>()
  for (const order of orders) {
    const key = `${order.supplier.id}:${order.currency}`
    const row = suppliers.get(key) ?? { supplierId: order.supplier.id, supplier: order.supplier.name, currency: order.currency, orders: 0, spend: 0, received: 0, onTime: 0, late: 0, averageDelayDays: null, delaySum: 0, delayCount: 0 }
    row.orders += 1
    if ((COMMITTED_STATUSES as readonly string[]).includes(order.status)) row.spend += Number(order.totalAmount.toString())
    if (order.status === "received") {
      row.received += 1
      const delay = delayDays(order)
      if (delay !== null) {
        row.delayCount += 1
        row.delaySum += delay
        if (delay === 0) row.onTime += 1
        else row.late += 1
      }
    } else if (isLate(order, now)) {
      row.late += 1
    }
    suppliers.set(key, row)
  }

  const dealIds = [...new Set(committed.map((order) => order.deal?.id).filter((id): id is string => !!id))]
  const lines: { dealId: string; quantity: { toString(): string }; unitPrice: { toString(): string } | null; discountPct: { toString(): string } }[] = dealIds.length
    ? await prisma.dealLineItem.findMany({ where: { organizationId: orgId, dealId: { in: dealIds } }, select: { dealId: true, quantity: true, unitPrice: true, discountPct: true } })
    : []
  const revenue = new Map<string, number>()
  for (const line of lines) {
    if (line.unitPrice === null) continue
    const value = Number(line.quantity.toString()) * Number(line.unitPrice.toString()) * (1 - Number(line.discountPct.toString()) / 100)
    revenue.set(line.dealId, (revenue.get(line.dealId) ?? 0) + value)
  }
  const deals = new Map<string, ProcurementReport["deals"][number]>()
  for (const order of committed) {
    if (!order.deal) continue
    const row = deals.get(order.deal.id) ?? { dealId: order.deal.id, deal: order.deal.name, currency: order.deal.currency, revenue: revenue.get(order.deal.id) ?? 0, cost: 0, margin: null, marginPct: null, otherCurrency: false }
    if (order.currency === order.deal.currency) row.cost = (row.cost ?? 0) + Number(order.totalAmount.toString())
    else row.otherCurrency = true
    deals.set(order.deal.id, row)
  }
  for (const row of deals.values()) {
    if (row.otherCurrency) { row.cost = null; continue }
    row.margin = row.revenue - (row.cost ?? 0)
    row.marginPct = row.revenue > 0 ? round1((row.margin / row.revenue) * 100) : null
  }

  return {
    period: { from: from.toISOString(), to: to.toISOString() },
    kpis: {
      orders: orders.length,
      committedByCurrency,
      received: received.length,
      onTimePct: judged.length ? round1((onTime.length / judged.length) * 100) : null,
      averageDelayDays: delays.length ? round1(delays.reduce((a, b) => a + b, 0) / delays.length) : null,
      lateOpen: orders.filter((order) => isLate(order, now)).length,
      averageApprovalHours: approvals.length ? round1(approvals.reduce((a, b) => a + b, 0) / approvals.length) : null,
    },
    orders: orders.map((order) => ({
      id: order.id,
      number: procurementNumber("order", order.seq),
      supplier: order.supplier.name,
      deal: order.deal?.name ?? null,
      status: order.status,
      currency: order.currency,
      total: Number(order.totalAmount.toString()),
      createdAt: order.createdAt.toISOString(),
      expectedDeliveryAt: order.expectedDeliveryAt?.toISOString() ?? null,
      receivedAt: order.receivedAt?.toISOString() ?? null,
      delayDays: delayDays(order),
      late: isLate(order, now),
    })),
    suppliers: [...suppliers.values()].map(({ delaySum, delayCount, ...row }) => ({ ...row, averageDelayDays: delayCount ? round1(delaySum / delayCount) : null })).sort((a, b) => b.spend - a.spend),
    deals: [...deals.values()].sort((a, b) => (b.margin ?? -Infinity) - (a.margin ?? -Infinity)),
  }
}

/** The period from the query string: `from` / `to` as yyyy-mm-dd, the last 90 days by default; at most two years. */
export function reportPeriod(searchParams: URLSearchParams, now = new Date()): { from: Date; to: Date } | null {
  const parse = (value: string | null) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : null)
  const to = parse(searchParams.get("to")) ? new Date(parse(searchParams.get("to"))!.getTime() + DAY) : new Date(now.getTime() + DAY)
  const from = parse(searchParams.get("from")) ?? new Date(to.getTime() - 91 * DAY)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to || to.getTime() - from.getTime() > 731 * DAY) return null
  return { from, to }
}
