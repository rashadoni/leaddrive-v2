import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { decimalToNumber } from "@/lib/prisma-decimal"
import { withRls } from "@/lib/with-rls"
import { orgStageVocabulary } from "@/lib/deal-stage-vocabulary"

export const GET = withRls(async (_req, { orgId }) => {

  try {
    const campaigns = await prisma.campaign.findMany({
      where: { organizationId: orgId },
      include: {
        deals: {
          where: { organizationId: orgId },
          select: {
            id: true,
            name: true,
            stage: true,
            valueAmount: true,
            currency: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    })

    // C9 #10 — multi-touch attribution overlay. The direct revenue above credits
    // a campaign only for deals whose Deal.campaignId points at it (last-touch,
    // full value). The attribution engine instead splits each won deal's revenue
    // across every campaign that touched it. Surface that as a parallel
    // `attributedRevenue` per campaign from the org's default (or latest active)
    // attribution model's influences — non-breaking: direct fields stay intact.
    const model = await prisma.attributionModel.findFirst({
      where: { organizationId: orgId, status: { not: "archived" } },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
      select: { id: true, name: true, modelType: true },
    })
    const attrByCampaign = new Map<string, number>()
    if (model) {
      const grouped = await prisma.campaignInfluence.groupBy({
        by: ["campaignId"],
        // #18 — realized (won) only; ROI must reflect closed revenue, not the
        // probability-weighted pipeline projection.
        where: { organizationId: orgId, modelId: model.id, kind: "won" },
        _sum: { attributedRevenue: true },
      })
      for (const g of grouped as { campaignId: string; _sum: { attributedRevenue: unknown } }[]) {
        attrByCampaign.set(g.campaignId, decimalToNumber(g._sum.attributedRevenue))
      }
    }

    // Resolve won stages the SAME way the recompute worker does (PipelineStage
    // .isWon ∪ "WON"), so the direct revenue and the attributed overlay are
    // computed over the same deal set even for orgs with custom won stages.
    /*
     * `wonStageNames` alone is configured stages ∪ the literal "WON", which
     * still misses `CLOSED_WON` and other stored spellings. The vocabulary
     * resolves what the org actually holds.
     */
    const wonNames = new Set((await orgStageVocabulary(orgId)).wonStages)

    const data = campaigns.map((c: any) => {
      const wonDeals = c.deals.filter((d: any) => wonNames.has(d.stage))
      const revenue = wonDeals.reduce((sum: number, d: any) => sum + decimalToNumber(d.valueAmount), 0)
      const cost = c.budget || 0
      const roi = cost > 0 ? ((revenue - cost) / cost) * 100 : 0
      const attributedRevenue = attrByCampaign.get(c.id) ?? 0
      const attributedRoi = cost > 0 ? ((attributedRevenue - cost) / cost) * 100 : 0
      return {
        id: c.id,
        name: c.name,
        status: c.status,
        type: c.type,
        budget: c.budget,
        totalRecipients: c.totalRecipients,
        totalSent: c.totalSent,
        totalOpened: c.totalOpened,
        totalClicked: c.totalClicked,
        sentAt: c.sentAt,
        revenue,
        attributedRevenue,
        attributedRoi,
        totalDeals: c.deals.length,
        wonDeals: wonDeals.length,
        roi,
        createdAt: c.createdAt,
        deals: c.deals.map((d: any) => ({
          id: d.id,
          name: d.name,
          stage: d.stage,
          amount: decimalToNumber(d.valueAmount),
          currency: d.currency,
        })),
      }
    })

    const totalRevenue = data.reduce((s: number, c: any) => s + c.revenue, 0)
    const totalCost = data.reduce((s: number, c: any) => s + c.budget, 0)
    const totalRoi = totalCost > 0 ? ((totalRevenue - totalCost) / totalCost) * 100 : 0
    const totalAttributedRevenue = data.reduce((s: number, c: any) => s + c.attributedRevenue, 0)
    const totalAttributedRoi = totalCost > 0 ? ((totalAttributedRevenue - totalCost) / totalCost) * 100 : 0

    return NextResponse.json({
      success: true,
      data: {
        campaigns: data,
        summary: {
          totalRevenue,
          totalCost,
          totalRoi,
          campaignCount: data.length,
          totalAttributedRevenue,
          totalAttributedRoi,
          attributionModel: model ? { name: model.name, modelType: model.modelType } : null,
        },
      },
    })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
