/**
 * «Müqavilə həyat dövrü» from its rows: renewal alerts (pending, due within
 * 90 days or overdue, on live contracts) and pending approval stages — the
 * shaping the contract-lifecycle route used to do inline, kept here so the
 * guided demo builds its page with the same rules.
 *
 * One row per contract for renewals (its soonest alert); for approvals, each
 * contract's lowest pending stage, grouped by stage label, the biggest queue
 * first.
 */

export interface LifecycleAlertRow {
  id: string
  contractId: string
  dueAt: Date
  daysBeforeExpiry: number
  contract: {
    contractNumber: string
    title: string
    endDate: Date | null
    valueAmount: number | null
    currency: string
    status: string
    company: { name: string } | null
  } | null
}

export interface LifecycleStageRow {
  id: string
  contractId: string
  order: number
  label: string
  assigneeUserId: string | null
  assigneeRole: string | null
  createdAt: Date
  contract: {
    contractNumber: string
    title: string
    valueAmount: number | null
    currency: string
    company: { name: string } | null
  } | null
}

/** `alerts` ordered by dueAt ascending, as the route reads them. */
export function buildLifecycleView(alerts: readonly LifecycleAlertRow[], stages: readonly LifecycleStageRow[], now: Date) {
  const renewalsOut = alerts.map((a) => {
    const daysUntilDue = Math.floor((a.dueAt.getTime() - now.getTime()) / 86_400_000)
    return {
      id: a.id,
      contractId: a.contractId,
      contractNumber: a.contract?.contractNumber ?? "—",
      contractTitle: a.contract?.title ?? "—",
      companyName: a.contract?.company?.name ?? null,
      contractStatus: a.contract?.status ?? "unknown",
      endDate: a.contract?.endDate ?? null,
      valueAmount: a.contract?.valueAmount ?? null,
      currency: a.contract?.currency ?? "USD",
      dueAt: a.dueAt,
      daysUntilDue,
      daysBeforeExpiry: a.daysBeforeExpiry,
      isOverdue: daysUntilDue < 0,
    }
  })

  // Dedup to ONE row per contract: a contract has a renewal alert PER threshold
  // (90/60/30/14d), so without this a single expiring contract floods the list
  // with redundant rows (same endDate, different alert window). The rows come
  // dueAt-asc, so the first occurrence per contract is its most urgent
  // (soonest) alert — keep that one. The KPI counts below run on the deduped
  // set so "renewals due (90d)" reflects CONTRACTS, not alert records.
  const seenContract = new Set<string>()
  const renewals = renewalsOut.filter((r) => {
    if (seenContract.has(r.contractId)) return false
    seenContract.add(r.contractId)
    return true
  })

  // For each contract in approvals, keep only the lowest-order pending
  // stage — that's the current bottleneck. If a contract has stages
  // 1=approved, 2=pending, 3=pending, the current bottleneck is stage 2.
  // (Sequential CLM: stage N is gated by stage N-1.)
  const currentByContract = new Map<string, LifecycleStageRow>()
  for (const s of stages) {
    const existing = currentByContract.get(s.contractId)
    if (!existing || s.order < existing.order) currentByContract.set(s.contractId, s)
  }
  const approvalsOut = Array.from(currentByContract.values()).map((s) => ({
    contractId: s.contractId,
    contractNumber: s.contract?.contractNumber ?? "—",
    contractTitle: s.contract?.title ?? "—",
    companyName: s.contract?.company?.name ?? null,
    valueAmount: s.contract?.valueAmount ?? null,
    currency: s.contract?.currency ?? "USD",
    currentStageLabel: s.label,
    currentStageOrder: s.order,
    currentStageId: s.id,
    assigneeUserId: s.assigneeUserId,
    assigneeRole: s.assigneeRole,
    ageMs: now.getTime() - s.createdAt.getTime(),
  }))

  // Approvals grouped by stage label for the page's "bottleneck" view.
  const grouped: Record<string, typeof approvalsOut> = {}
  for (const a of approvalsOut) {
    if (!grouped[a.currentStageLabel]) grouped[a.currentStageLabel] = []
    grouped[a.currentStageLabel].push(a)
  }
  // Within a stage bucket, oldest-stalled contract first so the most
  // overdue case is at the top of each group.
  for (const contracts of Object.values(grouped)) contracts.sort((a, b) => b.ageMs - a.ageMs)
  // Across groups: larger queue first; label localeCompare as
  // deterministic tiebreaker so equal-count groups stay stable across
  // reloads.
  const groups = Object.entries(grouped)
    .map(([label, contracts]) => ({ label, contracts }))
    .sort((a, b) => (b.contracts.length !== a.contracts.length ? b.contracts.length - a.contracts.length : a.label.localeCompare(b.label)))

  return {
    renewals: {
      items: renewals,
      total: renewals.length,
      overdueCount: renewals.filter((r) => r.isOverdue).length,
      next30dCount: renewals.filter((r) => !r.isOverdue && r.daysUntilDue <= 30).length,
    },
    approvals: {
      items: approvalsOut,
      groups,
      total: approvalsOut.length,
      bottleneckStage: groups.length > 0 ? groups[0].label : null,
      // How many contracts are stuck at the bottleneck stage — turns the KPI
      // from a bare label into "{stage} — N stuck" + a jump target.
      bottleneckCount: groups.length > 0 ? groups[0].contracts.length : 0,
    },
  }
}
