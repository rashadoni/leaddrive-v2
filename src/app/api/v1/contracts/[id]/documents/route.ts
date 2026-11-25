/**
 * A contract's document chain (src/lib/clm/contract-documents.ts).
 *
 * GET  — the price protocols and acceptance acts, the contract's invoices
 *        with whether each has an act, and the protocol whose prices hold today.
 * POST { kind: "price_protocol", source?: "auto" | "deal" | "previous" | "empty" }
 *        — a draft protocol, numbered Əlavə №N. «auto» copies the latest
 *        protocol when there is one, else the deal's product lines.
 * POST { kind: "acceptance_act", invoiceId }
 *        — a draft act from that invoice of this contract; the invoice's
 *        open act is returned instead of a second one.
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { checkPermission } from "@/lib/permissions"
import {
  activeProtocol,
  documentTotals,
  lineAmount,
  linesFromDeal,
  linesFromInvoice,
  nextNumber,
  type DocumentLine,
} from "@/lib/clm/contract-documents"
import {
  DOCUMENT_SELECT,
  LINE_SELECT,
  documentRow,
  lineRow,
  loadContractForDocuments,
  loadInvoiceSettings,
} from "@/lib/clm/contract-documents-server"
import { toNumber } from "@/lib/clm/contract-documents"

type Params = { params: Promise<{ id: string }> }

export const GET = withRlsAuth("contracts", "read", async (_req, { orgId, role }, { params }: Params) => {
  const { id: contractId } = await params
  try {
    const contract = await loadContractForDocuments(orgId, contractId)
    if (!contract) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const [documents, invoices] = await Promise.all([
      prisma.contractDocument.findMany({
        where: { organizationId: orgId, contractId },
        orderBy: [{ kind: "asc" }, { number: "desc" }],
        select: { ...DOCUMENT_SELECT, _count: { select: { lines: true } } },
      }),
      checkPermission(role, "invoices", "read")
        ? prisma.invoice.findMany({
            where: { organizationId: orgId, contractId },
            orderBy: { createdAt: "asc" },
            select: { id: true, invoiceNumber: true, status: true, totalAmount: true, currency: true, issueDate: true },
          })
        : Promise.resolve(null),
    ])
    const rows = documents.map((d: Record<string, unknown>) => documentRow(d))
    const protocols = rows.filter((d: { kind: unknown }) => d.kind === "price_protocol") as Array<ReturnType<typeof documentRow> & { id: string; number: number; status: string; validFrom: Date | null; validTo: Date | null; documentDate: Date }>
    const active = activeProtocol(protocols, new Date())
    // The active protocol's lines: an invoice of this contract compares its prices with them.
    const activeLines = active
      ? (
          await prisma.contractDocumentLine.findMany({
            where: { organizationId: orgId, documentId: active.protocol.id },
            orderBy: { position: "asc" },
            select: LINE_SELECT,
          })
        ).map(lineRow)
      : []
    const acts = rows.filter((d: { kind: unknown; status: unknown }) => d.kind === "acceptance_act" && d.status !== "cancelled") as Array<{ invoiceId: string | null; id: string; status: string }>
    return NextResponse.json({
      success: true,
      data: {
        contract: { id: contract.id, contractNumber: contract.contractNumber, title: contract.title, status: contract.status, signedAt: contract.signedAt },
        documents: rows,
        activeProtocol: active ? { id: active.protocol.id, number: active.protocol.number, signed: active.signed, vatRate: active.protocol.vatRate, lines: activeLines } : null,
        // null: this person does not see invoices — the chain says so instead of «0».
        invoices: invoices
          ? invoices.map((inv: { id: string; invoiceNumber: string; status: string; totalAmount: unknown; currency: string; issueDate: Date }) => {
              const act = acts.find((a) => a.invoiceId === inv.id)
              return { ...inv, totalAmount: toNumber(inv.totalAmount) ?? 0, act: act ? { id: act.id, status: act.status } : null }
            })
          : null,
      },
    })
  } catch (e) {
    console.error("[contracts/:id/documents GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

const bodySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("price_protocol"), source: z.enum(["auto", "deal", "previous", "empty"]).default("auto") }),
  z.object({ kind: z.literal("acceptance_act"), invoiceId: z.string().min(1).max(64) }),
])

export const POST = withRlsAuth("contracts", "write", async (req, { orgId, userId, role }, { params }: Params) => {
  const { id: contractId } = await params
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  const input = parsed.data

  try {
    const contract = await loadContractForDocuments(orgId, contractId)
    if (!contract) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (["draft", "rejected", "cancelled", "terminated"].includes(contract.status)) {
      // Documents follow an agreed contract: a draft is still being written, a dead one is over.
      return NextResponse.json({ error: "The contract is not in force", code: "CONTRACT_NOT_IN_FORCE", status: contract.status }, { status: 409 })
    }
    const settings = await loadInvoiceSettings(orgId)
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)

    let lines: DocumentLine[] = []
    let vatRate = settings.defaultVatRate
    let invoiceId: string | null = null
    let currency = contract.currency

    if (input.kind === "price_protocol") {
      const previous =
        input.source === "auto" || input.source === "previous"
          ? await prisma.contractDocument.findFirst({
              where: { organizationId: orgId, contractId, kind: "price_protocol", status: { not: "cancelled" } },
              orderBy: { number: "desc" },
              select: { vatRate: true, lines: { orderBy: { position: "asc" }, select: LINE_SELECT } },
            })
          : null
      if (previous) {
        lines = previous.lines.map(lineRow)
        vatRate = toNumber(previous.vatRate) ?? vatRate
      } else if ((input.source === "auto" || input.source === "deal") && contract.dealId) {
        const items = await prisma.dealLineItem.findMany({
          where: { organizationId: orgId, dealId: contract.dealId },
          orderBy: { sortOrder: "asc" },
          select: { productId: true, name: true, quantity: true, unitPrice: true, discountPct: true, product: { select: { unit: true } } },
        })
        lines = linesFromDeal(items)
      }
    } else {
      if (!checkPermission(role, "invoices", "read")) {
        return NextResponse.json({ error: "No right to read invoices", code: "INVOICES_READ_DENIED" }, { status: 403 })
      }
      const invoice = await prisma.invoice.findFirst({
        where: { id: input.invoiceId, organizationId: orgId },
        select: {
          id: true,
          contractId: true,
          currency: true,
          includeVat: true,
          taxRate: true,
          status: true,
          items: { orderBy: { sortOrder: "asc" }, select: { productId: true, name: true, quantity: true, unitPrice: true, discount: true } },
        },
      })
      if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
      if (invoice.contractId !== contractId) {
        return NextResponse.json({ error: "The invoice is not this contract's", code: "INVOICE_OTHER_CONTRACT" }, { status: 409 })
      }
      if (invoice.status === "cancelled" || invoice.status === "refunded") {
        return NextResponse.json({ error: "The invoice is cancelled", code: "INVOICE_CANCELLED" }, { status: 409 })
      }
      const open = await prisma.contractDocument.findFirst({
        where: { organizationId: orgId, contractId, kind: "acceptance_act", invoiceId: invoice.id, status: { not: "cancelled" } },
        select: { ...DOCUMENT_SELECT },
      })
      if (open) return NextResponse.json({ success: true, existing: true, data: documentRow(open) })
      lines = linesFromInvoice(invoice.items)
      vatRate = invoice.includeVat ? invoice.taxRate : 0
      invoiceId = invoice.id
      currency = invoice.currency
    }

    const totals = documentTotals(lines, vatRate)
    const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // One number per contract and kind: two people pressing at once wait here.
      await tx.$queryRaw`SELECT id FROM "contracts" WHERE id = ${contractId} AND "organizationId" = ${orgId} FOR UPDATE`
      const taken = await tx.contractDocument.findMany({
        where: { organizationId: orgId, contractId, kind: input.kind },
        select: { number: true },
      })
      return tx.contractDocument.create({
        data: {
          organizationId: orgId,
          contractId,
          kind: input.kind,
          number: nextNumber(taken.map((t: { number: number }) => t.number)),
          status: "draft",
          documentDate: today,
          validFrom: input.kind === "price_protocol" ? today : null,
          validTo: input.kind === "price_protocol" ? contract.endDate : null,
          invoiceId,
          currency,
          vatRate,
          ...totals,
          createdBy: userId,
          lines: {
            create: lines.map((line, position) => ({
              organizationId: orgId,
              position,
              productId: line.productId,
              name: line.name,
              unit: line.unit,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              amount: lineAmount(line),
            })),
          },
        },
        select: DOCUMENT_SELECT,
      })
    })
    logAudit(orgId, "create", "contract_document", created.id, `${input.kind} ${created.number}`, {
      newValue: { contractId, kind: input.kind, number: created.number, invoiceId, lines: lines.length },
      ...(userId ? { userId } : {}),
    })
    return NextResponse.json({ success: true, data: documentRow(created) }, { status: 201 })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json({ error: "Try again", code: "NUMBER_TAKEN" }, { status: 409 })
    }
    console.error("[contracts/:id/documents POST]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
