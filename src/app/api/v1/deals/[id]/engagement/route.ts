import { NextResponse } from "next/server"
import { withRls } from "@/lib/with-rls"
import { prisma } from "@/lib/prisma"

type ActivityRow = { id: string; type: string; subject: string | null; createdAt: Date; completedAt: Date | null }
type EmailLogRow = { status: string; createdAt: Date }

// GET /api/v1/deals/[id]/engagement — engagement metrics for deal's contact
export const GET = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const deal = await prisma.deal.findFirst({
    where: { id, organizationId: orgId },
    select: { contactId: true, companyId: true, id: true },
  })
  if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 })

  const threeMonthsAgo = new Date()
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)

  // Activities for this deal's contact
  const activities = await prisma.activity.findMany({
    where: {
      organizationId: orgId,
      OR: [
        { contactId: deal.contactId },
        { companyId: deal.companyId },
        { relatedType: "deal", relatedId: deal.id },
      ].filter(Boolean) as any,
      createdAt: { gte: threeMonthsAgo },
    },
    select: { id: true, type: true, subject: true, createdAt: true, completedAt: true },
    orderBy: { createdAt: "desc" },
  })

  // Activity breakdown
  const calls = activities.filter((a: ActivityRow) => a.type === "call").length
  const emails = activities.filter((a: ActivityRow) => a.type === "email").length
  const meetings = activities.filter((a: ActivityRow) => a.type === "meeting").length
  const notes = activities.filter((a: ActivityRow) => a.type === "note").length
  const tasks = activities.filter((a: ActivityRow) => a.type === "task").length

  // Last activity
  const lastActivity = activities[0] || null

  // Monthly breakdown for chart (last 6 months)
  const monthlyData: { month: string; calls: number; emails: number; meetings: number }[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date()
    d.setMonth(d.getMonth() - i)
    const monthStr = d.toLocaleString("en", { month: "short" })
    const start = new Date(d.getFullYear(), d.getMonth(), 1)
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59)

    const monthActivities = activities.filter((a: ActivityRow) => {
      const ad = new Date(a.createdAt)
      return ad >= start && ad <= end
    })

    monthlyData.push({
      month: monthStr,
      calls: monthActivities.filter((a: ActivityRow) => a.type === "call").length,
      emails: monthActivities.filter((a: ActivityRow) => a.type === "email").length,
      meetings: monthActivities.filter((a: ActivityRow) => a.type === "meeting").length,
    })
  }

  // Email logs for this contact
  let emailMetrics = { sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, failed: 0 }
  let emailMonthly: { month: string; sent: number; opened: number; clicked: number }[] = []

  if (deal.contactId) {
    const contact = await prisma.contact.findFirst({
      where: { id: deal.contactId, organizationId: orgId },
      select: { email: true },
    })

    if (contact?.email) {
      const emailLogs = await prisma.emailLog.findMany({
        where: {
          organizationId: orgId,
          toEmail: contact.email,
          createdAt: { gte: threeMonthsAgo },
        },
        select: { status: true, createdAt: true },
      })

      emailMetrics = {
        sent: emailLogs.length,
        delivered: emailLogs.filter((e: EmailLogRow) => e.status === "delivered" || e.status === "sent").length,
        opened: emailLogs.filter((e: EmailLogRow) => e.status === "opened").length,
        clicked: emailLogs.filter((e: EmailLogRow) => e.status === "clicked").length,
        bounced: emailLogs.filter((e: EmailLogRow) => e.status === "bounced").length,
        failed: emailLogs.filter((e: EmailLogRow) => e.status === "failed").length,
      }

      // Monthly email breakdown
      for (let i = 5; i >= 0; i--) {
        const d = new Date()
        d.setMonth(d.getMonth() - i)
        const monthStr = d.toLocaleString("en", { month: "short" })
        const start = new Date(d.getFullYear(), d.getMonth(), 1)
        const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59)

        const ml = emailLogs.filter((e: EmailLogRow) => {
          const ed = new Date(e.createdAt)
          return ed >= start && ed <= end
        })

        emailMonthly.push({
          month: monthStr,
          sent: ml.length,
          opened: ml.filter((e: EmailLogRow) => e.status === "opened").length,
          clicked: ml.filter((e: EmailLogRow) => e.status === "clicked").length,
        })
      }
    }
  }

  const openRate = emailMetrics.sent > 0 ? Math.round((emailMetrics.opened / emailMetrics.sent) * 100) : 0
  const clickRate = emailMetrics.sent > 0 ? Math.round((emailMetrics.clicked / emailMetrics.sent) * 100) : 0

  return NextResponse.json({
    success: true,
    data: {
      activities: { total: activities.length, calls, emails, meetings, notes, tasks },
      lastActivity: lastActivity ? { date: lastActivity.createdAt, type: lastActivity.type, subject: lastActivity.subject } : null,
      activityChart: monthlyData,
      email: {
        ...emailMetrics,
        openRate,
        clickRate,
        chart: emailMonthly,
      },
    },
  })
})
