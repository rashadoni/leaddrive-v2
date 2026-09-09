import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"

const schema = z.object({
  reason: z.string().min(1).max(1000),
}).strict()

// POST — pending_approval → rejected
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  return runWithTenant(orgId, async () => {
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

    const updated = await prisma.paymentOrder.update({
      where: { id },
      data: { status: "rejected", rejectedAt: new Date(), rejectionReason: data.reason },
    })

    return NextResponse.json({ data: updated })
  })
}
