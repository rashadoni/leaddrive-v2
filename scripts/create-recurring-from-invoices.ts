/**
 * One-time script: Create RecurringInvoice rules from existing invoices
 * Run on server: npx tsx scripts/create-recurring-from-invoices.ts
 */
import type { PrismaClient } from "@prisma/client"
import { makeScriptPrisma } from "./_rls.mjs"

let prisma!: PrismaClient

async function main() {
  prisma = await makeScriptPrisma()
  const org = await prisma.organization.findFirst({ select: { id: true } })
  if (!org) throw new Error("No organization found")
  const orgId = org.id

  // Get all invoices with items
  const invoices = await prisma.invoice.findMany({
    where: { organizationId: orgId },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      company: { select: { name: true } },
    },
    orderBy: { invoiceNumber: "asc" },
  })

  // Check existing recurring invoices to avoid duplicates
  const existingRecurring = await prisma.recurringInvoice.findMany({
    where: { organizationId: orgId },
    select: { companyId: true },
  })
  const existingCompanyIds = new Set(existingRecurring.map((r) => r.companyId))

  console.log(`Found ${invoices.length} invoices`)
  let created = 0
  let skipped = 0

  for (const inv of invoices) {
    // Skip if recurring rule already exists for this company
    if (inv.companyId && existingCompanyIds.has(inv.companyId)) {
      console.log(`  SKIP: ${inv.invoiceNumber} | ${inv.company?.name || "?"} — recurring rule already exists`)
      skipped++
      continue
    }

    // Create RecurringInvoice
    const rec = await prisma.recurringInvoice.create({
      data: {
        organizationId: orgId,
        title: inv.title || `${inv.company?.name || ""} — İT xidmətləri`,
        titleTemplate: `${inv.company?.name || ""} — İT xidmətləri — {month} {year}`,
        companyId: inv.companyId || undefined,
        contactId: inv.contactId || undefined,
        dealId: inv.dealId || undefined,
        contractId: inv.contractId || undefined,
        frequency: "monthly",
        intervalCount: 1,
        startDate: new Date("2026-03-25"),
        nextRunDate: new Date("2026-04-25"),
        currency: inv.currency || "AZN",
        taxRate: Number(inv.taxRate) || 0,
        includeVat: inv.includeVat || false,
        voen: inv.voen || undefined,
        paymentTerms: inv.paymentTerms || "net30",
        recipientEmail: inv.recipientEmail || undefined,
        notes: inv.notes || undefined,
        termsAndConditions: inv.termsAndConditions || undefined,
        autoSend: true,
        dayOfMonth: 25,
        isActive: true,
        items: {
          create: inv.items.map((item) => ({
            productId: item.productId || undefined,
            name: item.name,
            description: item.description || undefined,
            quantity: Number(item.quantity) || 1,
            unitPrice: Number(item.unitPrice) || 0,
            discount: Number(item.discount) || 0,
            sortOrder: item.sortOrder || 0,
            customFields: item.customFields || undefined,
          })),
        },
      },
    })

    // Link the original invoice to the recurring rule
    await prisma.invoice.update({
      where: { id: inv.id },
      data: { recurringInvoiceId: rec.id },
    })

    if (inv.companyId) existingCompanyIds.add(inv.companyId)

    console.log(
      `  ✓ ${inv.invoiceNumber} | ${inv.company?.name || "?"} | ${inv.items.length} items | autoSend: true`
    )
    created++
  }

  console.log(`\nDone: ${created} recurring rules created, ${skipped} skipped`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
