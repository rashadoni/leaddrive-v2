import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { loadAndCompute } from "@/lib/cost-model/db"
import { generateRevenueForecast } from "@/lib/ai/predictive"
import { decimalToNumber } from "@/lib/prisma-decimal"
import { canonicalDealStage, resolveStageVocabulary } from "@/lib/deal-stage-normalization"
import { wonStageNames, lostStageNames } from "@/lib/marketing-attribution/won-stages"

export const GET = withRls(async (_req, { orgId }) => {
  try {
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const startOfWeek = new Date(now)
    startOfWeek.setDate(now.getDate() - now.getDay())
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000)

    /*
     * Resolve the stage vocabulary before anything queries by it.
     *
     * `Deal.stage` is a free string: pipelines are configured per org and rows
     * also arrive from imports and seeds. This tenant holds seven spellings for
     * five stages — `WON` and `CLOSED_WON`, `LEAD` and `lead` — so every
     * `stage: "WON"` comparison silently split the data. It dropped the single
     * largest deal from revenue, counted that same closed deal as still open,
     * and printed `LEAD` twice in the pipeline.
     *
     * Reports already merge aliases through `canonicalDealStage`; the dashboard
     * did not, which is why the two disagreed. It cannot go inside the `where`
     * clause, so the distinct stages are read first and the ones that fold to
     * WON/LOST become the filter.
     */
    const [configuredWonStages, configuredLostStages, dealsByStage] = await Promise.all([
      wonStageNames(orgId),
      lostStageNames(orgId),
      prisma.deal.groupBy({
        by: ["stage"],
        where: { organizationId: orgId },
        _count: true,
        _sum: { valueAmount: true },
      }),
    ])
    const canonStage = (stage: string) =>
      canonicalDealStage(stage, configuredWonStages, configuredLostStages)
    const { wonStages, lostStages, closedStages } = resolveStageVocabulary(
      (dealsByStage as { stage: string }[]).map((r) => r.stage),
      configuredWonStages,
      configuredLostStages,
    )

    const [
      companiesCount,
      companiesAgg,
      contactsCount,
      activeDeals,
      pipelineAgg,
      openTickets,
      criticalTickets,
      slaBreached,
      csatAgg,
      overdueTasks,
      totalTasks,
      completedTasks,
      dueThisWeek,
      wonThisMonth,
      wonValueAgg,
      lostThisMonth,
      recentActivities,
      activityCount30d,
      leadsByTemp,
      serviceRevenue,
      ticketsByStatus,
      leadsByStatus,
      contractsData,
      wonDealsAll,
      dealsForForecast,
      activeLeadsCount,
      leadsBySource,
      topScoredLeads,
      recentDealsList,
      activeCampaigns,
      upcomingEvents,
      weekLeads,
      weekTickets,
      slaResolvedOnTime,
      slaResolvedTotal,
      ticketsWithResponse,
      atRiskDeals,
    ] = await Promise.all([
      // Companies
      prisma.company.count({ where: { organizationId: orgId, category: "client" } }),
      prisma.company.aggregate({ where: { organizationId: orgId, category: "client" }, _sum: { userCount: true } }),
      // Contacts
      prisma.contact.count({ where: { organizationId: orgId } }),
      // Deals
      prisma.deal.count({ where: { organizationId: orgId, stage: { notIn: closedStages } } }),
      prisma.deal.aggregate({ where: { organizationId: orgId, stage: { notIn: lostStages } }, _sum: { valueAmount: true } }),
      // Tickets
      prisma.ticket.count({ where: { organizationId: orgId, status: { in: ["new", "in_progress", "waiting"] } } }),
      prisma.ticket.count({ where: { organizationId: orgId, priority: "urgent", status: { in: ["new", "in_progress", "waiting"] } } }),
      prisma.ticket.count({ where: { organizationId: orgId, slaDueAt: { lt: now }, status: { in: ["new", "in_progress", "waiting"] } } }),
      prisma.ticket.aggregate({ where: { organizationId: orgId, satisfactionRating: { gt: 0 } }, _avg: { satisfactionRating: true }, _count: true }),
      // Tasks
      prisma.task.count({ where: { organizationId: orgId, status: { not: "completed" }, dueDate: { lt: now } } }),
      prisma.task.count({ where: { organizationId: orgId } }),
      prisma.task.count({ where: { organizationId: orgId, status: "completed" } }),
      prisma.task.count({ where: { organizationId: orgId, status: { not: "completed" }, dueDate: { gte: now, lte: new Date(now.getTime() + 7 * 86400000) } } }),
      /*
       * Won/Lost this month — by `stageChangedAt`, not `updatedAt`.
       *
       * `updatedAt` is a row-touch timestamp: renaming a deal closed years ago
       * would have made it "won this month". `stageChangedAt` is the only field
       * that records when a deal actually reached its stage.
       *
       * It is null on rows that were never moved through the app — imports and
       * seeds write the final stage directly — and those are honestly excluded
       * rather than counted. A deal whose win date is unknown is not a deal won
       * this month.
       */
      prisma.deal.count({ where: { organizationId: orgId, stage: { in: wonStages }, stageChangedAt: { gte: startOfMonth } } }),
      prisma.deal.aggregate({ where: { organizationId: orgId, stage: { in: wonStages }, stageChangedAt: { gte: startOfMonth } }, _sum: { valueAmount: true } }),
      prisma.deal.count({ where: { organizationId: orgId, stage: { in: lostStages }, stageChangedAt: { gte: startOfMonth } } }),
      // Activity
      prisma.activity.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: "desc" }, take: 8, include: { contact: { select: { fullName: true } }, company: { select: { name: true } } } }),
      prisma.activity.count({ where: { organizationId: orgId, createdAt: { gte: thirtyDaysAgo } } }),
      // Leads by temperature
      prisma.company.groupBy({ by: ["leadTemperature"], where: { organizationId: orgId, category: "client", leadTemperature: { not: null } }, _count: true }),
      // Service revenue
      prisma.clientService.groupBy({ by: ["serviceType"], where: { organizationId: orgId, isActive: true }, _sum: { monthlyRevenue: true } }),
      // Tickets by status
      prisma.ticket.groupBy({ by: ["status"], where: { organizationId: orgId }, _count: true }),
      // Leads by status (for lead funnel)
      prisma.lead.groupBy({ by: ["status"], where: { organizationId: orgId }, _count: true }),
      // Contracts for financial overview
      prisma.contract.findMany({
        where: { organizationId: orgId },
        select: { valueAmount: true, status: true },
      }),
      // All won deals (total revenue)
      prisma.deal.findMany({
        where: { organizationId: orgId, stage: { in: wonStages } },
        select: { valueAmount: true },
      }),
      // Deals with dates for forecast
      prisma.deal.findMany({
        where: { organizationId: orgId },
        select: { valueAmount: true, stage: true, createdAt: true, updatedAt: true },
      }),
      // Active leads
      prisma.lead.count({ where: { organizationId: orgId, status: { notIn: ["converted", "lost"] } } }),
      // Leads by source
      prisma.lead.groupBy({ by: ["source"], where: { organizationId: orgId }, _count: true }),
      // Top scored leads
      prisma.lead.findMany({
        where: { organizationId: orgId },
        orderBy: { score: "desc" },
        take: 5,
        select: { id: true, contactName: true, companyName: true, score: true, source: true },
      }),
      // Recent deals
      prisma.deal.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, name: true, valueAmount: true, currency: true, stage: true, company: { select: { name: true } } },
      }),
      // Recent campaigns (any status)
      prisma.campaign.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: "desc" },
        take: 4,
        select: { id: true, name: true, status: true, totalSent: true, totalOpened: true, totalClicked: true, totalRecipients: true },
      }),
      // Upcoming events
      prisma.event.findMany({
        where: { organizationId: orgId, startDate: { gte: now } },
        orderBy: { startDate: "asc" },
        take: 3,
        select: { id: true, name: true, startDate: true, type: true, registeredCount: true },
      }),
      // Week leads (last 7 days)
      prisma.lead.findMany({
        where: { organizationId: orgId, createdAt: { gte: new Date(now.getTime() - 7 * 86400000) } },
        select: { createdAt: true },
      }),
      // Week tickets (last 7 days)
      prisma.ticket.findMany({
        where: { organizationId: orgId, createdAt: { gte: new Date(now.getTime() - 7 * 86400000) } },
        select: { createdAt: true },
      }),
      // SLA resolved on time
      prisma.ticket.count({
        where: { organizationId: orgId, resolvedAt: { not: null }, slaDueAt: { not: null } },
      }),
      // SLA resolved total
      prisma.ticket.count({
        where: { organizationId: orgId, resolvedAt: { not: null } },
      }),
      // Tickets with first response
      prisma.ticket.findMany({
        where: { organizationId: orgId, firstResponseAt: { not: null } },
        select: { createdAt: true, firstResponseAt: true },
        take: 100,
        orderBy: { createdAt: "desc" },
      }),
      // At-risk deals (low confidence, active)
      prisma.deal.findMany({
        where: { organizationId: orgId, stage: { notIn: closedStages } },
        select: {
          id: true, name: true, valueAmount: true, currency: true, stage: true,
          probability: true, confidenceLevel: true, stageChangedAt: true, createdAt: true, contactId: true,
          company: { select: { name: true } },
        },
        orderBy: { valueAmount: "desc" },
      }),
    ])

    // Cost model — direct compute (no internal fetch)
    let costSummary = { totalCost: 0, totalRevenue: 0, margin: 0, marginPct: 0, profitableClients: 0, lossClients: 0 }
    let topClients: any[] = []
    let bottomClients: any[] = []
    try {
      const costResult = await loadAndCompute(orgId)
      costSummary = {
        totalCost: costResult.grandTotalG || 0,
        totalRevenue: costResult.summary?.totalRevenue || 0,
        margin: costResult.summary?.totalMargin || 0,
        marginPct: costResult.summary?.marginPct || 0,
        profitableClients: costResult.summary?.profitableClients || 0,
        lossClients: costResult.summary?.lossClients || 0,
      }
      // Top/bottom clients from cost model
      const sorted = (costResult.clients || []).sort((a: any, b: any) => (b.totalRevenue || 0) - (a.totalRevenue || 0))
      topClients = sorted.filter((c: any) => c.totalRevenue > 0).slice(0, 5).map((c: any) => ({
        name: c.name, revenue: c.totalRevenue, margin: c.margin, marginPct: c.marginPct, userCount: c.userCount,
      }))
      bottomClients = sorted.filter((c: any) => c.margin < 0).slice(-3).map((c: any) => ({
        name: c.name, revenue: c.totalRevenue, margin: c.margin, marginPct: c.marginPct, userCount: c.userCount,
      }))
    } catch (err) { console.error(err) }

    // Risks — return keys for i18n, frontend translates
    const risks: { severity: string; titleKey: string; descKey: string; descParams?: Record<string, string | number>; metric: string }[] = []
    if (costSummary.marginPct < 5 && costSummary.totalRevenue > 0)
      risks.push({ severity: "critical", titleKey: "riskLowMargin", descKey: "riskLowMarginDesc", descParams: { pct: costSummary.marginPct.toFixed(1) }, metric: `${costSummary.marginPct.toFixed(1)}%` })
    if (costSummary.lossClients > costSummary.profitableClients * 0.5)
      risks.push({ severity: "warning", titleKey: "riskUnprofitableClients", descKey: "riskUnprofitableClientsDesc", descParams: { total: costSummary.profitableClients + costSummary.lossClients, count: costSummary.lossClients }, metric: `${costSummary.lossClients}` })
    if (slaBreached > 0)
      risks.push({ severity: "critical", titleKey: "riskSlaBreach", descKey: "riskSlaBreachDesc", descParams: { count: slaBreached }, metric: `${slaBreached}` })
    if (overdueTasks > 3)
      risks.push({ severity: "warning", titleKey: "riskOverdueTasks", descKey: "riskOverdueTasksDesc", descParams: { count: overdueTasks }, metric: `${overdueTasks}` })
    // At-risk deals (predictive score < 40%)
    const STAGE_PROBABILITY: Record<string, number> = {
      LEAD: 10, QUALIFIED: 20, PROPOSAL: 50, NEGOTIATION: 70, CONTRACT: 85,
    }
    const atRiskList = (atRiskDeals as any[]).map((d: any) => {
      const confidence = d.confidenceLevel ?? 50
      const probability = d.probability ?? (STAGE_PROBABILITY[canonStage(d.stage)] || 30)
      const predictive = Math.round(confidence * 0.85 + probability * 0.15)
      const daysInFunnel = Math.floor((Date.now() - new Date(d.createdAt).getTime()) / 86400000)
      return { ...d, predictive, probability, daysInFunnel }
    }).filter((d: any) => d.predictive < 40)
    .sort((a: any, b: any) => a.predictive - b.predictive)

    if (atRiskList.length > 0)
      risks.push({
        severity: "warning",
        titleKey: "riskAtRiskDeals",
        descKey: "riskAtRiskDealsDesc",
        descParams: { count: atRiskList.length },
        metric: `${atRiskList.length}`,
      })

    if (risks.length === 0)
      risks.push({ severity: "ok", titleKey: "riskAllGood", descKey: "riskAllGoodDesc", metric: "✓" })

    // Weekly metrics computation
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000)
    const leadsPerDay = Array(7).fill(0)
    const ticketsPerDay = Array(7).fill(0)
    for (const l of weekLeads as any[]) {
      const dayIdx = 6 - Math.floor((now.getTime() - new Date(l.createdAt).getTime()) / 86400000)
      if (dayIdx >= 0 && dayIdx < 7) leadsPerDay[dayIdx]++
    }
    for (const t of weekTickets as any[]) {
      const dayIdx = 6 - Math.floor((now.getTime() - new Date(t.createdAt).getTime()) / 86400000)
      if (dayIdx >= 0 && dayIdx < 7) ticketsPerDay[dayIdx]++
    }
    const slaCompliance = (slaResolvedTotal as number) > 0
      ? Math.round(((slaResolvedOnTime as number) / (slaResolvedTotal as number)) * 100)
      : 0
    const csatVal = csatAgg._avg.satisfactionRating || 0
    let avgResponseHours = 0
    const respTickets = ticketsWithResponse as any[]
    if (respTickets.length > 0) {
      const totalMs = respTickets.reduce((s: number, t: any) => {
        return s + (new Date(t.firstResponseAt).getTime() - new Date(t.createdAt).getTime())
      }, 0)
      avgResponseHours = Math.round(totalMs / respTickets.length / 3600000)
    }

    /*
     * Pipeline rolled up by canonical stage.
     *
     * Merging happens here rather than in SQL because the folding rules live in
     * `canonicalDealStage`, and duplicating them as a Postgres expression is how
     * the two would drift apart again.
     */
    const stageSummary = new Map<string, { stage: string; count: number; value: number }>()
    for (const row of dealsByStage as any[]) {
      const stage = canonStage(row.stage)
      const entry = stageSummary.get(stage) ?? { stage, count: 0, value: 0 }
      entry.count += row._count
      entry.value += decimalToNumber(row._sum.valueAmount)
      stageSummary.set(stage, entry)
    }
    const normalizedStages = Array.from(stageSummary.values())

    // Pipeline conversion rate
    const totalDealsEver = normalizedStages.reduce((s: number, d) => s + d.count, 0)
    const wonDealsCount2 = stageSummary.get("WON")?.count || 0
    const pipelineConversionRate = totalDealsEver > 0 ? Math.round((wonDealsCount2 / totalDealsEver) * 100) : 0

    const totalUsers = companiesAgg._sum.userCount || 0

    // Financial overview from contracts + deals
    const wonDealsRevenue = wonDealsAll.reduce((s: number, d: any) => s + decimalToNumber(d.valueAmount), 0)
    const activeContracts = contractsData.filter((c: any) => c.status === "active" || c.status === "Active")
    const totalContractValue = activeContracts.reduce((s: number, c: any) => s + decimalToNumber(c.valueAmount), 0)
    const monthlyContractRevenue = Math.round(totalContractValue / 12)

    // Lead funnel data (with conversion rates)
    const totalLeadCount = leadsByStatus.reduce((s: number, l: any) => s + l._count, 0)
    const leadFunnelOrder = ["new", "contacted", "qualified", "converted", "rejected"]
    const leadFunnelData = leadFunnelOrder.map(status => {
      const item = leadsByStatus.find((l: any) => l.status === status)
      const count = item?._count || 0
      return {
        status,
        count,
        pct: totalLeadCount > 0 ? Math.round((count / totalLeadCount) * 100) : 0,
      }
    }).filter(l => l.count > 0)
    const convertedLeads = leadsByStatus.find((l: any) => l.status === "converted")?._count || 0
    const leadConversionRate = totalLeadCount > 0 ? Math.round((convertedLeads / totalLeadCount) * 100) : 0

    // Sales forecast — committed / bestCase / pipeline using predictive engine
    const forecast = await generateRevenueForecast(orgId, 6)

    // Service labels
    const serviceLabels: Record<string, string> = {
      permanent_it: "Постоянное IT", infosec: "InfoSec", erp: "ERP",
      grc: "GRC", projects: "Проекты", helpdesk: "HelpDesk", cloud: "Облако",
    }

    // Revenue fallback for CRM-only tenants:
    // costSummary.totalRevenue comes from the Cost Model / Profitability
    // module (part of the separate BudgetPro suite). Tenants that use
    // LeadDrive purely as a CRM won't have that data — the «Выручка»
    // stat card shows 0 even when they have WON deals. Fall back to the
    // sum of WON deals' valueAmount so the card is meaningful out of
    // the box. If BudgetPro data exists, it wins.
    let displayedRevenue = costSummary.totalRevenue
    let displayedMarginPct = costSummary.marginPct
    if (displayedRevenue === 0) {
      const wonDealsAgg = await prisma.deal.aggregate({
        where: { organizationId: orgId, stage: { in: wonStages } },
        _sum: { valueAmount: true },
      })
      displayedRevenue = decimalToNumber(wonDealsAgg._sum.valueAmount)
      // No cost model → we can't compute margin, leave at 0
      displayedMarginPct = 0
    }

    return NextResponse.json({
      success: true,
      data: {
        financial: {
          monthlyRevenue: displayedRevenue,
          monthlyCost: costSummary.totalCost,
          monthlyMargin: costSummary.margin,
          marginPct: displayedMarginPct,
          pipelineValue: decimalToNumber(pipelineAgg._sum.valueAmount),
          revenueByService: serviceRevenue.map((s: any) => ({
            name: serviceLabels[s.serviceType] || s.serviceType,
            value: s._sum.monthlyRevenue || 0,
          })).filter((s: any) => s.value > 0).sort((a: any, b: any) => b.value - a.value),
        },
        clients: {
          total: companiesCount,
          totalUsers,
          profitable: costSummary.profitableClients,
          loss: costSummary.lossClients,
          noRevenue: companiesCount - costSummary.profitableClients - costSummary.lossClients,
          topClients,
          bottomClients,
        },
        pipeline: {
          deals: activeDeals,
          stages: normalizedStages,
          wonThisMonth,
          wonValue: decimalToNumber(wonValueAgg._sum.valueAmount),
          lostThisMonth,
          conversionRate: pipelineConversionRate,
          recentDeals: (recentDealsList as any[]).map((d: any) => ({
            id: d.id, name: d.name, valueAmount: decimalToNumber(d.valueAmount), currency: d.currency, stage: d.stage,
            company: d.company,
          })),
        },
        leads: {
          byTemperature: leadsByTemp.map((t: any) => ({
            temp: t.leadTemperature, count: t._count,
          })),
          funnel: leadFunnelData,
          total: totalLeadCount,
          activeCount: activeLeadsCount,
          conversionRate: leadConversionRate,
          bySource: leadsBySource,
          topScored: topScoredLeads,
        },
        financialOverview: {
          wonDealsRevenue,
          wonDealsCount: wonDealsAll.length,
          avgDealSize: wonDealsAll.length > 0 ? Math.round(wonDealsRevenue / wonDealsAll.length) : 0,
          monthlyContractRevenue,
          totalContracts: contractsData.length,
          activeContracts: activeContracts.length,
          pipelineValue: decimalToNumber(pipelineAgg._sum.valueAmount),
        },
        forecast,
        operations: {
          openTickets,
          criticalTickets,
          slaBreached,
          csatScore: csatAgg._avg.satisfactionRating || 0,
          csatCount: csatAgg._count || 0,
          ticketsByStatus: ticketsByStatus.map((t: any) => ({
            status: t.status, count: t._count,
          })),
        },
        tasks: {
          total: totalTasks,
          overdue: overdueTasks,
          dueThisWeek,
          completed: completedTasks,
          completionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
        },
        activity: {
          recent: recentActivities,
          count30d: activityCount30d,
        },
        risks,
        campaigns: (activeCampaigns as any[]).map((c: any) => ({
          id: c.id, name: c.name, status: c.status || "draft", sent: c.totalSent || 0,
          openRate: c.totalRecipients > 0 ? Math.round((c.totalOpened / c.totalRecipients) * 100) : 0,
          clickRate: c.totalRecipients > 0 ? Math.round((c.totalClicked / c.totalRecipients) * 100) : 0,
        })),
        events: (upcomingEvents as any[]).map((e: any) => ({
          id: e.id, name: e.name, date: e.startDate, type: e.type, registered: e.registeredCount || 0,
        })),
        weeklyMetrics: {
          leadsPerDay,
          ticketsPerDay,
          slaCompliance,
          csat: csatVal,
          avgResponseHours,
        },
        atRiskDeals: atRiskList.slice(0, 5).map((d: any) => ({
          id: d.id, name: d.name, value: decimalToNumber(d.valueAmount), currency: d.currency,
          stage: d.stage, predictive: d.predictive, probability: d.probability,
          confidence: d.confidenceLevel ?? 50, daysInFunnel: d.daysInFunnel,
          company: d.company?.name,
        })),
      },
    })
  } catch (e) {
    console.error("Executive dashboard error:", e)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
})
