import type { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { withRlsAuth } from "@/lib/with-rls"
import { prisma } from "@/lib/prisma"
import { notifyBillPaymentRecorded } from "@/lib/finance/telegram-notify"
import {
  applyBillPayment,
  parseMoneyAmount,
  BillNotFoundError,
  type AppliedBillPayment,
} from "@/lib/finance/bill-payment"
import { DEFAULT_CURRENCY } from "@/lib/constants"
import { normalizeBillPaymentRow } from "@/lib/prisma-decimal"

type RouteContext = { params: Promise<{ id: string }> }

const createPaymentSchema = z.object({
  amount: z.union([z.string().min(1).max(64), z.number()]),
  paymentMethod: z.string().max(50).optional(),
  paymentDate: z.string().max(50).optional(),
  reference: z.string().max(200).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  currency: z.string().max(10).optional(),
}).strict()

// GET — list payments for a bill
export const GET = withRlsAuth<RouteContext>("finance", "read", async (_req, { orgId }, { params }) => {
  const { id } = await params

  const payments = await prisma.billPayment.findMany({
    where: { billId: id, organizationId: orgId },
    orderBy: { paymentDate: "desc" },
  })

  return NextResponse.json({ data: payments.map(normalizeBillPaymentRow) })
})

// POST — add payment to a bill
export const POST = withRlsAuth<RouteContext>("finance", "write", async (req, auth, { params }) => {
  const { orgId } = auth
  const { id: billId } = await params

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

  let amount: Prisma.Decimal
  try {
    amount = parseMoneyAmount(data.amount)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid amount" }, { status: 400 })
  }

  const paymentDate = data.paymentDate ? new Date(data.paymentDate) : new Date()
  if (Number.isNaN(paymentDate.getTime())) {
    return NextResponse.json({ error: "paymentDate is not a valid date" }, { status: 400 })
  }
  const currency = data.currency || DEFAULT_CURRENCY

  // The payment row, the bill's totals and the registry entry are one fact
  // written in three places. They used to be three separate writes, so a
  // failure after the first left a payment that the bill did not count.
  let applied: AppliedBillPayment
  try {
    applied = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const result = await applyBillPayment(tx, {
        organizationId: orgId,
        billId,
        amount,
        currency,
        paymentMethod: data.paymentMethod || "bank_transfer",
        paymentDate,
        reference: data.reference || null,
        notes: data.notes || null,
        createdBy: auth.userId || null,
      })

      // Payment registry entry for the audit trail
      await tx.paymentRegistryEntry.create({
        data: {
          organizationId: orgId,
          direction: "outgoing",
          // The registry column is still a Float; the exact figure lives on the payment row.
          amount: amount.toNumber(),
          currency,
          counterpartyName: result.bill.vendorName,
          counterpartyId: result.bill.vendorId,
          sourceType: "bill_payment",
          sourceId: result.payment.id,
          billId: result.bill.id,
          category: result.bill.category || "vendor_payment",
          paymentDate,
          description: `Оплата по счёту ${result.bill.billNumber}`,
          createdBy: auth.userId || null,
        },
      })

      return result
    })
  } catch (e) {
    if (e instanceof BillNotFoundError) return NextResponse.json({ error: "Not found" }, { status: 404 })
    throw e
  }

  // After the commit, and never part of it: a Telegram outage must not undo a payment.
  await notifyBillPaymentRecorded({
    billNumber: applied.bill.billNumber,
    vendorName: applied.bill.vendorName,
    paymentAmount: amount.toNumber(),
    remainingBalance: applied.balanceDue.toNumber(),
    currency,
  }, orgId)

  return NextResponse.json({ data: normalizeBillPaymentRow(applied.payment) }, { status: 201 })
})
