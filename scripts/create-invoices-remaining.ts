/**
 * Second pass: Create invoices for companies that didn't match by name
 */
import type { PrismaClient } from "@prisma/client"
import { makeScriptPrisma } from "./_rls.mjs"

let prisma!: PrismaClient

// Manual mapping: pricingCode → company name in DB
const MANUAL_MAP: Record<string, string> = {
  "TABİA": "Tabia",
  "SPS": "Shamakhipalace",
  "PBA": "Pashabank",
  "CENTRAL POİNT": "Centralpoint",
  "AGHDAM CİTY": "Aghdamcityhotel",
  "LSWR": "Lankaransprings",
  "GALALTI": "Qalaalti Resort",
  "CHENOT PALACE": "Chenotpalacegabala",
  "AFİ": "Afigroup",
  "GREEN PLANT": "Greenplant",
  "GALA OLIVES": "Galaolives",
  "LACHEQ": "Lecheq",
  "SHAMKİR AP": "Shamkiragropark",
  "ZAFAR BAGLARİ": "Zafarbaglari",
  "PMD GROUP": "Pmdgroup",
  "PMD PROJECTS": "Pmdprojects",
  "DESIGN BUREAU": "Designbureau",
  "GLC": "Grandlogistics",
  "MER GROUP": "Mergroup",
  "QUKZ": "Qubakz",
  "ATS FOOD": "Atsfood",
  "NOVEX AGRO": "Novexagro",
  "AZSF": "", // no match - skip
  "DOST AGROPARK": "Dostagropark",
  "REVERI": "Revery",
}

async function main() {
  prisma = await makeScriptPrisma()
  const orgId = "cmmxcvbs50000u6qqs3kkb9mf"
  const pricingOrgId = "cmmxg74k10000td3rr37dl6am"
  const today = new Date()
  const dueDate = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000)

  const profiles = await prisma.pricingProfile.findMany({
    where: { organizationId: pricingOrgId, isActive: true },
    include: {
      categories: {
        include: {
          category: { select: { name: true } },
          services: { orderBy: { sortOrder: "asc" } },
        },
        orderBy: { category: { sortOrder: "asc" } },
      },
    },
  })

  const companies = await prisma.company.findMany({
    where: { organizationId: orgId },
    select: { id: true, name: true },
  })

  const existingInvoices = await prisma.invoice.findMany({
    where: { organizationId: orgId },
    select: { companyId: true, invoiceNumber: true },
  })
  const existingCompanyIds = new Set(existingInvoices.map((i) => i.companyId))

  // Get next invoice number
  let maxNum = 32 // we already created 32
  let created = 0

  for (const profile of profiles) {
    const mappedName = MANUAL_MAP[profile.companyCode]
    if (mappedName === undefined) continue // not in our skip list
    if (mappedName === "") {
      console.log(`  SKIP: No DB match for "${profile.companyCode}"`)
      continue
    }

    const company = companies.find(
      (c) => c.name.toLowerCase() === mappedName.toLowerCase()
    )
    if (!company) {
      console.log(`  SKIP: "${mappedName}" not found in companies`)
      continue
    }

    if (existingCompanyIds.has(company.id)) {
      console.log(`  SKIP: Invoice already exists for ${profile.companyCode}`)
      continue
    }

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
      console.log(`  SKIP: No services for "${profile.companyCode}"`)
      continue
    }

    const subtotal = services.reduce((sum, s) => sum + s.total, 0)
    const taxRate = 18
    const taxAmount = Math.round(subtotal * taxRate) / 100
    const totalAmount = Math.round((subtotal + taxAmount) * 100) / 100

    maxNum++
    const invoiceNumber = `INV-2026-${String(maxNum).padStart(5, "0")}`

    await prisma.invoice.create({
      data: {
        organizationId: orgId,
        invoiceNumber,
        companyId: company.id,
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

    console.log(`  ✓ ${invoiceNumber} | ${profile.companyCode} → ${company.name} | ${services.length} items | ${totalAmount.toLocaleString("az-AZ")} AZN`)
    created++
    existingCompanyIds.add(company.id)
  }

  const total = await prisma.invoice.count({ where: { organizationId: orgId } })
  console.log(`\nDone: ${created} more invoices created. Total invoices: ${total}`)
  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
