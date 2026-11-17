import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { checkPermission } from "@/lib/permissions"
import { procurementNumber } from "@/lib/procurement/numbering"
import { badRequest, conflict, notFound, readJsonBody } from "@/lib/procurement/access"
import { emailPurchaseOrder } from "@/lib/procurement/send-order-email"

/**
 * Send the order's PDF to the supplier again (or for the first time, after it
 * was marked sent by hand). Only an order that went to the supplier: a draft
 * or one awaiting approval is not something a supplier should receive.
 */
const schema = z.object({
  to: z.string().trim().email().max(200),
  lang: z.enum(["az", "ru", "en"]).optional(),
  message: z.string().trim().max(2000).optional(),
}).strict()

const EMAILABLE = ["sent", "in_production", "in_transit", "partially_received"]

export const POST = withRlsAuth("procurement", "write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { orgId, userId, role } = auth
  if (auth.principalType !== "session" || !userId) return NextResponse.json({ error: "A person sends the order", code: "SESSION_REQUIRED" }, { status: 403 })
  if (!checkPermission(role, "procurement-costs", "read")) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const { id } = await params
  const read = await readJsonBody(req)
  if (!read.ok) return read.response
  const parsed = schema.safeParse(read.body)
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message || "Invalid input")
  const order = await prisma.purchaseOrder.findFirst({ where: { id, organizationId: orgId }, select: { id: true, seq: true, status: true } })
  if (!order) return notFound()
  if (!EMAILABLE.includes(order.status)) return conflict("Only an order sent to the supplier is e-mailed", "NOT_SENT")
  const result = await emailPurchaseOrder({ orgId, orderId: id, actorId: userId, to: parsed.data.to, lang: parsed.data.lang, message: parsed.data.message })
  logAudit(orgId, "email", "purchase_order", id, procurementNumber("order", order.seq), { newValue: { to: parsed.data.to, ok: result.ok }, userId })
  return NextResponse.json({ success: result.ok, data: { emailed: result.ok } }, { status: result.ok ? 200 : 502 })
})
