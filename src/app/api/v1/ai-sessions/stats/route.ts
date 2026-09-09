import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

type MessageRow = { role: string; tokenCount: number | null; createdAt: Date }
type SessionRow = { status: string; messagesCount: number; messages: MessageRow[]; [key: string]: any }

export const GET = withRls(async (_req, { orgId }) => {
  try {
    const sessions = await prisma.aiChatSession.findMany({
      where: { organizationId: orgId },
      include: {
        messages: {
          select: { role: true, tokenCount: true, createdAt: true },
        },
      },
    })

    const totalSessions = sessions.length
    const activeSessions = sessions.filter((s: SessionRow) => s.status === "active").length

    // Total messages
    const allMessages = sessions.flatMap((s: SessionRow) => s.messages)
    const totalMessages = allMessages.length
    const avgMessagesPerSession = totalSessions > 0 ? Math.round((totalMessages / totalSessions) * 10) / 10 : 0

    // Escalations — sessions with status "escalated"
    const escalations = sessions.filter((s: SessionRow) => s.status === "escalated").length

    // Deflection rate — sessions resolved without escalation
    const resolvedSessions = sessions.filter((s: SessionRow) => s.status === "resolved" || s.status === "closed").length
    const deflectionRate = totalSessions > 0 ? Math.round((resolvedSessions / totalSessions) * 1000) / 10 : 0

    // FCR — first contact resolution (sessions resolved with <=4 messages)
    const fcrSessions = sessions.filter((s: SessionRow) =>
      (s.status === "resolved" || s.status === "closed") && s.messagesCount <= 4
    ).length
    const fcrRate = resolvedSessions > 0 ? Math.round((fcrSessions / resolvedSessions) * 1000) / 10 : 0

    // Average resolution time (minutes) — diff between first and last message
    const resolvedWithMessages = sessions
      .filter((s: SessionRow) => (s.status === "resolved" || s.status === "closed") && s.messages.length >= 2)
    let avgResolutionTime = 0
    if (resolvedWithMessages.length > 0) {
      const totalMinutes = resolvedWithMessages.reduce((sum: number, s: SessionRow) => {
        const msgs = s.messages.sort((a: MessageRow, b: MessageRow) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        const first = new Date(msgs[0].createdAt).getTime()
        const last = new Date(msgs[msgs.length - 1].createdAt).getTime()
        return sum + (last - first) / 60000
      }, 0)
      avgResolutionTime = Math.round((totalMinutes / resolvedWithMessages.length) * 10) / 10
    }

    // Average response latency (seconds) — time between user msg and assistant reply
    let totalLatency = 0
    let latencyCount = 0
    for (const s of sessions) {
      const msgs = s.messages.sort((a: MessageRow, b: MessageRow) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      for (let i = 1; i < msgs.length; i++) {
        if (msgs[i].role === "assistant" && msgs[i - 1].role === "user") {
          totalLatency += (new Date(msgs[i].createdAt).getTime() - new Date(msgs[i - 1].createdAt).getTime()) / 1000
          latencyCount++
        }
      }
    }
    const avgLatency = latencyCount > 0 ? Math.round((totalLatency / latencyCount) * 10) / 10 : 0

    // Total cost estimate ($0.003 per 1000 tokens as rough estimate)
    const totalTokens = allMessages.reduce((sum: number, m: MessageRow) => sum + (m.tokenCount || 0), 0)
    const totalCost = Math.round((totalTokens / 1000) * 0.003 * 1000) / 1000

    // CSAT — average satisfaction rating from tickets with ratings
    const csatResult = await prisma.ticket.aggregate({
      where: { organizationId: orgId, satisfactionRating: { not: null } },
      _avg: { satisfactionRating: true },
      _count: { satisfactionRating: true },
    })
    const csat = csatResult._avg.satisfactionRating
      ? Math.round(csatResult._avg.satisfactionRating * 10) / 10
      : 0
    // Quality score based on CSAT
    const qualityScore = csat > 0 ? Math.round((csat / 5) * 100) : 0

    return NextResponse.json({
      success: true,
      data: {
        totalSessions,
        activeSessions,
        deflectionRate,
        csat,
        fcrRate,
        avgResolutionTime,
        totalMessages,
        avgMessagesPerSession,
        escalations,
        avgLatency,
        totalCost,
        qualityScore,
        totalTokens,
      },
    })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
