/**
 * One contract document (src/lib/clm/contract-documents.ts).
 *
 * GET    — the document, its lines and the facts its text names.
 * PUT    — a draft's date, period, VAT rate, note and lines (all lines at once).
 *          Anything but a draft is refused: what went to signing is what is signed.
 * DELETE — cancels a draft. The row stays: its number is not reused, and
 *          the chain shows it was cancelled.
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { documentTotals, lineAmount } from "@/lib/clm/contract-documents"
import {
  DOCUMENT_SELECT,
  LINE_SELECT,
  documentFacts,
  documentRow,
  lineRow,
  loadContractForDocuments,
  loadInvoiceSettings,
} from "@/lib/clm/contract-documents-server"

type Params = { params: Promise<{ id: string; docId: string }> }

async function loadDocument(orgId: string, contractId: string, docId: string) {
  return prisma.contractDocument.findFirst({
    where: { id: docId, contractId, organizationId: orgId },
    select: { ...DOCUMENT_SELECT, lines: { orderBy: { position: "asc" }, select: LINE_SELECT } },
  })
}

export const GET = withRlsAuth("contracts", "read", async (_req, { orgId }, { params }: Params) => {
  const { id: contractId, docId } = await params
  try {
    const [doc, contract, settings] = await Promise.all([
      loadDocument(orgId, contractId, docId),
      loadContractForDocuments(orgId, contractId),
      loadInvoiceSettings(orgId),
    ])
    if (!doc || !contract) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({
      success: true,
      data: {
        ...documentRow(doc),
        lines: doc.lines.map((l: Parameters<typeof lineRow>[0] & { id: string; position: number }) => ({ id: l.id, position: l.position, ...lineRow(l) })),
        facts: documentFacts(doc, contract, settings),
        contract: { id: contract.id, contractNumber: contract.contractNumber, title: contract.title },
      },
    })
  } catch (e) {
    console.error("[contracts/:id/documents/:docId GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .transform((v) => new Date(`${v}T00:00:00Z`))

const lineSchema = z.object({
  productId: z.string().max(64).nullable().optional(),
  name: z.string().trim().min(1).max(500),
  unit: z.string().trim().max(40).nullable().optional(),
  quantity: z.number().finite().min(0).max(1e9).nullable(),
  unitPrice: z.number().finite().min(0).max(1e12),
})

const putSchema = z
  .object({
    documentDate: day.optional(),
    validFrom: day.nullable().optional(),
    validTo: day.nullable().optional(),
    vatRate: z.number().min(0).max(1).optional(),
    note: z.string().max(2000).nullable().optional(),
    lines: z.array(lineSchema).max(500).optional(),
  })
  .strict()

export const PUT = withRlsAuth("contracts", "write", async (req, { orgId, userId }, { params }: Params) => {
  const { id: contractId, docId } = await params
  const parsed = putSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  const input = parsed.data
  if (input.validFrom && input.validTo && input.validTo < input.validFrom) {
    return NextResponse.json({ error: "The period ends before it starts", code: "INVALID_PERIOD" }, { status: 400 })
  }

  try {
    const current = await loadDocument(orgId, contractId, docId)
    if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (current.status !== "draft") {
      return NextResponse.json({ error: "Only a draft is edited", code: "NOT_DRAFT", status: current.status }, { status: 409 })
    }
    // Lines are checked against this organisation's products: a foreign id is dropped, not linked.
    let lines = input.lines
    if (lines) {
      const ids = [...new Set(lines.map((l) => l.productId).filter((id): id is string => Boolean(id)))]
      const known = ids.length
        ? new Set(
            (await prisma.product.findMany({ where: { organizationId: orgId, id: { in: ids } }, select: { id: true } })).map(
              (p: { id: string }) => p.id,
            ),
          )
        : new Set<string>()
      lines = lines.map((l) => ({ ...l, productId: l.productId && known.has(l.productId) ? l.productId : null }))
    }
    const vatRate = input.vatRate ?? Number(current.vatRate)
    const totalsFrom = lines
      ? lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice }))
      : current.lines.map((l: Parameters<typeof lineRow>[0]) => lineRow(l))
    const totals = documentTotals(totalsFrom, vatRate)

    const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Only a draft, checked again under the write: a send for signing may have just started.
      const res = await tx.contractDocument.updateMany({
        where: { id: docId, contractId, organizationId: orgId, status: "draft" },
        data: {
          ...(input.documentDate ? { documentDate: input.documentDate } : {}),
          ...(input.validFrom !== undefined ? { validFrom: input.validFrom } : {}),
          ...(input.validTo !== undefined ? { validTo: input.validTo } : {}),
          ...(input.note !== undefined ? { note: input.note?.trim() || null } : {}),
          vatRate,
          ...totals,
        },
      })
      if (res.count !== 1) return null
      if (lines) {
        await tx.contractDocumentLine.deleteMany({ where: { organizationId: orgId, documentId: docId } })
        if (lines.length > 0) {
          await tx.contractDocumentLine.createMany({
            data: lines.map((l, position) => ({
              organizationId: orgId,
              documentId: docId,
              position,
              productId: l.productId ?? null,
              name: l.name,
              unit: l.unit?.trim() || null,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              amount: lineAmount({ quantity: l.quantity, unitPrice: l.unitPrice }),
            })),
          })
        }
      }
      return true
    })
    if (!updated) return NextResponse.json({ error: "Only a draft is edited", code: "NOT_DRAFT" }, { status: 409 })
    logAudit(orgId, "update", "contract_document", docId, `${current.kind} ${current.number}`, {
      newValue: { ...input, lines: lines?.length },
      ...(userId ? { userId } : {}),
    })
    const fresh = await loadDocument(orgId, contractId, docId)
    return NextResponse.json({
      success: true,
      data: { ...documentRow(fresh!), lines: fresh!.lines.map((l: Parameters<typeof lineRow>[0] & { id: string; position: number }) => ({ id: l.id, position: l.position, ...lineRow(l) })) },
    })
  } catch (e) {
    console.error("[contracts/:id/documents/:docId PUT]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const DELETE = withRlsAuth("contracts", "write", async (_req, { orgId, userId }, { params }: Params) => {
  const { id: contractId, docId } = await params
  try {
    const res = await prisma.contractDocument.updateMany({
      where: { id: docId, contractId, organizationId: orgId, status: "draft" },
      data: { status: "cancelled" },
    })
    if (res.count !== 1) {
      const exists = await prisma.contractDocument.findFirst({ where: { id: docId, contractId, organizationId: orgId }, select: { status: true } })
      if (!exists) return NextResponse.json({ error: "Not found" }, { status: 404 })
      return NextResponse.json({ error: "Only a draft is cancelled", code: "NOT_DRAFT", status: exists.status }, { status: 409 })
    }
    logAudit(orgId, "cancel", "contract_document", docId, docId, userId ? { userId } : undefined)
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error("[contracts/:id/documents/:docId DELETE]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
