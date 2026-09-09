import { prisma } from "@/lib/prisma"

const OUTSTANDING_STATUSES = ["sent", "viewed", "partially_paid", "overdue"]
const TRIGGER_RATIO = 0.8  // fire warning when outstanding >= 80% of limit

export interface CreditWarning {
  companyId: string
  companyName: string
  creditLimit: number
  creditCurrency: string
  outstandingAmount: number
  percentUsed: number
  overdueCount: number
  oldestOverdueDays: number
}

export async function findCreditLimitWarnings(orgId: string, now: Date): Promise<CreditWarning[]> {
  const companies = await prisma.company.findMany({
    where: {
      organizationId: orgId,
      creditLimit: { gt: 0 },
    },
    select: {
      id: true, name: true, creditLimit: true, creditCurrency: true,
      invoices: {
        where: { status: { in: OUTSTANDING_STATUSES } },
        select: { id: true, totalAmount: true, paidAmount: true, status: true, dueDate: true, currency: true },
      },
    },
  })
  if (companies.length === 0) return []

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { settings: true },
  })
  const orgCurrency = ((org?.settings as Record<string, any>) || {}).defaultCurrency || "USD"

  const warnings: CreditWarning[] = []
  for (const co of companies) {
    const limit = co.creditLimit || 0
    const limitCcy = co.creditCurrency || orgCurrency
    let outstanding = 0
    let overdueCount = 0
    let oldestOverdueDays = 0
    for (const inv of co.invoices) {
      // sum only invoices in the same currency as credit limit; skip mismatched
      if ((inv as any).currency && (inv as any).currency !== limitCcy) continue
      const due = Math.max(0, (inv.totalAmount || 0) - (inv.paidAmount || 0))
      outstanding += due
      if (inv.status === "overdue" && inv.dueDate) {
        overdueCount++
        const days = Math.floor((now.getTime() - inv.dueDate.getTime()) / 86400000)
        if (days > oldestOverdueDays) oldestOverdueDays = days
      }
    }
    const percentUsed = limit > 0 ? outstanding / limit : 0
    if (percentUsed >= TRIGGER_RATIO) {
      warnings.push({
        companyId: co.id,
        companyName: co.name,
        creditLimit: limit,
        creditCurrency: limitCcy,
        outstandingAmount: Math.round(outstanding * 100) / 100,
        percentUsed: Math.round(percentUsed * 100) / 100,
        overdueCount,
        oldestOverdueDays,
      })
    }
  }
  return warnings
}

export async function filterNewCreditWarnings(
  orgId: string,
  warnings: CreditWarning[],
  now: Date,
): Promise<CreditWarning[]> {
  if (warnings.length === 0) return []
  const existing = await prisma.aiShadowAction.findMany({
    where: {
      organizationId: orgId,
      featureName: { in: ["ai_auto_credit_limit", "ai_auto_credit_limit_shadow"] },
      entityType: "company",
      entityId: { in: warnings.map(w => w.companyId) },
      OR: [{ approved: null }, { reviewedAt: { gte: new Date(now.getTime() - 14 * 86400000) } }],
    },
    select: { entityId: true },
  })
  const skip = new Set(existing.map((e: { entityId: string }) => e.entityId))
  return warnings.filter(w => !skip.has(w.companyId))
}

export async function writeCreditLimitShadowAction(
  orgId: string,
  w: CreditWarning,
  now: Date,
  shadow: boolean,
) {
  await prisma.aiShadowAction.create({
    data: {
      organizationId: orgId,
      featureName: shadow ? "ai_auto_credit_limit_shadow" : "ai_auto_credit_limit",
      entityType: "company",
      entityId: w.companyId,
      actionType: "credit_warning",
      payload: {
        companyName: w.companyName,
        creditLimit: w.creditLimit,
        creditCurrency: w.creditCurrency,
        outstandingAmount: w.outstandingAmount,
        percentUsed: w.percentUsed,
        overdueCount: w.overdueCount,
        oldestOverdueDays: w.oldestOverdueDays,
        reasoning: `Outstanding ${w.outstandingAmount} ${w.creditCurrency} is ${Math.round(w.percentUsed * 100)}% of credit limit (${w.creditLimit} ${w.creditCurrency}).`,
      },
      approved: shadow ? null : true,
      reviewedAt: shadow ? null : now,
      reviewedBy: shadow ? null : "system",
    },
  })
}
