import { VOICE_SECTION_KEYS } from "./sections"
import type { ModuleId } from "@/lib/modules"
import type { Module } from "@/lib/permissions"

/**
 * What the voice assistant can SAY about each section.
 *
 * Why this file exists — the failure it replaces:
 *
 * The first version had seventeen hand-written read tools, one per entity I
 * happened to think of. Coverage equalled my memory. The owner found the holes
 * by asking: leads, quotes, boards, per-person breakdowns — each time the
 * answer was "there is no tool for that", and each time I patched that one
 * hole. He was doing my QA, and said so.
 *
 * The same mistake had already been made and fixed once in this codebase, for
 * navigation: destinations used to be a hand-written list (which shipped with
 * `leads` missing), and the fix was to DERIVE them from the menu. That fix is
 * why a new page in the sidebar is reachable by voice automatically.
 *
 * This file applies that lesson to reading. A section is described by WHICH
 * MODEL holds its rows and WHICH FIELDS carry meaning — status, owner, date,
 * money. One generic reader then answers for every described section, so the
 * question "does it know about X?" stops depending on what I remembered.
 *
 * Every section in the menu must appear here or in NO_DATA_SECTIONS. A test
 * enforces that, so a new section fails CI instead of failing in a
 * conversation. That test — not my attention — is the thing that catches gaps.
 */

export type SectionDescriptor = {
  /** Prisma model name (client property, camelCase). */
  model: string
  /** Paid-module gate; the reader re-checks it per call. */
  module: ModuleId
  /**
   * Permission module for the role matrix — a different axis from `module`.
   *
   * `module` answers "did the organisation pay for this". This answers "may
   * this ROLE read it". They are not the same question and the assistant was
   * only asking the first: a salesperson could hear finance figures by voice
   * that the screen would not show them, because the org owns the finance
   * module. Voice must not be a way around the matrix.
   */
  permission: Module
  /** Column holding workflow state, when the entity has one. */
  statusField?: string
  /** Statuses that mean "finished" — excluded from open counts. */
  closedStatuses?: string[]
  /** Column holding the responsible user id. */
  assigneeField?: string
  /** Column that makes a row late once it is in the past. */
  dueField?: string
  /** Column used for "created in period" questions. */
  createdField?: string
  /** Money column and its currency column; both or neither. */
  amountField?: string
  currencyField?: string
  /** Immutable discriminator shared by every aggregate for this surface. */
  baseWhere?: Record<string, unknown>
}

/**
 * Sections whose numbers a generic reader can state truthfully.
 *
 * Deliberately NOT here (they keep their hand-written tools) — each one needs a
 * judgement a uniform aggregate cannot express, and the reasons are recorded at
 * each site in summaries.ts:
 *   deals      — currencies must not be summed; won/lost must not count as "in
 *                the funnel"; stage labels come from the tenant's own config
 *   forecast   — three separate figures, never one blended number
 *   campaigns  — counts, never rates: open counters include proxy fetches
 *   briefing   — a snapshot whose age must be spoken with it
 */
