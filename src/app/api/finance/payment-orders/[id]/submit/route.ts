import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { notifyPaymentOrderPending } from "@/lib/finance/telegram-notify"

// POST — draft → pending_approval
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  return runWithTenant(orgId, async () => {
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
}
