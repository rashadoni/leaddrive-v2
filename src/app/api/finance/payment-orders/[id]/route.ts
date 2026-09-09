import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"

const updateSchema = z.object({
  counterpartyName: z.string().min(1).max(200).optional(),
  counterpartyId: z.string().max(100).optional().nullable(),
  billId: z.string().max(100).optional().nullable(),
  bankAccountId: z.string().max(100).optional().nullable(),
  amount: z.union([z.string().min(1), z.number().min(0.01)]).optional(),
  currency: z.string().max(10).optional(),
  purpose: z.string().min(1).max(2000).optional(),
  paymentMethod: z.string().max(50).optional(),
  bankDetails: z.string().max(2000).optional().nullable(),
}).strict()

// GET — single payment order
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  return runWithTenant(orgId, async () => {
    const { id } = await params

    const order = await prisma.paymentOrder.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 })

    return NextResponse.json({ data: order })
  })
}

// PUT — update payment order (only draft/pending_approval)
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  return runWithTenant(orgId, async () => {
    const { id } = await params

    const existing = await prisma.paymentOrder.findFirst({ where: { id, organizationId: orgId } })
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (!["draft", "pending_approval"].includes(existing.status)) {
      return NextResponse.json({ error: "Cannot edit order in current status" }, { status: 400 })
    }

    let body
    try { body = await req.json() } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
    }

    let data
    try { data = updateSchema.parse(body) } catch (e) {
      if (e instanceof ZodError) return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
      return NextResponse.json({ error: "Invalid request" }, { status: 400 })
    }

    const updateData: any = {}
    if (data.counterpartyName !== undefined) updateData.counterpartyName = data.counterpartyName
    if (data.counterpartyId !== undefined) updateData.counterpartyId = data.counterpartyId
    if (data.billId !== undefined) updateData.billId = data.billId
    if (data.bankAccountId !== undefined) updateData.bankAccountId = data.bankAccountId
    if (data.amount !== undefined) updateData.amount = parseFloat(String(data.amount))
    if (data.currency !== undefined) updateData.currency = data.currency
    if (data.purpose !== undefined) updateData.purpose = data.purpose
    if (data.paymentMethod !== undefined) updateData.paymentMethod = data.paymentMethod
    if (data.bankDetails !== undefined) updateData.bankDetails = data.bankDetails

    const order = await prisma.paymentOrder.update({ where: { id }, data: updateData })
    return NextResponse.json({ data: order })
  })
}

// DELETE — delete payment order (only draft)
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  return runWithTenant(orgId, async () => {
    const { id } = await params

    const existing = await prisma.paymentOrder.findFirst({ where: { id, organizationId: orgId } })
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (existing.status !== "draft") {
      return NextResponse.json({ error: "Can only delete drafts" }, { status: 400 })
    }

    await prisma.paymentOrder.delete({ where: { id } })
    return NextResponse.json({ success: true })
  })
}
