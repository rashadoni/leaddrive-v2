/**
 * Notification taxonomy helpers — pure functions, no DB, no React.
 *
 * Bridges the entityType strings produced by createNotification() to the
 * nav-items section vocabulary (NAV_GROUP_ORDER) so the preferences system
 * and the access gate can work in terms of the 13 nav sections rather than
 * raw entityType strings.
 */
import { LEGACY_MODULE_MAP } from "@/lib/modules"
import { navItems, NAV_GROUP_ORDER } from "@/lib/nav-items"

// ---------------------------------------------------------------------------
// ENTITY_TO_MODULE
// ---------------------------------------------------------------------------

/**
 * Maps each notification entityType produced by createNotification() to the
 * corresponding navItem module. Every value MUST exist as a `module` field in
 * navItems — verified in unit tests.
 *
 * Notes on non-obvious mappings:
 * - "task"           → "tasks"       (navItem module, not "boards" — tasks module covers boards)
 * - "company"        → "core"        (companies nav items use module "core")
 * - "contact"        → "core"        (contacts nav items use module "core")
 * - "campaign"       → "campaigns"
 * - "invoice"        → "invoices"
 * - "social_mention" → "social"      (Social Monitoring group — own module since the 2026-08-01 split)
 * - "briefing"       → "ai"          (AI daily briefing — gated by ai module)
 * - "budget_plan"    → "budgeting"   (Budget plan notifications — gated by budgeting module)
 * - "quote"          → "quotes"      (CPQ quotes — Sales group, gated by sales module)
 * - "complaint"      → "tickets"     (Complaint register lives under tickets module, Support group)
 * - "inbox_message"  → "omnichannel" (Inbound inbox messages — Communication group)
 * - "order"          → "mtm"         (MTM field orders — gated by mtm module, Route & Field group)
 * - "survey"         → "campaigns"   (Surveys — gated by campaigns module, Marketing group)
 * - "loyalty"        → "loyalty"     (Loyalty accounts — gated by loyalty module, Loyalty Program group)
 */
// Values are LEGACY fine-grained ids ON PURPOSE (typed `string`, not ModuleId —
// the group catalog narrowed ModuleId, but this map deliberately keeps the
// legacy vocabulary; see the moduleToSection comment below).
export const ENTITY_TO_MODULE: Record<string, string> = {
  task:           "tasks",
  deal:           "deals",       // → sales group (LEGACY_MODULE_MAP deals→sales)
  lead:           "leads",       // → sales group (LEGACY_MODULE_MAP leads→sales)
  contact:        "core",
  company:        "core",
  ticket:         "tickets",
  contract:       "contracts",
  campaign:       "campaigns",
  invoice:        "invoices",
  quote:          "quotes",      // CPQ quote — gated by sales module (Sales group)
  // Phase 2+ emitters — added here so the read-gate allowlist covers them
  social_mention: "social",      // Social Monitoring nav items use module "social" (own group)
  briefing:       "ai",          // AI daily briefing uses module "ai"
  budget_plan:    "budgeting",   // Budget plan approval uses module "budgeting"
  // Phase 2b — Support + Communication emitters
  complaint:      "tickets",     // Complaint register — gated by tickets module (Support group)
  inbox_message:  "omnichannel", // Inbound inbox message — gated by omnichannel module (Communication group)
  // Phase 2c — Route & Field + Marketing/Loyalty emitters
  order:          "mtm",         // MTM field order — gated by mtm module (Route & Field group)
  survey:         "campaigns",   // Survey response — gated by campaigns module (Marketing group)
  loyalty:        "loyalty",     // Loyalty tier/redeem — gated by loyalty module (Loyalty Program group)
  // Phase 2d — Industry Cloud emitters (one notable gated kind per vertical)
  health_patient: "health",      // Health Cloud patient record — gated by health module
  claim:          "insurance",   // Insurance Cloud claim — gated by insurance module
  ps_case:        "public-sector", // Public Sector Cloud case — gated by public-sector module
  media_subscriber: "media",    // Media Cloud subscriber — gated by media module
  outage:         "energy",      // Energy & Utilities outage — gated by energy module
}

// ---------------------------------------------------------------------------
// moduleToSection
// ---------------------------------------------------------------------------

/**
 * Returns the nav group (section) for the first navItem whose module matches,
 * or null if no navItem uses that module.
 *
 * MC-T4 nav re-tag: navItems now carry GROUP module ids (1 группа = 1 модуль),
 * while ENTITY_TO_MODULE deliberately keeps the LEGACY vocabulary — its ids
 * feed canNotifyEntityType's hasModule/roleCanRead delivery gate, and
 * re-pointing them to group ids would coarsen per-entity granularity (e.g.
 * support+`campaign` must stay blocked via campaigns:[] even though support
 * reads the Marketing GROUP via events:read). So for SECTION derivation we
 * translate legacy → group through LEGACY_MODULE_MAP (identity for group ids),
 * and resolve the cross-cutting addon flags ("ai"/"voip" — no group of their
 * own) to the group of the first nav item carrying that `addon`, which matches
 * the pre-re-tag sections exactly (ai → /ai/actions → Communication, voip →
 * /support/voip → Support). The narrow-union task (MC-T12) KEPT this shim —
 * ENTITY_TO_MODULE stays on legacy vocabulary for delivery-gate granularity,
 * so the legacy→group translation here remains load-bearing.
 */
