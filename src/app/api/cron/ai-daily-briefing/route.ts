import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireCronAuth } from "@/lib/cron-auth"
import { runWithRlsBypass } from "@/lib/rls-context"
import { createNotification } from "@/lib/notifications"
import { canRunAiAutomation, calculateAiCost } from "@/lib/ai/budget"
import { PiiMasker } from "@/lib/ai/pii-masker"
import { getDigestRecipients, markDigestSent } from "@/lib/digest/subscriptions"
import { getAnthropicClient } from "@/lib/ai/anthropic-client"
import { decimalToNumber } from "@/lib/prisma-decimal"
import { orgStageVocabulary } from "@/lib/deal-stage-vocabulary"

const FEATURE_NAME = "ai_daily_briefing"

/**
 * AI Daily Briefing Cron Endpoint
 * Called by external cron (e.g. every day at 8:00 AM)
 * Collects CRM metrics and generates an AI-powered daily summary for each org.
 */
export async function POST(req: NextRequest) {
  return runWithRlsBypass(async () => {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError

  try {
    const now = new Date()
    let briefingsSent = 0
    let orgsSkipped = 0

    const orgs = await prisma.organization.findMany({
      where: { isActive: true },
      select: { id: true, name: true, features: true, settings: true },
    })

    for (const org of orgs) {
      const guard = await canRunAiAutomation(org.id, FEATURE_NAME)
      if (!guard.proceed) {
        orgsSkipped++
        continue
      }

      const briefing = await collectBriefingData(org.id, now)
      if (!briefing.hasContent) continue

      const orgSettings = (org.settings as Record<string, any>) || {}
      const orgLang = orgSettings.language || orgSettings.locale || "ru"

      // Fetch recipients honoring DigestSubscription opt-ins (per-user
      // frequency + channels). Falls back to legacy "all admin + manager"
      // rule when no subscription rows exist for the org yet.
      const recipientsRaw = await getDigestRecipients(org.id, "daily_briefing")
      const recipients = recipientsRaw.map((r) => ({
        id: r.id,
        email: r.email,
        name: r.name,
        preferredLanguage: r.preferredLanguage,
        channels: r.channels,
      }))
      if (recipients.length === 0) continue

      // Group recipients by effective language
      const byLang = new Map<string, typeof recipients>()
      for (const user of recipients) {
        const lang = user.preferredLanguage || orgLang
        const group = byLang.get(lang) || []
        group.push(user)
        byLang.set(lang, group)
      }

      // Generate one narrative per unique language
      const narrativeByLang = new Map<string, string>()
      for (const lang of byLang.keys()) {
        const narrative = await generateNarrative(org.id, briefing, lang)
        if (narrative) narrativeByLang.set(lang, narrative)
      }

      if (narrativeByLang.size === 0) continue

      // Deliver to each user in their preferred language
      for (const [lang, users] of byLang.entries()) {
        const narrative = narrativeByLang.get(lang)
        if (!narrative) continue

        for (const user of users) {
          const channels = user.channels || ["email", "in_app"]

          // In-app notification
          if (channels.includes("in_app")) {
            await createNotification({
              organizationId: org.id,
              userId: user.id,
              type: "info",
              title: "Daily AI Briefing",
              message: narrative,
              entityType: "briefing",
            })
          }

          // Email delivery
          if (channels.includes("email") && user.email) {
            try {
              const { sendEmail } = await import("@/lib/email")
              await sendEmail({
                to: user.email,
                subject: `📊 Daily AI Briefing — ${org.name}`,
                html: formatBriefingEmail(narrative, org.name, user.name || ""),
                organizationId: org.id,
              })
            } catch { /* non-critical — email config may not be set */ }
          }

          // Mark this subscription as sent so the frequency gate works
          await markDigestSent(org.id, user.id, "daily_briefing")
        }
      }

      // Slack delivery — org language (shared channel)
      const slackNarrative = narrativeByLang.get(orgLang) || narrativeByLang.values().next().value
      if (orgSettings.slackWebhookUrl && slackNarrative) {
        try {
          const { sendSlackNotification } = await import("@/lib/slack")
          await sendSlackNotification(orgSettings.slackWebhookUrl, {
            text: `*Daily AI Briefing*\n${slackNarrative}`,
          })
        } catch { /* non-critical */ }
      }

      // Telegram delivery — org language (shared channel)
      if (orgSettings.telegramBotToken && orgSettings.telegramChatId && slackNarrative) {
        try {
          const tgUrl = `https://api.telegram.org/bot${orgSettings.telegramBotToken}/sendMessage`
          await fetch(tgUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: orgSettings.telegramChatId,
              text: `📊 *Daily AI Briefing*\n\n${slackNarrative}`,
              parse_mode: "Markdown",
            }),
          })
        } catch { /* non-critical */ }
      }

      briefingsSent++
    }

    return NextResponse.json({
      success: true,
      data: { briefingsSent, orgsSkipped, timestamp: now.toISOString() },
    })
  } catch (e) {
    console.error("AI Daily Briefing cron error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
  })
}

