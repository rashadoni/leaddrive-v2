import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { DEFAULT_CURRENCY } from "@/lib/constants"

const createSchema = z.object({
  counterpartyName: z.string().min(1).max(200),
  counterpartyId: z.string().max(100).optional(),
  billId: z.string().max(100).optional(),
  bankAccountId: z.string().max(100).optional(),
  amount: z.union([z.string().min(1), z.number().min(0.01)]),
  currency: z.string().max(10).optional(),
  purpose: z.string().min(1).max(2000),
  paymentMethod: z.string().max(50).optional(),
  bankDetails: z.string().max(2000).optional(),
}).strict()

// GET — list payment orders
export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  return runWithTenant(orgId, async () => {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get("status")

    const where: any = { organizationId: orgId }
    if (status) where.status = status

    const orders = await prisma.paymentOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
    })

    return NextResponse.json({ data: orders })
  })
}

// POST — create payment order
export async function POST(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  return runWithTenant(orgId, async () => {
    let body
    try { body = await req.json() } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
    }

    let data
    try { data = createSchema.parse(body) } catch (e) {
      if (e instanceof ZodError) return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
      return NextResponse.json({ error: "Invalid request" }, { status: 400 })
    }

    // Generate next order number
    const last = await prisma.paymentOrder.findFirst({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      select: { orderNumber: true },
    })
    const lastNum = last ? parseInt(last.orderNumber.replace(/\D/g, "")) || 0 : 0
    const orderNumber = `ПП-${String(lastNum + 1).padStart(3, "0")}`

    const order = await prisma.paymentOrder.create({
      data: {
        organizationId: orgId,
        orderNumber,
        counterpartyName: data.counterpartyName,
        counterpartyId: data.counterpartyId || null,
        billId: data.billId || null,
        bankAccountId: data.bankAccountId || null,
        amount: parseFloat(String(data.amount)),
        currency: data.currency || DEFAULT_CURRENCY,
        purpose: data.purpose,
        paymentMethod: data.paymentMethod || "bank_transfer",
        bankDetails: data.bankDetails || null,
      },
    })

    return NextResponse.json({ data: order }, { status: 201 })
  })
}
