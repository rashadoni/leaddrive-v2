/**
 * CLM Slice 7c — POST /api/v1/contracts/:id/create-invoice
 *
 * Generates a draft Invoice pre-filled from a Contract:
 *   - contractId, companyId, dealId, contactId (all same-org via the contract)
 *   - title from contract.title
 *   - subtotal/totalAmount from contract.valueAmount (Decimal — no float coercion)
 *   - currency from contract
 *   - issueDate = now, dueDate = +30 days
 *   - one InvoiceItem for the contract value
 *
 * Permission: the caller must have BOTH contracts:write (to act on the contract)
 * AND invoices:write (to create an invoice). If either check fails → 403.
 *
 * Multiple invoices per contract are allowed (the model supports it). A warning
 * is included in the response body when one already exists.
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
import { calculateDueDate } from "@/lib/invoice-calculations"
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
      },
    })
    if (!contract) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    // ── Idempotency advisory: warn if an invoice already exists ──────────────
    const existingCount = await prisma.invoice.count({
      where: { contractId, organizationId: orgId },
    })

    // ── Derive monetary values from contract.valueAmount (Decimal, no float) ─
    // contract.valueAmount is Prisma.Decimal | null.
    // We pass it directly to the Invoice create as a Decimal-compatible value so
    // Prisma handles the precision correctly — never cast to JS number.
    const contractValue: Prisma.Decimal =
      contract.valueAmount ?? new Prisma.Decimal(0)

    const invoiceNumber = await generateInvoiceNumber(orgId)
    const issueDate = new Date()
    const dueDate = calculateDueDate(issueDate, "net30")

    // ── Create invoice inside a transaction ──────────────────────────────────
    const invoice = await prisma.invoice.create({
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
        subtotal: contractValue,
        discountType: "percentage",
        discountValue: new Prisma.Decimal(0),
        discountAmount: new Prisma.Decimal(0),
        taxRate: 0,
        taxAmount: new Prisma.Decimal(0),
        totalAmount: contractValue,
        paidAmount: new Prisma.Decimal(0),
        balanceDue: contractValue,
        paymentTerms: "net30",
        issueDate,
        dueDate,
        // Carry over contract number into the invoice document details field.
        contractNumber: contract.contractNumber ?? undefined,
        viewToken: crypto.randomUUID(),
        items: {
          create: [
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
          ],
        },
      },
      include: {
        items: true,
        company: { select: { id: true, name: true } },
      },
    })

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
