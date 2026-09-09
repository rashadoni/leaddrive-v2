/**
 * A7 Conversation Intelligence — slice-2 API.
 *
 * GET /api/v1/conversation-insights?days=7
 *
 * Lists recent CallLog rows that have AI insights (insightsAt NOT NULL)
 * + aggregates competitor mentions across the window so sales managers
 * see "Acme mentioned in 5 calls, Globex in 3".
 *
 * Insights JSON shape is governed by ConversationInsight in
 * src/lib/conversation-intel/types.ts — version 1 today.
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { isManagerOrAbove } from "@/lib/constants"
import { withRlsAuth } from "@/lib/with-rls"
import type { ConversationInsight } from "@/lib/conversation-intel/types"

interface CallRow {
  id: string
  callSid: string | null
  direction: string
  fromNumber: string
  toNumber: string
  duration: number | null
  status: string
  disposition: string | null
  insights: unknown
  insightsAt: Date | null
  createdAt: Date
  contactId: string | null
  companyId: string | null
  dealId: string | null
  userId: string | null
  contact: { fullName: string | null; email: string | null } | null
}

const DAY_MS = 86_400_000
const MAX_DAYS = 90
const DEFAULT_DAYS = 7
const FETCH_CAP = 100

function isInsight(v: unknown): v is ConversationInsight {
  return !!v && typeof v === "object" && (v as { version?: unknown }).version === 1
}

export const GET = withRlsAuth("voip", "read", async (req, auth) => {
  const { searchParams } = new URL(req.url)
  const daysRaw = parseInt(searchParams.get("days") || `${DEFAULT_DAYS}`, 10)
  const days = Number.isFinite(daysRaw)
    ? Math.min(Math.max(daysRaw, 1), MAX_DAYS)
    : DEFAULT_DAYS

  const periodEnd = new Date()
  const periodStart = new Date(periodEnd.getTime() - days * DAY_MS)

  try {
    const calls = (await prisma.callLog.findMany({
      where: {
        organizationId: auth.orgId,
        insightsAt: { not: null, gte: periodStart, lte: periodEnd },
        ...(!isManagerOrAbove(auth.role) ? { userId: auth.userId } : {}),
      },
      select: {
        id: true,
        callSid: true,
        direction: true,
        fromNumber: true,
        toNumber: true,
        duration: true,
        status: true,
        disposition: true,
        insights: true,
        insightsAt: true,
        createdAt: true,
        contactId: true,
        companyId: true,
        dealId: true,
        userId: true,
        contact: {
          select: { fullName: true, email: true },
        },
      },
      orderBy: [{ insightsAt: "desc" }],
      take: FETCH_CAP + 1,
    })) as CallRow[]
    const truncated = calls.length > FETCH_CAP
    if (truncated) calls.length = FETCH_CAP

    interface SentimentCounts {
      very_positive: number
      positive: number
      neutral: number
      negative: number
      very_negative: number
    }
    const sentimentCounts: SentimentCounts = {
      very_positive: 0,
      positive: 0,
      neutral: 0,
      negative: 0,
      very_negative: 0,
    }
    // Key by lowercase to collapse "Acme" / "acme " / "ACME"; preserve the
    // first-seen casing as the display name so the UI renders real brand
    // casing (e.g. "IBM" not "Ibm", "Salesforce.com" not "Salesforce.com").
    const competitorTallies = new Map<string, { display: string; count: number }>()
    const coachingTallies = new Map<
      string,
      { message: string; severity: "info" | "warning" | "critical"; count: number }
    >()
    let totalActionItems = 0
    let totalCalls = 0

    const out = calls.map((c) => {
      const insight = isInsight(c.insights) ? c.insights : null
      if (insight) {
        totalCalls++
        if (insight.sentiment in sentimentCounts) {
          sentimentCounts[insight.sentiment]++
        }
        totalActionItems += insight.actionItems?.length ?? 0
        for (const m of insight.competitorMentions ?? []) {
          const trimmed = m.name.trim()
          if (!trimmed) continue
          const key = trimmed.toLowerCase()
          const existing = competitorTallies.get(key)
          if (existing) {
            existing.count++
          } else {
            competitorTallies.set(key, { display: trimmed, count: 1 })
          }
        }
        for (const hint of insight.coachingHints ?? []) {
          const k = hint.rule
          const existing = coachingTallies.get(k)
          if (existing) {
            existing.count++
          } else {
            coachingTallies.set(k, {
              message: hint.message,
              severity: hint.severity,
              count: 1,
            })
          }
        }
      }
      return {
        id: c.id,
        callSid: c.callSid,
        direction: c.direction,
        fromNumber: c.fromNumber,
        toNumber: c.toNumber,
        durationSeconds: c.duration,
        status: c.status,
        disposition: c.disposition,
        contactName: c.contact
          ? c.contact.fullName?.trim() || c.contact.email || null
          : null,
        contactId: c.contactId,
        companyId: c.companyId,
        dealId: c.dealId,
        insightsAt: c.insightsAt,
        createdAt: c.createdAt,
        insight: insight
          ? {
              sentiment: insight.sentiment,
              sentimentScore: insight.sentimentScore,
              summary: insight.summary,
              topics: insight.topics ?? [],
              actionItemCount: insight.actionItems?.length ?? 0,
              actionItems: insight.actionItems ?? [],
              competitorMentions: insight.competitorMentions ?? [],
              coachingHints: insight.coachingHints ?? [],
              costUsd: insight.costUsd ?? null,
              latencyMs: insight.latencyMs ?? null,
              model: insight.model ?? null,
            }
          : null,
      }
    })

    const competitorTop = Array.from(competitorTallies.entries())
      .sort((a, b) => {
        if (b[1].count !== a[1].count) return b[1].count - a[1].count
        return a[1].display.localeCompare(b[1].display)
      })
      .slice(0, 10)
      .map(([, v]) => ({ name: v.display, count: v.count }))

    const coachingTop = Array.from(coachingTallies.entries())
      .sort((a, b) => {
        // critical > warning > info, then count desc.
        const sev = { critical: 0, warning: 1, info: 2 } as const
        const sa = sev[a[1].severity]
        const sb = sev[b[1].severity]
        if (sa !== sb) return sa - sb
        return b[1].count - a[1].count
      })
      .slice(0, 6)
      .map(([rule, v]) => ({
        rule,
        message: v.message,
        severity: v.severity,
        count: v.count,
      }))

    return NextResponse.json({
      days,
      periodStart,
      periodEnd,
      calls: out,
      totalCalls,
      totalCallsWithInsights: out.length,
      totalActionItems,
      sentimentCounts,
      competitorMentions: competitorTop,
      coachingHints: coachingTop,
      truncated,
      fetchCap: FETCH_CAP,
    })
  } catch (err) {
    console.error("[conversation-insights] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load conversation insights" },
      { status: 500 },
    )
  }
})
