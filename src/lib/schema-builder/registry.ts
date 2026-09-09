/**
 * Schema Builder registry — curated view of LeadDrive's data model for the
 * read-only ER diagram (Salesforce Schema Builder analogue).
 *
 * Why a registry and not "expose all 151 Prisma models":
 *   - Most models are internal plumbing (AI logs, audit, OTP codes, queue
 *     subscriptions); rendering them in a user-facing ER diagram would be
 *     noise, not signal.
 *   - Some models contain credentials or session secrets (User passwords,
 *     portal tokens, API key hashes); a curated registry is also a
 *     security boundary against leaking field names.
 *   - Salesforce Schema Builder shows only "Objects" (standard + custom);
 *     it does NOT expose every internal table either.
 *
 * Slice 1 = read-only. Slice 2 will add: filter/search UI, "show all
 * relationships from this entity", per-org "hidden objects" overrides.
 * Slice 3 will add the inverse: declarative "add field" → schema migration.
 *
 * Part of N9 No-code Schema Builder (Phase 2 roadmap).
 */

export type EntityGroup =
  | "sales"       // Deal, Lead, Pipeline, Offer
  | "people"      // Contact, Company, User
  | "service"     // Ticket, SLA, Survey
  | "marketing"   // Campaign, Journey, Segment, LandingPage
  | "finance"     // Invoice, Contract, Product, Currency
  | "operations"  // Project, Task, Activity, MtmAgent
  | "platform"   // Workflow, Webhook, ApiKey, SavedReport

export type FieldType =
  | "id"
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "json"
  | "enum"
  | "relation_one"  // belongsTo (FK column)
  | "relation_many" // hasMany (reverse collection)

/**
 * NOTE on `currency` fields across the registry (Deal, Offer, Invoice,
 * Product): these are typed `"string"`, not `"relation_one"` to Currency.
 * That mirrors the Prisma schema, which stores currency as a denormalised
 * ISO code (e.g. "AZN", "USD") rather than a foreign key. The denormalisation
 * is intentional — invoice currency must remain stable even if a Currency
 * record is renamed or deleted (historical accuracy). The Currency entity
 * itself is included in the registry for completeness of the Finance group.
 */


export interface FieldSpec {
  /** Field name as it appears in Prisma schema. */
  name: string
  /** Display label for the diagram tooltip / detail panel. */
  label: string
  type: FieldType
  /** Whether the field is required (`!= null`). */
  required: boolean
  /** Description rendered as a tooltip in the diagram. */
  description?: string
  /** When `type === "relation_one"` or `"relation_many"`, the target entity key. */
  relatesTo?: EntityKey
  /** When `type === "enum"`, the canonical option set. */
  enumValues?: readonly string[]
}

export interface EntitySpec {
  /** Stable key — used by the API + UI for cross-references. */
  key: EntityKey
  /** Display name shown on the diagram node. */
  label: string
  /** Plural label for collections. */
  labelPlural: string
  /** Group bucket for color-coding + filter UI. */
  group: EntityGroup
  /** One-line description shown in detail panel. */
  description: string
  /** Curated visible fields. Internal/credential fields are deliberately omitted. */
  fields: FieldSpec[]
}

export type EntityKey =
  | "deal" | "lead" | "pipeline" | "offer" | "contract"
  | "contact" | "company" | "user"
  | "ticket" | "slaPolicy" | "survey"
  | "campaign" | "journey" | "segment" | "landingPage"
  | "invoice" | "product" | "currency"
  | "project" | "task" | "activity" | "mtmAgent"
  | "workflowRule" | "webhook" | "apiKey" | "savedReport"

/* ─── Sales ───────────────────────────────────────────────────────────── */

const DEAL: EntitySpec = {
  key: "deal", label: "Deal", labelPlural: "Deals", group: "sales",
  description: "Sales opportunity tracked through pipeline stages.",
  fields: [
    { name: "id", label: "ID", type: "id", required: true },
    { name: "name", label: "Name", type: "string", required: true },
    { name: "valueAmount", label: "Value", type: "number", required: true },
    { name: "currency", label: "Currency", type: "string", required: true },
    { name: "stage", label: "Stage", type: "string", required: true },
    { name: "probability", label: "Probability", type: "number", required: false },
    { name: "expectedClose", label: "Expected close", type: "date", required: false },
    { name: "stageChangedAt", label: "Stage changed at", type: "date", required: false },
    { name: "companyId", label: "Company", type: "relation_one", required: false, relatesTo: "company" },
    { name: "contactId", label: "Contact", type: "relation_one", required: false, relatesTo: "contact" },
    { name: "pipelineId", label: "Pipeline", type: "relation_one", required: false, relatesTo: "pipeline" },
    { name: "assignedTo", label: "Assigned to", type: "relation_one", required: false, relatesTo: "user" },
  ],
}

