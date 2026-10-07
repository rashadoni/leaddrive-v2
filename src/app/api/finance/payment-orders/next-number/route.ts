import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { prisma } from "@/lib/prisma"

// GET — next available order number
export const GET = withRlsAuth("finance", "read", async (_req, { orgId }) => {
  const last = await prisma.paymentOrder.findFirst({
    where: { organizationId: orgId },
    orderBy: { createdAt: "desc" },
    select: { orderNumber: true },
  })

  const lastNum = last ? parseInt(last.orderNumber.replace(/\D/g, "")) || 0 : 0
  const nextNumber = `ПП-${String(lastNum + 1).padStart(3, "0")}`

  return NextResponse.json({ data: { nextNumber } })
})
