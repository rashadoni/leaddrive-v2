export type ProviderRunRollupInput = {
  phase: string
  receivedCount: number
  acceptedCount: number
  reviewCount: number
  duplicateCount: number
  reservedChargeUsd: string | number
  actualChargeUsd: string | number | null
}

export function providerRunRollup(runs: ProviderRunRollupInput[]) {
  const number = (value: string | number | null) => {
    const parsed = Number(value ?? 0)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return runs.reduce((summary, run) => {
    summary.candidates += run.phase.includes("DISCOVER") ? run.receivedCount : 0
    summary.enriched += (run.phase.includes("ENRICH") || run.phase === "PAID_ROUTE_COLLECTION") ? run.receivedCount : 0
    summary.review += run.reviewCount
    summary.accepted += run.acceptedCount
    summary.duplicates += run.duplicateCount
    summary.reservedUsd += number(run.reservedChargeUsd)
    summary.actualUsd += number(run.actualChargeUsd)
    summary.hasActual = summary.hasActual || run.actualChargeUsd !== null
    return summary
  }, {
    candidates: 0,
    enriched: 0,
    review: 0,
    accepted: 0,
    duplicates: 0,
    reservedUsd: 0,
    actualUsd: 0,
    hasActual: false,
  })
}