// Cross-cutting addon flags ("ai") have no group of their own and their nav
// items now span MULTIPLE groups (e.g. /ai/actions + /ai-command-center under
// Analytics, /inbox/ai-agent under Communication). Pin the notification SECTION
// here so it stays stable when an individual addon item is moved between groups
// (e.g. AI Actions → Analytics, 2026-06-21) — otherwise moduleToSection would
// resolve the addon to whichever addon item happens to sort first in navItems.
const ADDON_SECTION: Record<string, string> = {
  ai: "Communication",
  voip: "VoIP",
}

export function moduleToSection(moduleId: string): string | null {
  const groupId: string = LEGACY_MODULE_MAP[moduleId] ?? moduleId
  const item = navItems.find((i) => i.module === groupId)
  if (item) return item.group
  if (ADDON_SECTION[moduleId]) return ADDON_SECTION[moduleId]
  const addonItem = navItems.find((i) => i.addon === moduleId)
  return addonItem?.group ?? null
}

// ---------------------------------------------------------------------------
// deriveSection
// ---------------------------------------------------------------------------

/**
 * Derives the section (NAV_GROUP_ORDER member) for a raw entityType string.
 * Unknown entityType → null.
 */
export function deriveSection(entityType: string): string | null {
  if (!entityType) return null
  const moduleId = ENTITY_TO_MODULE[entityType]
  if (!moduleId) return null
  return moduleToSection(moduleId)
}

// ---------------------------------------------------------------------------
// NOTIFICATION_KINDS
// ---------------------------------------------------------------------------

export interface NotificationKind {
  kind: string
  section: string
  entityType: string
}

/**
 * Catalog of current (Phase 1) notification event kinds.
 * section is derived from entityType via deriveSection() — any new kind
 * automatically picks up the right section as long as its entityType is in
 * ENTITY_TO_MODULE and its module is in navItems.
 */
export const NOTIFICATION_KINDS: NotificationKind[] = (
  [
    { kind: "task.created",     entityType: "task" },
    { kind: "task.completed",   entityType: "task" },
    { kind: "deal.created",     entityType: "deal" },
    { kind: "deal.won",         entityType: "deal" },
    { kind: "deal.lost",        entityType: "deal" },
    { kind: "deal.stage",       entityType: "deal" },
    { kind: "lead.created",     entityType: "lead" },
    { kind: "lead.converted",   entityType: "lead" },
    { kind: "lead.status",      entityType: "lead" },
    { kind: "contact.created",  entityType: "contact" },
    { kind: "company.created",  entityType: "company" },
    { kind: "ticket.created",   entityType: "ticket" },
    { kind: "ticket.comment",   entityType: "ticket" },
    { kind: "campaign.sent",    entityType: "campaign" },
    // CLM — Contract lifecycle events (Contracts Control section, gated by contracts module)
    { kind: "contract.approval_requested", entityType: "contract" },
    { kind: "contract.approved",           entityType: "contract" },
    { kind: "contract.signed",             entityType: "contract" },
    { kind: "contract.declined",           entityType: "contract" },
    { kind: "contract.renewal_due",        entityType: "contract" },
    // Phase 2a — CPQ quote transitions (Sales section, gated by sales module)
    { kind: "quote.sent",       entityType: "quote" },
    { kind: "quote.accepted",   entityType: "quote" },
    { kind: "quote.rejected",   entityType: "quote" },
    // Phase 2a — Finance invoice events (Finance section, gated by invoices module)
    { kind: "invoice.paid",        entityType: "invoice" },
    { kind: "invoice.overdue",     entityType: "invoice" },
    // Phase 2b — Support: new complaint (Support section, gated by tickets module)
    { kind: "complaint.created",   entityType: "complaint" },
    // Phase 2b — Communication: inbound inbox message with assigned agent (Communication section)
    { kind: "inbox.message",       entityType: "inbox_message" },
    { kind: "inbox.note",          entityType: "inbox_message" }, // internal collaborator note — same omnichannel gate + Inbox badge as a message
    // Phase 2c — Route & Field: MTM field order lifecycle (gated by mtm module)
    { kind: "order.created",       entityType: "order" },
    { kind: "order.shipped",       entityType: "order" },
    { kind: "order.returned",      entityType: "order" },
    // Phase 2c — Marketing: survey response (gated by campaigns module)
    { kind: "survey.response",     entityType: "survey" },
    // Phase 2c — Loyalty Program: notable low-volume loyalty events only (NOT per-earn spam)
    { kind: "loyalty.tier_changed", entityType: "loyalty" },
    { kind: "loyalty.redeemed",     entityType: "loyalty" },
    // Phase 2d — Industry Clouds: one notable gated kind per vertical, org-wide in-app only
    { kind: "health_patient.created",  entityType: "health_patient" },   // Health Cloud
    { kind: "claim.filed",             entityType: "claim" },            // Insurance Cloud (warning)
    { kind: "ps_case.created",         entityType: "ps_case" },          // Public Sector
    { kind: "subscriber.created",      entityType: "media_subscriber" }, // Media Cloud
    { kind: "outage.reported",         entityType: "outage" },           // Energy & Utilities (warning)
  ] as Array<Omit<NotificationKind, "section">>
).map((entry) => ({
  ...entry,
  section: deriveSection(entry.entityType) as string,
}))

// ---------------------------------------------------------------------------
// kindsForSection
// ---------------------------------------------------------------------------

/**
 * Returns the event kind strings for a given section.
 * Used by the expand UI to render per-type toggle rows.
 */
export function kindsForSection(section: string): string[] {
  return NOTIFICATION_KINDS.filter((k) => k.section === section).map((k) => k.kind)
}

// Re-export NAV_GROUP_ORDER so consumers only need this file.
export { NAV_GROUP_ORDER }
