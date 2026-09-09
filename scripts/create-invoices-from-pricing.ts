/**
 * One-time script: Create one invoice per company from pricing model data
 * Run: npx tsx scripts/create-invoices-from-pricing.ts
 */
import type { PrismaClient } from "@prisma/client"
import { makeScriptPrisma } from "./_rls.mjs"

let prisma!: PrismaClient

async function main() {
  prisma = await makeScriptPrisma()
  const orgId = "cmmxcvbs50000u6qqs3kkb9mf"
  const pricingOrgId = "cmmxg74k10000td3rr37dl6am" // pricing data was imported with different orgId
  const today = new Date()
  const dueDate = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000)

  // Get all active pricing profiles with services
  const profiles = await prisma.pricingProfile.findMany({
    where: { organizationId: pricingOrgId, isActive: true },
    include: {
      company: { select: { id: true, name: true } },
      categories: {
        include: {
          category: { select: { name: true } },
          services: { orderBy: { sortOrder: "asc" } },
        },
        orderBy: { category: { sortOrder: "asc" } },
      },
    },
  })

  console.log(`Found ${profiles.length} pricing profiles`)

  // Match companyCode to Company records
  const companies = await prisma.company.findMany({
    where: { organizationId: orgId },
    select: { id: true, name: true },
  })

  // Get existing invoice numbers to avoid duplicates
  const existingInvoices = await prisma.invoice.findMany({
    where: { organizationId: orgId },
    select: { companyId: true },
  })
  const existingCompanyIds = new Set(existingInvoices.map((i) => i.companyId))

  let invoiceCounter = 1
  let created = 0
  let skipped = 0

  for (const profile of profiles) {
    // Match company by companyCode (name) or by linked companyId
    let companyId = profile.companyId
    if (!companyId) {
      const match = companies.find(
        (c) => c.name.toUpperCase() === profile.companyCode.toUpperCase()
      )
      if (!match) {
        // Try partial match
        const partial = companies.find(
          (c) =>
            c.name.toUpperCase().includes(profile.companyCode.toUpperCase()) ||
            profile.companyCode.toUpperCase().includes(c.name.toUpperCase())
        )
        if (partial) {
          companyId = partial.id
        } else {
          console.log(`  SKIP: No company match for "${profile.companyCode}"`)
          skipped++
          continue
        }
      } else {
        companyId = match.id
      }
    }

    // Skip if invoice already exists for this company
    if (existingCompanyIds.has(companyId)) {
      console.log(`  SKIP: Invoice already exists for company ${profile.companyCode}`)
      skipped++
      continue
    }

    // Collect services with qty > 0
    const services = profile.categories.flatMap((pc, catIdx) =>
      pc.services
        .filter((s) => Number(s.qty) > 0 && Number(s.price) > 0)
        .map((s, svcIdx) => ({
          name: s.name,
          description: pc.category?.name || "",
          quantity: Number(s.qty),
          unitPrice: Number(s.price),
          total: Number(s.qty) * Number(s.price),
          unit: s.unit || "",
          sortOrder: catIdx * 100 + svcIdx,
        }))
    )

    if (services.length === 0) {
      console.log(`  SKIP: No services with qty>0 for "${profile.companyCode}"`)
      skipped++
      continue
    }

    const subtotal = services.reduce((sum, s) => sum + s.total, 0)
    const taxRate = 18
    const taxAmount = Math.round(subtotal * taxRate) / 100
    const totalAmount = Math.round((subtotal + taxAmount) * 100) / 100

    const invoiceNumber = `INV-2026-${String(invoiceCounter).padStart(5, "0")}`

    await prisma.invoice.create({
      data: {
        organizationId: orgId,
        invoiceNumber,
        companyId,
        title: `${profile.companyCode} — İT xidmətləri`,
        status: "draft",
        subtotal: Math.round(subtotal * 100) / 100,
        discountType: "percentage",
        discountValue: 0,
        discountAmount: 0,
        taxRate,
        taxAmount,
        totalAmount,
        paidAmount: 0,
        balanceDue: totalAmount,
        currency: "AZN",
        includeVat: true,
        issueDate: today,
        dueDate,
        paymentTerms: "net30",
        paymentTermsDays: 30,
        items: {
          create: services.map((s) => ({
            name: s.name,
            description: s.description,
            quantity: s.quantity,
            unitPrice: s.unitPrice,
            total: Math.round(s.total * 100) / 100,
            sortOrder: s.sortOrder,
            customFields: {
              unit: s.unit,
              project: s.description,
            },
          })),
        },
      },
    })

    console.log(
      `  ✓ ${invoiceNumber} | ${profile.companyCode} | ${services.length} items | ${totalAmount.toLocaleString("az-AZ")} AZN`
    )
    invoiceCounter++
    created++
    existingCompanyIds.add(companyId)
  }

  console.log(`\nDone: ${created} invoices created, ${skipped} skipped`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
