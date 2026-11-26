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
  currency?: string | null
  startDate?: string | null
  endDate?: string | null
}

/** One currency's figures of the live contracts — currencies are never added together (no rates). */
export type CurrencyFigures = { currency: string; count: number; total: number; mrr: number; avg: number }

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
  // Per currency (owner 2026-11-26, «Деньги по договору»): the sums above add AZN and USD
  // together and the list labelled the lot «₼». The demo, all in AZN, still reads the sums.
  const groups = new Map<string, ContractListRow[]>()
  for (const contract of live) {
    const currency = contract.currency || "AZN"
    groups.set(currency, [...(groups.get(currency) ?? []), contract])
  }
  const byCurrency: CurrencyFigures[] = [...groups.entries()]
    .map(([currency, rows]) => {
      const total = rows.reduce((sum, contract) => sum + (contract.valueAmount || 0), 0)
      const currencyMrr = rows.reduce((sum, contract) => {
        if (!contract.valueAmount || !contract.startDate || !contract.endDate) return sum
        const months = Math.max(1, Math.ceil((new Date(contract.endDate).getTime() - new Date(contract.startDate).getTime()) / (DAY_MS * 30)))
        return sum + contract.valueAmount / months
      }, 0)
      return { currency, count: rows.length, total, mrr: currencyMrr, avg: rows.length > 0 ? Math.round(total / rows.length) : 0 }
    })
    .sort((a, b) => (a.currency === "AZN" ? -1 : b.currency === "AZN" ? 1 : b.total - a.total))
  return {
    byCurrency,
    activeCount: live.length,
    totalValue,
    avgValue: live.length > 0 ? Math.round(totalValue / live.length) : 0,
    mrr,
    expiringSoon: contracts.filter((contract) => isContractExpiringSoon(contract, now)).length,
    expiredCount: contracts.filter((contract) => contract.status === "expired").length,
    statusCounts,
  }
}

/** «1 240 000 ₼ · 35 000 USD» — one figure per currency; «0 ₼» when there is none. */
export function currencyFiguresText(byCurrency: readonly CurrencyFigures[], key: "total" | "mrr" | "avg"): string {
  if (byCurrency.length === 0) return "0 ₼"
  return byCurrency
    .map((figures) => `${Math.round(figures[key]).toLocaleString()} ${figures.currency === "AZN" ? "₼" : figures.currency}`)
    .join(" · ")
}
