import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { notifyPaymentOrderExecuted } from "@/lib/finance/telegram-notify"
import { decimalToNumber } from "@/lib/prisma-decimal"

// POST — approved → executed (creates BillPayment + RegistryEntry in transaction)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return runWithTenant(orgId, async () => {
  const { id } = await params

  const order = await prisma.paymentOrder.findFirst({ where: { id, organizationId: orgId } })
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (order.status !== "approved") return NextResponse.json({ error: "Only approved orders can be executed" }, { status: 400 })

  const result = await prisma.$transaction(async (tx: any) => {
    // 1. Mark order as executed
    const updated = await tx.paymentOrder.update({
      where: { id },
      data: { status: "executed", executedAt: new Date() },
    })

    // 2. If linked to a bill, create BillPayment and update bill
    if (order.billId) {
      await tx.billPayment.create({
        data: {
          organizationId: orgId,
          billId: order.billId,
          amount: order.amount,
          currency: order.currency,
          paymentMethod: order.paymentMethod,
          paymentDate: new Date(),
          reference: order.orderNumber,
        },
      })

      const bill = await tx.bill.findUnique({ where: { id: order.billId } })
      if (bill) {
        // Bill columns are Decimal(18,4); convert to number before arithmetic
        const newPaid = decimalToNumber(bill.paidAmount) + decimalToNumber(order.amount)
        const newBalance = Math.max(0, decimalToNumber(bill.totalAmount) - newPaid)
        const newStatus = newBalance <= 0 ? "paid" : newPaid > 0 ? "partially_paid" : bill.status
        await tx.bill.update({
          where: { id: order.billId },
          data: {
            paidAmount: newPaid,
            balanceDue: newBalance,
            status: newStatus,
            ...(newBalance <= 0 ? { paidAt: new Date() } : {}),
          },
        })
      }
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
        paymentDate: new Date(),
        description: `${order.orderNumber}: ${order.purpose}`,
      },
    })

    return updated
  })

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
}
