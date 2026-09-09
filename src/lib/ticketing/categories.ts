export const LEGACY_TICKET_CATEGORY_SLUGS = [
  "general",
  "technical",
  "billing",
  "feature_request",
  "complaint",
] as const

export const AI_TICKET_CATEGORY_SLUGS = [
  "general",
  "technical",
  "billing",
  "feature_request",
] as const

export const TICKET_CATEGORY_SCOPES = ["ticket", "complaint", "both"] as const
export const TICKET_PRIORITY_LEVELS = ["low", "medium", "high", "critical"] as const

export type LegacyTicketCategorySlug = (typeof LEGACY_TICKET_CATEGORY_SLUGS)[number]
export type AiTicketCategorySlug = (typeof AI_TICKET_CATEGORY_SLUGS)[number]
export type TicketCategoryScope = (typeof TICKET_CATEGORY_SCOPES)[number]
export type TicketPriorityLevel = (typeof TICKET_PRIORITY_LEVELS)[number]

export interface DefaultTicketCategorySeed {
  slug: LegacyTicketCategorySlug
  name: string
  scope: TicketCategoryScope
  defaultPriority: TicketPriorityLevel
  isPortalVisible: boolean
  sortOrder: number
}

export const DEFAULT_TICKET_CATEGORIES: readonly DefaultTicketCategorySeed[] = [
  { slug: "general", name: "General", scope: "ticket", defaultPriority: "medium", isPortalVisible: true, sortOrder: 10 },
  { slug: "technical", name: "Technical", scope: "ticket", defaultPriority: "medium", isPortalVisible: true, sortOrder: 20 },
  { slug: "billing", name: "Billing", scope: "ticket", defaultPriority: "medium", isPortalVisible: true, sortOrder: 30 },
  { slug: "feature_request", name: "Feature Request", scope: "ticket", defaultPriority: "low", isPortalVisible: true, sortOrder: 40 },
  { slug: "complaint", name: "Complaint", scope: "complaint", defaultPriority: "high", isPortalVisible: true, sortOrder: 50 },
]

const LEGACY_CATEGORY_SET = new Set<string>(LEGACY_TICKET_CATEGORY_SLUGS)
const AI_CATEGORY_SET = new Set<string>(AI_TICKET_CATEGORY_SLUGS)

export function normalizeTicketCategorySlug(category?: string | null): string {
  const normalized = (category || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
  return normalized || "general"
}

export function normalizeLegacyTicketCategory(category?: string | null): LegacyTicketCategorySlug {
  const slug = normalizeTicketCategorySlug(category)
  return (LEGACY_CATEGORY_SET.has(slug) ? slug : "general") as LegacyTicketCategorySlug
}

export function normalizeAiTicketCategory(category?: string | null): AiTicketCategorySlug {
  const slug = normalizeTicketCategorySlug(category)
  return (AI_CATEGORY_SET.has(slug) ? slug : "general") as AiTicketCategorySlug
}

export function inferTicketCategoryScope(category?: string | null): TicketCategoryScope {
  return normalizeTicketCategorySlug(category) === "complaint" ? "complaint" : "ticket"
}
