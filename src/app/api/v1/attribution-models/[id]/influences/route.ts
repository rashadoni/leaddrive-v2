/**
 * C9 Marketing Attribution — per-campaign influence report.
 *
 * GET /api/v1/attribution-models/[id]/influences — the actual answer the
 * feature exists for: how much revenue THIS model attributed to EACH campaign,
 * across all closed-won deals. Groups campaign_influences by campaignId,
 * joins campaign names, sorts by attributed revenue desc.
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { decimalToNumber } from "@/lib/prisma-decimal"
import { withRlsAuth } from "@/lib/with-rls"

type GroupRow = {
  campaignId: string
  _count: { _all: number }
  _sum: { attributedRevenue: unknown; touchpointCount: number | null }
  _avg: { weight: number | null }
}
interface CampaignRow {
  campaignId: string
  campaignName: string
  dealCount: number
  attributedRevenue: number
  touchpointCount: number
  avgWeight: number
}

export const GET = withRlsAuth("campaigns", "read", async (_req, auth, context: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId

  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: "Missing model id" }, { status: 400 })
  }

  try {
    const model = await prisma.attributionModel.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, name: true, modelType: true },
    })
    if (!model) {
      return NextResponse.json({ error: "Model not found" }, { status: 404 })
    }

    // One influence row per (deal, campaign, model) → _count = deals touched.
    // #18 — realized (won) only: the per-campaign breakdown reports closed-won
    // attributed revenue, matching the model card's headline KPI. Projected
    // (pipeline, open-deal) revenue is surfaced separately on the model list.
    const grouped = await prisma.campaignInfluence.groupBy({
      by: ["campaignId"],
      where: { organizationId: orgId, modelId: id, kind: "won" },
      _count: { _all: true },
      _sum: { attributedRevenue: true, touchpointCount: true },
      _avg: { weight: true },
    })

    const groupRows = grouped as GroupRow[]
    const campaignIds = groupRows.map((g) => g.campaignId)
    const campaigns = campaignIds.length
      ? await prisma.campaign.findMany({
          where: { id: { in: campaignIds }, organizationId: orgId },
          select: { id: true, name: true },
        })
      : []
    const nameById = new Map<string, string>()
    for (const c of campaigns as { id: string; name: string }[]) {
      nameById.set(c.id, c.name)
    }

    const rows: CampaignRow[] = groupRows
      .map((g) => ({
        campaignId: g.campaignId,
        campaignName: nameById.get(g.campaignId) ?? "—",
        dealCount: g._count._all,
        attributedRevenue: decimalToNumber(g._sum.attributedRevenue),
        touchpointCount: g._sum.touchpointCount ?? 0,
        avgWeight: g._avg.weight ?? 0,
      }))
      .sort((a, b) => b.attributedRevenue - a.attributedRevenue)

    return NextResponse.json({
      modelId: model.id,
      modelName: model.name,
      modelType: model.modelType,
      campaignCount: rows.length,
      totalAttributedRevenue: rows.reduce((s, r) => s + r.attributedRevenue, 0),
      campaigns: rows,
    })
  } catch (err) {
    console.error("[attribution-models/:id/influences] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load attribution breakdown" },
      { status: 500 },
    )
  }
})
