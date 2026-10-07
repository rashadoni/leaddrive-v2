import { Prisma, type BillPayment } from "@prisma/client"

/** The bound the request schemas already put on a numeric amount. */
const MAX_AMOUNT = "999999999"

/** Plain decimal notation only: no sign, no exponent, no thousands separator. */
const PLAIN_DECIMAL = /^\d+(\.\d+)?$/

export class InvalidMoneyAmountError extends Error {}

/**
 * A money amount from a request body, as an exact decimal.
 *
 * The finance routes used `parseFloat(String(amount))`. That read "12abc" as
 * 12, let "-500" through (the schemas bounded numbers, not strings), and turned
 * "abc" into NaN, which reached Prisma and came back as a 500. Worse than any
 * of those, it put every sum through IEEE-754 on its way into NUMERIC(18,4)
 * columns that were migrated to Decimal precisely to stop that.
 *
 * Four decimal places because that is the scale of the columns: a fifth digit
 * would be rounded away by Postgres without anyone being told.
 */
export function parseMoneyAmount(
  value: string | number,
  options: { allowZero?: boolean } = {},
): Prisma.Decimal {
  if (typeof value === "string" && !PLAIN_DECIMAL.test(value.trim())) {
    throw new InvalidMoneyAmountError("amount must be a decimal number")
  }
  let amount: Prisma.Decimal
  try {
    amount = new Prisma.Decimal(typeof value === "string" ? value.trim() : value)
  } catch {
    throw new InvalidMoneyAmountError("amount must be a decimal number")
  }
  if (!amount.isFinite()) throw new InvalidMoneyAmountError("amount must be a decimal number")
  if (options.allowZero ? amount.lt(0) : amount.lte(0)) {
    throw new InvalidMoneyAmountError(
      options.allowZero ? "amount must not be negative" : "amount must be greater than zero",
    )
  }
  if (amount.gt(MAX_AMOUNT)) throw new InvalidMoneyAmountError(`amount must be at most ${MAX_AMOUNT}`)
  if (amount.decimalPlaces() > 4) {
    throw new InvalidMoneyAmountError("amount supports at most 4 decimal places")
  }
  return amount
}

export class BillNotFoundError extends Error {
  constructor() {
    super("Bill not found")
  }
}

export interface BillPaymentInput {
  organizationId: string
  billId: string
  amount: Prisma.Decimal
  currency: string
  paymentMethod: string
  paymentDate: Date
  reference: string | null
  notes: string | null
  /** The person recording the payment; null only for a caller with no user behind it. */
  createdBy: string | null
}

export interface AppliedBillPayment {
  payment: BillPayment
  bill: {
    id: string
    billNumber: string
    vendorName: string
    vendorId: string | null
    category: string | null
  }
  /** What is still owed on the bill after this payment. */
  balanceDue: Prisma.Decimal
}

/**
 * Record one payment against a vendor bill and bring the bill's totals up to
 * date. Must be called inside a transaction: the payment row and the bill it
 * pays either both change or neither does.
 *
 * The bill's `paidAmount` is raised with an atomic increment rather than
 * computed from a value read earlier. Two payments recorded at the same moment
 * used to read the same `paidAmount` and each write back its own sum, so one of
 * them vanished from the total while its row stayed in the list. The increment
 * also takes the row lock, and holds it until the transaction ends, so the
 * balance derived from the returned row cannot be stale by the time it is
 * written.
 */
export async function applyBillPayment(
  tx: Prisma.TransactionClient,
  input: BillPaymentInput,
): Promise<AppliedBillPayment> {
  const bill = await tx.bill.findFirst({
    where: { id: input.billId, organizationId: input.organizationId },
    select: { id: true, billNumber: true, vendorName: true, vendorId: true, category: true },
  })
  if (!bill) throw new BillNotFoundError()

  const payment = await tx.billPayment.create({
    data: {
      organizationId: input.organizationId,
      billId: bill.id,
      amount: input.amount,
      currency: input.currency,
      paymentMethod: input.paymentMethod,
      paymentDate: input.paymentDate,
      reference: input.reference,
      notes: input.notes,
      createdBy: input.createdBy,
    },
  })

  const raised = await tx.bill.update({
    where: { id: bill.id, organizationId: input.organizationId },
    data: { paidAmount: { increment: input.amount } },
    select: { totalAmount: true, paidAmount: true, status: true },
  })
  const paid = new Prisma.Decimal(String(raised.paidAmount))
  const remaining = new Prisma.Decimal(String(raised.totalAmount)).minus(paid)
  const balanceDue = remaining.lt(0) ? new Prisma.Decimal(0) : remaining
  const settled = balanceDue.lte(0)

  await tx.bill.update({
    where: { id: bill.id, organizationId: input.organizationId },
    data: {
      balanceDue,
      status: settled ? "paid" : paid.gt(0) ? "partially_paid" : raised.status,
      ...(settled ? { paidAt: new Date() } : {}),
    },
  })

  return { payment, bill, balanceDue }
}