const LEAD: EntitySpec = {
  key: "lead", label: "Lead", labelPlural: "Leads", group: "sales",
  description: "Unqualified prospect awaiting conversion.",
  fields: [
    { name: "id", label: "ID", type: "id", required: true },
    { name: "contactName", label: "Contact name", type: "string", required: true },
    { name: "companyName", label: "Company name", type: "string", required: false },
    { name: "email", label: "Email", type: "string", required: false },
    { name: "phone", label: "Phone", type: "string", required: false },
    { name: "source", label: "Source", type: "string", required: false },
    { name: "status", label: "Status", type: "enum", required: true,
      enumValues: ["new", "contacted", "qualified", "converted", "lost"] as const },
    { name: "priority", label: "Priority", type: "enum", required: true,
      enumValues: ["low", "medium", "high"] as const },
    { name: "score", label: "Score", type: "number", required: false },
    { name: "estimatedValue", label: "Est. value", type: "number", required: false },
    { name: "convertedAt", label: "Converted at", type: "date", required: false },
    { name: "assignedTo", label: "Assigned to", type: "relation_one", required: false, relatesTo: "user" },
  ],
}

const PIPELINE: EntitySpec = {
  key: "pipeline", label: "Pipeline", labelPlural: "Pipelines", group: "sales",
  description: "Named stage sequence for deals (e.g. Enterprise, SMB).",
  fields: [
    { name: "id", label: "ID", type: "id", required: true },
    { name: "name", label: "Name", type: "string", required: true },
    { name: "isDefault", label: "Default", type: "boolean", required: true },
    { name: "deals", label: "Deals", type: "relation_many", required: false, relatesTo: "deal" },
  ],
}

const OFFER: EntitySpec = {
  key: "offer", label: "Offer", labelPlural: "Offers", group: "sales",
  description: "Commercial proposal with line items.",
  fields: [
    { name: "id", label: "ID", type: "id", required: true },
    { name: "number", label: "Number", type: "string", required: true },
    { name: "totalAmount", label: "Total", type: "number", required: true },
    { name: "currency", label: "Currency", type: "string", required: true },
    { name: "status", label: "Status", type: "string", required: true },
    { name: "dealId", label: "Deal", type: "relation_one", required: false, relatesTo: "deal" },
  ],
}

const CONTRACT: EntitySpec = {
  key: "contract", label: "Contract", labelPlural: "Contracts", group: "sales",
  description: "Signed agreement with terms and value.",
  fields: [
    { name: "id", label: "ID", type: "id", required: true },
    { name: "number", label: "Number", type: "string", required: true },
    { name: "valueAmount", label: "Value", type: "number", required: true },
    { name: "status", label: "Status", type: "string", required: true },
    { name: "startDate", label: "Start", type: "date", required: false },
    { name: "endDate", label: "End", type: "date", required: false },
    { name: "companyId", label: "Company", type: "relation_one", required: false, relatesTo: "company" },
    { name: "dealId", label: "Deal", type: "relation_one", required: false, relatesTo: "deal" },
  ],
}

/* ─── People ──────────────────────────────────────────────────────────── */

const CONTACT: EntitySpec = {
  key: "contact", label: "Contact", labelPlural: "Contacts", group: "people",
  description: "Person record. Portal-credential fields are intentionally hidden.",
  fields: [
    { name: "id", label: "ID", type: "id", required: true },
    { name: "fullName", label: "Full name", type: "string", required: true },
    { name: "email", label: "Email", type: "string", required: false },
    { name: "phone", label: "Phone", type: "string", required: false },
    { name: "position", label: "Position", type: "string", required: false },
    { name: "department", label: "Department", type: "string", required: false },
    { name: "source", label: "Source", type: "string", required: false },
    { name: "engagementScore", label: "Engagement", type: "number", required: false },
    { name: "isActive", label: "Active", type: "boolean", required: true },
    { name: "companyId", label: "Company", type: "relation_one", required: false, relatesTo: "company" },
  ],
}