export const SECTION_DESCRIPTORS: Record<string, SectionDescriptor> = {
  leads: {
    model: "lead",
    permission: "leads", module: "crm",
    statusField: "status",
    closedStatuses: ["converted", "lost"],
    assigneeField: "assignedTo",
    createdField: "createdAt",
  },
  // Deals are described AND keep their bespoke funnel tool. The two answer
  // different questions and neither can cover the other:
  //   get_pipeline_by_stage — what is in the funnel NOW, with the judgements a
  //     uniform aggregate cannot make (currencies not summed, won and lost
  //     excluded from "in the funnel", stage labels from the tenant's config);
  //   describe_section("deals", period) — how many were CREATED in a window,
  //     which the funnel tool structurally cannot answer because a stage is a
  //     state, not an event.
  //
  // The owner asked "how much did we sell in July" and got current state. Note
  // what this does and does not fix: created-in-July is answerable from
  // createdAt, which every row has. WON-in-July is not, and this does not
  // pretend otherwise — 31 of 36 won deals in production were created already
  // won by a seed script and were never moved, so no date exists to read.
  deals: {
    model: "deal",
    permission: "deals", module: "crm",
    statusField: "stage",
    assigneeField: "assignedTo",
    dueField: "expectedClose",
    createdField: "createdAt",
    amountField: "valueAmount",
    currencyField: "currency",
  },
  contacts: { model: "contact", permission: "contacts", module: "crm", createdField: "createdAt" },
  companies: { model: "company", permission: "companies", module: "crm", createdField: "createdAt" },
  projects: { model: "project", permission: "projects", module: "crm", statusField: "status", createdField: "createdAt" },
  products: { model: "product", permission: "companies", module: "crm", createdField: "createdAt" },
  boards: {
    model: "task",
    permission: "tasks", module: "crm",
    statusField: "status",
    // The column still mixes legacy values with Kanban ones — the schema says
    // so outright — so completion is matched on both spellings.
    closedStatuses: ["done", "completed", "cancelled"],
    assigneeField: "assignedTo",
    dueField: "dueDate",
    createdField: "createdAt",
  },
  quotes: {
    model: "quote",
    permission: "offers", module: "sales",
    statusField: "status",
    closedStatuses: ["accepted", "rejected", "expired"],
    // validUntil, not status: nothing flips a stored status when a date passes.
    dueField: "validUntil",
    createdField: "createdAt",
    amountField: "totalAmount",
    currencyField: "currency",
  },
  invoices: {
    model: "invoice",
    permission: "invoices", module: "finance",
    statusField: "status",
    closedStatuses: ["paid", "cancelled", "refunded"],
    dueField: "dueDate",
    createdField: "createdAt",
    amountField: "totalAmount",
    currencyField: "currency",
  },
  tickets: {
    model: "ticket",
    permission: "tickets", module: "support",
    statusField: "status",
    closedStatuses: ["closed", "resolved"],
    assigneeField: "assignedTo",
    createdField: "createdAt",
  },
  complaints: {
    // Complaints are Ticket rows with a required one-to-one ComplaintMeta.
    model: "ticket",
    permission: "tickets", module: "support",
    statusField: "status",
    closedStatuses: ["closed", "resolved"],
    assigneeField: "assignedTo",
    createdField: "createdAt",
    baseWhere: { complaintMeta: { isNot: null } },
  },
  contracts: {
    model: "contract",
    permission: "contracts", module: "contracts",
    statusField: "status",
    createdField: "createdAt",
  },
  segments: { model: "contactSegment", permission: "segments", module: "marketing", createdField: "createdAt" },
  journeys: { model: "journey", permission: "journeys", module: "marketing", statusField: "status", createdField: "createdAt" },
  events: { model: "event", permission: "events", module: "marketing", statusField: "status", createdField: "createdAt" },
  inbox: {
    model: "socialConversation",
    permission: "inbox", module: "omnichannel",
    statusField: "status",
    closedStatuses: ["closed", "resolved"],
    assigneeField: "assignedTo",
    createdField: "createdAt",
  },
  mtm_visits: {
    model: "mtmVisit",
    permission: "tpm", module: "mtm",
    statusField: "status",
    assigneeField: "agentId",
    createdField: "createdAt",
  },
  mtm_routes: { model: "mtmRoute", permission: "tpm", module: "mtm", statusField: "status", createdField: "createdAt" },
  mtm_tasks: {
    model: "mtmTask",
    permission: "tpm", module: "mtm",
    statusField: "status",
    assigneeField: "agentId",
    dueField: "dueDate",
    createdField: "createdAt",
  },
  mtm_customers: { model: "mtmCustomer", permission: "tpm", module: "mtm", createdField: "createdAt" },
}

/**
 * Sections a generic reader must NOT try to summarise, with the reason.
 *
 * Being explicit matters: an unclassified section is a gap, and the test cannot
 * tell a gap from a deliberate omission unless the omission is written down.
 *
 *  - "surface"  — a page that renders other sections' data (dashboards,
 *                 analytics, report builders). Counting its rows means nothing.
 *  - "config"   — tenant configuration living outside the Settings group
 *                 (rules, templates, tiers). Not something to report on.
 *  - "bespoke"  — has a hand-written tool BECAUSE the honest number needs
 *                 judgement; see the note above SECTION_DESCRIPTORS.
 *  - "pending"  — a real data surface not yet described. This is the only
 *                 value that represents unfinished work, and it is countable.
 */
