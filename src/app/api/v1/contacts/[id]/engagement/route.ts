import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

type ActivityRow = { id: string; type: string; subject: string | null; createdAt: Date }
type EmailLogRow = { status: string; createdAt: Date }

export const GET = withRls(async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const contact = await prisma.contact.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, email: true, companyId: true },
  })
  if (!contact) return NextResponse.json({ error: "Contact not found" }, { status: 404 })

  const threeMonthsAgo = new Date()
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)

  const activities = await prisma.activity.findMany({
    where: { organizationId: orgId, contactId: id, createdAt: { gte: threeMonthsAgo } },
    select: { id: true, type: true, subject: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  })

  const calls = activities.filter((a: ActivityRow) => a.type === "call").length
  const emails = activities.filter((a: ActivityRow) => a.type === "email").length
  const meetings = activities.filter((a: ActivityRow) => a.type === "meeting").length
  const notes = activities.filter((a: ActivityRow) => a.type === "note").length
  const tasks = activities.filter((a: ActivityRow) => a.type === "task").length

  // Monthly chart
  const monthlyData: { month: string; calls: number; emails: number; meetings: number }[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setMonth(d.getMonth() - i)
    const start = new Date(d.getFullYear(), d.getMonth(), 1)
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59)
    const ma = activities.filter((a: ActivityRow) => { const ad = new Date(a.createdAt); return ad >= start && ad <= end })
    monthlyData.push({
      month: d.toLocaleString("en", { month: "short" }),
      calls: ma.filter((a: ActivityRow) => a.type === "call").length,
      emails: ma.filter((a: ActivityRow) => a.type === "email").length,
      meetings: ma.filter((a: ActivityRow) => a.type === "meeting").length,
    })
  }

  // Email logs
  let emailMetrics = { sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, failed: 0 }
  let emailMonthly: { month: string; sent: number; opened: number; clicked: number }[] = []

  if (contact.email) {
    const emailLogs = await prisma.emailLog.findMany({
      where: { organizationId: orgId, toEmail: contact.email, createdAt: { gte: threeMonthsAgo } },
      select: { status: true, createdAt: true },
    })
    emailMetrics = {
      sent: emailLogs.length,
      delivered: emailLogs.filter((e: EmailLogRow) => ["delivered", "sent"].includes(e.status)).length,
      opened: emailLogs.filter((e: EmailLogRow) => e.status === "opened").length,
      clicked: emailLogs.filter((e: EmailLogRow) => e.status === "clicked").length,
      bounced: emailLogs.filter((e: EmailLogRow) => e.status === "bounced").length,
      failed: emailLogs.filter((e: EmailLogRow) => e.status === "failed").length,
    }
    for (let i = 5; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i)
      const start = new Date(d.getFullYear(), d.getMonth(), 1)
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59)
      const ml = emailLogs.filter((e: EmailLogRow) => { const ed = new Date(e.createdAt); return ed >= start && ed <= end })
      emailMonthly.push({ month: d.toLocaleString("en", { month: "short" }), sent: ml.length, opened: ml.filter((e: EmailLogRow) => e.status === "opened").length, clicked: ml.filter((e: EmailLogRow) => e.status === "clicked").length })
    }
  }

  const openRate = emailMetrics.sent > 0 ? Math.round((emailMetrics.opened / emailMetrics.sent) * 100) : 0
  const clickRate = emailMetrics.sent > 0 ? Math.round((emailMetrics.clicked / emailMetrics.sent) * 100) : 0

  return NextResponse.json({
    success: true,
    data: {
      activities: { total: activities.length, calls, emails, meetings, notes, tasks },
      lastActivity: activities[0] ? { date: activities[0].createdAt, type: activities[0].type, subject: activities[0].subject } : null,
      activityChart: monthlyData,
      email: { ...emailMetrics, openRate, clickRate, chart: emailMonthly },
    },
  })
})
