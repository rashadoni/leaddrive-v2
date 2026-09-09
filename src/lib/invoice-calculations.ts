export interface InvoiceItemInput {
  quantity: number
  unitPrice: number
  discount: number
  taxRate?: number | null
}

export interface InvoiceTotals {
  subtotal: number
  discountAmount: number
  taxAmount: number
  totalAmount: number
}

export function calculateItemTotal(item: InvoiceItemInput): number {
  const lineTotal = item.quantity * item.unitPrice
  const discountAmt = lineTotal * (item.discount / 100)
  return Math.round((lineTotal - discountAmt) * 100) / 100
}

export function calculateInvoiceTotals(
  items: InvoiceItemInput[],
  discountType: "percentage" | "fixed",
  discountValue: number,
  taxRate: number,
  includeVat: boolean
): InvoiceTotals {
  const subtotal = items.reduce((sum, item) => sum + calculateItemTotal(item), 0)

  let discountAmount = 0
  if (discountType === "percentage") {
    discountAmount = subtotal * (discountValue / 100)
  } else {
    discountAmount = discountValue
  }

  const afterDiscount = subtotal - discountAmount
  const taxAmount = includeVat ? afterDiscount * taxRate : 0
  const totalAmount = afterDiscount + taxAmount

  return {
    subtotal: Math.round(subtotal * 100) / 100,
    discountAmount: Math.round(discountAmount * 100) / 100,
    taxAmount: Math.round(taxAmount * 100) / 100,
    totalAmount: Math.round(totalAmount * 100) / 100,
  }
}

export function calculateBalance(totalAmount: number, paidAmount: number): number {
  return Math.round((totalAmount - paidAmount) * 100) / 100
}

export function getPaymentTermsDays(paymentTerms: string, customDays?: number | null): number {
  switch (paymentTerms) {
    case "due_on_receipt": return 0
    case "net15": return 15
    case "net30": return 30
    case "net45": return 45
    case "net60": return 60
    case "custom": return customDays || 30
    default: return 30
  }
}

export function calculateDueDate(issueDate: Date, paymentTerms: string, customDays?: number | null): Date {
  const days = getPaymentTermsDays(paymentTerms, customDays)
  const dueDate = new Date(issueDate)
  dueDate.setDate(dueDate.getDate() + days)
  return dueDate
}