interface BriefingData {
  hasContent: boolean
  staleDeals: { name: string; days: number; value: number }[]
  slaAtRisk: { ticketNumber: string; subject: string; hoursLeft: number }[]
  hotLeads: { name: string; score: number; daysSinceActivity: number }[]
  overdueInvoices: { number: string; company: string; amount: number; daysOverdue: number }[]
  churnRisk: { company: string; score: number; factors: string[] }[]
  newTicketsToday: number
  newDealsToday: number
  wonDealsToday: number
  wonRevenueToday: number
}

async function collectBriefingData(orgId: string, now: Date): Promise<BriefingData> {
  // Закрытая сделка — это любое написание закрытой, а не два литерала.
  const { wonStages, closedStages } = await orgStageVocabulary(orgId)
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)

  // 1. Stale deals (no activity >7 days) — batch activity lookup
  const activeDeals = await prisma.deal.findMany({
    where: {
      organizationId: orgId,
      stage: { notIn: closedStages },
    },
    select: { id: true, name: true, valueAmount: true },
  })

  // Batch: get latest activity per deal in one query
  const dealIds = activeDeals.map((d: any) => d.id)
  const dealActivities = dealIds.length > 0 ? await prisma.activity.findMany({
    where: { organizationId: orgId, relatedType: "deal", relatedId: { in: dealIds } },
    orderBy: { createdAt: "desc" },
    distinct: ["relatedId"],
    select: { relatedId: true, createdAt: true },
  }) : []
  const dealLastActivity = new Map<string, Date>(dealActivities.map((a: any) => [a.relatedId, a.createdAt]))

  const staleDeals: BriefingData["staleDeals"] = []
  for (const deal of activeDeals) {
    const lastAct = dealLastActivity.get(deal.id)
    const days = lastAct
      ? Math.floor((now.getTime() - lastAct.getTime()) / 86400000)
      : 999
    if (days > 7) {
      staleDeals.push({ name: deal.name, days, value: decimalToNumber(deal.valueAmount) })
    }
  }
  staleDeals.sort((a, b) => b.days - a.days)

  // 2. SLA at risk (tickets with <4h to SLA breach)
  const ticketsAtRisk = await prisma.ticket.findMany({
    where: {
      organizationId: orgId,
      status: { notIn: ["resolved", "closed"] },
      slaFirstResponseDueAt: { not: null },
      firstResponseAt: null,
    },
    select: { ticketNumber: true, subject: true, slaFirstResponseDueAt: true },
  })

  const slaAtRisk: BriefingData["slaAtRisk"] = []
  for (const t of ticketsAtRisk) {
    if (!t.slaFirstResponseDueAt) continue
    const hoursLeft = (t.slaFirstResponseDueAt.getTime() - now.getTime()) / 3600000
    if (hoursLeft <= 4) {
      slaAtRisk.push({
        ticketNumber: t.ticketNumber || "",
        subject: t.subject,
        hoursLeft: Math.round(hoursLeft * 10) / 10,
      })
    }
  }

  // 3. Hot leads without follow-up — batch activity lookup
  const leads = await prisma.lead.findMany({
    where: {
      organizationId: orgId,
      status: { notIn: ["converted", "lost"] },
      score: { gte: 60 },
    },
    select: { id: true, contactName: true, email: true, score: true },
  })

  const leadIds = leads.map((l: any) => l.id)
  const leadActivities = leadIds.length > 0 ? await prisma.activity.findMany({
    where: { organizationId: orgId, relatedType: "lead", relatedId: { in: leadIds } },
    orderBy: { createdAt: "desc" },
    distinct: ["relatedId"],
    select: { relatedId: true, createdAt: true },
  }) : []
  const leadLastActivity = new Map<string, Date>(leadActivities.map((a: any) => [a.relatedId, a.createdAt]))

  const hotLeads: BriefingData["hotLeads"] = []
  for (const lead of leads) {
    const lastAct = leadLastActivity.get(lead.id)
    const days = lastAct
      ? Math.floor((now.getTime() - lastAct.getTime()) / 86400000)
      : 999
    if (days > 3) {
      hotLeads.push({
        name: lead.contactName || lead.email || "Unknown",
        score: lead.score || 0,
        daysSinceActivity: days,
      })
    }
  }

  // 4. Overdue invoices
  const overdueInvoices: BriefingData["overdueInvoices"] = []
  try {
    const invoices = await prisma.invoice.findMany({
      where: {
        organizationId: orgId,
        status: { in: ["sent", "viewed", "overdue"] },
        dueDate: { lt: now },
      },
      select: {
        invoiceNumber: true,
        totalAmount: true,
        dueDate: true,
        company: { select: { name: true } },
      },
      take: 10,
      orderBy: { dueDate: "asc" },
    })
    for (const inv of invoices) {
      const daysOverdue = inv.dueDate
        ? Math.floor((now.getTime() - inv.dueDate.getTime()) / 86400000)
        : 0
      overdueInvoices.push({
        number: inv.invoiceNumber || "",
        company: (inv.company as any)?.name || "—",
        amount: decimalToNumber(inv.totalAmount),
        daysOverdue,
      })
    }
  } catch {
    // invoice relations may vary
  }

  // 5. Churn risk companies
  const companies = await prisma.company.findMany({
    where: { organizationId: orgId },
    select: {
      id: true,
      name: true,
      activities: { orderBy: { createdAt: "desc" as const }, take: 1, select: { createdAt: true } },
      tickets: { where: { status: { notIn: ["closed", "resolved"] } }, select: { id: true } },
      deals: { where: { stage: { notIn: closedStages } }, select: { id: true } },
    },
  })

  const churnRisk: BriefingData["churnRisk"] = []
  for (const c of companies) {
    let score = 0
    const factors: string[] = []
    const lastAct = c.activities[0]?.createdAt
    const days = lastAct ? Math.floor((now.getTime() - lastAct.getTime()) / 86400000) : 999

    if (days > 60) { score += 40; factors.push(`No activity ${days}d`) }
    else if (days > 30) { score += 20; factors.push(`No activity ${days}d`) }
    if (c.tickets.length > 3) { score += 20; factors.push(`${c.tickets.length} open tickets`) }
    if (c.deals.length === 0) { score += 15; factors.push("No active deals") }

    if (score > 30) {
      churnRisk.push({ company: c.name, score, factors })
    }
  }
  churnRisk.sort((a, b) => b.score - a.score)

  // 6. Today's activity counters
  const [newTicketsToday, newDealsToday] = await Promise.all([
    prisma.ticket.count({ where: { organizationId: orgId, createdAt: { gte: todayStart } } }),
    prisma.deal.count({ where: { organizationId: orgId, createdAt: { gte: todayStart } } }),
  ])

  const wonDeals = await prisma.deal.findMany({
    where: {
      organizationId: orgId,
      stage: { in: wonStages },
      updatedAt: { gte: todayStart },
    },
    select: { valueAmount: true },
  })
  const wonDealsToday = wonDeals.length
  const wonRevenueToday = wonDeals.reduce((s: number, d: any) => s + decimalToNumber(d.valueAmount), 0)

  const hasContent =
    staleDeals.length > 0 ||
    slaAtRisk.length > 0 ||
    hotLeads.length > 0 ||
    overdueInvoices.length > 0 ||
    churnRisk.length > 0 ||
    newTicketsToday > 0 ||
    newDealsToday > 0

  return {
    hasContent,
    staleDeals: staleDeals.slice(0, 5),
    slaAtRisk: slaAtRisk.slice(0, 5),
    hotLeads: hotLeads.slice(0, 5),
    overdueInvoices: overdueInvoices.slice(0, 5),
    churnRisk: churnRisk.slice(0, 3),
    newTicketsToday,
    newDealsToday,
    wonDealsToday,
    wonRevenueToday,
  }
}

