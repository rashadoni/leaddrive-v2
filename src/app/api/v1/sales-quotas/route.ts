import { NextResponse } from "next/server"
import { z } from "zod"
import { withRls } from "@/lib/with-rls"
import { prisma, logAudit } from "@/lib/prisma"
import { DEFAULT_CURRENCY, isManagerOrAbove } from "@/lib/constants"
import { decimalToNumber } from "@/lib/prisma-decimal"
import { orgStageVocabulary } from "@/lib/deal-stage-vocabulary"
import { coercedNonNegativeFinancialAmountSchema } from "@/lib/validation/numeric"

const numericStringInput = (value: unknown): unknown =>
  typeof value === "string" && value.trim() ? Number(value.trim()) : value

const createQuotaSchema = z.object({
  userId: z.string().trim().min(1).max(128),
  year: z.preprocess(numericStringInput, z.number().finite().int().min(2000).max(2100)),
  quarter: z.preprocess(numericStringInput, z.number().finite().int().min(1).max(4)),
  amount: coercedNonNegativeFinancialAmountSchema,
  currency: z.string().trim().min(1).max(10).optional(),
})

export const GET = withRls(async (req, { orgId, session }) => {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const year = parseInt(req.nextUrl.searchParams.get("year") || String(new Date().getFullYear()))
  const userId = req.nextUrl.searchParams.get("userId") || undefined

  const quotas = await prisma.salesQuota.findMany({
    where: {
      organizationId: orgId,
      year,
      ...(userId ? { userId } : {}),
    },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: [{ userId: "asc" }, { quarter: "asc" }],
  })

  /*
   * Written-down stage spellings, not the literal "WON": `Deal.stage` is a free
   * string and production holds `CLOSED_WON` beside `WON`, so a literal filter
   * credits that deal to nobody.
   */
  const { wonStages } = await orgStageVocabulary(orgId)

  // Get actual won deals per user per quarter for comparison
  const wonDeals = await prisma.deal.findMany({
    where: {
      organizationId: orgId,
      stage: { in: wonStages },
      updatedAt: {
        gte: new Date(year, 0, 1),
        lt: new Date(year + 1, 0, 1),
      },
    },
    select: { assignedTo: true, valueAmount: true, updatedAt: true },
  })

  const actualsByUserQuarter: Record<string, number> = {}
  for (const d of wonDeals) {
    if (!d.assignedTo) continue
    const q = Math.ceil((new Date(d.updatedAt).getMonth() + 1) / 3)
    const key = `${d.assignedTo}_${q}`
    actualsByUserQuarter[key] = (actualsByUserQuarter[key] || 0) + decimalToNumber(d.valueAmount)
  }

  const data = quotas.map((q: any) => ({
    ...q,
    actual: actualsByUserQuarter[`${q.userId}_${q.quarter}`] || 0,
    attainment: q.amount > 0
      ? Math.round(((actualsByUserQuarter[`${q.userId}_${q.quarter}`] || 0) / q.amount) * 100)
      : 0,
  }))

  return NextResponse.json({ success: true, data })
})

export const POST = withRls(async (req, { orgId, session }) => {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!isManagerOrAbove(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const parsed = createQuotaSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }
  const { userId, year, quarter, amount, currency } = parsed.data

  const quota = await prisma.salesQuota.upsert({
    where: {
      organizationId_userId_year_quarter: {
        organizationId: orgId,
        userId,
        year,
        quarter,
      },
    },
    update: { amount, currency: currency || DEFAULT_CURRENCY },
    create: {
      organizationId: orgId,
      userId,
      year,
      quarter,
      amount,
      currency: currency || DEFAULT_CURRENCY,
    },
  })

  logAudit(orgId, "create", "sales_quota", quota.id, `Quota: ${year} Q${quarter}`)

  return NextResponse.json({ success: true, data: quota })
})
