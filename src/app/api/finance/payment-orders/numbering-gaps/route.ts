import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { prisma } from "@/lib/prisma"

// GET — find gaps in payment order numbering (e.g. ПП-001, ПП-003 → gap at ПП-002)
export const GET = withRlsAuth("finance", "read", async (_req, { orgId }) => {
  const orders = await prisma.paymentOrder.findMany({
    where: { organizationId: orgId },
    select: { orderNumber: true, status: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  })

  // Extract numbers from order numbers (ПП-001 → 1, ПП-012 → 12)
  const numbers = orders
    .map((o: any) => {
      const match = o.orderNumber.match(/(\d+)$/)
      return match ? parseInt(match[1]) : null
    })
    .filter((n: any): n is number => n !== null)
    .sort((a: number, b: number) => a - b)

  if (numbers.length === 0) {
    return NextResponse.json({ data: { gaps: [], totalOrders: 0, lastNumber: 0 } })
  }

  const gaps: number[] = []
  const maxNum = numbers[numbers.length - 1]
  const numSet = new Set(numbers)

  for (let i = 1; i <= maxNum; i++) {
    if (!numSet.has(i)) gaps.push(i)
  }

  return NextResponse.json({
    data: {
      gaps: gaps.map((n) => `ПП-${String(n).padStart(3, "0")}`),
      totalOrders: orders.length,
      lastNumber: maxNum,
      nextNumber: `ПП-${String(maxNum + 1).padStart(3, "0")}`,
    },
  })
})
