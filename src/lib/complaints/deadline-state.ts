export type ComplaintDeadlineState = "none" | "upcoming" | "overdue" | "met" | "missed" | "completed_unknown"

export function complaintDeadlineState(row: {
  status: string
  slaDueAt: string | null
  resolvedAt?: string | null
  closedAt?: string | null
}, now = Date.now()): ComplaintDeadlineState {
  const due = row.slaDueAt ? Date.parse(row.slaDueAt) : NaN
  if (!Number.isFinite(due)) return "none"
  if (row.status === "resolved" || row.status === "closed") {
    // Resolution ends the SLA obligation; later administrative closure does not.
    const completed = row.resolvedAt || row.closedAt
    const at = completed ? Date.parse(completed) : NaN
    if (!Number.isFinite(at)) return "completed_unknown"
    return at > due ? "missed" : "met"
  }
  return due < now ? "overdue" : "upcoming"
}
