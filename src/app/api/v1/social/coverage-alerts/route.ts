import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { evaluateSocialCoverageAlertRules, writeSocialCoverageAlerts } from "@/lib/social/coverage-alerts"
import { withSocialMonitoringTenantCollectionFence } from "@/lib/social/monitoring-import-fence"
import { riskRelevantMentionWhere } from "@/lib/social/risk-mention-visibility"

const schema = z.object({
  limit: z.number().int().min(1).max(200).optional(),
}).optional()

export const POST = withRlsAuth("social", "write", async (req: NextRequest, auth) => {
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  const limit = parsed.data?.limit ?? 100
  const fenced = await withSocialMonitoringTenantCollectionFence(auth.orgId, async () => {
    const now = new Date()
    const recent = new Date(now.getTime() - 24 * 3600000)

    const [sources, mentions] = await Promise.all([
      prisma.monitoringSource.findMany({
        where: { organizationId: auth.orgId },
        select: {
          id: true,
          platform: true,
          sourceType: true,
          collectionMode: true,
          status: true,
          lastError: true,
        },
        take: 200,
      }),
      prisma.socialMention.findMany({
        where: {
          organizationId: auth.orgId,
          externalId: { not: "__tg_offset__" },
          purgedAt: null,
          deletedAtSource: null,
          AND: [riskRelevantMentionWhere()],
          createdAt: { gte: recent },
        },
        orderBy: [{ engagement: "desc" }, { reach: "desc" }, { createdAt: "desc" }],
        take: limit,
        select: {
          id: true,
          platform: true,
          sourceType: true,
          sourceProvider: true,
          sourceMetadata: true,
          authorName: true,
          authorHandle: true,
          text: true,
          sentiment: true,
          matchedTerm: true,
          reach: true,
          engagement: true,
          cluster: { select: { id: true, mentionCount: true, topic: true, riskLevel: true } },
        },
      }),
    ])

    const candidates = evaluateSocialCoverageAlertRules({ sources, mentions })
    const created = await writeSocialCoverageAlerts(auth.orgId, candidates, now)

    return {
      evaluated: candidates.length,
      created,
      candidates,
    }
  })

  if (!fenced.allowed) {
    return NextResponse.json(
      {
        error: "Social Monitoring is paused for a clean-slate reset",
        code: fenced.reason,
      },
      { status: 409 },
    )
  }

  return NextResponse.json({ success: true, data: fenced.value })
})
