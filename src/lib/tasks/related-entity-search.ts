/**
 * Shared search helpers for a task's related entity (company/contact/deal/
 * lead/ticket). Extracted from task-form.tsx so the task DETAIL view's inline
 * related-entity picker reuses the exact same endpoint + result-parsing logic
 * (no drift between the create-form picker and the inline editor).
 */

export const RELATED_ENTITY_VALUES = ["company", "contact", "deal", "lead", "ticket"] as const
export type RelatedEntityType = (typeof RELATED_ENTITY_VALUES)[number]

/** Per-type list endpoint with a `search` query (limit 10). */
export function getRelatedSearchEndpoint(type: string, query: string): string {
  const q = encodeURIComponent(query)
  switch (type) {
    case "company": return `/api/v1/companies?search=${q}&limit=10`
    case "contact": return `/api/v1/contacts?search=${q}&limit=10`
    case "deal": return `/api/v1/deals?search=${q}&limit=10`
    case "lead": return `/api/v1/leads?search=${q}&limit=10`
    case "ticket": return `/api/v1/tickets?search=${q}&limit=10`
    default: return ""
  }
}

/** Normalise each entity type's list payload into a flat {id,name} list. */
export function parseRelatedResults(type: string, data: any): { id: string; name: string }[] {
  if (!data) return []
  const list = Array.isArray(data) ? data : data.companies || data.contacts || data.deals || data.leads || data.tickets || []
  return list.slice(0, 10).map((item: any) => ({
    id: item.id,
    name: type === "contact"
      ? item.fullName || item.name || item.id
      : type === "lead"
        ? item.contactName || item.companyName || item.id
        : type === "ticket"
          ? item.subject || item.title || item.id
          : item.name || item.id,
  }))
}
