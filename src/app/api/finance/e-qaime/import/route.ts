import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { prisma } from "@/lib/prisma"
import {
  eQaimeCounterparty,
  eQaimeImportSchema,
  eQaimeTotals,
  storedLines,
} from "@/lib/finance/e-qaime"

/**
 * POST — invoices the LeadDrive Chrome extension read from e-Taxes, a batch at
 * a time. Reading the same invoice again updates it (its status moves:
 * awaiting approval → approved → cancelled) and keeps its PDF.
 *
 * Answers, per invoice, the row id and whether a PDF is already stored, so the
 * extension uploads only the PDFs that are missing.
 */
export const POST = withRlsAuth("finance", "write", async (req, { orgId, userId }) => {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = eQaimeImportSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors }, { status: 400 })
  }
  const { own, invoices } = parsed.data

  // Every invoice must belong to the signed-in company before any is written.
  const sides = invoices.map((invoice) => eQaimeCounterparty(invoice, own.voen))
  const foreign = invoices.filter((_, index) => !sides[index].ok).map((invoice) => invoice.serialNumber)
  if (foreign.length) {
    return NextResponse.json({ error: "Invoice does not belong to the signed-in company", serialNumbers: foreign }, { status: 422 })
  }

  const voens = [...new Set(sides.map((side) => (side.ok ? side.voen : null)).filter((v): v is string => Boolean(v)))]
  const companies = voens.length
    ? await prisma.company.findMany({
        where: { organizationId: orgId, voen: { in: voens } },
        select: { id: true, voen: true },
        orderBy: { createdAt: "asc" },
      })
    : []
  const companyByVoen = new Map<string, string>()
  for (const company of companies) {
    if (company.voen && !companyByVoen.has(company.voen)) companyByVoen.set(company.voen, company.id)
  }

  const now = new Date()
  const results: Array<{ portalId: string; priorSystem: boolean; id: string; hasPdf: boolean }> = []
  for (const [index, invoice] of invoices.entries()) {
    const side = sides[index]
    if (!side.ok) continue
    const totals = eQaimeTotals(invoice.items)
    const fields = {
      ownName: own.name,
      sourceSystem: invoice.sourceSystem ?? null,
      serialNumber: invoice.serialNumber,
      kind: invoice.kind ?? null,
      docType: invoice.docType ?? null,
      status: invoice.status,
      issuedAt: new Date(invoice.issuedAt),
      counterpartyVoen: side.voen,
      counterpartyName: side.name,
      counterpartyCompanyId: side.voen ? companyByVoen.get(side.voen) ?? null : null,
      netAmount: totals.net,
      vatAmount: totals.vat,
      exciseAmount: totals.excise,
      roadTaxAmount: totals.roadTax,
      totalAmount: totals.total,
      comment: invoice.comment ?? null,
      comment2: invoice.comment2 ?? null,
      items: storedLines(invoice.items),
      sourceSerials: invoice.sourceSerials,
      importedByUserId: userId || null,
      portalSyncedAt: now,
    }
    const row = await prisma.eQaimeInvoice.upsert({
      where: {
        organizationId_ownVoen_direction_portalId_priorSystem: {
          organizationId: orgId,
          ownVoen: own.voen,
          direction: invoice.direction,
          portalId: invoice.portalId,
          priorSystem: invoice.priorSystem,
        },
      },
      create: {
        organizationId: orgId,
        ownVoen: own.voen,
        direction: invoice.direction,
        portalId: invoice.portalId,
        priorSystem: invoice.priorSystem,
        ...fields,
      },
      update: fields,
      select: { id: true, pdfFile: true },
    })
    results.push({ portalId: invoice.portalId, priorSystem: invoice.priorSystem, id: row.id, hasPdf: Boolean(row.pdfFile) })
  }

  return NextResponse.json({ data: results })
})
