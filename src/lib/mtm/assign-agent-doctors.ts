/** The assignment API takes at most this many doctors in one call. */
export const ASSIGNMENT_BATCH = 500

/**
 * Assigns doctors ticked in the agent's client picker — on the agent's card or
 * on his own page — by the same preview → apply as «Клиенты → Закрепить»
 * (checked, journalled; a doctor who has an employee keeps him and gets this
 * one as a second). Throws when a call fails; what was applied before stays.
 */
export async function assignDoctorsToAgent(agentId: string, contactIds: string[], effectiveFrom: string, reason: string, orgId?: string) {
  const headers = { "Content-Type": "application/json", Accept: "application/json", ...(orgId ? { "x-organization-id": orgId } : {}) }
  let changed = 0
  let left = 0
  for (let start = 0; start < contactIds.length; start += ASSIGNMENT_BATCH) {
    const batch = { contactIds: contactIds.slice(start, start + ASSIGNMENT_BATCH), mode: "ASSIGN", targetAgentId: agentId, effectiveFrom, reason }
    const previewResponse = await fetch("/api/v1/mtm/contact-assignments/preview", { method: "POST", headers, body: JSON.stringify(batch) })
    const preview = await previewResponse.json().catch(() => null) as { success?: boolean; data?: { previewToken: string; summary: { assignable: number } } } | null
    if (!previewResponse.ok || !preview?.success || !preview.data) throw new Error("preview")
    if (preview.data.summary.assignable === 0) { left += batch.contactIds.length; continue }
    const applyResponse = await fetch("/api/v1/mtm/contact-assignments", {
      method: "POST",
      headers,
      body: JSON.stringify({ ...batch, previewToken: preview.data.previewToken, idempotencyKey: crypto.randomUUID() }),
    })
    const applied = await applyResponse.json().catch(() => null) as { success?: boolean; data?: { summary: { changed: number }; excluded: unknown[] } } | null
    if (!applyResponse.ok || !applied?.success || !applied.data) throw new Error("apply")
    changed += applied.data.summary.changed
    left += applied.data.excluded.length
  }
  return { changed, left }
}
