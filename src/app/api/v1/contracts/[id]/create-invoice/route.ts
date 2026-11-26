/**
 * CLM Slice 7c — POST /api/v1/contracts/:id/create-invoice
 *
 * Generates a draft Invoice pre-filled from a Contract:
 *   - contractId, companyId, dealId, contactId (all same-org via the contract)
 *   - title from contract.title
 *   - with an active price protocol: its lines and prices, as before;
 *   - without one: one line for what is LEFT of contract.valueAmount after every
 *     invoice of the contract in its currency that counts (drafts included;
 *     cancelled and refunded do not) — owner 2026-11-26, «Деньги по договору»:
 *     it was the whole value on every press. Nothing left → 409 FULLY_INVOICED.
 *     A contract without a value gets a 0 line to fill in, as before.
 *   - currency from contract
 *   - issueDate = now, dueDate = +30 days
 *
 * A contract that never took effect (draft, in approval, rejected, cancelled)
 * is not invoiced → 409 CONTRACT_NOT_IN_FORCE (src/lib/clm/contract-money.ts).
 * The left-over is read and the invoice written under the contract's row lock.
 *
 * Permission: the caller must have BOTH contracts:write (to act on the contract)
 * AND invoices:write (to create an invoice). If either check fails → 403.
 *
 * A warning is included in the response body when invoices already exist.
 *
 * An ERP push is fired best-effort after invoice creation: a configured org
 * auto-syncs; an unconfigured org no-ops. An ERP push failure NEVER fails the
 * invoice creation — it is caught and swallowed.
 */

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth, isAuthError } from "@/lib/api-auth"
import { getMobileAuth } from "@/lib/mobile-auth"
import { runWithRlsBypass, runWithTenant } from "@/lib/rls-context"
import { generateInvoiceNumber } from "@/lib/invoice-number"
import { calculateDueDate, calculateInvoiceTotals, calculateItemTotal } from "@/lib/invoice-calculations"
import { activeProtocol, toNumber, type ProtocolRow } from "@/lib/clm/contract-documents"
import { countsTowardsValue, invoiceRefusal, nextInvoiceAmount } from "@/lib/clm/contract-money"
import { normalizeInvoiceRow, normalizeInvoiceItemRow } from "@/lib/prisma-decimal"
import { pushInvoiceToErp } from "@/lib/integrations/erp/provider"
import { Prisma } from "@prisma/client"
import crypto from "crypto"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Dual permission check: the user must be able to BOTH act on contracts AND
  // create invoices. We check contracts:write first (short-circuit if no access
  // to the contract at all), then invoices:write as a module/role gate.
  // Auth resolves under runWithRlsBypass so the requireAuth internal queries do
  // NOT run inside a tenant frame (the writes below get tenant context instead).
  const contractsAuth = await runWithRlsBypass(() => requireAuth(req, "contracts", "write"))
  if (isAuthError(contractsAuth)) return contractsAuth

  const invoicesAuth = await runWithRlsBypass(() => requireAuth(req, "invoices", "write"))
  if (isAuthError(invoicesAuth)) return invoicesAuth

  // SECURITY (FIX 1): reject mobile-JWT callers on this FINANCE action.
  // requireAuth's mobile-JWT path early-returns WITHOUT checking module/action
  // permissions (systemic — see api-auth.ts:250-259; escalated separately).
  // Invoice creation is a finance/billing action; mobile field-rep tokens must
  // never be able to mint invoices regardless of requireAuth's permission gate.
  if (getMobileAuth(req)) {
    return NextResponse.json(
      { error: "Forbidden", message: "Invoice creation is not available via the mobile app" },
      { status: 403 },
    )
  }

  // Both checks share the same session / orgId — use either; they're identical.
  const orgId = contractsAuth.orgId

  // Run the contract load + invoice create under tenant context so the writes
  // are RLS-scoped once RLS is enabled on invoices/contracts (prod no-op while OFF).
  return runWithTenant(orgId, async () => {
  const { id: contractId } = await params

  try {
    // ── Load contract (org-scoped, 404 on foreign or missing) ────────────────
    const contract = await prisma.contract.findFirst({
      where: { id: contractId, organizationId: orgId },
      select: {
        id: true,
        title: true,
        contractNumber: true,
        companyId: true,
        dealId: true,
        contactId: true,
        valueAmount: true,
        currency: true,
        status: true,
      },
    })
    if (!contract) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    // A contract that never took effect is not invoiced (src/lib/clm/contract-money.ts).
    const refusal = invoiceRefusal(contract.status)
    if (refusal) {
      return NextResponse.json({ error: refusal, code: refusal, status: contract.status }, { status: 409 })
    }

    // ── Derive monetary values from contract.valueAmount (Decimal, no float) ─
    // contract.valueAmount is Prisma.Decimal | null.
    // We pass it directly to the Invoice create as a Decimal-compatible value so
    // Prisma handles the precision correctly — never cast to JS number.
    const contractValue: Prisma.Decimal =
      contract.valueAmount ?? new Prisma.Decimal(0)

    // ── The price protocol, when the contract has one: its lines and prices ──
    // (owner 2026-11-25, mock «Протокол цены и акт»). Quantities a protocol
    // leaves empty start at 1 for a person to set on the invoice.
    type ProtocolWithLines = ProtocolRow & {
      vatRate: unknown
      lines: Array<{ productId: string | null; name: string; unit: string | null; quantity: unknown; unitPrice: unknown }>
    }
    const protocols: ProtocolWithLines[] = await prisma.contractDocument.findMany({
      where: { organizationId: orgId, contractId, kind: "price_protocol", status: { not: "cancelled" } },
      select: {
        id: true,
        number: true,
        status: true,
        validFrom: true,
        validTo: true,
        documentDate: true,
        vatRate: true,
        lines: { orderBy: { position: "asc" }, select: { productId: true, name: true, unit: true, quantity: true, unitPrice: true } },
      },
    })
    const active = activeProtocol(protocols, new Date())
    const protocolLines = active?.protocol.lines ?? []
    const fromProtocol = protocolLines.length > 0
    const vatRate = fromProtocol ? toNumber(active!.protocol.vatRate) ?? 0 : 0
    const protocolItems = protocolLines.map((line: { productId: string | null; name: string; unit: string | null; quantity: unknown; unitPrice: unknown }, index: number) => {
      const quantity = toNumber(line.quantity) ?? 1
      const unitPrice = toNumber(line.unitPrice) ?? 0
      return {
        productId: line.productId ?? undefined,
        name: line.name,
        description: line.unit ?? undefined,
        quantity,
        unitPrice: new Prisma.Decimal(unitPrice),
        discount: 0,
        taxRate: null,
        total: new Prisma.Decimal(calculateItemTotal({ quantity, unitPrice, discount: 0 })),
        sortOrder: index,
      }
    })
    const protocolTotals = fromProtocol
      ? calculateInvoiceTotals(
          protocolItems.map((i: { quantity: number; unitPrice: Prisma.Decimal }) => ({ quantity: i.quantity, unitPrice: Number(i.unitPrice), discount: 0 })),
          "percentage",
          0,
          vatRate,
          vatRate > 0,
        )
      : null

    // Without a protocol: one line for what is left of the contract's value, no VAT
    // (owner 2026-11-26, «Деньги по договору»: it was the whole value every time).
    // The left-over is read again under the contract's row lock, below.
    const oneLineMoney = (value: Prisma.Decimal) => ({
      subtotal: value,
      discountType: "percentage",
      discountValue: new Prisma.Decimal(0),
      discountAmount: new Prisma.Decimal(0),
      taxRate: 0,
      taxAmount: new Prisma.Decimal(0),
      totalAmount: value,
      paidAmount: new Prisma.Decimal(0),
      balanceDue: value,
    })
    const money = protocolTotals
      ? {
          subtotal: new Prisma.Decimal(protocolTotals.subtotal),
          discountType: "percentage",
          discountValue: new Prisma.Decimal(0),
          discountAmount: new Prisma.Decimal(0),
          taxRate: vatRate,
          includeVat: vatRate > 0,
          taxAmount: new Prisma.Decimal(protocolTotals.taxAmount),
          totalAmount: new Prisma.Decimal(protocolTotals.totalAmount),
          paidAmount: new Prisma.Decimal(0),
          balanceDue: new Prisma.Decimal(protocolTotals.totalAmount),
        }
      : oneLineMoney(contractValue)
    const items = fromProtocol
      ? protocolItems
      : [
          {
            name: contract.title,
            description: `Contract ${contract.contractNumber ?? contract.id}`,
            quantity: 1,
            unitPrice: contractValue,
            discount: 0,
            taxRate: null,
            total: contractValue,
            sortOrder: 0,
          },
        ]

    const issueDate = new Date()
    const dueDate = calculateDueDate(issueDate, "net30")

    // ── Create the invoice under the contract's row lock ─────────────────────
    // Two presses at once must not both see the same left-over and both invoice it.
    const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`SELECT id FROM "contracts" WHERE id = ${contractId} AND "organizationId" = ${orgId} FOR UPDATE`
    const existing: Array<{ status: string; totalAmount: unknown; currency: string }> = await tx.invoice.findMany({
      where: { contractId, organizationId: orgId },
      select: { status: true, totalAmount: true, currency: true },
    })
    // The number too: a second press waiting on the lock reads the first one's number.
    const invoiceNumber = await generateInvoiceNumber(orgId, tx)
    let lineAmount = contractValue
    if (!fromProtocol) {
      const next = nextInvoiceAmount(
        { valueAmount: toNumber(contract.valueAmount), currency: contract.currency },
        existing.map((i) => ({ status: i.status, totalAmount: toNumber(i.totalAmount) ?? 0, currency: i.currency })),
      )
      if (!next.ok) return { refused: next.code } as const
      // The left-over in Decimal arithmetic; with nothing counted yet, the value itself, exactly.
      const counted = existing.filter((i) => countsTowardsValue(i, contract.currency))
      if (next.amount !== null && counted.length > 0) {
        lineAmount = counted.reduce(
          (left: Prisma.Decimal, i: { totalAmount: unknown }) => left.minus(new Prisma.Decimal(String(i.totalAmount ?? 0))),
          new Prisma.Decimal(String(contract.valueAmount)),
        )
      }
    }
    const invoice = await tx.invoice.create({
      data: {
        organizationId: orgId,
        invoiceNumber,
        title: contract.title,
        status: "draft",
        contractId: contract.id,
        companyId: contract.companyId ?? undefined,
        dealId: contract.dealId ?? undefined,
        contactId: contract.contactId ?? undefined,
        currency: contract.currency,
        // Money — pass Decimal directly; Prisma handles precision.
        ...(fromProtocol ? money : oneLineMoney(lineAmount)),
        paymentTerms: "net30",
        issueDate,
        dueDate,
        // Carry over contract number into the invoice document details field.
        contractNumber: contract.contractNumber ?? undefined,
        viewToken: crypto.randomUUID(),
        items: { create: fromProtocol ? items : [{ ...items[0], unitPrice: lineAmount, total: lineAmount }] },
      },
      include: {
        items: true,
        company: { select: { id: true, name: true } },
      },
    })
    return { invoice, existingCount: existing.length } as const
    })
    if ("refused" in created) {
      return NextResponse.json({ error: created.refused, code: created.refused }, { status: 409 })
    }
    const { invoice, existingCount } = created

    // ── Best-effort ERP push (never fails the response) ──────────────────────
    void pushInvoiceToErp(orgId, invoice.id).catch((err: unknown) => {
      console.error("[create-invoice] ERP push error (swallowed):", err)
    })

    return NextResponse.json(
      {
        success: true,
        data: {
          ...normalizeInvoiceRow(invoice),
          items: invoice.items.map(normalizeInvoiceItemRow),
        },
        ...(active && fromProtocol ? { protocol: { number: active.protocol.number, signed: active.signed } } : {}),
        ...(existingCount > 0
          ? {
              warning: `This contract already has ${existingCount} invoice(s). A new draft was created.`,
            }
          : {}),
      },
      { status: 201 },
    )
  } catch (e) {
    console.error("[create-invoice] error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
  })
}
