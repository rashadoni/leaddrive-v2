import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { checkPermission } from "@/lib/permissions"
import { procurementNumber } from "@/lib/procurement/numbering"
import { badRequest, canSeeProcurementCosts, conflict, notFound, readJsonBody, withoutPrices } from "@/lib/procurement/access"
import { notifyProcurement, purchasersOf } from "@/lib/procurement/notify"

type Ctx = { params: Promise<{ id: string }> }

export const GET = withRlsAuth("purchase-requests", "read", async (_req, { orgId, role }, { params }: Ctx) => {
  const { id } = await params
  const request = await prisma.purchaseRequest.findFirst({
    where: { id, organizationId: orgId },
    include: {
      deal: { select: { id: true, name: true, currency: true } },
      items: { orderBy: { sortOrder: "asc" } },
      quotes: {
        orderBy: { createdAt: "asc" },
        include: { supplier: { select: { id: true, name: true } }, items: true },
      },
      orders: {
        orderBy: { seq: "asc" },
        select: { id: true, seq: true, status: true, totalAmount: true, currency: true, expectedDeliveryAt: true, overdueAt: true, supplier: { select: { id: true, name: true } } },
      },
    },
  })
  if (!request) return notFound()
  const data = {
    ...request,
    number: procurementNumber("request", request.seq),
    orders: request.orders.map((order) => ({ ...order, number: procurementNumber("order", order.seq) })),
  }
  return NextResponse.json({ success: true, data: canSeeProcurementCosts(role) ? data : withoutPrices(data) })
})

const itemSchema = z.object({
  dealLineItemId: z.string().min(1).max(64).optional().nullable(),
  name: z.string().trim().min(1).max(300),
  quantity: z.number().positive().max(1e9),
  unit: z.string().trim().max(40).optional().nullable(),
  note: z.string().trim().max(1000).optional().nullable(),
})

const patchSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  neededBy: z.string().max(40).optional().nullable(),
  note: z.string().trim().max(4000).optional().nullable(),
  /** Purchasing takes the request: a person of the organization, or nobody. */
  assignedToId: z.string().max(64).optional().nullable(),
  /** submitted — sales sends it; in_progress — purchasing took it; closed / cancelled. */
  status: z.enum(["submitted", "in_progress", "closed", "cancelled"]).optional(),
  /** Replaces the lines; only while the request is a draft. */
  items: z.array(itemSchema).min(1).max(200).optional(),
  /** Purchasing saw the change in the deal. */
  acknowledgeDealChange: z.boolean().optional(),
}).strict()

const NEXT: Record<string, readonly string[]> = {
  submitted: ["draft"],
  in_progress: ["submitted"],
  closed: ["submitted", "in_progress", "ordered"],
  cancelled: ["draft", "submitted", "in_progress"],
}

export const PATCH = withRlsAuth("purchase-requests", "write", async (req, { orgId, userId, role }, { params }: Ctx) => {
  const { id } = await params
  const read = await readJsonBody(req)
  if (!read.ok) return read.response
  const parsed = patchSchema.safeParse(read.body)
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message || "Invalid input")
  const input = parsed.data

  const existing = await prisma.purchaseRequest.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, seq: true, title: true, status: true, dealId: true, requestedById: true, items: { select: { dealLineItemId: true } } },
  })
  if (!existing) return notFound()

  // Taking, assigning and closing a request is purchasing work.
  const purchasingOnly = input.status === "in_progress" || input.status === "closed" || input.assignedToId !== undefined || input.acknowledgeDealChange
  if (purchasingOnly && !checkPermission(role, "procurement", "write")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  // Sales edits its own request until purchasing takes it.
  if (!checkPermission(role, "procurement", "write") && !["draft", "submitted"].includes(existing.status) && input.status !== "cancelled") {
    return conflict("Purchasing is already working on this request", "IN_PURCHASING")
  }
  if (input.status && !NEXT[input.status].includes(existing.status)) {
    return conflict(`A ${existing.status} request cannot become ${input.status}`, "BAD_TRANSITION")
  }
  if (input.items && existing.status !== "draft") return conflict("Lines change only in a draft", "NOT_DRAFT")
  if (input.items && input.items.some((item) => item.dealLineItemId) && existing.dealId) {
    const own = new Set((await prisma.dealLineItem.findMany({ where: { dealId: existing.dealId, organizationId: orgId }, select: { id: true } })).map((line) => line.id))
    if (input.items.some((item) => item.dealLineItemId && !own.has(item.dealLineItemId))) return badRequest("A line refers to another deal", "FOREIGN_LINE")
  }
  if (input.assignedToId) {
    const person = await prisma.user.findFirst({ where: { id: input.assignedToId, organizationId: orgId, isActive: true }, select: { id: true } })
    if (!person) return badRequest("Unknown person", "UNKNOWN_USER")
  }

  const updated = await prisma.$transaction(async (tx) => {
    // Compare-and-set on the status read above: two people moving the same
    // request at once cannot both win.
    const moved = await tx.purchaseRequest.updateMany({
      where: { id, organizationId: orgId, status: existing.status },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.neededBy !== undefined ? { neededBy: input.neededBy ? new Date(input.neededBy) : null } : {}),
        ...(input.note !== undefined ? { note: input.note?.trim() || null } : {}),
        ...(input.assignedToId !== undefined ? { assignedToId: input.assignedToId || null } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.status === "submitted" ? { submittedAt: new Date() } : {}),
        ...(input.status === "in_progress" && input.assignedToId === undefined ? { assignedToId: userId } : {}),
        ...(input.acknowledgeDealChange ? { dealChangedAt: null } : {}),
      },
    })
    if (moved.count !== 1) return null
    if (input.items) {
      await tx.purchaseRequestItem.deleteMany({ where: { requestId: id, organizationId: orgId } })
      await tx.purchaseRequestItem.createMany({
        data: input.items.map((item, index) => ({
          organizationId: orgId,
          requestId: id,
          dealLineItemId: existing.dealId ? item.dealLineItemId ?? null : null,
          name: item.name,
          quantity: new Prisma.Decimal(item.quantity),
          unit: item.unit?.trim() || null,
          note: item.note?.trim() || null,
          sortOrder: index,
        })),
      })
    }
    return tx.purchaseRequest.findUniqueOrThrow({ where: { id }, select: { id: true, seq: true, title: true, status: true, assignedToId: true } })
  })
  if (!updated) return conflict("The request changed meanwhile — reload it", "STALE")

  const number = procurementNumber("request", updated.seq)
  logAudit(orgId, "update", "purchase_request", id, number, { oldValue: { status: existing.status }, newValue: input, userId })
  if (input.status === "submitted") {
    await notifyProcurement({
      orgId, actorId: userId, entityType: "purchase_request", entityId: id,
      recipients: await purchasersOf(orgId),
      event: { kind: "request.submitted", number, title: updated.title },
    })
  }
  return NextResponse.json({ success: true, data: { ...updated, number } })
})

export const DELETE = withRlsAuth("purchase-requests", "write", async (_req, { orgId, userId }, { params }: Ctx) => {
  const { id } = await params
  const removed = await prisma.purchaseRequest.deleteMany({ where: { id, organizationId: orgId, status: "draft" } })
  if (removed.count === 0) {
    const exists = await prisma.purchaseRequest.findFirst({ where: { id, organizationId: orgId }, select: { status: true } })
    return exists ? conflict("Only a draft is deleted; cancel the request instead", "NOT_DRAFT") : notFound()
  }
  logAudit(orgId, "delete", "purchase_request", id, id, { userId })
  return NextResponse.json({ success: true })
})
