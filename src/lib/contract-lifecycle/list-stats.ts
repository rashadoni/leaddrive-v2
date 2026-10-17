/**
 * The contracts list's six figures and its status counts, computed in the
 * browser over the loaded rows — kept here so the guided demo counts its
 * invented portfolio with the page's own arithmetic.
 *
 * «Live» is active or renewing. MRR spreads each live contract's value over
 * its whole months (30-day months, rounded up, at least one); a contract
 * without both dates adds nothing. «Expiring soon» is a live contract ending
 * within the next 90 days.
 */

export type ContractListRow = {
  status: string
  valueAmount?: number | null
  startDate?: string | null
  endDate?: string | null
}

const DAY_MS = 1000 * 60 * 60 * 24

export function daysUntilContractEnd(endDate: string | null | undefined, now: number = Date.now()): number | null {
  if (!endDate) return null
  return Math.ceil((new Date(endDate).getTime() - now) / DAY_MS)
}

export function isContractLive(contract: Pick<ContractListRow, "status">): boolean {
  return contract.status === "active" || contract.status === "renewing"
}

export function isContractExpiringSoon(contract: ContractListRow, now: number = Date.now()): boolean {
  const days = daysUntilContractEnd(contract.endDate, now)
  return days !== null && days > 0 && days <= 90 && isContractLive(contract)
}

export function contractListStats(contracts: readonly ContractListRow[], now: number = Date.now()) {
  const live = contracts.filter(isContractLive)
  const totalValue = live.reduce((sum, contract) => sum + (contract.valueAmount || 0), 0)
  const mrr = live.reduce((sum, contract) => {
    if (!contract.valueAmount || !contract.startDate || !contract.endDate) return sum
    const months = Math.max(1, Math.ceil((new Date(contract.endDate).getTime() - new Date(contract.startDate).getTime()) / (DAY_MS * 30)))
    return sum + contract.valueAmount / months
  }, 0)
  const statusCounts: Record<string, number> = {}
  for (const contract of contracts) statusCounts[contract.status] = (statusCounts[contract.status] || 0) + 1
  return {
    activeCount: live.length,
    totalValue,
    avgValue: live.length > 0 ? Math.round(totalValue / live.length) : 0,
    mrr,
    expiringSoon: contracts.filter((contract) => isContractExpiringSoon(contract, now)).length,
    expiredCount: contracts.filter((contract) => contract.status === "expired").length,
    statusCounts,
  }
}