const COMPANY: EntitySpec = {
  key: "company", label: "Company", labelPlural: "Companies", group: "people",
  description: "Account record — organization the user does business with.",
  fields: [
    { name: "id", label: "ID", type: "id", required: true },
    { name: "name", label: "Name", type: "string", required: true },
    { name: "industry", label: "Industry", type: "string", required: false },
    { name: "website", label: "Website", type: "string", required: false },
    { name: "phone", label: "Phone", type: "string", required: false },
    { name: "email", label: "Email", type: "string", required: false },
    { name: "city", label: "City", type: "string", required: false },
    { name: "country", label: "Country", type: "string", required: false },
    { name: "employeeCount", label: "Employees", type: "number", required: false },
    { name: "annualRevenue", label: "Revenue", type: "number", required: false },
    { name: "category", label: "Category", type: "enum", required: true,
      enumValues: ["client", "partner", "prospect", "inactive"] as const },
    { name: "contacts", label: "Contacts", type: "relation_many", required: false, relatesTo: "contact" },
  ],
}

const USER: EntitySpec = {
  key: "user", label: "User", labelPlural: "Users", group: "people",
  description: "CRM user. Credential / 2FA / portal fields are hidden.",
  fields: [
    { name: "id", label: "ID", type: "id", required: true },
    { name: "name", label: "Name", type: "string", required: true },
    { name: "email", label: "Email", type: "string", required: true },
    { name: "role", label: "Role", type: "enum", required: true,
      enumValues: ["admin", "manager", "sales", "support", "viewer"] as const },
    { name: "department", label: "Department", type: "string", required: false },
    { name: "timezone", label: "Timezone", type: "string", required: false },
    { name: "preferredLanguage", label: "Language", type: "string", required: false },
    { name: "skills", label: "Skills", type: "json", required: false },
    { name: "isActive", label: "Active", type: "boolean", required: true },
    { name: "isAvailable", label: "Available", type: "boolean", required: true },
  ],
}

/* ─── Service ─────────────────────────────────────────────────────────── */

const TICKET: EntitySpec = {
  key: "ticket", label: "Ticket", labelPlural: "Tickets", group: "service",
  description: "Support request with SLA tracking and channel routing.",
  fields: [
    { name: "id", label: "ID", type: "id", required: true },
    { name: "ticketNumber", label: "Number", type: "string", required: true },
    { name: "subject", label: "Subject", type: "string", required: true },
    { name: "priority", label: "Priority", type: "enum", required: true,
      enumValues: ["low", "medium", "high", "critical"] as const },
    { name: "status", label: "Status", type: "enum", required: true,
      enumValues: ["new", "in_progress", "waiting", "resolved", "closed"] as const },
    { name: "category", label: "Category", type: "string", required: true },
    { name: "source", label: "Source channel", type: "string", required: false },
    { name: "satisfactionRating", label: "CSAT", type: "number", required: false },
    { name: "slaDueAt", label: "SLA due", type: "date", required: false },
    { name: "resolvedAt", label: "Resolved at", type: "date", required: false },
    { name: "contactId", label: "Contact", type: "relation_one", required: false, relatesTo: "contact" },
    { name: "companyId", label: "Company", type: "relation_one", required: false, relatesTo: "company" },
    { name: "assignedTo", label: "Assigned to", type: "relation_one", required: false, relatesTo: "user" },
  ],
}

const SLA_POLICY: EntitySpec = {
  key: "slaPolicy", label: "SLA Policy", labelPlural: "SLA Policies", group: "service",
  description: "First-response + resolution time targets per ticket priority.",
  fields: [
    { name: "id", label: "ID", type: "id", required: true },
    { name: "name", label: "Name", type: "string", required: true },
    { name: "firstResponseHours", label: "First-response hours", type: "number", required: true },
    { name: "resolutionHours", label: "Resolution hours", type: "number", required: true },
    { name: "businessHoursOnly", label: "Business hours only", type: "boolean", required: true },
  ],
}

const SURVEY: EntitySpec = {
  key: "survey", label: "Survey", labelPlural: "Surveys", group: "service",
  description: "CSAT/NPS/CES survey definition with channels and triggers.",
  fields: [
    { name: "id", label: "ID", type: "id", required: true },
    { name: "name", label: "Name", type: "string", required: true },
    { name: "type", label: "Type", type: "enum", required: true,
      enumValues: ["nps", "csat", "ces", "custom"] as const },
    { name: "status", label: "Status", type: "enum", required: true,
      enumValues: ["draft", "active", "paused", "archived"] as const },
    { name: "publicSlug", label: "Public slug", type: "string", required: true },
    { name: "triggers", label: "Triggers", type: "json", required: true },
    { name: "channels", label: "Channels", type: "json", required: true },
  ],
}

