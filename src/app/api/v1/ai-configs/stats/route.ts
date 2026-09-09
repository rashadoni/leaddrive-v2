import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

export const GET = withRls(async (_req, { orgId }) => {
  try {
    // Get all agent configs
    const agents = await prisma.aiAgentConfig.findMany({
      where: { organizationId: orgId },
      orderBy: { priority: "desc" },
    })

    // Get per-agent metrics from interaction logs
    const agentStats = await prisma.aiInteractionLog.groupBy({
      by: ["agentConfigId", "agentType"],
      where: { organizationId: orgId },
      _count: { id: true },
      _avg: { latencyMs: true, costUsd: true, qualityScore: true },
      _sum: { costUsd: true, promptTokens: true, completionTokens: true },
    })

    // Get recent handoffs
    const handoffs = await prisma.agentHandoff.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      take: 20,
    })

    // Get intent distribution (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000)
    const intentLogs = await prisma.aiInteractionLog.groupBy({
      by: ["agentType"],
      where: {
        organizationId: orgId,
        createdAt: { gte: thirtyDaysAgo },
        agentType: { not: null },
      },
      _count: { id: true },
    })

    // Map stats to agents
    const agentMetrics = agents.map((agent: any) => {
      const stats = agentStats.find((s: any) => s.agentConfigId === agent.id)
      return {
        id: agent.id,
        configName: agent.configName,
        agentType: agent.agentType,
        model: agent.model,
        isActive: agent.isActive,
        totalInteractions: stats?._count?.id || 0,
        avgLatencyMs: Math.round(stats?._avg?.latencyMs || 0),
        totalCost: Number((stats?._sum?.costUsd || 0).toFixed(4)),
        avgQualityScore: stats?._avg?.qualityScore || null,
        totalTokens: (stats?._sum?.promptTokens || 0) + (stats?._sum?.completionTokens || 0),
      }
    })

    // Enrich handoffs with agent names
    const agentMap = Object.fromEntries(agents.map((a: any) => [a.id, a.configName]))
    const enrichedHandoffs = handoffs.map((h: any) => ({
      ...h,
      fromAgentName: agentMap[h.fromAgentId] || h.fromAgentId,
      toAgentName: agentMap[h.toAgentId] || h.toAgentId,
    }))

    return NextResponse.json({
      success: true,
      data: {
        agents: agentMetrics,
        handoffs: enrichedHandoffs,
        intentDistribution: intentLogs.map((l: any) => ({
          agentType: l.agentType || "unknown",
          count: l._count.id,
        })),
      },
    })
  } catch (e) {
    console.error("AI configs stats error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
