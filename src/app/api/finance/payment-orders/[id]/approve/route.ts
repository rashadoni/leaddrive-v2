import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { prisma } from "@/lib/prisma"
import { isOwnOrderToApprove } from "@/lib/finance/payment-order-approval"

type RouteContext = { params: Promise<{ id: string }> }

// POST — pending_approval → approved
export const POST = withRlsAuth<RouteContext>("finance", "write", async (_req, auth, { params }) => {
  const { orgId } = auth
  const { id } = await params

  // An approval is a person's decision and is recorded under their name. An
  // API key carries its creator's id for audit, not as a right to sign for them.
  if (auth.principalType !== "session" || !auth.userId) {
    return NextResponse.json(
      { error: "Forbidden", message: "A payment order is approved by a signed-in user" },
      { status: 403 },
    )
  }

  const order = await prisma.paymentOrder.findFirst({ where: { id, organizationId: orgId } })
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (order.status !== "pending_approval") return NextResponse.json({ error: "Only pending orders can be approved" }, { status: 400 })
  if (isOwnOrderToApprove(order, auth)) {
    return NextResponse.json(
      { error: "Forbidden", message: "A payment order is approved by someone other than the person who created it" },
      { status: 403 },
    )
  }

  // Compare-and-set on the status: an approval that lost a race with a
  // rejection (or with a second approval) changes nothing, instead of
  // overwriting the other person's decision.
  const claimed = await prisma.paymentOrder.updateMany({
    where: { id, organizationId: orgId, status: "pending_approval" },
    data: { status: "approved", approvedAt: new Date(), approvedBy: auth.userId },
  })
  if (claimed.count !== 1) {
    return NextResponse.json({ error: "The order was changed by someone else. Reload and try again." }, { status: 409 })
  }

  const updated = await prisma.paymentOrder.findFirst({ where: { id, organizationId: orgId } })
  return NextResponse.json({ data: updated })
})
