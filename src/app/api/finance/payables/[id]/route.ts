import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { withRlsAuth } from "@/lib/with-rls"
import { prisma } from "@/lib/prisma"
import { parseMoneyAmount } from "@/lib/finance/bill-payment"
import { normalizeBillRow, normalizeBillPaymentRow } from "@/lib/prisma-decimal"

type RouteContext = { params: Promise<{ id: string }> }

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
export const GET = withRlsAuth<RouteContext>("finance", "read", async (_req, { orgId }, { params }) => {
  const { id } = await params

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

// PUT — update bill
export const PUT = withRlsAuth<RouteContext>("finance", "write", async (req, { orgId }, { params }) => {
  const { id } = await params

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

  // A new total changes what is still owed, not what was already paid: the
  // balance is the new total less the payments on record. It used to be reset
  // to the full total, so correcting the amount of a half-paid bill made it
  // look unpaid again.
  let totals: { totalAmount: Prisma.Decimal; balanceDue: Prisma.Decimal } | undefined
  if (totalAmount !== undefined) {
    let total: Prisma.Decimal
    try {
      total = parseMoneyAmount(totalAmount, { allowZero: true })
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid amount" }, { status: 400 })
    }
    const remaining = total.minus(String(existing.paidAmount))
    totals = { totalAmount: total, balanceDue: remaining.lt(0) ? new Prisma.Decimal(0) : remaining }
  }

  const bill = await prisma.bill.update({
    where: { id },
    data: {
      ...(billNumber !== undefined && { billNumber }),
      ...(vendorName !== undefined && { vendorName }),
      ...(vendorId !== undefined && { vendorId }),
      ...(title !== undefined && { title }),
      ...(totals !== undefined && totals),
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

// DELETE — delete bill
export const DELETE = withRlsAuth<RouteContext>("finance", "delete", async (_req, { orgId }, { params }) => {
  const { id } = await params

  const existing = await prisma.bill.findFirst({ where: { id, organizationId: orgId } })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // The bill goes first: deleting it waits for a payment that is being
    // recorded on it right now, so the registry rows removed below include
    // that payment's.
    await tx.bill.delete({ where: { id } })
    // The database deletes the bill's payments with it. Their registry rows
    // have no foreign key and would stay, still counted as money paid out.
    // An executed payment order's row is not one of them: the order outlives
    // the bill and its row describes the order.
    await tx.paymentRegistryEntry.deleteMany({
      where: { organizationId: orgId, sourceType: "bill_payment", billId: id },
    })
  })
  return NextResponse.json({ data: { success: true } })
})
