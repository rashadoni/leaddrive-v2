export const DEFAULT_LEAD_SORT = "newest"

export type SortableLead = {
  id: string
  createdAt: string | Date
  score: number
  contactName: string
  companyName?: string | null
  source?: string | null
  status: string
  scoreDetails?: unknown
}

function createdAtMs(lead: SortableLead): number {
  const value = new Date(lead.createdAt).getTime()
  return Number.isFinite(value) ? value : 0
}

function compareNewest(a: SortableLead, b: SortableLead): number {
  const byDate = createdAtMs(b) - createdAtMs(a)
  return byDate || a.id.localeCompare(b.id)
}

function compareOldest(a: SortableLead, b: SortableLead): number {
  const byDate = createdAtMs(a) - createdAtMs(b)
  return byDate || a.id.localeCompare(b.id)
}

function conversionProbability(lead: SortableLead): number {
  const details = lead.scoreDetails
  if (details && typeof details === "object" && !Array.isArray(details)) {
    const value = (details as Record<string, unknown>).conversionProb
    if (typeof value === "number" && Number.isFinite(value)) return value
  }
  return Math.round(lead.score * 0.85)
}

/**
 * One deterministic ordering shared by the lead table and Kanban columns.
 * Every non-date sort falls back to newest-first so equal-score leads never
 * jump around and a newly created lead remains visible near the top.
 */
export function compareLeads(a: SortableLead, b: SortableLead, sortBy: string): number {
  let primary = 0
  switch (sortBy) {
    case "score_desc": primary = b.score - a.score; break
    case "score_asc": primary = a.score - b.score; break
    case "name_asc": primary = a.contactName.localeCompare(b.contactName); break
    case "name_desc": primary = b.contactName.localeCompare(a.contactName); break
    case "company_asc": primary = (a.companyName || "").localeCompare(b.companyName || ""); break
    case "company_desc": primary = (b.companyName || "").localeCompare(a.companyName || ""); break
    case "conversion_desc": primary = conversionProbability(b) - conversionProbability(a); break
    case "conversion_asc": primary = conversionProbability(a) - conversionProbability(b); break
    case "source_asc": primary = (a.source || "").localeCompare(b.source || ""); break
    case "source_desc": primary = (b.source || "").localeCompare(a.source || ""); break
    case "status_asc": primary = a.status.localeCompare(b.status); break
    case "status_desc": primary = b.status.localeCompare(a.status); break
    case "oldest": return compareOldest(a, b)
    case "newest": return compareNewest(a, b)
    default: return compareNewest(a, b)
  }
  return primary || compareNewest(a, b)
}