/* ─── Marketing ───────────────────────────────────────────────────────── */

const CAMPAIGN: EntitySpec = {
  key: "campaign", label: "Campaign", labelPlural: "Campaigns", group: "marketing",
  description: "Outbound marketing send (email/SMS/push).",
  fields: [
    { name: "id", label: "ID", type: "id", required: true },
    { name: "name", label: "Name", type: "string", required: true },
    { name: "type", label: "Type", type: "string", required: true },
    { name: "status", label: "Status", type: "string", required: true },
    { name: "subject", label: "Subject", type: "string", required: false },
    { name: "scheduledAt", label: "Scheduled at", type: "date", required: false },
    { name: "sentAt", label: "Sent at", type: "date", required: false },
  ],
}

const JOURNEY: EntitySpec = {
  key: "journey", label: "Journey", labelPlural: "Journeys", group: "marketing",
  description: "Multi-step customer engagement flow.",
  fields: [
    { name: "id", label: "ID", type: "id", required: true },
    { name: "name", label: "Name", type: "string", required: true },
    { name: "status", label: "Status", type: "string", required: true },
    { name: "trigger", label: "Trigger", type: "string", required: true },
  ],
}

const SEGMENT: EntitySpec = {
  key: "segment", label: "Segment", labelPlural: "Segments", group: "marketing",
  description: "Filtered audience definition.",
  fields: [
    { name: "id", label: "ID", type: "id", required: true },
    { name: "name", label: "Name", type: "string", required: true },
    { name: "type", label: "Type", type: "enum", required: true,
      enumValues: ["dynamic", "static"] as const },
    { name: "filterConfig", label: "Filter", type: "json", required: true },
  ],
}

const LANDING_PAGE: EntitySpec = {
  key: "landingPage", label: "Landing Page", labelPlural: "Landing Pages", group: "marketing",
  description: "Public landing page with form capture (GrapesJS-built).",
  fields: [
    { name: "id", label: "ID", type: "id", required: true },
    { name: "name", label: "Name", type: "string", required: true },
    { name: "slug", label: "Slug", type: "string", required: true },
    { name: "isPublished", label: "Published", type: "boolean", required: true },
    { name: "formConfig", label: "Form", type: "json", required: false },
  ],
}

/* ─── Finance ─────────────────────────────────────────────────────────── */

const INVOICE: EntitySpec = {
  key: "invoice", label: "Invoice", labelPlural: "Invoices", group: "finance",
  description: "Billing document with line items, taxes, and payment tracking.",
  fields: [
    { name: "id", label: "ID", type: "id", required: true },
    { name: "invoiceNumber", label: "Number", type: "string", required: true },
    { name: "title", label: "Title", type: "string", required: true },
    { name: "status", label: "Status", type: "enum", required: true,
      enumValues: ["draft", "sent", "viewed", "partially_paid", "paid", "overdue", "cancelled", "refunded"] as const },
    { name: "totalAmount", label: "Total", type: "number", required: true },
    { name: "paidAmount", label: "Paid", type: "number", required: true },
    { name: "currency", label: "Currency", type: "string", required: true },
    { name: "dueDate", label: "Due date", type: "date", required: false },
    { name: "companyId", label: "Company", type: "relation_one", required: false, relatesTo: "company" },
    { name: "contactId", label: "Contact", type: "relation_one", required: false, relatesTo: "contact" },
    { name: "contractId", label: "Contract", type: "relation_one", required: false, relatesTo: "contract" },
  ],
}

const PRODUCT: EntitySpec = {
  key: "product", label: "Product", labelPlural: "Products", group: "finance",
  description: "Sellable item or service with pricing.",
  fields: [
    { name: "id", label: "ID", type: "id", required: true },
    { name: "name", label: "Name", type: "string", required: true },
    { name: "sku", label: "SKU", type: "string", required: false },
    { name: "price", label: "Price", type: "number", required: true },
    { name: "currency", label: "Currency", type: "string", required: true },
    { name: "isActive", label: "Active", type: "boolean", required: true },
  ],
}

