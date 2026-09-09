/**
 * C9 Marketing Attribution — recompute worker (Phase 3).
 *
 * Recomputes campaign_influences for one model over an org's closed-won deals
 * and records an AttributionCalculationRun. This is where the slice-1 pure
 * helpers finally run on real data:
 *   gather touchpoints → dedupe + engagement-weight (#12) →
 *   evaluateAttributionModel → aggregateByCampaign → allocateRevenue →
 *   upsert influences (+ delete stale).
 *
 * Invoked by the manual endpoint (POST …/[id]/recompute) and the cron
 * (/api/cron/attribution-recompute). All queries are explicitly org-scoped;
 * campaign_* tables are not in any RLS batch.
 */
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { decimalToNumber } from "@/lib/prisma-decimal"
import { evaluateAttributionModel } from "./attribution-model-evaluator"
import { aggregateByCampaign } from "./touchpoint-aggregator"
import { allocateRevenue } from "./revenue-allocator"
import { wonStageNames, lostStageNames } from "./won-stages"
import { dedupeTouchpoints, applyEngagementWeighting } from "./engagement-weights"
import type {
  AttributionModelType,
  ModelConfig,
  TriggerSource,
  TouchpointForAttribution,
} from "./types"

/** Minimal model shape the worker needs (manual route + cron both satisfy it). */
export interface RecomputeModel {
  id: string
  organizationId: string
  modelType: string
  config: unknown
}

export interface RecomputeResult {
  runId: string
  status: "succeeded" | "failed"
  dealsTotal: number
  dealsProcessed: number
  influencesWritten: number
  errorMessage?: string
}

function asConfigObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/**
 * Recompute one model's influences across all of the org's closed-won deals.
 * Never throws — failures are captured on the run record and returned.
 */
