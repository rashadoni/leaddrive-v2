/**
 * Backfill script: Creates PaymentRegistryEntry records for all existing
 * BillPayments, InvoicePayments, and FundTransactions that don't have
 * corresponding registry entries yet.
 *
 * Usage: npx tsx scripts/backfill-payment-registry.ts
 *
 * Safe to run multiple times — checks for duplicates by sourceType + sourceId.
 */

import type { PrismaClient } from "@prisma/client"
import { makeScriptPrisma } from "./_rls.mjs"
import { decimalToNumber } from "../src/lib/prisma-decimal"

let prisma!: PrismaClient

async function main() {
  prisma = await makeScriptPrisma()
  console.log("=== Payment Registry Backfill ===\n")

  // Get all organizations
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } })
  console.log(`Found ${orgs.length} organization(s)\n`)

  let totalCreated = 0

  for (const org of orgs) {
    console.log(`\n--- Org: ${org.name} (${org.id}) ---`)
    let orgCreated = 0

    // 1. Backfill from BillPayments
    const billPayments = await prisma.billPayment.findMany({
      where: { organizationId: org.id },
      include: { bill: { select: { vendorName: true, vendorId: true, billNumber: true } } },
    })

    for (const bp of billPayments) {
      // Check if registry entry already exists for this source
      const existing = await prisma.paymentRegistryEntry.findFirst({
        where: { organizationId: org.id, sourceType: "bill_payment", sourceId: bp.id },
      })
      if (existing) continue

      // Also check if a payment_order registry entry already covers this bill payment
      // (happens when PO execute creates both registry entry and bill payment)
      const poEntry = await prisma.paymentRegistryEntry.findFirst({
        where: {
          organizationId: org.id,
          sourceType: "payment_order",
          billId: bp.billId,
          // bp.amount is Decimal(18,4); registry.amount is Float — convert for exact match
          amount: decimalToNumber(bp.amount),
        },
      })
      if (poEntry) {
        console.log(`  Skip BillPayment ${bp.id} — covered by PO registry entry`)
        continue
      }

      await prisma.paymentRegistryEntry.create({
        data: {
          organizationId: org.id,
          direction: "outgoing",
          // bp.amount is Decimal(18,4) after migration; PaymentRegistryEntry.amount is Float
          amount: decimalToNumber(bp.amount),
          currency: bp.currency,
          counterpartyName: bp.bill?.vendorName || "Unknown vendor",
          counterpartyId: bp.bill?.vendorId || null,
          sourceType: "bill_payment",
          sourceId: bp.id,
          billId: bp.billId,
          category: "vendor_payment",
          paymentDate: bp.paymentDate,
          description: `Оплата по счёту ${bp.bill?.billNumber || bp.billId}`,
        },
      })
      orgCreated++
    }
    console.log(`  BillPayments: ${billPayments.length} found, ${orgCreated} created`)

    // 2. Backfill from InvoicePayments
    const prevCreated = orgCreated
    const invoicePayments = await prisma.invoicePayment.findMany({
      where: { organizationId: org.id },
      include: {
        invoice: {
          select: {
            invoiceNumber: true,
            companyId: true,
            recipientName: true,
            company: { select: { id: true, name: true } },
          },
        },
      },
    })

    for (const ip of invoicePayments) {
      const existing = await prisma.paymentRegistryEntry.findFirst({
        where: { organizationId: org.id, sourceType: "invoice_payment", sourceId: ip.id },
      })
      if (existing) continue

      const counterpartyName = ip.invoice?.company?.name || ip.invoice?.recipientName || "Unknown"
      const counterpartyId = ip.invoice?.company?.id || null

      await prisma.paymentRegistryEntry.create({
        data: {
          organizationId: org.id,
          direction: "incoming",
          amount: decimalToNumber(ip.amount),
          currency: ip.currency,
          counterpartyName,
          counterpartyId,
          sourceType: "invoice_payment",
          sourceId: ip.id,
          invoiceId: ip.invoiceId,
          category: "revenue",
          paymentDate: ip.paymentDate,
          description: `Оплата по счёту ${ip.invoice?.invoiceNumber || ip.invoiceId}`,
        },
      })
      orgCreated++
    }
    console.log(`  InvoicePayments: ${invoicePayments.length} found, ${orgCreated - prevCreated} created`)

    // 3. Backfill from FundTransactions (only deposit/withdrawal)
    const prevCreated2 = orgCreated
    const fundTransactions = await prisma.fundTransaction.findMany({
      where: {
        organizationId: org.id,
        type: { in: ["deposit", "withdrawal"] },
      },
      include: { fund: { select: { name: true, currency: true } } },
    })

    for (const ft of fundTransactions) {
      const existing = await prisma.paymentRegistryEntry.findFirst({
        where: { organizationId: org.id, sourceType: "fund_transaction", sourceId: ft.id },
      })
      if (existing) continue

      await prisma.paymentRegistryEntry.create({
        data: {
          organizationId: org.id,
          direction: ft.type === "deposit" ? "incoming" : "outgoing",
          // FundTransaction.amount is Decimal(18,4); PaymentRegistryEntry.amount is Float.
          amount: decimalToNumber(ft.amount),
          currency: ft.fund?.currency || "AZN",
          counterpartyName: ft.fund?.name || "Unknown fund",
          sourceType: "fund_transaction",
          sourceId: ft.id,
          fundId: ft.fundId,
          category: "fund_allocation",
          paymentDate: ft.createdAt,
          description: ft.description || `${ft.type === "deposit" ? "Пополнение" : "Снятие"} — ${ft.fund?.name}`,
        },
      })
      orgCreated++
    }
    console.log(`  FundTransactions: ${fundTransactions.length} found, ${orgCreated - prevCreated2} created`)

    console.log(`  Total created for org: ${orgCreated}`)
    totalCreated += orgCreated
  }

  console.log(`\n=== Done! Total registry entries created: ${totalCreated} ===`)
}

main()
  .catch((e) => {
    console.error("Backfill failed:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