const CURRENCY: EntitySpec = {
  key: "currency", label: "Currency", labelPlural: "Currencies", group: "finance",
  description: "ISO currency with exchange rate.",
  fields: [
    { name: "code", label: "Code", type: "string", required: true },
    { name: "name", label: "Name", type: "string", required: true },
    { name: "symbol", label: "Symbol", type: "string", required: false },
    { name: "rate", label: "Exchange rate", type: "number", required: true },
    { name: "isBase", label: "Base", type: "boolean", required: true },
  ],
}

/* ─── Operations ──────────────────────────────────────────────────────── */

const PROJECT: EntitySpec = {
  key: "project", label: "Project", labelPlural: "Projects", group: "operations",
  description: "Delivery engagement with milestones and team members.",
  fields: [
    { name: "id", label: "ID", type: "id", required: true },
    { name: "name", label: "Name", type: "string", required: true },
    { name: "status", label: "Status", type: "string", required: true },
    { name: "startDate", label: "Start", type: "date", required: false },
    { name: "endDate", label: "End", type: "date", required: false },
    { name: "companyId", label: "Company", type: "relation_one", required: false, relatesTo: "company" },
    { name: "dealId", label: "Deal", type: "relation_one", required: false, relatesTo: "deal" },
  ],
}

const TASK: EntitySpec = {
  key: "task", label: "Task", labelPlural: "Tasks", group: "operations",
  description: "Action item with due date and assignee.",
  fields: [
    { name: "id", label: "ID", type: "id", required: true },
    { name: "title", label: "Title", type: "string", required: true },
    { name: "status", label: "Status", type: "string", required: true },
    { name: "priority", label: "Priority", type: "string", required: false },
    { name: "dueDate", label: "Due date", type: "date", required: false },
    { name: "completedAt", label: "Completed at", type: "date", required: false },
    { name: "assignedTo", label: "Assigned to", type: "relation_one", required: false, relatesTo: "user" },
  ],
}

const ACTIVITY: EntitySpec = {
  key: "activity", label: "Activity", labelPlural: "Activities", group: "operations",
  description: "Call / meeting / email / note logged against a record.",
  fields: [
    { name: "id", label: "ID", type: "id", required: true },
    { name: "type", label: "Type", type: "enum", required: true,
      enumValues: ["call", "meeting", "email", "note", "task"] as const },
    { name: "subject", label: "Subject", type: "string", required: true },
    { name: "description", label: "Description", type: "string", required: false },
    { name: "createdAt", label: "Created at", type: "date", required: true },
    { name: "contactId", label: "Contact", type: "relation_one", required: false, relatesTo: "contact" },
    { name: "companyId", label: "Company", type: "relation_one", required: false, relatesTo: "company" },
  ],
}

const MTM_AGENT: EntitySpec = {
  key: "mtmAgent", label: "MTM Agent", labelPlural: "MTM Agents", group: "operations",
  description: "Field-team agent with route + GPS tracking.",
  fields: [
    { name: "id", label: "ID", type: "id", required: true },
    { name: "name", label: "Name", type: "string", required: true },
    { name: "phone", label: "Phone", type: "string", required: false },
    { name: "isActive", label: "Active", type: "boolean", required: true },
  ],
}

/* ─── Platform ────────────────────────────────────────────────────────── */

const WORKFLOW_RULE: EntitySpec = {
  key: "workflowRule", label: "Workflow Rule", labelPlural: "Workflow Rules", group: "platform",
  description: "If-this-then-that automation rule (trigger + actions).",
  fields: [
    { name: "id", label: "ID", type: "id", required: true },
    { name: "name", label: "Name", type: "string", required: true },
    { name: "triggerEntity", label: "Trigger entity", type: "string", required: true },
    { name: "triggerEvent", label: "Trigger event", type: "string", required: true },
    { name: "isActive", label: "Active", type: "boolean", required: true },
  ],
}

const WEBHOOK: EntitySpec = {
  key: "webhook", label: "Webhook", labelPlural: "Webhooks", group: "platform",
  description: "Outbound HTTP subscription on CRM events.",
  fields: [
    { name: "id", label: "ID", type: "id", required: true },
    { name: "url", label: "URL", type: "string", required: true },
    { name: "events", label: "Events", type: "json", required: true },
    { name: "isActive", label: "Active", type: "boolean", required: true },
  ],
}

