import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { checkPermission } from "@/lib/permissions"
import { badRequest, canSeeProcurementCosts, notFound, readJsonBody } from "@/lib/procurement/access"

/**
 * The planned cost of each line of a deal, in the deal's currency (task 2.2) —
 * what the order is expected to cost before any purchase order exists. Set by
 * someone who does purchasing and may see costs; sales never sends it (the
 * deal's own line editor neither reads nor writes it).
 */
const bodySchema = z.strictObject({
  lines: z.array(z.strictObject({
    dealLineItemId: z.string().trim().min(1).max(60),
    plannedUnitCost: z.number().finite().min(0).max(1e12).nullable(),
  })).min(1).max(200),
})

export const PUT = withRlsAuth("procurement", "write", async (req, { orgId, userId, role }, { params }: { params: Promise<{ id: string }> }) => {
  if (!canSeeProcurementCosts(role) || !checkPermission(role, "deals", "read")) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const { id } = await params
  const read = await readJsonBody(req)
  if (!read.ok) return read.response
  const parsed = bodySchema.safeParse(read.body)
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message || "Invalid input")

  const deal = await prisma.deal.findFirst({ where: { id, organizationId: orgId }, select: { id: true, name: true, lineItems: { select: { id: true } } } })
  if (!deal) return notFound()
  const own = new Set(deal.lineItems.map((line: { id: string }) => line.id))
  if (parsed.data.lines.some((line) => !own.has(line.dealLineItemId))) return badRequest("A line refers to another deal", "FOREIGN_LINE")

  await prisma.$transaction(async (tx) => {
    for (const line of parsed.data.lines) {
      await tx.dealLineItem.updateMany({
        where: { id: line.dealLineItemId, dealId: id, organizationId: orgId },
        data: { plannedUnitCost: line.plannedUnitCost === null ? null : new Prisma.Decimal(line.plannedUnitCost) },
      })
    }
  })
  void logAudit(orgId, "update", "deal", id, deal.name, { newValue: { plannedCosts: parsed.data.lines }, userId: userId ?? undefined })
  return NextResponse.json({ success: true })
})