export async function recomputeModel(
  orgId: string,
  model: RecomputeModel,
  opts: { triggerSource: TriggerSource },
): Promise<RecomputeResult> {
  // Run lifecycle: pending → running (startedAt) → succeeded|failed (endedAt).
  const run = await prisma.attributionCalculationRun.create({
    data: {
      organizationId: orgId,
      modelId: model.id,
      status: "pending",
      triggerSource: opts.triggerSource,
    },
    select: { id: true },
  })
  await prisma.attributionCalculationRun.update({
    where: { id: run.id },
    data: { status: "running", startedAt: new Date() },
  })

  // Hoisted so the catch can report REAL partial progress on a mid-loop
  // failure (each deal is its own transaction → earlier deals may already
  // have committed influences).
  let dealsTotal = 0
  let dealsProcessed = 0
  let influencesWritten = 0

  try {
    // #18 — attribute closed-WON deals (realized) AND OPEN deals (pipeline =
    // neither won nor lost). Fetch everything that isn't lost; partition by
    // won-ness per deal below. `stage`/`probability` drive kind + the expected
    // (probability-weighted) revenue for pipeline deals.
    const wonNames = await wonStageNames(orgId)
    const lostNames = await lostStageNames(orgId)
    const wonSet = new Set(wonNames)
    const deals = await prisma.deal.findMany({
      where: { organizationId: orgId, stage: { notIn: lostNames } },
      select: {
        id: true,
        stage: true,
        probability: true,
        valueAmount: true,
        contactId: true,
        companyId: true,
        stageChangedAt: true,
        updatedAt: true,
        contactRoles: { select: { contactId: true } },
      },
    })
    dealsTotal = deals.length
    const processedDealIds: string[] = []

    // C9 — account-based rollup is ON by default; a per-model `accountRollup:
    // false` narrows attribution to the deal's OWN contacts (precision orgs).
    // Read defensively: anything except an explicit `false` keeps rollup on.
    const accountRollup = (asConfigObject(model.config) as { accountRollup?: unknown }).accountRollup !== false

    // Company-level rollup (account-based attribution): a B2B deal's
    // touchpoints often sit on SIBLING contacts at the same company, not the
    // deal's own contact. Pre-fetch each company's contact ids once (batched,
    // not per-deal) so the relevance gather can include them.
    const companyIds = Array.from(
      new Set(
        deals
          .map((d: { companyId: string | null }) => d.companyId)
          .filter((c: string | null): c is string => Boolean(c)),
      ),
    )
    const companyContacts = new Map<string, string[]>()
    if (accountRollup && companyIds.length) {
      const rows = await prisma.contact.findMany({
        where: { organizationId: orgId, companyId: { in: companyIds } },
        select: { id: true, companyId: true },
      })
      for (const c of rows as { id: string; companyId: string | null }[]) {
        if (!c.companyId) continue
        const arr = companyContacts.get(c.companyId) ?? []
        arr.push(c.id)
        companyContacts.set(c.companyId, arr)
      }
    }

    // The DB evaluator only reads knobs when config.modelType matches, so the
    // stored knobs object must be tagged with the model's type.
    const modelType = model.modelType as AttributionModelType
    const config = { modelType, ...asConfigObject(model.config) } as ModelConfig

    for (const deal of deals) {
      const conversionAt = deal.stageChangedAt ?? deal.updatedAt
      const contactIds = Array.from(
        new Set(
          [
            deal.contactId,
            ...deal.contactRoles.map((r: { contactId: string }) => r.contactId),
            ...(accountRollup && deal.companyId ? companyContacts.get(deal.companyId) ?? [] : []),
          ].filter((c): c is string => Boolean(c)),
        ),
      )

      // Relevant touchpoints: those explicitly linked to this deal, plus
      // unlinked touchpoints of the deal's contacts up to conversion time.
      const tps = await prisma.campaignTouchpoint.findMany({
        where: {
          organizationId: orgId,
          OR: [
            { dealId: deal.id },
            ...(contactIds.length
              ? [{ dealId: null, contactId: { in: contactIds }, occurredAt: { lte: conversionAt } }]
              : []),
          ],
        },
        select: { id: true, campaignId: true, occurredAt: true, touchpointType: true },
      })

      const forAttribution: TouchpointForAttribution[] = tps.map(
        (t: { id: string; campaignId: string; occurredAt: Date; touchpointType: string | null }) => ({
          touchpointId: t.id,
          campaignId: t.campaignId,
          occurredAt: t.occurredAt,
          touchpointType: t.touchpointType ?? undefined,
        }),
      )

      // #12 — collapse repeats of the same (campaign, type), run the positional
      // model on the deduped set, then scale by engagement strength so credit
      // tracks intent (click > open > send), not raw event count.
      const deduped = dedupeTouchpoints(forAttribution)
      const typeById = new Map(deduped.map((t) => [t.touchpointId, t.touchpointType]))
      const positional = evaluateAttributionModel({ touchpoints: deduped, modelType, config, conversionAt })
      const weights = applyEngagementWeighting(positional, typeById)
      const aggregated = aggregateByCampaign(weights)
      // #18 — realized vs pipeline: a won deal allocates its FULL value; an open
      // deal allocates its probability-weighted EXPECTED value (forecast credit).
      const kind = wonSet.has(deal.stage) ? "won" : "pipeline"
      const dealValue = decimalToNumber(deal.valueAmount)
      const effectiveAmount =
        kind === "pipeline" ? dealValue * (Math.min(100, Math.max(0, deal.probability ?? 0)) / 100) : dealValue
      const allocated = allocateRevenue({ dealAmount: effectiveAmount, influences: aggregated })
      const keptCampaignIds = allocated.map((a) => a.campaignId)
      processedDealIds.push(deal.id)

      // Upsert this deal's influences + drop campaigns that fell out of the
      // set (e.g. a touchpoint was retired) — atomic per deal.
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        for (const a of allocated) {
          // Clamp to [0,1] before the write: aggregateByCampaign sums
          // per-touchpoint weights in float, so a single-campaign deal with
          // N touchpoints can land at 1.0000000000000002 (e.g. linear N=9),
          // which would trip campaign_influences_weight_check (weight <= 1)
          // and fail the whole run. The math intends exactly 1.0.
          const weight = Math.min(1, Math.max(0, a.weight))
          await tx.campaignInfluence.upsert({
            where: {
              dealId_campaignId_modelId: { dealId: deal.id, campaignId: a.campaignId, modelId: model.id },
            },
            create: {
              organizationId: orgId,
              dealId: deal.id,
              campaignId: a.campaignId,
              modelId: model.id,
              weight,
              attributedRevenue: a.attributedRevenue,
              touchpointCount: a.touchpointCount,
              kind,
              computedAt: new Date(),
            },
            update: {
              weight,
              attributedRevenue: a.attributedRevenue,
              touchpointCount: a.touchpointCount,
              kind,
              computedAt: new Date(),
            },
          })
        }
        await tx.campaignInfluence.deleteMany({
          where: {
            // org-scoped defense-in-depth on a destructive multi-tenant write
            // (dealId+modelId are already org-bound, but be explicit).
            organizationId: orgId,
            dealId: deal.id,
            modelId: model.id,
            // notIn [] matches everything; guard with a sentinel when empty.
            campaignId: { notIn: keptCampaignIds.length ? keptCampaignIds : ["__none__"] },
          },
        })
      })

      influencesWritten += allocated.length
      dealsProcessed++
    }

    // #18 — drop influences for deals that left the won∪open set (a won/open
    // deal that became LOST). Deleted deals are handled by onDelete: Cascade;
    // this catches lost transitions whose stale influences would otherwise
    // linger. Empty processedDealIds (no won/open deals) → notIn [] matches all
    // → clears every influence for the model, which is correct.
    await prisma.campaignInfluence.deleteMany({
      where: {
        organizationId: orgId,
        modelId: model.id,
        dealId: { notIn: processedDealIds },
      },
    })

    await prisma.attributionCalculationRun.update({
      where: { id: run.id },
      data: {
        status: "succeeded",
        endedAt: new Date(),
        dealsTotal,
        dealsProcessed,
        influencesWritten,
      },
    })
    return { runId: run.id, status: "succeeded", dealsTotal, dealsProcessed, influencesWritten }
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    // Best-effort failure stamp — the run must not be left stuck "running".
    // Record the REAL partial counts (dealsProcessed <= dealsTotal holds since
    // both come from the same loop), not zeros.
    await prisma.attributionCalculationRun
      .update({
        where: { id: run.id },
        data: {
          status: "failed",
          endedAt: new Date(),
          errorMessage: errorMessage.slice(0, 1000),
          dealsTotal,
          dealsProcessed,
          influencesWritten,
        },
      })
      .catch(() => {})
    return { runId: run.id, status: "failed", dealsTotal, dealsProcessed, influencesWritten, errorMessage }
  }
}