const API_KEY: EntitySpec = {
  key: "apiKey", label: "API Key", labelPlural: "API Keys", group: "platform",
  description: "Bearer token for programmatic API access. Hash + raw secret hidden.",
  fields: [
    { name: "id", label: "ID", type: "id", required: true },
    { name: "name", label: "Name", type: "string", required: true },
    { name: "keyPrefix", label: "Prefix", type: "string", required: true },
    { name: "scopes", label: "Scopes", type: "json", required: true },
    { name: "isActive", label: "Active", type: "boolean", required: true },
    { name: "expiresAt", label: "Expires at", type: "date", required: false },
  ],
}

const SAVED_REPORT: EntitySpec = {
  key: "savedReport", label: "Saved Report", labelPlural: "Saved Reports", group: "platform",
  description: "Persisted report definition from the Report Builder.",
  fields: [
    { name: "id", label: "ID", type: "id", required: true },
    { name: "name", label: "Name", type: "string", required: true },
    { name: "entityType", label: "Entity", type: "string", required: true },
    { name: "chartType", label: "Chart type", type: "string", required: true },
    { name: "isShared", label: "Shared", type: "boolean", required: true },
    { name: "scheduleFreq", label: "Schedule", type: "string", required: false },
  ],
}

/* ─── Registry ────────────────────────────────────────────────────────── */

export const ENTITY_REGISTRY: readonly EntitySpec[] = [
  DEAL, LEAD, PIPELINE, OFFER, CONTRACT,
  CONTACT, COMPANY, USER,
  TICKET, SLA_POLICY, SURVEY,
  CAMPAIGN, JOURNEY, SEGMENT, LANDING_PAGE,
  INVOICE, PRODUCT, CURRENCY,
  PROJECT, TASK, ACTIVITY, MTM_AGENT,
  WORKFLOW_RULE, WEBHOOK, API_KEY, SAVED_REPORT,
]

export const ENTITY_BY_KEY: Map<EntityKey, EntitySpec> = new Map(
  ENTITY_REGISTRY.map(e => [e.key, e])
)

/* ─── Graph derivation ────────────────────────────────────────────────── */

export interface SchemaGraphNode {
  id: EntityKey
  label: string
  labelPlural: string
  group: EntityGroup
  description: string
  fields: { name: string; label: string; type: FieldType; required: boolean }[]
}

export interface SchemaGraphEdge {
  /** Unique edge id: `${from}.${field}` */
  id: string
  from: EntityKey
  to: EntityKey
  /** "one" (FK) or "many" (reverse collection). */
  cardinality: "one" | "many"
  /** Source field name on the `from` entity. */
  field: string
  label: string
}

export interface SchemaGraph {
  nodes: SchemaGraphNode[]
  edges: SchemaGraphEdge[]
  groups: { key: EntityGroup; count: number }[]
}

/**
 * Derive a Node-Edge graph from the registry. Edges only connect entities
 * that are themselves in the registry — references to internal-only models
 * are dropped (e.g. `Deal.aiObservations` doesn't draw because
 * `AiObservation` is hidden by design).
 */
export function buildSchemaGraph(filterGroup?: EntityGroup | null): SchemaGraph {
  const visible = filterGroup
    ? ENTITY_REGISTRY.filter(e => e.group === filterGroup)
    : ENTITY_REGISTRY
  const visibleKeys = new Set(visible.map(e => e.key))

  const nodes: SchemaGraphNode[] = visible.map(e => ({
    id: e.key,
    label: e.label,
    labelPlural: e.labelPlural,
    group: e.group,
    description: e.description,
    fields: e.fields.map(f => ({ name: f.name, label: f.label, type: f.type, required: f.required })),
  }))

  const edges: SchemaGraphEdge[] = []
  for (const entity of visible) {
    for (const field of entity.fields) {
      if (
        (field.type === "relation_one" || field.type === "relation_many") &&
        field.relatesTo &&
        visibleKeys.has(field.relatesTo)
      ) {
        edges.push({
          id: `${entity.key}.${field.name}`,
          from: entity.key,
          to: field.relatesTo,
          cardinality: field.type === "relation_one" ? "one" : "many",
          field: field.name,
          label: field.label,
        })
      }
    }
  }

  // Group counts derived from visible nodes
  const groupCount = new Map<EntityGroup, number>()
  for (const n of nodes) {
    groupCount.set(n.group, (groupCount.get(n.group) ?? 0) + 1)
  }
  const groups = Array.from(groupCount.entries()).map(([key, count]) => ({ key, count }))

  return { nodes, edges, groups }
}
