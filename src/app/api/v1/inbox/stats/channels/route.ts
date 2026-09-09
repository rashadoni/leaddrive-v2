import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { SANE_MIN_DATE } from "@/lib/inbox-analytics-filters"

/**
 * B1 (Creatio 10X roadmap) — per-channel AI effectiveness aggregates for the owner.
 * GET /api/v1/inbox/stats/channels?days=7|30 (default 7).
 *
 * Per channel: conversation volume (created in window), avg first-response minutes,
 * resolved count, AI-resolved count (closed with ≥1 AI outbound and NO human outbound —
 * an unedited approved draft still counts as AI; a conversation with zero outbound does
 * NOT count as "AI effective"), escalation share (AI hand-offs in window).
 *
 * One SQL pass (mirrors the FRT route's CTE style): social channels from
 * social_conversations+channel_messages, web-chat from web_chat_sessions+messages
 * (its messages live in their own table), UNION'd then grouped. Close data covers both
 * eras: the PR #308 columns and the older Whelp metadata.closedAt.
 */
export const GET = withRlsAuth("inbox", "read", async (req, { orgId }) => {
  const { searchParams } = new URL(req.url)
  const days = Number(searchParams.get("days")) === 30 ? 30 : 7
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  const rows = await prisma.$queryRaw<{
    channel: string
    volume: number
    avg_frt_min: number | null
    resolved: number
    ai_resolved: number
    escalated: number
  }[]>`
    WITH social_base AS (
      SELECT c.id AS sid, c.platform AS channel, c."createdAt" AS created_at,
             COALESCE(c."closedAt", (c.metadata->>'closedAt')::timestamptz) AS closed_at,
             (c.status = 'resolved' OR c."closedAt" IS NOT NULL) AS is_resolved
      FROM social_conversations c
      WHERE c."organizationId" = ${orgId}
        AND c.platform <> 'web-chat'
        AND (c."createdAt" >= ${from} OR c."closedAt" >= ${from})
    ),
    social_fi AS (
      SELECT m."conversationId" AS sid, MIN(m."createdAt") AS first_in
      FROM channel_messages m JOIN social_base b ON b.sid = m."conversationId"
      WHERE m.direction = 'inbound' AND m."createdAt" >= ${SANE_MIN_DATE}
      GROUP BY m."conversationId"
    ),
    social_frt AS (
      SELECT fi.sid, EXTRACT(EPOCH FROM (MIN(m."createdAt") - fi.first_in)) / 60.0 AS frt_min
      FROM social_fi fi
      JOIN channel_messages m ON m."conversationId" = fi.sid
        AND m.direction = 'outbound' AND m."createdAt" >= fi.first_in
      GROUP BY fi.sid, fi.first_in
    ),
    social_flags AS (
      SELECT m."conversationId" AS sid,
        BOOL_OR(m.direction = 'outbound' AND (m.metadata->>'aiAutoReply') = 'true') AS has_ai,
        BOOL_OR(m.direction = 'outbound' AND COALESCE((m.metadata->>'aiAutoReply') = 'true', false) = false) AS has_human,
        BOOL_OR((m.metadata->>'escalated') = 'true') AS has_escalation
      FROM channel_messages m JOIN social_base b ON b.sid = m."conversationId"
      GROUP BY m."conversationId"
    ),
    web_base AS (
      SELECT s.id AS sid, 'web-chat' AS channel, s."createdAt" AS created_at,
             s."closedAt" AS closed_at,
             (s.status = 'closed' OR s."closedAt" IS NOT NULL) AS is_resolved,
             (s.status = 'escalated' OR s."ticketId" IS NOT NULL) AS session_escalated
      FROM web_chat_sessions s
      WHERE s."organizationId" = ${orgId}
        AND (s."createdAt" >= ${from} OR s."closedAt" >= ${from})
    ),
    web_fi AS (
      SELECT m."sessionId" AS sid, MIN(m."createdAt") AS first_in
      FROM web_chat_messages m JOIN web_base b ON b.sid = m."sessionId"
      WHERE m."fromRole" = 'visitor' AND m."createdAt" >= ${SANE_MIN_DATE}
      GROUP BY m."sessionId"
    ),
    web_frt AS (
      SELECT fi.sid, EXTRACT(EPOCH FROM (MIN(m."createdAt") - fi.first_in)) / 60.0 AS frt_min
      FROM web_fi fi
      JOIN web_chat_messages m ON m."sessionId" = fi.sid
        AND m."fromRole" IN ('bot', 'agent') AND m."createdAt" >= fi.first_in
      GROUP BY fi.sid, fi.first_in
    ),
    web_flags AS (
      SELECT m."sessionId" AS sid,
        BOOL_OR(m."fromRole" = 'bot' AND (m.metadata->>'aiGenerated') = 'true') AS has_ai,
        BOOL_OR(m."fromRole" = 'agent') AS has_human
      FROM web_chat_messages m JOIN web_base b ON b.sid = m."sessionId"
      GROUP BY m."sessionId"
    ),
    unified AS (
      SELECT b.channel, b.created_at, b.closed_at, b.is_resolved, f.frt_min,
             COALESCE(fl.has_ai, false) AS has_ai,
             COALESCE(fl.has_human, false) AS has_human,
             COALESCE(fl.has_escalation, false) AS has_escalation
      FROM social_base b
      LEFT JOIN social_frt f ON f.sid = b.sid
      LEFT JOIN social_flags fl ON fl.sid = b.sid
      UNION ALL
      SELECT b.channel, b.created_at, b.closed_at, b.is_resolved, f.frt_min,
             COALESCE(fl.has_ai, false), COALESCE(fl.has_human, false), b.session_escalated
      FROM web_base b
      LEFT JOIN web_frt f ON f.sid = b.sid
      LEFT JOIN web_flags fl ON fl.sid = b.sid
    )
    SELECT channel,
      COUNT(*) FILTER (WHERE created_at >= ${from})::int AS volume,
      AVG(frt_min) FILTER (WHERE created_at >= ${from})::float AS avg_frt_min,
      COUNT(*) FILTER (WHERE is_resolved AND closed_at >= ${from})::int AS resolved,
      COUNT(*) FILTER (WHERE is_resolved AND closed_at >= ${from} AND has_ai AND NOT has_human)::int AS ai_resolved,
      COUNT(*) FILTER (WHERE created_at >= ${from} AND has_escalation)::int AS escalated
    FROM unified
    GROUP BY channel
    ORDER BY volume DESC, channel ASC
  `

  return NextResponse.json({
    success: true,
    data: {
      days,
      channels: rows.map((r: (typeof rows)[number]) => ({
        channel: r.channel,
        volume: r.volume,
        avgFirstResponseMinutes: r.avg_frt_min !== null ? Math.round(r.avg_frt_min * 10) / 10 : null,
        resolved: r.resolved,
        aiResolved: r.ai_resolved,
        aiEffectivenessPct: r.resolved > 0 ? Math.round((r.ai_resolved / r.resolved) * 100) : null,
        escalated: r.escalated,
        escalationSharePct: r.volume > 0 ? Math.round((r.escalated / r.volume) * 100) : null,
      })),
    },
  })
})
