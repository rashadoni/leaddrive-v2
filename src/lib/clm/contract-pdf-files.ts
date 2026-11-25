/**
 * The PDF files of a contract and of its documents, for whoever may read them:
 * the CRM's routes (src/app/api/v1/contracts/[id]/pdf, …/documents/[docId]/pdf)
 * and the counterparty's cabinet in the portal (src/app/api/v1/public/portal-documents).
 * Both read the same bytes, so the counterparty's copy is the CRM's copy.
 *
 * Runs inside the caller's tenant scope.
 */
import { prisma } from "@/lib/prisma"
import { generateContractPdf } from "@/lib/clm/contract-pdf"
import { generateContractDocumentPdf } from "@/lib/clm/contract-document-pdf"
import type { SignatureSheet } from "@/lib/clm/signature-sheet"
import { DOCUMENT_SELECT, LINE_SELECT, documentFacts, lineRow, loadContractForDocuments, loadInvoiceSettings } from "@/lib/clm/contract-documents-server"

export type PdfFile = { ok: true; bytes: Uint8Array; filename: string } | { ok: false; status: number; error: string }

export interface PdfOptions {
  lang?: string | null
  tz?: string | null
  /** The signed copy: the signed text with the signature sheet as its last page. */
  signed?: boolean
  /** For a contract: the envelope whose signed version to print; else the canonical one. */
  envelopeId?: string | null
}

/** 300 000 chars ≈ ~200 A4 pages; real contracts rarely exceed 50. Guards shared memory. */
const PDF_BODY_CHAR_LIMIT = 300_000

export async function buildContractPdfFile(orgId: string, contractId: string, opts: PdfOptions): Promise<PdfFile> {
  const [contract, organization] = await Promise.all([
    prisma.contract.findFirst({ where: { id: contractId, organizationId: orgId }, include: { company: { select: { name: true } } } }),
    prisma.organization.findUnique({ where: { id: orgId }, select: { name: true, logo: true, branding: true } }),
  ])
  if (!contract) return { ok: false, status: 404, error: "Not found" }
  if (!organization) return { ok: false, status: 500, error: "Org not found" }

  let renderedBody = contract.renderedBody
  let signatureSheet: SignatureSheet | null = null
  if (opts.signed) {
    const signed = await loadSignedCopy(orgId, contract.id, opts.envelopeId ?? null)
    if (!signed) return { ok: false, status: 404, error: "This contract has no signed copy" }
    renderedBody = signed.body
    signatureSheet = signed.sheet
  }
  if ((renderedBody ?? "").length > PDF_BODY_CHAR_LIMIT) {
    return { ok: false, status: 413, error: "Contract body too large to render as PDF — use the export/download option instead" }
  }
  const bytes = generateContractPdf({
    contract: { ...contract, renderedBody },
    organization,
    lang: opts.lang,
    timeZone: opts.tz,
    signatureSheet,
  })
  const safeNumber = contract.contractNumber.replace(/[^\w.\-]/g, "_").slice(0, 50)
  return { ok: true, bytes, filename: signatureSheet ? `${safeNumber}-signed.pdf` : `${safeNumber}.pdf` }
}

/**
 * The text a completed envelope bound people to, and who signed it. The sign
 * route mints that text as an immutable `signed` version created by
 * `esign:<envelopeId>` in the same transaction that completes the envelope,
 * so the pair is found by that mark — not by the contract's current body.
 */
