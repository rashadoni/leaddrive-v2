import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { PAGE_SIZE } from "@/lib/constants"
import { decimalToNumber } from "@/lib/prisma-decimal"
import { withRls } from "@/lib/with-rls"
import { orgStageVocabulary } from "@/lib/deal-stage-vocabulary"

export const GET = withRls(async (_req, { orgId }) => {
  try {
    /*
     * Stage spellings first: this dashboard and the executive one must agree,
     * and they only do if both ask the same question. A literal "WON" here left
     * the org's largest deal out of revenue and inside the open pipeline.
     */
    const { wonStages, lostStages, closedStages } = await orgStageVocabulary(orgId)

    const [
      companiesCount,
      contactsCount,
      activeDeals,
      dealsPipelineValue,
      openTickets,
      overdueTasks,
      recentActivities,
      myTasks,
    ] = await Promise.all([
      prisma.company.count({ where: { organizationId: orgId, category: "client" } }),
      prisma.contact.count({ where: { organizationId: orgId } }),
      prisma.deal.count({ where: { organizationId: orgId, stage: { notIn: closedStages } } }),
      prisma.deal.aggregate({ where: { organizationId: orgId, stage: { notIn: lostStages } }, _sum: { valueAmount: true } }),
      prisma.ticket.count({ where: { organizationId: orgId, status: { in: ["new", "in_progress", "waiting"] } } }),
      prisma.task.count({ where: { organizationId: orgId, status: { not: "completed" }, dueDate: { lt: new Date() } } }),
      prisma.activity.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: "desc" }, take: PAGE_SIZE.DASHBOARD_RECENT, include: { contact: { select: { fullName: true } }, company: { select: { name: true } } } }),
      prisma.task.findMany({ where: { organizationId: orgId, status: { not: "completed" } }, orderBy: { dueDate: "asc" }, take: PAGE_SIZE.DASHBOARD_TASKS }),
    ]) as any[]

    // Engagement stats
    const [engagementHot, engagementWarm, engagementCold] = await Promise.all([
      prisma.contact.count({ where: { organizationId: orgId, engagementScore: { gte: 50 } } }),
      prisma.contact.count({ where: { organizationId: orgId, engagementScore: { gte: 20, lt: 50 } } }),
      prisma.contact.count({ where: { organizationId: orgId, engagementScore: { lt: 20 } } }),
    ])

    // Revenue by month (last 6 months)
    const sixMonthsAgo = new Date()
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
    const deals = await prisma.deal.findMany({
      where: { organizationId: orgId, stage: { in: wonStages }, createdAt: { gte: sixMonthsAgo } },
      select: { valueAmount: true, createdAt: true },
    })

    const revenueByMonth: Record<string, number> = {}
    for (const deal of deals) {
      const month = deal.createdAt.toISOString().slice(0, 7)
      revenueByMonth[month] = (revenueByMonth[month] || 0) + decimalToNumber(deal.valueAmount)
    }

    return NextResponse.json({
      success: true,
      data: {
        stats: {
          companies: companiesCount,
          contacts: contactsCount,
          activeDeals,
          pipelineValue: decimalToNumber(dealsPipelineValue._sum.valueAmount),
          openTickets,
          overdueTasks,
        },
        revenueByMonth,
        recentActivities,
        myTasks,
        engagementHot,
        engagementWarm,
        engagementCold,
      },
    })
  } catch (err) {
    console.error("Dashboard error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
