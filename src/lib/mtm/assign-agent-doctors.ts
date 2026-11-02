/** The assignment API takes at most this many doctors in one call. */
export const ASSIGNMENT_BATCH = 500

export type AgentDoctorChanges = {
  /** Ticked, not the agent's yet: attached. */
  add: string[]
  /** The agent's, unticked: this agent alone is detached; other employees stay. */
  remove: string[]
}

export type AgentDoctorResult = { added: number; removed: number; left: number }

/**
 * Applies what the agent's client picker leaves — on the agent's card or on
 * his own page — by the same preview → apply as «Клиенты → Закрепить /
 * Открепить» (checked, journalled). A doctor who has an employee keeps him
 * and gets this one as a second; taking a doctor off detaches this agent only
 * (owner, 2026-10-16: «нет возможности снимать галочки»). What the server
 * leaves out — an open visit, a planned route — is counted in `left`.
 * Throws when a call fails; what was applied before stays.
 */
export async function changeAgentDoctors(agentId: string, changes: AgentDoctorChanges, effectiveFrom: string, reason: string, orgId?: string): Promise<AgentDoctorResult> {
  const headers = { "Content-Type": "application/json", Accept: "application/json", ...(orgId ? { "x-organization-id": orgId } : {}) }
  const result: AgentDoctorResult = { added: 0, removed: 0, left: 0 }
  const runs = [
    { ids: changes.add, body: { mode: "ASSIGN", targetAgentId: agentId }, count: "added" as const },
    { ids: changes.remove, body: { mode: "UNASSIGN", targetAgentId: null, sourceAgentId: agentId }, count: "removed" as const },
  ]
  for (const run of runs) {
    for (let start = 0; start < run.ids.length; start += ASSIGNMENT_BATCH) {
      const batch = { contactIds: run.ids.slice(start, start + ASSIGNMENT_BATCH), ...run.body, effectiveFrom, reason }
      const previewResponse = await fetch("/api/v1/mtm/contact-assignments/preview", { method: "POST", headers, body: JSON.stringify(batch) })
      const preview = await previewResponse.json().catch(() => null) as { success?: boolean; data?: { previewToken: string; summary: { assignable: number } } } | null
      if (!previewResponse.ok || !preview?.success || !preview.data) throw new Error("preview")
      if (preview.data.summary.assignable === 0) { result.left += batch.contactIds.length; continue }
      const applyResponse = await fetch("/api/v1/mtm/contact-assignments", {
        method: "POST",
        headers,
        body: JSON.stringify({ ...batch, previewToken: preview.data.previewToken, idempotencyKey: crypto.randomUUID() }),
      })
      const applied = await applyResponse.json().catch(() => null) as { success?: boolean; data?: { summary: { changed: number }; excluded: unknown[] } } | null
      if (!applyResponse.ok || !applied?.success || !applied.data) throw new Error("apply")
      result[run.count] += applied.data.summary.changed
      result.left += applied.data.excluded.length
    }
  }
  return result
}