async function generateNarrative(orgId: string, data: BriefingData, lang: string = "ru"): Promise<string | null> {
  const langMap: Record<string, string> = { ru: "RUSSIAN", en: "ENGLISH", az: "AZERBAIJANI" }
  const langName = langMap[lang] || "RUSSIAN"

  try {
    const anthropic = getAnthropicClient()

    const piiMasker = new PiiMasker()
    const dataSnapshot = piiMasker.mask(JSON.stringify({
      staleDeals: data.staleDeals,
      slaAtRisk: data.slaAtRisk,
      hotLeads: data.hotLeads,
      overdueInvoices: data.overdueInvoices,
      churnRisk: data.churnRisk,
      newTicketsToday: data.newTicketsToday,
      newDealsToday: data.newDealsToday,
      wonDealsToday: data.wonDealsToday,
      wonRevenueToday: data.wonRevenueToday,
    }))

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [
        {
          role: "user",
          content: `You are a CRM assistant. Generate a concise daily briefing (max 300 words) in ${langName} language based on this data. Use bullet points. Prioritize urgent items (SLA breaches, high churn risk, overdue invoices). Skip sections with no data. No greetings or sign-offs — just the briefing.\n\nData:\n${dataSnapshot}`,
        },
      ],
    })

    const rawText =
      response.content[0]?.type === "text" ? response.content[0].text : null
    const text = rawText ? piiMasker.unmask(rawText) : null

    // Log the interaction
    const inputTokens = response.usage?.input_tokens || 0
    const outputTokens = response.usage?.output_tokens || 0
    const cost = calculateAiCost("claude-haiku-4-5-20251001", inputTokens, outputTokens)

    await prisma.aiInteractionLog.create({
      data: {
        organizationId: orgId,
        userMessage: "daily_briefing_cron",
        aiResponse: (text || "").slice(0, 1000),
        latencyMs: 0,
        promptTokens: inputTokens,
        completionTokens: outputTokens,
        costUsd: cost,
        model: "claude-haiku-4-5-20251001",
        agentType: "system_briefing",
        isCopilot: false,
      },
    })

    return text
  } catch (err) {
    console.error("AI Daily Briefing narrative error:", err)
    return null
  }
}

