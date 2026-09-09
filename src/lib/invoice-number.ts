import { prisma } from "@/lib/prisma"

export async function generateInvoiceNumber(organizationId: string): Promise<string> {
  const year = new Date().getFullYear()
  const prefix = `INV-${year}-`

  const lastInvoice = await prisma.invoice.findFirst({
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
