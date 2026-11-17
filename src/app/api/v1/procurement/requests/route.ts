import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { checkPermission } from "@/lib/permissions"
import { nextProcurementSeq, procurementNumber } from "@/lib/procurement/numbering"
import { PURCHASE_REQUEST_STATUSES } from "@/lib/procurement/order-status"
import { badRequest, readJsonBody } from "@/lib/procurement/access"
import { notifyProcurement, purchasersOf } from "@/lib/procurement/notify"
import { emitPurchaseRequestSubmitted } from "@/lib/procurement/events"

/**
 * Purchase requests (docs/sales-procurement/README.md, task 3.1): what sales
 * asks purchasing to buy for a deal. Raised from the deal in one action — its
 * lines come from the deal's lines — or by hand.
 */

export const GET = withRlsAuth("purchase-requests", "read", async (req, { orgId }) => {
  const { searchParams } = new URL(req.url)
  const status = searchParams.get("status")
  const dealId = searchParams.get("dealId")
  const where: Prisma.PurchaseRequestWhereInput = {
    organizationId: orgId,
    ...(status && (PURCHASE_REQUEST_STATUSES as readonly string[]).includes(status) ? { status } : {}),
    ...(status === "open" ? { status: { in: ["submitted", "in_progress"] } } : {}),
    ...(dealId ? { dealId } : {}),
  }
  const rows = await prisma.purchaseRequest.findMany({
    where,
    orderBy: [{ seq: "desc" }],
    take: 300,
    select: {
      id: true, seq: true, title: true, status: true, neededBy: true, createdAt: true, submittedAt: true,
      requestedById: true, assignedToId: true, dealChangedAt: true,
      deal: { select: { id: true, name: true } },
      _count: { select: { items: true, quotes: true, orders: true } },
    },
  })
  return NextResponse.json({
    success: true,
    data: { requests: rows.map((row) => ({ ...row, number: procurementNumber("request", row.seq) })) },
  })
})

const itemSchema = z.object({
  dealLineItemId: z.string().min(1).max(64).optional().nullable(),
  name: z.string().trim().min(1).max(300),
  quantity: z.number().positive().max(1e9),
  unit: z.string().trim().max(40).optional().nullable(),
  note: z.string().trim().max(1000).optional().nullable(),
})

const createSchema = z.object({
  dealId: z.string().min(1).max(64).optional().nullable(),
  title: z.string().trim().max(300).optional().nullable(),
  neededBy: z.string().datetime({ offset: true }).optional().nullable().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  note: z.string().trim().max(4000).optional().nullable(),
  /** Omitted with a deal: every line of the deal. */
  items: z.array(itemSchema).max(200).optional(),
  /** Send to purchasing at once (otherwise a draft). */
  submit: z.boolean().optional(),
})

export const POST = withRlsAuth("purchase-requests", "write", async (req, { orgId, userId, role }) => {
  const read = await readJsonBody(req)
  if (!read.ok) return read.response
  const parsed = createSchema.safeParse(read.body)
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message || "Invalid input")
  const input = parsed.data

  let deal: { id: string; name: string; lineItems: { id: string; name: string; quantity: Prisma.Decimal }[] } | null = null
  if (input.dealId) {
    if (!checkPermission(role, "deals", "read")) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    deal = await prisma.deal.findFirst({
      where: { id: input.dealId, organizationId: orgId },
      select: { id: true, name: true, lineItems: { select: { id: true, name: true, quantity: true }, orderBy: { sortOrder: "asc" } } },
    })
    if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 })
  }

  const items = input.items ?? (deal?.lineItems ?? []).map((line) => ({
    dealLineItemId: line.id, name: line.name, quantity: Number(line.quantity), unit: null, note: null,
  }))
  if (items.length === 0) return badRequest("A purchase request needs at least one line", "NO_LINES")
  if (deal) {
    const own = new Set(deal.lineItems.map((line) => line.id))
    if (items.some((item) => item.dealLineItemId && !own.has(item.dealLineItemId))) {
      return badRequest("A line refers to another deal", "FOREIGN_LINE")
    }
  } else if (items.some((item) => item.dealLineItemId)) {
    return badRequest("Deal lines need the deal", "FOREIGN_LINE")
  }

  const neededBy = input.neededBy ? new Date(input.neededBy) : null
  const title = input.title?.trim() || deal?.name || items[0].name
  const submit = input.submit === true

  const created = await prisma.$transaction(async (tx) => {
    const seq = await nextProcurementSeq(tx, orgId, "request")
    return tx.purchaseRequest.create({
      data: {
        organizationId: orgId,
        seq,
        dealId: deal?.id ?? null,
        title,
        status: submit ? "submitted" : "draft",
        submittedAt: submit ? new Date() : null,
        neededBy,
        note: input.note?.trim() || null,
        requestedById: userId,
        items: {
          create: items.map((item, index) => ({
            organizationId: orgId,
            dealLineItemId: item.dealLineItemId ?? null,
            name: item.name,
            quantity: new Prisma.Decimal(item.quantity),
            unit: item.unit?.trim() || null,
            note: item.note?.trim() || null,
            sortOrder: index,
          })),
        },
      },
      select: { id: true, seq: true, title: true, status: true },
    })
  })
  const number = procurementNumber("request", created.seq)
  logAudit(orgId, "create", "purchase_request", created.id, number, { newValue: { status: created.status, dealId: deal?.id ?? null }, userId })
  if (submit) {
    await notifyProcurement({
      orgId, actorId: userId, entityType: "purchase_request", entityId: created.id,
      recipients: await purchasersOf(orgId),
      event: { kind: "request.submitted", number, title: created.title },
    })
    await emitPurchaseRequestSubmitted(orgId, created.id)
  }
  return NextResponse.json({ success: true, data: { ...created, number } }, { status: 201 })
})
