import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { getOrgId } from "@/lib/api-auth"
import { runWithTenant } from "@/lib/rls-context"
import { prisma } from "@/lib/prisma"
import { notifyBillPaymentRecorded } from "@/lib/finance/telegram-notify"
import { DEFAULT_CURRENCY } from "@/lib/constants"
import { decimalToNumber, normalizeBillPaymentRow } from "@/lib/prisma-decimal"

const createPaymentSchema = z.object({
  amount: z.union([z.string().min(1), z.number().min(0).max(999999999)]),
  paymentMethod: z.string().max(50).optional(),
  paymentDate: z.string().max(50).optional(),
  reference: z.string().max(200).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  currency: z.string().max(10).optional(),
}).strict()

// GET — list payments for a bill
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params

  return runWithTenant(orgId, async () => {
    const payments = await prisma.billPayment.findMany({
      where: { billId: id, organizationId: orgId },
      orderBy: { paymentDate: "desc" },
    })

    return NextResponse.json({ data: payments.map(normalizeBillPaymentRow) })
  })
}

// POST — add payment to a bill
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id: billId } = await params

  return runWithTenant(orgId, async () => {
    let body
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
    }

    let data
    try {
      data = createPaymentSchema.parse(body)
    } catch (e) {
      if (e instanceof ZodError) {
        return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
      }
      return NextResponse.json({ error: "Invalid request" }, { status: 400 })
    }

    const { amount, paymentMethod, paymentDate, reference, notes, currency } = data

    const paymentAmount = parseFloat(String(amount))

    // Create payment
    const payment = await prisma.billPayment.create({
      data: {
        organizationId: orgId,
        billId,
        amount: paymentAmount,
        currency: currency || DEFAULT_CURRENCY,
        paymentMethod: paymentMethod || "bank_transfer",
        paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
        reference: reference || null,
        notes: notes || null,
      },
    })

    // Update bill totals — paidAmount/totalAmount are Decimal(18,4); convert to number before arithmetic
    const bill = await prisma.bill.findUnique({ where: { id: billId } })
    if (bill) {
      const newPaid = decimalToNumber(bill.paidAmount) + paymentAmount
      const newBalance = Math.max(0, decimalToNumber(bill.totalAmount) - newPaid)
      const newStatus = newBalance <= 0 ? "paid" : newPaid > 0 ? "partially_paid" : bill.status

      await prisma.bill.update({
        where: { id: billId },
        data: {
          paidAmount: newPaid,
          balanceDue: newBalance,
          status: newStatus,
          ...(newBalance <= 0 ? { paidAt: new Date() } : {}),
        },
      })

      // Create payment registry entry for audit trail
      await prisma.paymentRegistryEntry.create({
        data: {
          organizationId: orgId,
          direction: "outgoing",
          amount: paymentAmount,
          currency: currency || DEFAULT_CURRENCY,
          counterpartyName: bill.vendorName,
          counterpartyId: bill.vendorId,
          sourceType: "bill_payment",
          sourceId: payment.id,
          billId,
          category: bill.category || "vendor_payment",
          paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
          description: `Оплата по счёту ${bill.billNumber}`,
        },
      })

      // Send Telegram notification
      await notifyBillPaymentRecorded({
        billNumber: bill.billNumber,
        vendorName: bill.vendorName,
        paymentAmount,
        remainingBalance: newBalance, // identical to Math.max(0, totalAmount - newPaid)
        currency: currency || DEFAULT_CURRENCY,
      }, orgId)
    }

    return NextResponse.json({ data: normalizeBillPaymentRow(payment) }, { status: 201 })
  })
}