export const NO_DATA_SECTIONS: Record<string, "surface" | "config" | "bespoke" | "pending"> = {
  dashboard: "surface",
  notifications: "surface",
  reports: "surface",
  reports_builder: "surface",
  "ai_actions": "surface",
  "ai-command-center": "surface",
  leaderboard: "surface",
  inbox_analytics: "surface",
  "cdp_insights": "surface",
  "cdp_merge-queue": "surface",
  attribution_models: "surface",
  profitability: "surface",
  finance: "surface",
  pricing: "surface",
  mtm: "surface",
  mtm_map: "surface",
  mtm_analytics: "surface",
  mtm_leaderboard: "surface",
  mtm_reports: "surface",
  mtm_activity: "surface",
  mtm_operations: "surface",
  mtm_settings: "config",
  social_monitoring_overview: "surface",
  social_monitoring_monitors: "surface",
  social_monitoring_mentions: "surface",
  social_monitoring_replies: "surface",
  social_monitoring_sources: "surface",
  social_monitoring_scenarios: "config",
  social_monitoring_subjects: "config",
  social_monitoring_media: "surface",
  social_monitoring_reports: "surface",
  social_monitoring_agent: "surface",
  social_monitoring_legal: "surface",
  voip_insights: "surface",
  support_voip: "surface",
  inbox_voip: "surface",
  support_calendar: "surface",
  "knowledge-base": "config",
  "email-templates": "config",
  "email-log": "surface",
  "ai-scoring": "config",
  surveys: "surface",
  accounts_engagement: "surface",
  loyalty_builder: "config",
  loyalty_dashboard: "surface",
  loyalty_tiers: "config",
  "loyalty_earn-rules": "config",
  "loyalty_promo-codes": "config",
  inbox_automation: "config",
  "inbox_business-hours": "config",
  "inbox_ai-agent": "config",
  contracts_lifecycle: "surface",
  contracts_templates: "config",
  contracts_request: "config",
  contracts_milestones: "pending",
  contracts_analytics: "surface",
  forecast: "bespoke",
  forecast_snapshots: "surface",
  forecast_waterfall: "surface",
  forecast_velocity: "surface",
  campaigns: "bespoke",
  sequences: "pending",
  mtm_promotions: "pending",
  mtm_photos: "pending",
  mtm_alerts: "pending",
  mtm_agents: "pending",
  mtm_contacts: "pending",
  settings_pipelines: "config",
  settings_quotas: "config",
  "settings_sales-forecast": "config",
  settings_territories: "config",
  "settings_lead-rules": "config",
  "settings_web-to-lead": "config",
  "settings_intake-forms": "config",
  "settings_approval-rules": "config",
  "settings_approval-delegates": "config",
  settings_snippets: "config",
  "inbox_chatbot-rules": "config",
  settings_channels: "config",
  "settings_ticket-categories": "config",
  "settings_sla-policies": "config",
  "settings_entitlement-templates": "config",
  "support_skill-routing": "config",
  settings_escalation: "config",
  settings_macros: "config",
  "settings_portal-users": "config",
  "support_ai-settings": "config",
  "settings_task-templates": "config",
  "settings_invoice-settings": "config",
  "settings_finance-notifications": "config",
  "settings_web-chat": "config",
  "campaign-roi": "surface",
  "support_agent-desktop": "surface",
  health: "pending",
  health_encounters: "pending",
  "health_care-plans": "pending",
  health_providers: "pending",
  insurance: "pending",
  insurance_policies: "pending",
  insurance_claims: "pending",
  insurance_beneficiaries: "pending",
  "public-sector": "pending",
  "public-sector_cases": "pending",
  "public-sector_licenses": "pending",
  "public-sector_grants": "pending",
  media: "pending",
  media_content: "pending",
  "media_ad-campaigns": "pending",
  energy: "pending",
  energy_metering: "pending",
  energy_outages: "pending",
  "energy_service-calls": "pending",
  support_entitlements: "pending",
  // Workforce has truthful navigation guides, but its three server-computed
  // views do not map to one Prisma model. Keep voice aggregates pending until
  // a dedicated, capability-aware reader exists instead of inventing totals.
  workforce: "pending",
  workforce_timesheet: "pending",
  workforce_requests: "pending",
  // This is an administrator-only definition surface, not an aggregate over a
  // business record. Keep it explicitly classified until a separately scoped
  // configuration reader is useful to the voice assistant.
  workforce_configuration: "config",
}

/** Sections in the menu that nothing has classified yet — the test's subject. */
export function unclassifiedSections(): string[] {
  return VOICE_SECTION_KEYS.filter(
    (k) => !(k in SECTION_DESCRIPTORS) && !(k in NO_DATA_SECTIONS),
  )
}

/** Real data surfaces still waiting for a descriptor. Should trend to zero. */
export function pendingSections(): string[] {
  return Object.entries(NO_DATA_SECTIONS)
    .filter(([, why]) => why === "pending")
    .map(([k]) => k)
}


/**
 * Filtered navigation is NOT available, and that is a finding, not an omission.
 *
 * The first attempt shipped a table of query strings — overdue=1,
 * assignedTo=none and so on — written from what such parameters usually look
 * like. None of them exist: leads reads category/search/source, invoices reads
 * dealId, and tickets, quotes, inbox and boards read no query parameters at
 * all. Every entry would have opened an unfiltered page while the agent
 * announced a filtered one, which is worse than not opening anything, because
 * the screen then contradicts the sentence with the authority of being real.
 *
 * Restoring this means adding the parameters to the list pages first. Until
 * then the navigation tool says plainly that it cannot narrow the view.
 */
export const SECTION_FILTERS: Record<string, Partial<Record<"overdue" | "unassigned" | "open", string>>> = {}
