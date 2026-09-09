import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRls, withRlsAuth } from "@/lib/with-rls"
import { percentageSchema } from "@/lib/validation/numeric"

const itemSchema = z.object({
  id: z.string().optional(),
  productId: z.string().nullable().optional(),
  name: z.string().min(1),
  quantity: z.number().int().min(1).default(1),
  unitPrice: z.number().min(0).default(0),
  discount: z.number().min(0).max(100).default(0),
  sortOrder: z.number().int().default(0),
})

const updateOfferSchema = z.object({
  type: z.enum(["commercial", "invoice", "equipment", "services"]).optional(),
  title: z.string().optional(),
  dealId: z.string().nullable().optional(),
  companyId: z.string().nullable().optional(),
  contactId: z.string().nullable().optional(),
  clientName: z.string().nullable().optional(),
  voen: z.string().nullable().optional(),
  contactPerson: z.string().nullable().optional(),
  contractNumber: z.string().nullable().optional(),
  includeVat: z.boolean().optional(),
  status: z.enum(["draft", "sent", "approved", "rejected"]).optional(),
  currency: z.string().optional(),
  // POST bounds this; PUT left it bare. Offer discount is a percentage —
  // `subtotal * (discount / 100)` in offers/route.ts.
  discount: percentageSchema.optional(),
  validUntil: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  items: z.array(itemSchema).optional(),
})

export const GET = withRls(async (
  _req: NextRequest,
  { orgId },
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params

  try {
    const offer = await prisma.offer.findFirst({
      where: { id, organizationId: orgId },
      include: {
        items: { orderBy: { sortOrder: "asc" } },
        deal: { select: { id: true, name: true } },
      },
    })
    if (!offer) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ success: true, data: offer })
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
})

export const PUT = withRlsAuth("deals", "write", async (req, authResult, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = authResult.orgId
  const { id } = await params
  const body = await req.json()
  const parsed = updateOfferSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  try {
    // Ownership is settled BEFORE anything is written, matching
    // invoices/[id]/route.ts. This check used to sit AFTER the item block, and
    // that ordering was exploitable: offer_items carries no RLS policy of its
    // own, so app.org_id never constrained the item statements, and the RLS
    // extension commits each operation in its own transaction. A PUT naming
    // another tenant's offer therefore deleted that offer's line items (empty
    // items array) or injected forged ones (populated array) and only then
    // returned 404 — with both writes already committed and nothing to roll
    // back. The victim's GET, /pdf and /send all include items unfiltered, so
    // the forged lines went out to their customer under their own letterhead.
    const existing = await prisma.offer.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true },
    })
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

    if (parsed.data.dealId) {
      const deal = await prisma.deal.findFirst({
        where: { id: parsed.data.dealId, organizationId: orgId },
        select: { id: true },
      })
      if (!deal) return NextResponse.json({ error: "Invalid dealId" }, { status: 400 })
    }

    const { items, validUntil, ...offerData } = parsed.data

    const itemsWithTotals = items?.map((item, idx) => {
      const subtotal = item.quantity * item.unitPrice
      const discountAmount = subtotal * (item.discount / 100)
      return {
        organizationId: orgId,
        offerId: id,
        productId: item.productId || null,
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discount: item.discount,
        total: subtotal - discountAmount,
        sortOrder: item.sortOrder || idx,
      }
    })
    if (itemsWithTotals) {
      ;(offerData as any).totalAmount = itemsWithTotals.reduce((s, i) => s + i.total, 0)
    }

    // One transaction, so replacing the items and re-stating the total either
    // both happen or neither does. Previously the delete, the create and the
    // update each committed separately: any failure between them left the offer
    // with items that did not add up to its totalAmount.
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      if (itemsWithTotals) {
        // Belt and braces: the child delete stays org-filtered through its
        // parent, so this statement is safe on its own even if the check above
        // is ever refactored away.
        await tx.offerItem.deleteMany({ where: { offerId: id, offer: { organizationId: orgId } } })
        await tx.offerItem.createMany({ data: itemsWithTotals })
      }
      return tx.offer.updateMany({
        where: { id, organizationId: orgId },
        data: {
          ...offerData,
          validUntil: validUntil !== undefined ? (validUntil ? new Date(validUntil) : null) : undefined,
        },
      })
    })
    if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const updated = await prisma.offer.findFirst({
      where: { id, organizationId: orgId },
      include: {
        items: { orderBy: { sortOrder: "asc" } },
        deal: { select: { id: true, name: true } },
      },
    })
    return NextResponse.json({ success: true, data: updated })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const DELETE = withRlsAuth("deals", "delete", async (req, authResult, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = authResult.orgId
  const { id } = await params

  try {
    const result = await prisma.offer.deleteMany({ where: { id, organizationId: orgId } })
    if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ success: true, data: { deleted: id } })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
