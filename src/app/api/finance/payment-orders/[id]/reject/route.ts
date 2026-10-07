import { NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { withRlsAuth } from "@/lib/with-rls"
import { prisma } from "@/lib/prisma"

type RouteContext = { params: Promise<{ id: string }> }

const schema = z.object({
  reason: z.string().min(1).max(1000),
}).strict()

// POST — pending_approval → rejected
export const POST = withRlsAuth<RouteContext>("finance", "write", async (req, { orgId }, { params }) => {
  const { id } = await params

  const order = await prisma.paymentOrder.findFirst({ where: { id, organizationId: orgId } })
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (order.status !== "pending_approval") return NextResponse.json({ error: "Only pending orders can be rejected" }, { status: 400 })

  let body
  try { body = await req.json() } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  let data
  try { data = schema.parse(body) } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  // Compare-and-set, as in approve: the two must not overwrite each other.
  const claimed = await prisma.paymentOrder.updateMany({
    where: { id, organizationId: orgId, status: "pending_approval" },
    data: { status: "rejected", rejectedAt: new Date(), rejectionReason: data.reason },
  })
  if (claimed.count !== 1) {
    return NextResponse.json({ error: "The order was changed by someone else. Reload and try again." }, { status: 409 })
  }

  const updated = await prisma.paymentOrder.findFirst({ where: { id, organizationId: orgId } })
  return NextResponse.json({ data: updated })
})
