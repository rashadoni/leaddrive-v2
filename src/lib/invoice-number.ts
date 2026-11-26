import { prisma } from "@/lib/prisma"

/**
 * `client` — the transaction a caller holds, when it numbers an invoice inside one: the
 * global client inside a transaction's callback runs outside it and, under RLS, sees no rows
 * (it would number every invoice 00001).
 */
export async function generateInvoiceNumber(
  organizationId: string,
  client: { invoice: { findFirst: typeof prisma.invoice.findFirst } } = prisma,
): Promise<string> {
  const year = new Date().getFullYear()
  const prefix = `INV-${year}-`

  const lastInvoice = await client.invoice.findFirst({
    where: {
      organizationId,
      invoiceNumber: { startsWith: prefix },
    },
    orderBy: { invoiceNumber: "desc" },
    select: { invoiceNumber: true },
  })

  let nextNum = 1
  if (lastInvoice) {
    const lastNum = parseInt(lastInvoice.invoiceNumber.replace(prefix, ""), 10)
    if (!isNaN(lastNum)) nextNum = lastNum + 1
  }

  return `${prefix}${String(nextNum).padStart(5, "0")}`
}
