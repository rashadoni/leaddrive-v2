import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { requireAuth, isAuthError, getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { normalizeBillRow, normalizeBillPaymentRow } from "@/lib/prisma-decimal"

const updateBillSchema = z.object({
  billNumber: z.string().max(50).optional(),
  vendorName: z.string().min(1).max(200).optional(),
  vendorId: z.string().max(100).optional().nullable(),
  title: z.string().min(1).max(300).optional(),
  totalAmount: z.union([z.string(), z.number().min(0).max(999999999)]).optional(),
  currency: z.string().max(10).optional(),
  issueDate: z.string().max(50).optional(),
  dueDate: z.string().max(50).optional().nullable(),
  category: z.string().max(100).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  status: z.string().max(50).optional(),
})

// GET — single bill
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params

  return runWithTenant(orgId, async () => {
    const bill = await prisma.bill.findFirst({
      where: { id, organizationId: orgId },
      include: { payments: true, vendor: { select: { id: true, name: true } } },
    })
    if (!bill) return NextResponse.json({ error: "Not found" }, { status: 404 })

    return NextResponse.json({
      data: {
        ...normalizeBillRow(bill),
        payments: bill.payments.map(normalizeBillPaymentRow),
      },
    })
  })
}

// PUT — update bill
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuth(req, "finance", "write")
  if (isAuthError(authResult)) return authResult
  const orgId = authResult.orgId
  const { id } = await params

  return runWithTenant(orgId, async () => {
    const existing = await prisma.bill.findFirst({ where: { id, organizationId: orgId } })
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

    let body
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
    }

    let data
    try {
      data = updateBillSchema.parse(body)
    } catch (e) {
      if (e instanceof ZodError) {
        return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
      }
      return NextResponse.json({ error: "Invalid request" }, { status: 400 })
    }

    const { billNumber, vendorName, vendorId, title, totalAmount, currency, issueDate, dueDate, category, notes, status } = data

    const bill = await prisma.bill.update({
      where: { id },
      data: {
        ...(billNumber !== undefined && { billNumber }),
        ...(vendorName !== undefined && { vendorName }),
        ...(vendorId !== undefined && { vendorId }),
        ...(title !== undefined && { title }),
        ...(totalAmount !== undefined && { totalAmount: parseFloat(String(totalAmount)), balanceDue: parseFloat(String(totalAmount)) }),
        ...(currency !== undefined && { currency }),
        ...(issueDate !== undefined && { issueDate: new Date(issueDate) }),
        ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
        ...(category !== undefined && { category }),
        ...(notes !== undefined && { notes }),
        ...(status !== undefined && { status }),
      },
    })

    return NextResponse.json({ data: normalizeBillRow(bill) })
  })
}

// DELETE — delete bill
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuth(req, "finance", "delete")
  if (isAuthError(authResult)) return authResult
  const orgId = authResult.orgId
  const { id } = await params

  return runWithTenant(orgId, async () => {
    const existing = await prisma.bill.findFirst({ where: { id, organizationId: orgId } })
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

    await prisma.bill.delete({ where: { id } })
    return NextResponse.json({ data: { success: true } })
  })
}
