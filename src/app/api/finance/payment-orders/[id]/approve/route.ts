import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"

// POST — pending_approval → approved
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  return runWithTenant(orgId, async () => {
    const { id } = await params

    const order = await prisma.paymentOrder.findFirst({ where: { id, organizationId: orgId } })
    if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (order.status !== "pending_approval") return NextResponse.json({ error: "Only pending orders can be approved" }, { status: 400 })

    const updated = await prisma.paymentOrder.update({
      where: { id },
      data: { status: "approved", approvedAt: new Date() },
    })

    return NextResponse.json({ data: updated })
  })
}
