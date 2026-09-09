// ═══════════════════════════════════════════════════════════
// Centralized constants for LeadDrive CRM v2
// ═══════════════════════════════════════════════════════════

// ── Currency ──────────────────────────────────────────────
// Re-export the isolated currency boundary for existing authenticated imports.
// Public UI primitives must import `cn` from utils.ts without pulling this
// module's authorization and internal role constants into their client graph.
export {
  DEFAULT_CURRENCY,
  CURRENCY_SYMBOLS,
  getCurrencySymbol,
  INITIAL_CURRENCIES,
} from "@/lib/currency"

// ── Pipeline Stages ──────────────────────────────────────
export const DEFAULT_PIPELINE_STAGES = [
  { name: "LEAD", displayName: "Lead", color: "#6366f1", probability: 10, sortOrder: 1 },
  { name: "QUALIFIED", displayName: "Qualified", color: "#3b82f6", probability: 25, sortOrder: 2 },
  { name: "PROPOSAL", displayName: "Proposal", color: "#f59e0b", probability: 50, sortOrder: 3 },
  { name: "NEGOTIATION", displayName: "Negotiation", color: "#f97316", probability: 75, sortOrder: 4 },
  { name: "WON", displayName: "Won", color: "#22c55e", probability: 100, sortOrder: 5, isWon: true },
  { name: "LOST", displayName: "Lost", color: "#ef4444", probability: 0, sortOrder: 6, isLost: true },
] as const

// ── Task types (Bordio-style configurable "Task types") ──
// Seeded per-org at provisioning + by the add_task_types migration for existing
// orgs. Task.type is validated against the org's active task_types.name; this is
// ALSO the fallback list when an org has none yet (colors mirror board-reports).
export const DEFAULT_TASK_TYPES = [
  { name: "task", displayName: "Task", color: "#EA580C", sortOrder: 0 },
  { name: "bug", displayName: "Bug", color: "#DE350B", sortOrder: 1 },
  { name: "feature", displayName: "Feature", color: "#00B8D9", sortOrder: 2 },
  { name: "story", displayName: "Story", color: "#00875A", sortOrder: 3 },
  { name: "epic", displayName: "Epic", color: "#6554C0", sortOrder: 4 },
] as const

// ── Task event types (Bordio-style "Event types" — the channel/source axis) ──
// A SECOND configurable categorization on tasks ("what the task relates to"), used
// for filtering. Seeded per-org like task types; Task.eventType validates against
// the org's event_types.name. Defaults match the client's channels.
export const DEFAULT_EVENT_TYPES = [
  { name: "914_line", displayName: "914 LINE", color: "#EAB308", sortOrder: 0 },
  { name: "mobil_operators_line", displayName: "MOBIL OPERATORS LINE", color: "#A855F7", sortOrder: 1 },
  { name: "social_media", displayName: "SOCIAL MEDIA", color: "#EC4899", sortOrder: 2 },
  { name: "vip_group_whatsapp", displayName: "VIP GROUP WHATSAPP", color: "#06B6D4", sortOrder: 3 },
] as const

// ── Pipeline Stage Colors (for charts/visualizations) ────
export const STAGE_COLORS: Record<string, string> = {
  LEAD: "#6366f1",
  QUALIFIED: "#3b82f6",
  PROPOSAL: "#f59e0b",
  NEGOTIATION: "#f97316",
  WON: "#22c55e",
  LOST: "#ef4444",
}

// ── Contact Info ─────────────────────────────────────────
export const COMPANY_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL || "info@leaddrivecrm.org"

// ── Legal identity ────────────────────────────────────────
// Finding F-11 (docs/isms/ISMS-02-gap-analysis.md). The privacy policy named
// "LeadDrive Inc." — a company that does not exist — and three legal pages each
// carried their own hardcoded copy of "LeadDrive Inc., Warsaw, Poland". Fixing
// the policy text alone left the page contradicting itself in its own contact
// block, which is exactly what three copies of a fact are for.
//
// This is not branding. It is the identity of the data controller: the party a
// data subject exercises rights against and a regulator writes to. It must
// match the entity that actually processes the data, in the country where it
// actually operates.
export const COMPANY_LEGAL_NAME = "Fanumsec MMC"
export const COMPANY_LEGAL_ADDRESS = "Baku, Azerbaijan"
export const COMPANY_LEGAL_LOCALITY = "Baku"
export const COMPANY_LEGAL_COUNTRY_CODE = "AZ"
export const NOREPLY_EMAIL = process.env.EMAIL_FROM_ADDRESS || process.env.NOREPLY_EMAIL || "noreply@leaddrivecrm.org"
export const EMAIL_FROM_ADDRESS = process.env.EMAIL_FROM_ADDRESS || NOREPLY_EMAIL
export const EMAIL_FROM_NAME_FALLBACK = process.env.EMAIL_FROM_NAME_FALLBACK || "LeadDrive CRM"
export const EMAIL_REPLY_DOMAIN = process.env.EMAIL_REPLY_DOMAIN || "leaddrivecrm.org"
export const COMPANY_PHONE = ""
export const COMPANY_PHONE_FORMATTED = ""

// ── Roles ────────────────────────────────────────────────
export const ROLES = {
  SUPERADMIN: "superadmin",
  ADMIN: "admin",
  MANAGER: "manager",
  SALES: "sales",
  SUPPORT: "support",
  VIEWER: "viewer",
  MARKETING: "marketing",
  FINANCE: "finance",
  HR: "hr",
} as const

export const ADMIN_ROLES = [ROLES.SUPERADMIN, ROLES.ADMIN] as const
export const MANAGER_ROLES = [ROLES.SUPERADMIN, ROLES.ADMIN, ROLES.MANAGER] as const

export const ALL_ROLES = Object.values(ROLES)

export function isAdmin(role: string): boolean {
  return role === ROLES.ADMIN || role === ROLES.SUPERADMIN
}

export function isManagerOrAbove(role: string): boolean {
  return role === ROLES.ADMIN || role === ROLES.SUPERADMIN || role === ROLES.MANAGER
}

// ── Pagination ───────────────────────────────────────────
export const PAGE_SIZE = {
  DEFAULT: 50,
  SEARCH: 5,
  DASHBOARD_RECENT: 10,
  DASHBOARD_TASKS: 5,
  INBOX: 500,
  EXPORT: 10000,
  AUDIT_LOG: 1000,
  PORTAL_USERS: 200,
  CALENDAR_AGENT: 300,
} as const
