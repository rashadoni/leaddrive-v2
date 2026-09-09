import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { isAdmin, isManagerOrAbove } from "@/lib/constants"
import { withRls } from "@/lib/with-rls"
import { coercedNonNegativeFinancialAmountSchema } from "@/lib/validation/numeric"

const updateQuotaSchema = z.object({
  amount: coercedNonNegativeFinancialAmountSchema.optional(),
  currency: z.string().trim().min(1).max(10).optional(),
})

export const PATCH = withRls(async (req, { orgId, session }, { params }: { params: Promise<{ id: string }> }) => {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!isManagerOrAbove(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params
  const parsed = updateQuotaSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const quota = await prisma.salesQuota.findFirst({
    where: { id, organizationId: orgId },
  })
  if (!quota) return NextResponse.json({ error: "Quota not found" }, { status: 404 })

  const updated = await prisma.salesQuota.update({
    where: { id },
    data: {
      amount: parsed.data.amount,
      currency: parsed.data.currency,
    },
  })

  logAudit(orgId, "update", "sales_quota", id, `Quota updated`)
  return NextResponse.json({ success: true, data: updated })
})

export const DELETE = withRls(async (_req, { orgId, session }, { params }: { params: Promise<{ id: string }> }) => {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!isAdmin(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params

  const quota = await prisma.salesQuota.findFirst({
    where: { id, organizationId: orgId },
  })
  if (!quota) return NextResponse.json({ error: "Quota not found" }, { status: 404 })

  await prisma.salesQuota.delete({ where: { id } })
  logAudit(orgId, "delete", "sales_quota", id, `Quota deleted`)

  return NextResponse.json({ success: true })
})
