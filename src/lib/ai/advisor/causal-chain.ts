import type { AdvisorSignal } from "./types"

export type AdvisorCausalChainTemplate =
  | "contract_invoice_task"
  | "owner_workload_sla"
  | "route_field_execution"
  | "record_link"

export type AdvisorCausalChainItem = {
  signal: AdvisorSignal
  template: AdvisorCausalChainTemplate
  score: number
}

export function advisorSignalRelationKeys(signal: AdvisorSignal) {
  const keys = new Set<string>([`${signal.entityType}:${signal.entityId}`])
  if (signal.ownerId) keys.add(`owner:${signal.ownerId}`)
  for (const sourceRef of signal.sources) {
    keys.add(`${sourceRef.entityType}:${sourceRef.entityId}`)
  }
  for (const action of signal.recommendedActions) {
    const relatedType = action.payload.relatedType
    const relatedId = action.payload.relatedId
    if (typeof relatedType === "string" && typeof relatedId === "string") {
      keys.add(`${relatedType}:${relatedId}`)
    }
    const assignedTo = action.payload.assignedTo
    if (typeof assignedTo === "string" && assignedTo) keys.add(`owner:${assignedTo}`)
  }
  return keys
}

function domainSet(signals: AdvisorSignal[]) {
  return new Set(signals.map((signal) => signal.domain))
}

function entityTypeSet(signals: AdvisorSignal[]) {
  const types = new Set<string>()
  for (const signal of signals) {
    types.add(signal.entityType)
    for (const source of signal.sources) types.add(source.entityType)
    for (const action of signal.recommendedActions) {
      if (typeof action.payload.relatedType === "string") types.add(action.payload.relatedType)
    }
  }
  return types
}

export function classifyAdvisorCausalChain(base: AdvisorSignal, candidate: AdvisorSignal): AdvisorCausalChainTemplate {
  const domains = domainSet([base, candidate])
  const entityTypes = entityTypeSet([base, candidate])
  const sameOwner = Boolean(base.ownerId && candidate.ownerId && base.ownerId === candidate.ownerId)

  if (
    (domains.has("contracts") || entityTypes.has("contract")) &&
    (domains.has("finance") || domains.has("tasks") || entityTypes.has("invoice") || entityTypes.has("task"))
  ) {
    return "contract_invoice_task"
  }
  if (sameOwner && (domains.has("support") || domains.has("tasks") || domains.has("kpi"))) {
    return "owner_workload_sla"
  }
  if (
    (domains.has("routes") || domains.has("mtm")) &&
    Array.from(entityTypes).some((type) => type.startsWith("mtm_"))
  ) {
    return "route_field_execution"
  }
  return "record_link"
}

function relatedSignalScore(baseKeys: Set<string>, signal: AdvisorSignal) {
  let score = 0
  for (const key of advisorSignalRelationKeys(signal)) {
    if (baseKeys.has(key)) score += key.startsWith("owner:") ? 1 : 2
  }
  return score
}

function severityRank(severity: AdvisorSignal["severity"]) {
  return severity === "critical" ? 4 : severity === "high" ? 3 : severity === "medium" ? 2 : 1
}

export function buildAdvisorCausalChain(signal: AdvisorSignal, signals: AdvisorSignal[], limit = 4): AdvisorCausalChainItem[] {
  const baseKeys = advisorSignalRelationKeys(signal)
  return signals
    .filter((candidate) => candidate.id !== signal.id)
    .map((candidate) => ({
      signal: candidate,
      score: relatedSignalScore(baseKeys, candidate),
      template: classifyAdvisorCausalChain(signal, candidate),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || severityRank(b.signal.severity) - severityRank(a.signal.severity))
    .slice(0, limit)
}
