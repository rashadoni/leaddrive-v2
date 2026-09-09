/**
 * C9 — shared "won stage" resolution.
 *
 * Single source of truth for which deal stages count as closed-won, so the
 * recompute worker (which builds CampaignInfluence) and the campaign-ROI route
 * (which reads it back) agree on the deal set. Prefers per-org
 * PipelineStage.isWon, and always includes the legacy hardcoded "WON" so orgs
 * that never configured pipeline stages still attribute.
 */
import { prisma } from "@/lib/prisma"

export async function wonStageNames(orgId: string): Promise<string[]> {
  const stages = await prisma.pipelineStage.findMany({
    where: { organizationId: orgId, isWon: true },
    select: { name: true },
  })
  const names = new Set<string>(stages.map((s: { name: string }) => s.name))
  names.add("WON")
  return Array.from(names)
}

/**
 * Closed-lost stage names — PipelineStage.isLost ∪ the legacy hardcoded "LOST".
 * Used by #18 to exclude lost deals from pipeline (open-deal) attribution: a
 * deal is "open" when its stage is neither won nor lost.
 */
export async function lostStageNames(orgId: string): Promise<string[]> {
  const stages = await prisma.pipelineStage.findMany({
    where: { organizationId: orgId, isLost: true },
    select: { name: true },
  })
  const names = new Set<string>(stages.map((s: { name: string }) => s.name))
  names.add("LOST")
  return Array.from(names)
}
