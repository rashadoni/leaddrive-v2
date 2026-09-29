export interface EntitlementFilters {
  companyId: string
  status: string
  supportLevel: string
  slaPolicyId: string
  risk: string
}

export interface EntitlementListRecord {
  companyId: string
  status: string
  supportLevel: string
  slaPolicyId: string
  isExpiringSoon: boolean
  milestones: { overdue: number; atRisk: number }
}

export function filterEntitlements<T extends EntitlementListRecord>(
  entitlements: readonly T[],
  filters: EntitlementFilters,
): T[] {
  return entitlements.filter((entitlement) => {
    if (filters.companyId && entitlement.companyId !== filters.companyId) return false
    if (filters.status && entitlement.status !== filters.status) return false
    if (filters.supportLevel && entitlement.supportLevel !== filters.supportLevel) return false
    if (filters.slaPolicyId && entitlement.slaPolicyId !== filters.slaPolicyId) return false
    if (filters.risk === "expiring" && !entitlement.isExpiringSoon) return false
    if (filters.risk === "overdue" && entitlement.milestones.overdue === 0) return false
    if (filters.risk === "atRisk" && entitlement.milestones.atRisk === 0) return false
    if (filters.risk === "attention" && entitlement.milestones.overdue === 0 && entitlement.milestones.atRisk === 0) return false
    return true
  })
}
