import { prisma } from "@/lib/prisma"
import { resolveStageVocabulary, type StageVocabulary } from "@/lib/deal-stage-normalization"
import { wonStageNames, lostStageNames } from "@/lib/marketing-attribution/won-stages"

/**
 * The stage spellings one org actually stores, ready to drop into a `where`.
 *
 * `Deal.stage` is a free string. Pipelines are configured per organisation, and
 * rows also arrive from imports and seed scripts, so several spellings of the
 * same stage coexist — production holds seven for five stages, `WON` next to
 * `CLOSED_WON` and `LEAD` next to `lead`.
 *
 * Every `stage: "WON"` in the codebase was therefore a silent filter bug. On
 * the executive dashboard it hid the organisation's largest deal from revenue
 * while leaving it in the open pipeline; in the quota routes it credits nothing
 * to the seller who closed it.
 *
 * This lives in one place because the alternative is fifteen copies of the same
 * twenty lines, and the moment one of them is edited alone the screens start
 * disagreeing again — which is exactly how reports and the dashboard came to
 * report different revenue for the same org.
 *
 * Costs three cheap indexed queries. Call once per request, not per row.
 *
 * The stored spellings come from `groupBy`, not `findMany({ distinct })`,
 * deliberately: this runs just before the caller's own deal query, and sharing
 * a method with it means sharing its mock. `findMany` here silently ate the
 * `mockResolvedValueOnce` that six route tests had set up for their real query.
 * That is a test-only symptom of a real coupling, and the cheapest way not to
 * have it is to not reach for the same door.
 */
export async function orgStageVocabulary(orgId: string): Promise<StageVocabulary> {
  const [configuredWon, configuredLost, stored] = await Promise.all([
    wonStageNames(orgId),
    lostStageNames(orgId),
    prisma.deal.groupBy({ by: ["stage"], where: { organizationId: orgId } }),
  ])
  return resolveStageVocabulary(
    (stored as { stage: string }[]).map((d) => d.stage),
    configuredWon,
    configuredLost,
  )
}
