import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { decimalToNumber } from "@/lib/prisma-decimal"
import { withRls } from "@/lib/with-rls"
import { orgStageVocabulary } from "@/lib/deal-stage-vocabulary"
import {
  CAMPAIGN_BUDGET_CURRENCY,
  campaignCost,
  campaignLaunched,
  mergeBuckets,
  revenueBuckets,
  roiVerdict,
} from "@/lib/campaigns/roi"

type CampaignRow = {
  id: string
  name: string
  status: string
  type: string
  budget: number
  totalRecipients: number
  totalSent: number
  totalOpened: number
  totalClicked: number
  sentAt: Date | null
  createdAt: Date
  deals: { id: string; name: string; stage: string; valueAmount: unknown; currency: string | null }[]
}

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
    // attribution model's influences, grouped by currency like the direct figure.
    const model = await prisma.attributionModel.findFirst({
      where: { organizationId: orgId, status: { not: "archived" } },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
      select: { id: true, name: true, modelType: true },
    })
    // Attributed revenue is a share of a deal's value, so it is in that deal's
    // currency — read it per influence with the deal's currency and bucket it,
    // instead of a groupBy that would add AZN shares to USD shares.
    const attrByCampaign = new Map<string, { valueAmount: number; currency: string | null }[]>()
    if (model) {
      const influences = await prisma.campaignInfluence.findMany({
        // #18 — realized (won) only; ROI must reflect closed revenue, not the
        // probability-weighted pipeline projection.
        where: { organizationId: orgId, modelId: model.id, kind: "won" },
        select: { campaignId: true, attributedRevenue: true, deal: { select: { currency: true } } },
      })
      for (const inf of influences as { campaignId: string; attributedRevenue: unknown; deal: { currency: string | null } | null }[]) {
        const rows = attrByCampaign.get(inf.campaignId) ?? []
        rows.push({ valueAmount: decimalToNumber(inf.attributedRevenue), currency: inf.deal?.currency ?? null })
        attrByCampaign.set(inf.campaignId, rows)
      }
    }

    /*
     * Won stages come from what the org actually stores (configured isWon
     * stages, `WON`, `CLOSED_WON`, localized spellings) — the same resolution
     * the attribution recompute uses, so direct and attributed revenue are
     * computed over the same deal set.
     */
    const wonNames = new Set((await orgStageVocabulary(orgId)).wonStages)

    const data = (campaigns as unknown as CampaignRow[]).map((c) => {
      const deals = c.deals.map((d) => ({
        id: d.id,
        name: d.name,
        stage: d.stage,
        amount: decimalToNumber(d.valueAmount),
        currency: String(d.currency || CAMPAIGN_BUDGET_CURRENCY).toUpperCase(),
      }))
      const wonDeals = deals.filter((d) => wonNames.has(d.stage))
      const revenue = revenueBuckets(wonDeals.map((d) => ({ valueAmount: d.amount, currency: d.currency })))
      const attributedRevenue = revenueBuckets(attrByCampaign.get(c.id) ?? [])
      const launched = campaignLaunched(c)
      const cost = { currency: CAMPAIGN_BUDGET_CURRENCY, value: campaignCost(c) }
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
        launched,
        /** Won-deal revenue per currency, largest first. */
        revenue,
        attributedRevenue,
        /** Budget counted as cost — 0 until the campaign has gone out. */
        cost,
        roi: roiVerdict(revenue, cost, { launched }),
        attributedRoi: roiVerdict(attributedRevenue, cost, { launched }),
        totalDeals: deals.length,
        wonDeals: wonDeals.length,
        createdAt: c.createdAt,
        deals,
      }
    })

    const totalRevenue = mergeBuckets(data.map((c) => c.revenue))
    const totalAttributedRevenue = mergeBuckets(data.map((c) => c.attributedRevenue))
    const launchedCount = data.filter((c) => c.launched).length
    const totalCost = {
      currency: CAMPAIGN_BUDGET_CURRENCY,
      value: data.reduce((s, c) => s + c.cost.value, 0),
    }

    return NextResponse.json({
      success: true,
      data: {
        campaigns: data,
        summary: {
          revenue: totalRevenue,
          cost: totalCost,
          /** What `cost` is made of, so a screen can say it rather than imply spend. */
          costBasis: "budget-of-launched",
          roi: roiVerdict(totalRevenue, totalCost),
          attributedRevenue: totalAttributedRevenue,
          attributedRoi: roiVerdict(totalAttributedRevenue, totalCost),
          campaignCount: data.length,
          launchedCount,
          attributionModel: model ? { name: model.name, modelType: model.modelType } : null,
        },
      },
    })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
