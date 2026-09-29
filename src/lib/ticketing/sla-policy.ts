export const SLA_POLICY_PRIORITIES = ["critical", "high", "medium", "low"] as const
export type SlaPolicyPriority = (typeof SLA_POLICY_PRIORITIES)[number]

export type SlaTargetError = "minimum" | "resolution_before_response"

export function validateSlaTargets(firstResponseHours: number, resolutionHours: number): SlaTargetError | null {
  const minimum = 1 / 60
  if (!Number.isFinite(firstResponseHours) || !Number.isFinite(resolutionHours)
    || firstResponseHours < minimum || resolutionHours < minimum) {
    return "minimum"
  }
  if (resolutionHours < firstResponseHours) return "resolution_before_response"
  return null
}

export function splitSlaDuration(decimalHours: number): { hours: number; minutes: number } {
  const totalMinutes = Math.max(0, Math.round((decimalHours || 0) * 60))
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 }
}

export interface SlaPolicySummaryInput {
  id: string
  priority: string
  isActive: boolean
}

export function summarizeSlaPolicyCoverage(policies: readonly SlaPolicySummaryInput[]) {
  const activeCounts = new Map<SlaPolicyPriority, number>(SLA_POLICY_PRIORITIES.map((priority) => [priority, 0]))
  for (const policy of policies) {
    if (!policy.isActive || !SLA_POLICY_PRIORITIES.includes(policy.priority as SlaPolicyPriority)) continue
    const priority = policy.priority as SlaPolicyPriority
    activeCounts.set(priority, (activeCounts.get(priority) || 0) + 1)
  }

  return {
    active: policies.filter((policy) => policy.isActive).length,
    covered: SLA_POLICY_PRIORITIES.filter((priority) => (activeCounts.get(priority) || 0) === 1),
    missing: SLA_POLICY_PRIORITIES.filter((priority) => (activeCounts.get(priority) || 0) === 0),
    conflicts: SLA_POLICY_PRIORITIES.filter((priority) => (activeCounts.get(priority) || 0) > 1),
    activeCounts,
  }
}

export function hasActivePriorityConflict(
  policies: readonly SlaPolicySummaryInput[],
  priority: string,
  excludeId?: string,
): boolean {
  return policies.some((policy) => policy.id !== excludeId && policy.isActive && policy.priority === priority)
}
