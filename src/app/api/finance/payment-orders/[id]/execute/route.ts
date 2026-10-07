import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { prisma } from "@/lib/prisma"
import { notifyPaymentOrderExecuted } from "@/lib/finance/telegram-notify"
import { applyBillPayment, BillNotFoundError } from "@/lib/finance/bill-payment"

type RouteContext = { params: Promise<{ id: string }> }

class OrderNoLongerApprovedError extends Error {}

// POST — approved → executed (creates BillPayment + RegistryEntry in transaction)
export const POST = withRlsAuth<RouteContext>("finance", "write", async (_req, auth, { params }) => {
  const { orgId } = auth
  const { id } = await params

  const order = await prisma.paymentOrder.findFirst({ where: { id, organizationId: orgId } })
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (order.status !== "approved") return NextResponse.json({ error: "Only approved orders can be executed" }, { status: 400 })

  const now = new Date()
  let result
  try {
    result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // 1. Claim the order: approved → executed, exactly once. Two requests
      //    that both read "approved" above used to each record the payment.
      const claimed = await tx.paymentOrder.updateMany({
        where: { id, organizationId: orgId, status: "approved" },
        data: { status: "executed", executedAt: now },
      })
      if (claimed.count !== 1) throw new OrderNoLongerApprovedError()

      // 2. If linked to a bill, record the payment and bring the bill up to date.
      //    The order's own column is a Float; the bill's are NUMERIC(18,4).
      if (order.billId) {
        await applyBillPayment(tx, {
          organizationId: orgId,
          billId: order.billId,
          amount: new Prisma.Decimal(order.amount).toDecimalPlaces(4),
          currency: order.currency,
          paymentMethod: order.paymentMethod,
          paymentDate: now,
          reference: order.orderNumber,
          notes: null,
          createdBy: auth.userId || null,
        })
      }

      // 3. Create registry entry
      await tx.paymentRegistryEntry.create({
        data: {
          organizationId: orgId,
          direction: "outgoing",
          amount: order.amount,
          currency: order.currency,
          counterpartyName: order.counterpartyName,
          counterpartyId: order.counterpartyId,
          sourceType: "payment_order",
          sourceId: order.id,
          billId: order.billId,
          category: "vendor_payment",
          paymentDate: now,
          description: `${order.orderNumber}: ${order.purpose}`,
          createdBy: auth.userId || null,
        },
      })

      return tx.paymentOrder.findFirst({ where: { id, organizationId: orgId } })
    })
  } catch (e) {
    if (e instanceof OrderNoLongerApprovedError) {
      return NextResponse.json({ error: "The order was changed by someone else. Reload and try again." }, { status: 409 })
    }
    if (e instanceof BillNotFoundError) {
      return NextResponse.json({ error: "The bill this order pays no longer exists" }, { status: 409 })
    }
    throw e
  }

  // Send Telegram notification
  await notifyPaymentOrderExecuted({
    orderNumber: order.orderNumber,
    counterpartyName: order.counterpartyName,
    amount: order.amount,
    currency: order.currency,
    purpose: order.purpose,
  }, orgId)

  return NextResponse.json({ data: result })
})