export async function loadSignedCopy(
  orgId: string,
  contractId: string,
  envelopeId: string | null,
): Promise<{ body: string | null; sheet: SignatureSheet } | null> {
  const version = await prisma.contractVersion.findFirst({
    where: envelopeId
      ? { organizationId: orgId, contractId, source: "signed", createdBy: `esign:${envelopeId}` }
      : { organizationId: orgId, contractId, source: "signed", isCanonicalSigned: true },
    orderBy: { versionNo: "desc" },
    select: { versionNo: true, contentHash: true, renderedBody: true, createdBy: true },
  })
  const signedBy = version?.createdBy?.startsWith("esign:") ? version.createdBy.slice("esign:".length) : null
  if (!version || !signedBy) return null

  const envelope = await prisma.esignEnvelope.findFirst({
    where: { id: signedBy, organizationId: orgId, contractId, status: "completed" },
    select: {
      sentAt: true,
      completedAt: true,
      signers: {
        orderBy: { order: "asc" },
        select: {
          order: true,
          fullName: true,
          email: true,
          role: true,
          status: true,
          signatureMethod: true,
          signaturePayload: true,
          viewedAt: true,
          signedAt: true,
          signedIpAddress: true,
        },
      },
    },
  })
  if (!envelope) return null

  return {
    body: version.renderedBody,
    sheet: {
      sentAt: envelope.sentAt,
      completedAt: envelope.completedAt,
      versionNo: version.versionNo,
      contentHash: version.contentHash,
      signers: envelope.signers,
    },
  }
}

/**
 * A price protocol or acceptance act. `visibleStatuses` narrows which
 * documents may be printed at all (the portal never prints a draft).
 */
export async function buildDocumentPdfFile(
  orgId: string,
  contractId: string,
  docId: string,
  opts: PdfOptions & { visibleStatuses?: string[] },
): Promise<PdfFile> {
  const [doc, contract, settings] = await Promise.all([
    prisma.contractDocument.findFirst({
      where: { id: docId, contractId, organizationId: orgId, ...(opts.visibleStatuses ? { status: { in: opts.visibleStatuses } } : {}) },
      select: { ...DOCUMENT_SELECT, lines: { orderBy: { position: "asc" }, select: LINE_SELECT } },
    }),
    loadContractForDocuments(orgId, contractId),
    loadInvoiceSettings(orgId),
  ])
  if (!doc || !contract) return { ok: false, status: 404, error: "Not found" }
  const lang = opts.lang === "ru" || opts.lang === "en" ? opts.lang : "az"

  // The signed copy: the sheet of the envelope that signed this document.
  let signatureSheet: SignatureSheet | null = null
  if (opts.signed) {
    const envelope = await prisma.esignEnvelope.findFirst({
      where: { organizationId: orgId, contractId, documentId: docId, status: "completed" },
      orderBy: { completedAt: "desc" },
      select: {
        sentAt: true,
        completedAt: true,
        boundContentHash: true,
        signers: {
          orderBy: { order: "asc" },
          select: { order: true, fullName: true, email: true, role: true, status: true, signatureMethod: true, signaturePayload: true, viewedAt: true, signedAt: true, signedIpAddress: true },
        },
      },
    })
    if (!envelope || doc.status !== "signed") return { ok: false, status: 404, error: "This document has no signed copy" }
    signatureSheet = { sentAt: envelope.sentAt, completedAt: envelope.completedAt, versionNo: null, contentHash: envelope.boundContentHash ?? "", signers: envelope.signers }
  }
  const bytes = generateContractDocumentPdf({
    facts: documentFacts(doc, contract, settings),
    lines: doc.lines.map(lineRow),
    currency: doc.currency,
    lang,
    signatureSheet,
    timeZone: opts.tz,
  })
  const base = `${contract.contractNumber}-${doc.kind === "price_protocol" ? "protocol" : "act"}-${doc.number}${signatureSheet ? "-signed" : ""}`
    .replace(/[^\w.\-]/g, "_")
    .slice(0, 80)
  return { ok: true, bytes, filename: `${base}.pdf` }
}

export function pdfResponseHeaders(filename: string, download: boolean): HeadersInit {
  return {
    "Content-Type": "application/pdf",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
    // Contracts are sensitive — do not let a CDN cache them.
    "Cache-Control": "private, no-store",
  }
}
