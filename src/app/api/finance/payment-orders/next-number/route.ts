import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"

// GET — next available order number
export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  return runWithTenant(orgId, async () => {
    const last = await prisma.paymentOrder.findFirst({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      select: { orderNumber: true },
    })

    const lastNum = last ? parseInt(last.orderNumber.replace(/\D/g, "")) || 0 : 0
    const nextNumber = `ПП-${String(lastNum + 1).padStart(3, "0")}`

    return NextResponse.json({ data: { nextNumber } })
  })
}
