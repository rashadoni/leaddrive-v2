/**
 * Reads for the contract documents routes (src/app/api/v1/contracts/[id]/documents):
 * a document with its lines as numbers, and the facts its text names — the
 * contract, both sides, the invoice an act closes. Runs inside the route's
 * tenant scope.
 */
import { prisma } from "@/lib/prisma"
import { toNumber, type DocumentFacts, type DocumentKind, type DocumentLine } from "@/lib/clm/contract-documents"

export const DOCUMENT_SELECT = {
  id: true,
  contractId: true,
  kind: true,
  number: true,
  status: true,
  documentDate: true,
  validFrom: true,
  validTo: true,
  invoiceId: true,
  currency: true,
  vatRate: true,
  subtotal: true,
  vatAmount: true,
  totalAmount: true,
  note: true,
  signedAt: true,
  createdAt: true,
  updatedAt: true,
  invoice: { select: { id: true, invoiceNumber: true } },
} as const

export const LINE_SELECT = { id: true, position: true, productId: true, name: true, unit: true, quantity: true, unitPrice: true, amount: true } as const

/** Decimals as numbers: what the screens and the PDF read. */
export function documentRow(row: Record<string, unknown>) {
  return {
    ...row,
    vatRate: toNumber(row.vatRate) ?? 0,
    subtotal: toNumber(row.subtotal) ?? 0,
    vatAmount: toNumber(row.vatAmount) ?? 0,
    totalAmount: toNumber(row.totalAmount) ?? 0,
  }
}

export function lineRow(row: { productId: string | null; name: string; unit: string | null; quantity: unknown; unitPrice: unknown }): DocumentLine {
  return { productId: row.productId, name: row.name, unit: row.unit, quantity: toNumber(row.quantity), unitPrice: toNumber(row.unitPrice) ?? 0 }
}

export async function loadContractForDocuments(orgId: string, contractId: string) {
  return prisma.contract.findFirst({
    where: { id: contractId, organizationId: orgId },
    select: {
      id: true,
      contractNumber: true,
      title: true,
      status: true,
      currency: true,
      dealId: true,
      companyId: true,
      endDate: true,
      signedAt: true,
      createdAt: true,
      company: { select: { name: true, director: true } },
    },
  })
}

type ContractForDocuments = NonNullable<Awaited<ReturnType<typeof loadContractForDocuments>>>

/** Our side as «Settings → Invoices» names it, and the VAT rate new documents start with. */
export async function loadInvoiceSettings(orgId: string): Promise<{ ourName: string; ourDirector: string | null; defaultVatRate: number }> {
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { name: true, settings: true } })
  const settings = (org?.settings ?? {}) as Record<string, unknown>
  const inv = (settings.invoice ?? {}) as Record<string, unknown>
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null)
  const rate = typeof inv.defaultTaxRate === "number" && inv.defaultTaxRate >= 0 && inv.defaultTaxRate <= 1 ? inv.defaultTaxRate : 0.18
  return { ourName: text(inv.companyName) ?? org?.name ?? "", ourDirector: text(inv.directorName), defaultVatRate: rate }
}

export function documentFacts(
  doc: { kind: string; number: number; documentDate: Date; validFrom: Date | null; validTo: Date | null; vatRate: unknown; invoice?: { invoiceNumber: string } | null },
  contract: ContractForDocuments,
  settings: { ourName: string; ourDirector: string | null },
): DocumentFacts {
  return {
    kind: doc.kind as DocumentKind,
    number: doc.number,
    documentDate: doc.documentDate,
    validFrom: doc.validFrom,
    validTo: doc.validTo,
    contractNumber: contract.contractNumber,
    contractDate: contract.signedAt ?? contract.createdAt,
    contractTitle: contract.title,
    our: { name: settings.ourName, director: settings.ourDirector },
    counterparty: { name: contract.company?.name ?? "—", director: contract.company?.director ?? null },
    invoiceNumber: doc.invoice?.invoiceNumber ?? null,
    vatRate: toNumber(doc.vatRate) ?? 0,
  }
}
