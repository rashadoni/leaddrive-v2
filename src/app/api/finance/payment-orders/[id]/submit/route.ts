import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { prisma } from "@/lib/prisma"
import { notifyPaymentOrderPending } from "@/lib/finance/telegram-notify"

type RouteContext = { params: Promise<{ id: string }> }

// POST — draft → pending_approval
export const POST = withRlsAuth<RouteContext>("finance", "write", async (_req, { orgId }, { params }) => {
  const { id } = await params

  const order = await prisma.paymentOrder.findFirst({ where: { id, organizationId: orgId } })
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (order.status !== "draft") return NextResponse.json({ error: "Only drafts can be submitted" }, { status: 400 })

  const updated = await prisma.paymentOrder.update({
    where: { id },
    data: { status: "pending_approval" },
  })

  // Notify via Telegram
  await notifyPaymentOrderPending({
    orderNumber: order.orderNumber,
    counterpartyName: order.counterpartyName,
    amount: order.amount,
    currency: order.currency,
    purpose: order.purpose,
  }, orgId)

  return NextResponse.json({ data: updated })
})
