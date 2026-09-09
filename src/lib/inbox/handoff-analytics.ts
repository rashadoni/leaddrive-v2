export const SALES_HANDOFF_STAGES = [
  "sales_contacted",
  "interested",
  "potential",
  "unable_to_contact",
  "sold",
  "not_sold",
  "no_result",
] as const

export type SalesHandoffStage = typeof SALES_HANDOFF_STAGES[number]

export type MarketingContactRow = {
  agent_id: string | null
  contacted: number
}

export type LeadHandoffRow = {
  marketer_id: string | null
  seller_id: string | null
  stage: string | null
  outcomes?: string[]
  reported: boolean
  count: number
}

export type HandoffUser = {
  id: string
  name: string | null
  email: string
}

type StageCounts = Partial<Record<SalesHandoffStage, number>>

function percentage(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null
}

function safeCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Number(value)) : 0
}

export function summarizeHandoffAnalytics(
  marketingRows: MarketingContactRow[],
  leadRows: LeadHandoffRow[],
  users: HandoffUser[],
) {
  const userName = new Map(users.map((user) => [user.id, user.name || user.email]))
  const marketing = new Map<string, {
    agentId: string | null
    agentName: string | null
    conversationsContacted: number
    leadsCreated: number
  }>()
  const sellers = new Map<string, {
    agentId: string | null
    agentName: string | null
    assignedLeads: number
    reported: number
    awaiting: number
    outcomes: StageCounts
  }>()

  let marketingContacted = 0
  for (const row of marketingRows) {
    const count = safeCount(row.contacted)
    marketingContacted += count
    const key = row.agent_id || "unassigned"
    marketing.set(key, {
      agentId: row.agent_id,
      agentName: row.agent_id ? userName.get(row.agent_id) || row.agent_id : null,
      conversationsContacted: count,
      leadsCreated: 0,
    })
  }

  let leadsCreated = 0
  let salesReported = 0
  let sold = 0
  for (const row of leadRows) {
    const count = safeCount(row.count)
    leadsCreated += count

    const marketerKey = row.marketer_id || "unassigned"
    const marketer = marketing.get(marketerKey) ?? {
      agentId: row.marketer_id,
      agentName: row.marketer_id ? userName.get(row.marketer_id) || row.marketer_id : null,
      conversationsContacted: 0,
      leadsCreated: 0,
    }
    marketer.leadsCreated += count
    marketing.set(marketerKey, marketer)

    const sellerKey = row.seller_id || "unassigned"
    const seller = sellers.get(sellerKey) ?? {
      agentId: row.seller_id,
      agentName: row.seller_id ? userName.get(row.seller_id) || row.seller_id : null,
      assignedLeads: 0,
      reported: 0,
      awaiting: 0,
      outcomes: {},
    }
    seller.assignedLeads += count
    const outcomes = (row.outcomes?.length ? row.outcomes : [row.stage])
      .filter((stage): stage is SalesHandoffStage =>
        SALES_HANDOFF_STAGES.includes(stage as SalesHandoffStage),
      )
    if (row.reported && outcomes.length > 0) {
      seller.reported += count
      for (const stage of outcomes) {
        seller.outcomes[stage] = (seller.outcomes[stage] ?? 0) + count
      }
      salesReported += count
      if (outcomes.includes("sold")) sold += count
    } else {
      seller.awaiting += count
    }
    sellers.set(sellerKey, seller)
  }

  const awaitingSalesReport = Math.max(0, leadsCreated - salesReported)
  return {
    totals: {
      marketingContacted,
      leadsCreated,
      salesReported,
      awaitingSalesReport,
      sold,
      marketingToLeadRate: percentage(leadsCreated, marketingContacted),
      salesReportRate: percentage(salesReported, leadsCreated),
      soldRate: percentage(sold, salesReported),
    },
    marketing: Array.from(marketing.values()).sort((a, b) =>
      b.leadsCreated - a.leadsCreated || b.conversationsContacted - a.conversationsContacted
    ),
    sellers: Array.from(sellers.values()).sort((a, b) =>
      b.assignedLeads - a.assignedLeads || b.reported - a.reported
    ),
  }
}
