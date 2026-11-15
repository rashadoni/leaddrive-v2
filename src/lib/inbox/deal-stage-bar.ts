import { canonicalDealStage } from "@/lib/deal-stage-normalization"

export type PipelineStageLike = { name: string; displayName?: string | null; isWon?: boolean | null; isLost?: boolean | null }
export type DealStageStep = { label: string; done: boolean; current: boolean }

/**
 * The stages of a deal's own pipeline as one bar for the inbox panel's «Sövdələşmə» card — the
 * organization's own names (`PipelineStage.displayName`), never a fixed list. A lost stage is not a
 * step on the way and is left out. Matching is by meaning (`canonicalDealStage`), as on the deal
 * page: prod stores seven spellings of five stages, and a raw comparison left a won deal with an
 * empty bar there.
 */
export function dealStageBar(stages: PipelineStageLike[], current: string): DealStageStep[] {
  // The pipeline's own won/lost flags name its closing stages, whatever they are called.
  const won = stages.filter((stage) => stage.isWon).map((stage) => stage.name)
  const lost = stages.filter((stage) => stage.isLost).map((stage) => stage.name)
  const canonical = (stage: string) => canonicalDealStage(stage, won, lost)
  const steps = stages.filter((stage) => canonical(stage.name) !== "LOST")
  const now = canonical(current)
  const index = steps.findIndex((stage) => canonical(stage.name) === now)
  return steps.map((stage, i) => ({
    label: stage.displayName || stage.name,
    done: index >= 0 && i <= index,
    current: i === index,
  }))
}
