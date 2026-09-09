import { NextResponse } from "next/server"
import type {
  ActionItem,
  CoachingHint,
  CompetitorMention,
  ConversationInsight,
  Sentiment,
} from "@/lib/conversation-intel/types"
import { prisma } from "@/lib/prisma"
import { applyRecordFilter } from "@/lib/sharing-rules"
import { withRlsAuth } from "@/lib/with-rls"

const FETCH_LIMIT = 20
type LeadInsightRow = {
  id: string
  direction: string
  duration: number | null
  insights: unknown
  insightsAt: Date | null
  createdAt: Date
}
const SENTIMENTS = new Set<Sentiment>([
  "very_positive",
  "positive",
  "neutral",
  "negative",
  "very_negative",
])

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null
  const text = value.trim()
  return text ? text.slice(0, maxLength) : null
}

function normalizeActionItems(value: unknown): ActionItem[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 12).flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const candidate = item as Record<string, unknown>
    const text = cleanText(candidate.text, 600)
    if (!text) return []
    const owner = candidate.owner === "agent" || candidate.owner === "customer"
      ? candidate.owner
      : null
    return [{
      text,
      owner,
      dueDateHint: cleanText(candidate.dueDateHint, 160),
    }]
  })
}

function normalizeCompetitors(value: unknown): CompetitorMention[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 10).flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const candidate = item as Record<string, unknown>
    const name = cleanText(candidate.name, 120)
    if (!name) return []
    return [{
      name,
      context: cleanText(candidate.context, 500) ?? "",
      count: typeof candidate.count === "number" && Number.isFinite(candidate.count)
        ? Math.max(1, Math.round(candidate.count))
        : 1,
    }]
  })
}

function normalizeCoaching(value: unknown): CoachingHint[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 10).flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const candidate = item as Record<string, unknown>
    const rule = cleanText(candidate.rule, 120)
    const message = cleanText(candidate.message, 600)
    if (!rule || !message) return []
    const severity = candidate.severity === "critical" || candidate.severity === "warning"
      ? candidate.severity
      : "info"
    return [{ rule, message, severity }]
  })
}

function insightForLead(value: unknown) {
  if (!value || typeof value !== "object") return null
  const candidate = value as Partial<ConversationInsight>
  const summary = cleanText(candidate.summary, 2_000)
  if (candidate.version !== 1 || !summary || !SENTIMENTS.has(candidate.sentiment as Sentiment)) {
    return null
  }

  return {
    sentiment: candidate.sentiment as Sentiment,
    summary,
    topics: Array.isArray(candidate.topics)
      ? candidate.topics.flatMap((topic) => {
          const text = cleanText(topic, 160)
          return text ? [text] : []
        }).slice(0, 12)
      : [],
    actionItems: normalizeActionItems(candidate.actionItems),
    competitorMentions: normalizeCompetitors(candidate.competitorMentions),
    coachingHints: normalizeCoaching(candidate.coachingHints),
  }
}

export const GET = withRlsAuth(
  "leads",
  "read",
  async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params

    try {
      const visibleLeadWhere = await applyRecordFilter(
        auth.orgId,
        auth.userId,
        auth.role,
        "lead",
        { id, organizationId: auth.orgId },
      )
      const lead = await prisma.lead.findFirst({
        where: visibleLeadWhere,
        select: { id: true },
      })
      if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 })

      const rows = await prisma.callLog.findMany({
        where: {
          organizationId: auth.orgId,
          leadId: id,
          insightsAt: { not: null },
        },
        select: {
          id: true,
          direction: true,
          duration: true,
          insights: true,
          insightsAt: true,
          createdAt: true,
        },
        orderBy: [{ insightsAt: "desc" }, { createdAt: "desc" }],
        take: FETCH_LIMIT + 1,
      }) as LeadInsightRow[]

      const calls = rows.slice(0, FETCH_LIMIT).flatMap((row) => {
        const insight = insightForLead(row.insights)
        if (!insight) return []
        return [{
          id: row.id,
          direction: row.direction === "inbound" ? "inbound" : "outbound",
          durationSeconds: row.duration,
          analysedAt: row.insightsAt ?? row.createdAt,
          insight,
        }]
      })

      return NextResponse.json({
        success: true,
        data: {
          calls,
          hasMore: rows.length > FETCH_LIMIT,
        },
      })
    } catch (error) {
      console.error("[lead-call-insights] GET error:", error)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
  },
)
