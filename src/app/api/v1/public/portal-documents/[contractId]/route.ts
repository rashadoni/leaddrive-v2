/**
 * GET /api/v1/public/portal-documents/:contractId — one contract of the
 * counterparty's company with its chain: the contract, its protocols and acts
 * that went for signing or are signed, its issued invoices (opened on the
 * portal's invoice page), and what of it waits for this person's signature.
 * Never a draft, an internal approval, a price deviation or a note.
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import {
  PORTAL_DOCUMENT_STATUSES,
  PORTAL_INVOICE_STATUSES,
  WAITING_ENVELOPE_SELECT,
  portalContractWhere,
  portalDocumentsAccess,
  waitingForSigner,
  type EnvelopeForWaiting,
} from "@/lib/portal-documents"

export async function GET(_req: Request, { params }: { params: Promise<{ contractId: string }> }) {
  const access = await portalDocumentsAccess()
  if (!access.ok) return NextResponse.json({ error: access.code, code: access.code }, { status: access.status })
  const { user, companyId, email } = access
  const { contractId } = await params
  try {
    return await runWithTenant(user.organizationId, async () => {
      const contract = await prisma.contract.findFirst({
        where: portalContractWhere(user.organizationId, companyId, contractId),
        select: { id: true, contractNumber: true, title: true, status: true, startDate: true, endDate: true, signedAt: true, currency: true, valueAmount: true },
      })
      if (!contract) return NextResponse.json({ error: "Not found" }, { status: 404 })
      const [documents, invoices, envelopes, signedVersion] = await Promise.all([
        prisma.contractDocument.findMany({
          where: { organizationId: user.organizationId, contractId, status: { in: PORTAL_DOCUMENT_STATUSES } },
          orderBy: [{ kind: "asc" }, { number: "asc" }],
          select: { id: true, kind: true, number: true, status: true, documentDate: true, validFrom: true, validTo: true, totalAmount: true, currency: true, invoice: { select: { invoiceNumber: true } } },
        }),
        prisma.invoice.findMany({
          where: { organizationId: user.organizationId, contractId, status: { in: PORTAL_INVOICE_STATUSES } },
          orderBy: { issueDate: "asc" },
          select: { id: true, invoiceNumber: true, status: true, totalAmount: true, currency: true, issueDate: true, viewToken: true },
        }),
        prisma.esignEnvelope.findMany({
          where: { organizationId: user.organizationId, contractId, status: { in: ["sent", "in_progress"] } },
          select: WAITING_ENVELOPE_SELECT,
        }),
        prisma.contractVersion.findFirst({
          where: { organizationId: user.organizationId, contractId, source: "signed", isCanonicalSigned: true },
          select: { id: true },
        }),
      ])
      return NextResponse.json({
        success: true,
        data: {
          contract: { ...contract, valueAmount: contract.valueAmount === null ? null : Number(contract.valueAmount), hasSignedCopy: Boolean(signedVersion) },
          documents: documents.map((d: { totalAmount: unknown }) => ({ ...d, totalAmount: Number(d.totalAmount) })),
          // The portal's own invoice page opens by the invoice's view token — the token is its credential.
          invoices: invoices.map((i: { id: string; invoiceNumber: string; status: string; totalAmount: unknown; currency: string; issueDate: Date; viewToken: string | null }) => ({
            id: i.id,
            invoiceNumber: i.invoiceNumber,
            status: i.status,
            totalAmount: Number(i.totalAmount),
            currency: i.currency,
            issueDate: i.issueDate,
            url: i.viewToken ? `/portal/invoice/${encodeURIComponent(i.viewToken)}` : null,
          })),
          waiting: waitingForSigner(envelopes as EnvelopeForWaiting[], email, new Date()),
        },
      })
    })
  } catch (e) {
    console.error("[portal-documents/:contractId GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