function formatBriefingEmail(narrative: string, orgName: string, userName: string): string {
  const lines = narrative.split("\n").map(l => {
    const trimmed = l.trim()
    if (trimmed.startsWith("•") || trimmed.startsWith("-") || trimmed.startsWith("*")) {
      return `<li style="margin-bottom:4px">${trimmed.replace(/^[•\-*]\s*/, "")}</li>`
    }
    if (trimmed) return `<p style="margin:0 0 8px">${trimmed}</p>`
    return ""
  }).join("")

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1a1a1a">
      <div style="border-bottom:2px solid #6366f1;padding-bottom:12px;margin-bottom:20px">
        <h2 style="margin:0;font-size:18px;color:#6366f1">Daily AI Briefing</h2>
        <p style="margin:4px 0 0;font-size:13px;color:#666">${orgName} — ${new Date().toLocaleDateString("en", { weekday: "long", month: "long", day: "numeric" })}</p>
      </div>
      ${userName ? `<p style="margin:0 0 16px;font-size:14px">Hi ${userName},</p>` : ""}
      <div style="font-size:14px;line-height:1.6;background:#f8f9fa;border-radius:8px;padding:16px">
        ${lines.includes("<li") ? `<ul style="margin:0;padding-left:20px">${lines}</ul>` : lines}
      </div>
      <p style="margin:20px 0 0;font-size:12px;color:#999">Generated by Da Vinci AI · <a href="https://app.leaddrivecrm.org" style="color:#6366f1">Open CRM</a></p>
    </div>
  `
}
