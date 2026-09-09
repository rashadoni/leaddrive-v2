import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireCronAuth } from "@/lib/cron-auth"
import { canRunAiAutomation } from "@/lib/ai/budget"
import { decimalToNumber, decimalToNumberNullable } from "@/lib/prisma-decimal"
import { runWithRlsBypass } from "@/lib/rls-context"
import { orgStageVocabulary } from "@/lib/deal-stage-vocabulary"

const FEATURE_NAME = "ai_anomaly_detection"

/**
 * AI Anomaly Detection Cron Endpoint
 * Called by external cron (e.g. every 30 minutes)
 * Detects unusual patterns and creates AiAlert records.
 * No LLM calls — pure SQL aggregation + threshold checks.
 */
export async function POST(req: NextRequest) {
  return runWithRlsBypass(async () => {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError

  try {
    const now = new Date()
    let alertsCreated = 0

    const orgs = await prisma.organization.findMany({
      where: { isActive: true },
      select: { id: true },
    })

    for (const org of orgs) {
      const guard = await canRunAiAutomation(org.id, FEATURE_NAME)
      if (!guard.proceed) continue

      const alerts = await detectAnomalies(org.id, now)

      for (const alert of alerts) {
        // Deduplicate: don't create same alert type+message within 24h (uses indexed columns)
        const existing = await prisma.aiAlert.findFirst({
          where: {
            organizationId: org.id,
            type: alert.type,
            message: alert.message,
            createdAt: { gte: new Date(now.getTime() - 24 * 3600000) },
          },
        })
        if (existing) continue

        await prisma.aiAlert.create({
          data: {
            organizationId: org.id,
            type: alert.type,
            severity: alert.severity,
            message: alert.message,
            metadata: alert.metadata || {},
          },
        })
        alertsCreated++
      }
    }

    return NextResponse.json({
      success: true,
      data: { alertsCreated, timestamp: now.toISOString() },
    })
  } catch (e) {
    console.error("AI Anomaly Detection cron error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
  })
}

interface AnomalyAlert {
  type: string
  severity: "info" | "warning" | "critical"
  message: string
  metadata?: Record<string, any>
}

async function detectAnomalies(orgId: string, now: Date): Promise<AnomalyAlert[]> {
  // Закрытая сделка — это любое написание закрытой, а не два литерала.
  const { closedStages } = await orgStageVocabulary(orgId)
  const alerts: AnomalyAlert[] = []
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)
  const last24h = new Date(now.getTime() - 24 * 3600000)
  const last7d = new Date(now.getTime() - 7 * 86400000)

  // 1. Ticket spike: >5 tickets from same company in 24h
  const ticketsByCompany = await prisma.ticket.groupBy({
    by: ["companyId"],
    where: {
      organizationId: orgId,
      createdAt: { gte: last24h },
      companyId: { not: null },
    },
    _count: { id: true },
    having: { id: { _count: { gte: 5 } } },
  })

  for (const group of ticketsByCompany) {
    if (!group.companyId) continue
    const company = await prisma.company.findUnique({
      where: { id: group.companyId },
      select: { name: true },
    })
    alerts.push({
      type: "anomaly",
      severity: "warning",
      message: `Ticket spike: ${group._count.id} tickets from ${company?.name || "Unknown"} in 24h`,
      metadata: { entityId: group.companyId, entityType: "company", count: group._count.id },
    })
  }

  // 2. Large invoice: any invoice created today with amount >2x the org average
  try {
    const avgResult = await prisma.invoice.aggregate({
      where: { organizationId: orgId },
      _avg: { totalAmount: true },
    })
    const avgAmount = decimalToNumber(avgResult._avg.totalAmount)

    if (avgAmount > 0) {
      const largeInvoices = await prisma.invoice.findMany({
        where: {
          organizationId: orgId,
          createdAt: { gte: todayStart },
          totalAmount: { gte: avgAmount * 2 },
        },
        select: { id: true, invoiceNumber: true, totalAmount: true },
      })

      for (const inv of largeInvoices) {
        alerts.push({
          type: "anomaly",
          severity: "info",
          message: `Large invoice ${inv.invoiceNumber}: $${decimalToNumber(inv.totalAmount).toFixed(0)} (avg: $${avgAmount.toFixed(0)})`,
          metadata: { entityId: inv.id, entityType: "invoice", amount: decimalToNumber(inv.totalAmount) },
        })
      }
    }
  } catch {
    // invoice model may not have all fields
  }

  // 3. Engagement drop: company with >50% engagement score drop in 7 days
  const contacts = await prisma.contact.findMany({
    where: {
      organizationId: orgId,
      companyId: { not: null },
      engagementScore: { gte: 0 },
    },
    select: { companyId: true, engagementScore: true },
  })

  // Group by company and get avg engagement
  const companyEngagement = new Map<string, number[]>()
  for (const c of contacts) {
    if (!c.companyId) continue
    const arr = companyEngagement.get(c.companyId) || []
    arr.push(c.engagementScore || 0)
    companyEngagement.set(c.companyId, arr)
  }

  for (const [companyId, scores] of companyEngagement) {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length
    if (avg < 20 && scores.length >= 2) {
      // Check if company had recent activity before (within last 30-60 days but not last 7)
      const recentActivity = await prisma.activity.count({
        where: {
          organizationId: orgId,
          relatedType: "company",
          relatedId: companyId,
          createdAt: { gte: last7d },
        },
      })
      const olderActivity = await prisma.activity.count({
        where: {
          organizationId: orgId,
          relatedType: "company",
          relatedId: companyId,
          createdAt: {
            gte: new Date(now.getTime() - 60 * 86400000),
            lt: last7d,
          },
        },
      })

      if (olderActivity > 3 && recentActivity === 0) {
        const company = await prisma.company.findUnique({
          where: { id: companyId },
          select: { name: true },
        })
        alerts.push({
          type: "anomaly",
          severity: "warning",
          message: `Engagement drop: ${company?.name || "Unknown"} — ${olderActivity} activities last month, 0 this week`,
          metadata: { entityId: companyId, entityType: "company", avgEngagement: Math.round(avg) },
        })
      }
    }
  }

  // 4. Deal value spike: deal updated today with value >3x avg deal value
  const avgDeal = await prisma.deal.aggregate({
    where: { organizationId: orgId, valueAmount: { gt: 0 } },
    _avg: { valueAmount: true },
  })
  const avgDealValue = decimalToNumberNullable(avgDeal._avg.valueAmount) ?? 0

  if (avgDealValue > 0) {
    const bigDeals = await prisma.deal.findMany({
      where: {
        organizationId: orgId,
        updatedAt: { gte: todayStart },
        valueAmount: { gte: avgDealValue * 3 },
        stage: { notIn: closedStages },
      },
      select: { id: true, name: true, valueAmount: true },
    })

    for (const deal of bigDeals) {
      const dealValue = decimalToNumber(deal.valueAmount)
      alerts.push({
        type: "anomaly",
        severity: "info",
        message: `High-value deal: "${deal.name}" — $${dealValue.toFixed(0)} (avg: $${avgDealValue.toFixed(0)})`,
        metadata: { entityId: deal.id, entityType: "deal", value: dealValue },
      })
    }
  }

  // 5. AI cost spike: today's AI spend > 2x average daily spend
  const last30d = new Date(now.getTime() - 30 * 86400000)
  const totalAiCost = await prisma.aiInteractionLog.aggregate({
    where: { organizationId: orgId, createdAt: { gte: last30d }, costUsd: { not: null } },
    _sum: { costUsd: true },
  })
  const avgDailyCost = (totalAiCost._sum.costUsd || 0) / 30

  if (avgDailyCost > 0.01) {
    const todayCost = await prisma.aiInteractionLog.aggregate({
      where: { organizationId: orgId, createdAt: { gte: todayStart }, costUsd: { not: null } },
      _sum: { costUsd: true },
    })
    const todaySpend = todayCost._sum.costUsd || 0

    if (todaySpend > avgDailyCost * 2) {
      // `message` is the English fallback; UI prefers `metadata.messageKey` + `metadata.params`
      // via next-intl (see ai-command-center/page.tsx alert renderer).
      alerts.push({
        type: "token_spike",
        severity: "warning",
        message: `AI cost spike: $${todaySpend.toFixed(3)} today (avg: $${avgDailyCost.toFixed(3)}/day)`,
        metadata: {
          todaySpend,
          avgDailyCost,
          messageKey: "alertMsg.aiCostSpike",
          params: { today: `$${todaySpend.toFixed(3)}`, avg: `$${avgDailyCost.toFixed(3)}` },
        },
      })
    }
  }

  return alerts
}
