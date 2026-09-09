import { LEGACY_MODULE_MAP, type ModuleId } from "./modules"

export type Role = "superadmin" | "admin" | "manager" | "sales" | "support" | "ticketing" | "viewer"
export type Action = "read" | "write" | "delete" | "export" | "admin"
export type Module =
  | "companies" | "contacts" | "deals" | "leads" | "tasks"
  | "contracts" | "offers" | "tickets" | "kb" | "campaigns"
  | "reports" | "profitability" | "ai" | "settings" | "users" | "audit"
  // ERP modules
  | "projects" | "budgeting" | "invoices" | "events" | "pricing"
  | "inbox" | "journeys" | "segments" | "voip"
  // Social Monitoring — its own scope since the 2026-08-01 module split. It
  // shares the `social` name with the group-module it bridges to (identity entry
  // in LEGACY_MODULE_MAP), so /api/v1/social gates on the Social Monitoring
  // toggle rather than on the inbox's `omnichannel`.
  | "social"
  // Юридический контур соцмониторинга (дела/кандидаты/доказательства/отчёты и
  // согласования по ним) — ОТДЕЛЬНЫЙ scope: появился уже в admin-only период и
  // остаётся за админами, тогда как повседневная работа с упоминаниями идёт по
  // `social` (manager rw / sales read). Намеренно НЕ ключ ROLE_PERMISSIONS и НЕ
  // член MODULES: проходят только wildcard-роли (admin/superadmin, viewer на
  // чтение), а API-ключи не могут получить такой scope вовсе. Тенантный гейт
  // прежний — бридж в LEGACY_MODULE_MAP ведёт на группу-модуль `social`.
  | "social-legal"
  // Consumer Goods Cloud (R4) — Trade Promotion Management + Retail
  // Execution audits. Distinct from `settings` so field agents (sales/
  // support roles) can record audits without being granted admin scope.
  | "tpm"
  // Nonprofit Cloud (R9) — donors / programs / donations / grants /
  // volunteer activity. Distinct module so fundraising staff can
  // record gifts + grants without admin-tier access; settings stays
  // reserved for org config.
  | "nonprofit"
  // B2B Commerce (D1) — buyer accounts, orders, RFQs. Distinct
  // from `offers` (CPQ-quote flow) because B2B Commerce is a
  // self-service catalog/order surface with per-buyer pricing.
  | "commerce"
  // Subscription Management (D4) — recurring billing lifecycle
  // (trial → active → past_due → cancelled), prorated plan changes,
  // dunning. Distinct from `commerce` because billing operators
  // (finance) typically have different role boundaries than
  // order-fulfillment operators.
  | "subscriptions"
  // Payment integrations (D5) — pluggable provider pattern (Stripe /
  // PayPal / YooKassa / Robokassa) + webhook signature verification +
  // idempotency. Distinct from `subscriptions` so PCI-adjacent
  // payment-method operators (treasury / finance ops) have a tighter
  // permission boundary than billing operators.
  | "payments"
  // Inventory Management (D7) — warehouses, per-(warehouse, product)
  // stock, append-only movement audit, low-stock alerts. Distinct
  // from `commerce` because warehouse operators (logistics / supply-
  // chain) are not the same role as order/cart operators.
  | "inventory"
  // Promo Codes / Loyalty Management (D8) — discount-code engine +
  // per-customer points wallet + tier rules. Distinct from
  // `commerce` because marketing operators (campaign managers,
  // customer-retention team) typically own promo + loyalty programs
  // while logistics/order operators don't.
  | "loyalty"
  // Data Cloud (G1) — UnifiedProfile + ProfileSource Customer 360
  // aggregation. Distinct module because data-analyst / RevOps
  // operators typically own profile-merge + segmentation while
  // sales/support consume the 360-view read-only.
  | "data-cloud"
  // Revenue Recognition (M4) — ASC 606 / IFRS 15 performance
  // obligations + schedules + entries. Distinct module because
  // finance-controller / revenue-accountant operators own this
  // surface and need a tighter permission boundary than sales-side
  // contract managers (who may view obligations read-only).
  | "revenue-recognition"
  // Education Cloud (R10) — student lifecycle, course catalog,
  // term-based enrollments, faculty. Distinct from CRM contacts
  // because student lifecycle (prospect → applicant → admitted →
  // enrolled → graduated → withdrawn) is its own domain. Registrar
  // / academic-affairs role typically owns this, distinct from
  // recruitment/sales-side admissions reps.
  | "education"
  // Financial Services Cloud (R1) — wealth management, retail/
  // commercial banking, insurance. Household-centric data model
  // with multi-party ownership, goal tracking, life-event triggers.
  // Distinct module because regulated-financial operators (advisors,
  // compliance officers) need a tighter audit boundary than CRM.
  // KYC-adjacent data requires its own RBAC.
  | "financial-services"
  // Health Cloud (R2) — patient management, encounters, medical
  // records, care plans. PHI-bearing module — needs its own RBAC
  // boundary distinct from CRM contacts. Slice-2 layers minimum-
  // necessary access checks + audit log + sensitivity-tier gates
  // (restricted records visible only to assigned providers).
  | "health"
  // Energy & Utilities Cloud (R6) — utility customer management,
  // metering, outage management, service-call dispatch. Distinct
  // module because the operator profile (utility dispatcher / field
  // engineer) and data shape (time-series readings, outage windows,
  // commodity-typed meters) are wholly unlike CRM Contact/Deal.
  | "energy-utilities"
  // Insurance Cloud (R7) — policy administration, claims, beneficiaries,
  // underwriter + adjuster service team. PII-bearing module (insureds'
  // SSN/DOB, beneficiary tax ids); slice-2 layers pgcrypto wraps.
  // Distinct from CRM because regulated-financial operators (claims
  // adjusters, SIU fraud investigators) need a tighter audit boundary,
  // and the data shape (policies, claims, beneficiaries) is unlike
  // any CRM entity.
  | "insurance"
  // Public Sector Cloud (R8) — citizen case management, licensing,
  // grant administration. PII-bearing (citizen SSN/DOB/address);
  // every read is FOIA-able. Slice-2 layers pgcrypto + audit log
  // for FedRAMP/IRAP path (certification itself is business workstream).
  // Distinct from CRM because government operators (caseworkers,
  // inspectors, grant officers) need a statutory-deadline-aware
  // audit boundary.
  | "public-sector"
  // Media Cloud (R11) — subscriber lifecycle, ad sales, content
  // monetization, consumption analytics. Closes Phase 7 active
  // roadmap. Distinct from CRM Contact (subscriber tier + content
  // preferences + billing-region for licensing) and from C3
  // Advertising Studio (which is generic ad-platform sync, while
  // Media has owned-and-operated content/inventory + placement-level
  // pacing). Editorial / ad-sales / analytics operators distinct.
  | "media"
  // Account Engagement (C5 — Pardot analogue) — B2B marketing depth:
  // account-level ICP grading + engagement scoring + ABM journeys
  // + intent signals. Distinct from contact-level `campaigns` /
  // `journeys` / `segments` because B2B buying is an ACCOUNT
  // decision. Marketing-ops + ABM strategist operators distinct
  // from sales-side account owners.
  | "account-engagement"
  // Route & Field (MTM) —
  // Region → Team → Agent territory hierarchy, daily visit plans,
  // visit-photo capture, GPS check-in, supervisor dashboards.
  // Distinct from CRM because field-agent operators (route reps,
  // team supervisors, territory managers) work exclusively in the
  // MTM surface and should not gain access to CRM deals/contacts.
  // Mobile JWT callers enforce territory-scope independently via
  // resolveAgentScope; this module gates the web admin panel.
  | "mtm"
  // Workforce is a permission scope, not a ModuleId: tenant entitlement is
  // enforced separately by withWorkforceRlsAuth so it never inherits MTM.
  | "workforce"

/**
 * Bridge the permissions.Module vocabulary (what resolveModuleFromPath returns)
 * to the monetization ModuleId vocabulary (MODULE_REGISTRY / hasModule) —
 * without the bridge a route's scope silently skips the module gate
 * (api-auth.ts only gates when the translated id is in MODULE_REGISTRY).
 *
 * Full permission-scope → group-module translation. Single source of truth is
 * LEGACY_MODULE_MAP (modules.ts). Spread keeps this Edge-safe (modules.ts is
 * pure data/functions, zero imports), so BOTH the Node API layer (api-auth.ts)
 * and the Edge middleware can import it. Scopes that must stay ungated live in
 * INTENTIONALLY_UNGATED (modules.ts); the totality test enforces that every
 * route scope is mapped, identity, or intentionally ungated.
 */
export const PERMISSION_MODULE_TO_MODULE_ID: Record<string, ModuleId> = {
  ...LEGACY_MODULE_MAP,
}

/**
 * Central list of every module that can be gated by permissions OR an API-key scope.
 * Add a module here (and to the `Module` type above) and it will automatically
 * appear in the API-keys scope picker and be enforceable at the auth layer.
 */
export const MODULES: readonly Module[] = [
  "companies", "contacts", "deals", "leads", "tasks",
  "contracts", "offers", "invoices", "tickets", "kb", "campaigns",
  "projects", "events", "pricing", "budgeting",
  "reports", "profitability",
  "inbox", "journeys", "segments", "voip",
  "social",
  "tpm",
  "nonprofit",
  "commerce",
  "subscriptions",
  "payments",
  "inventory",
  "loyalty",
  "data-cloud",
  "revenue-recognition",
  "education",
  "financial-services",
  "health",
  "energy-utilities",
  "insurance",
  "public-sector",
  "media",
  "account-engagement",
  "mtm",
  "workforce",
  "ai", "settings", "users", "audit",
] as const

/**
 * These permission scopes intentionally do not bridge into MODULE_REGISTRY.
 * Their tenant entitlement lives in a dedicated capability wrapper, which is
 * stricter than a generic group-module gate and keeps the domains independent.
 */
export const CAPABILITY_GATED_PERMISSION_SCOPES = new Set<Module>(["workforce"])

/**
 * Flat list of every `read:<module>` / `write:<module>` scope string that
 * an API key can hold. Derived from MODULES — no need to touch this manually.
 */
export const API_SCOPES: readonly string[] = MODULES.flatMap(
  (m) => [`read:${m}`, `write:${m}`]
)

// Permission matrix: role × module × action
const ROLE_PERMISSIONS: Record<Role, Record<string, Action[]>> = {
  superadmin: {
    "*": ["read", "write", "delete", "export", "admin"],
  },
  admin: {
    "*": ["read", "write", "delete", "export", "admin"],
  },
  manager: {
    companies: ["read", "write", "delete", "export"],
    contacts: ["read", "write", "delete", "export"],
    deals: ["read", "write", "delete", "export"],
    leads: ["read", "write", "delete", "export"],
    tasks: ["read", "write", "delete"],
    contracts: ["read", "write", "export"],
    offers: ["read", "write", "export"],
    invoices: ["read", "write", "export"],
    tickets: ["read", "write"],
    kb: ["read", "write"],
    campaigns: ["read", "write"],
    // Соцмониторинг: менеджер — штатный оператор. Все эмиттеры алертов
    // соцмониторинга адресуют их admin+manager (spike-alerts, coverage-slo,
    // ai-auto-actions), а до 2026-06-29 роуты ходили под scope `campaigns`,
    // который у менеджера rw. Переключение на `omnichannel` (c2a514e94) было
    // сделано ради модульного гейта и НЕЧАЯННО схлопнуло доступ до admin —
    // менеджер получал алерт и упирался в 403. Восстанавливаем прежние права
    // на собственном scope `social` (2026-08-01).
    social: ["read", "write"],
    reports: ["read", "export"],
    profitability: ["read"],
    budgeting: ["read", "write"],
    projects: ["read", "write", "delete"],
    events: ["read", "write"],
    pricing: ["read"],
    inbox: ["read", "write"],
    journeys: ["read", "write"],
    segments: ["read", "write"],
    voip: ["read", "write"],
    tpm: ["read", "write", "delete"],
    nonprofit: ["read", "write", "delete"],
    commerce: ["read", "write", "delete"],
    subscriptions: ["read", "write", "delete"],
    payments: ["read", "write", "delete"],
    inventory: ["read", "write", "delete"],
    loyalty: ["read", "write", "delete"],
    "data-cloud": ["read", "write", "delete"],
    // Manager controls obligations + scheduling; revenue-accountant
    // is a separate finance role (slice-2 admin assignments may
    // restrict to read-only for non-finance managers).
    "revenue-recognition": ["read", "write", "delete"],
    // Education: registrar / academic-affairs operator. Manager owns
    // full CRUD; sales (admissions reps) gets read-only on records +
    // write on students they recruit (handled in slice-2 row-level).
    education: ["read", "write", "delete", "export"],
    // Financial Services: advisor / compliance role. Manager owns
    // households + accounts + goals; KYC promotion gated to slice-2
    // row-level rules (only manager+ can flip kycStatus).
    "financial-services": ["read", "write", "delete", "export"],
    // Health: care-coordinator / physician role. Manager owns
    // patient + provider + encounter + care-plan CRUD plus export
    // for HIPAA-compliant data portability. Medical-record write
    // is permitted but DB trigger enforces append-only; sensitivity
    // tier (restricted) is slice-2 row-level RBAC.
    health: ["read", "write", "delete", "export"],
    // Energy & Utilities: dispatcher / field engineer / billing
    // operator role. Manager owns customer + meter + outage + call
    // CRUD plus export for regulatory CMI/SAIDI reporting.
    "energy-utilities": ["read", "write", "delete", "export"],
    // Insurance: underwriter / claims-manager role. Manager owns
    // policy + claim + beneficiary CRUD plus export for regulatory
    // filings (NAIC, state DOI). Fraud-flag toggle + SIU referral
    // are slice-2 row-level RBAC.
    insurance: ["read", "write", "delete", "export"],
    // Public Sector: agency supervisor / director role. Manager owns
    // case + license + grant CRUD plus export for FOIA / records
    // requests. Statutory-deadline overrides + escalations gated
    // by authorityLevel (slice-2 row-level RBAC).
    "public-sector": ["read", "write", "delete", "export"],
    // Media: editorial / ad-sales manager role. Manager owns
    // subscriber + content + campaign + placement CRUD plus export
    // for revenue reporting + ad-sales reconciliation.
    media: ["read", "write", "delete", "export"],
    // Account Engagement: marketing-ops / ABM strategist. Manager
    // owns MarketingAccount + ABMJourney + IntentSignal CRUD plus
    // export for revenue-attribution + sales handoff. ICP grading
    // + score recompute are slice-2 cron-driven (manager configures
    // the rules; cron writes the snapshots).
    "account-engagement": ["read", "write", "delete", "export"],
    // MTM: territory manager role (maps to MtmAgent.role=MANAGER).
    // Web admin panel users with CRM `manager` role get full CRUD over
    // regions, teams, agents, visits, photos, and analytics.
    // Fine-grained territory scope (Region → Team) is enforced
    // separately by resolveAgentScope on mobile JWT callers.
    mtm: ["read", "write", "delete", "export", "admin"],
    workforce: ["read", "write", "export"],
    ai: ["read"],
    settings: [],
    users: ["read"],
    audit: ["read"],
  },
  sales: {
    companies: ["read", "write"],
    contacts: ["read", "write"],
    deals: ["read", "write", "delete"],
    leads: ["read", "write"],
    tasks: ["read", "write"],
    contracts: ["read"],
    offers: ["read", "write"],
    invoices: ["read"],
    tickets: ["read"],
    kb: ["read"],
    campaigns: ["read"],
    social: ["read"],   // паритет с прежним `campaigns` (см. manager выше)
    reports: ["read"],
    profitability: [],
    budgeting: [],
    projects: ["read"],
    events: ["read"],
    pricing: [],
    inbox: ["read", "write"],
    journeys: [],
    segments: [],
    voip: ["read", "write"],
    // Sales reps are the natural field-agent author of TPM audits.
    tpm: ["read", "write"],
    // Fundraising staff (gift officers / development reps) are the
    // natural sales-role author of donor + donation records.
    nonprofit: ["read", "write"],
    // Sales reps own B2B order entry + RFQ workflow.
    commerce: ["read", "write"],
    subscriptions: ["read", "write"],
    // Sales sees payment status (own deals) but cannot write — payments
    // are a finance-only mutation surface (PCI-adjacent + audit-sensitive).
    payments: ["read"],
    // Sales reads inventory (to know "is this in stock?" before quoting)
    // but doesn't author warehouse / movement writes — that's logistics.
    inventory: ["read"],
    // Sales reads loyalty data (see customer tier + balance during a
    // call to know what discounts/perks to offer) but doesn't author
    // promo codes / earn adjustments — that's marketing's RBAC.
    loyalty: ["read"],
    // Sales reads 360-profile (aggregated customer history during a
    // call) but doesn't author merge decisions — that's data-analyst
    // / RevOps territory.
    "data-cloud": ["read"],
    // Sales reads obligations to know revenue attribution on a deal
    // (forecasting, win-rate analysis) but doesn't author schedules
    // — that's finance.
    "revenue-recognition": ["read"],
    // Admissions reps (sales-role) can create prospects + applicants
    // + read everything; status promotion to admitted+ is gated to
    // registrar (manager) via slice-2 row-level rules.
    education: ["read", "write"],
    // FS sales-role = junior advisor / relationship manager. Read
    // households + accounts + goals; create prospects but not active
    // accounts (KYC required first, manager-only operation in slice-2).
    "financial-services": ["read", "write"],
    // Health: sales-role = practice referral / intake coordinator.
    // Read-only on clinical data; sales reps shouldn't see PHI by
    // default — slice-2 may carve a separate `health-intake` permission
    // for new-patient registration without medical-record access.
    health: ["read"],
    // E&U sales-role = new-connection rep / account-acquisition.
    // Can read existing customer data + create prospects; activation
    // is manager-only (compliance + tariff-setup).
    "energy-utilities": ["read", "write"],
    // Insurance sales-role = producer / agent. Can create quotes
    // and policy-holder records; binding + claim authoring requires
    // manager (compliance + reserve setup).
    insurance: ["read", "write"],
    // Public Sector sales-role = outreach / intake-coordinator.
    // Can register new citizens + intake new cases; decisions
    // (issue/deny/escalate) are caseworker-line-or-above.
    "public-sector": ["read", "write"],
    // Media sales-role = ad-sales rep / account exec. Can create
    // advertiser campaigns + placements; subscriber data is read-only
    // (privacy boundary — sales doesn't author subscriber state).
    media: ["read", "write"],
    // Account Engagement sales-role = account exec / BDR. Read
    // MarketingAccount + scores + signals to inform outreach; can
    // create new target accounts but not author ABM journeys
    // (journey authoring is marketing-team-owned).
    "account-engagement": ["read", "write"],
    // MTM sales-role = field agent / route rep. Can read their own
    // visit plan + submit visits + upload photos. Territory scope is
    // enforced by resolveAgentScope on mobile JWT (AGENT sees only self).
    // Web admin panel users with `sales` CRM role get read+write but
    // not delete/admin (team admin stays with manager).
    mtm: ["read", "write"],
    workforce: ["read", "write"],
    ai: ["read"],
    settings: [],
    users: [],
    audit: [],
  },
  support: {
    companies: ["read"],
    contacts: ["read", "write"],
    deals: ["read"],
    leads: [],
    tasks: ["read", "write"],
    contracts: ["read"],
    offers: [],
    invoices: ["read"],
    tickets: ["read", "write", "delete"],
    kb: ["read", "write"],
    campaigns: [],
    social: [],         // как и раньше: соц-алерты в support не адресуются
    reports: ["read"],
    profitability: [],
    budgeting: [],
    projects: ["read"],
    events: ["read"],
    pricing: [],
    inbox: ["read", "write"],
    journeys: [],
    segments: [],
    voip: ["read", "write"],
    // Support reads audits but doesn't typically author them.
    tpm: ["read"],
    // Support can log volunteer activities + read donor data, but
    // doesn't author donations / grants in the default tier.
    nonprofit: ["read", "write"],
    // Support reads B2B orders but doesn't author them.
    commerce: ["read"],
    subscriptions: ["read"],
    payments: ["read"],
    inventory: ["read"],
    loyalty: ["read"],
    "data-cloud": ["read"],
    // Support doesn't typically need revenue-recognition visibility;
    // tighter posture is read-only.
    "revenue-recognition": ["read"],
    // Student support staff need read across the system to help
    // students navigate; writes scoped to slice-2 (notes, etc.).
    education: ["read"],
    // FS support reads household data to assist clients; writes
    // restricted (PII boundary).
    "financial-services": ["read"],
    // Health support: patient-services / front-desk role. Read-only
    // on clinical data — staff need to look up appointments + care
    // team but not author records (slice-2 may grant write on
    // appointment scheduling specifically).
    health: ["read"],
    // E&U support: customer-care role — answers billing questions,
    // logs service-call requests, escalates to dispatch. Can create
    // service calls (writes) but not author outages / meter status
    // (operator-side).
    "energy-utilities": ["read", "write"],
    // Insurance support: claims-intake / customer-care role. Read
    // policies + claims to assist insureds; can log first-notice-of-
    // loss intake but not author claim decisions / settlements.
    insurance: ["read"],
    // Public Sector support: citizen-services / front-desk role.
    // Read-only on citizen data — call-center staff need to look up
    // case status / license expiration / grant balance but cannot
    // author decisions (FOIA boundary).
    "public-sector": ["read"],
    // Media support: subscriber-services / customer-care role.
    // Read subscriber + subscription history to assist callers;
    // cannot author campaign / placement / content state.
    media: ["read"],
    // Account Engagement support: marketing-ops support / SDR coach.
    // Read MarketingAccount + scores + signals to advise outreach
    // priority; cannot author journeys / grades / scores.
    "account-engagement": ["read"],
    // MTM support-role = back-office / ops team. Read-only access to
    // visit data, agent lists, and analytics to support field ops.
    // Cannot author visits/photos or manage team structure.
    mtm: ["read"],
    workforce: [],
    ai: ["read"],
    settings: [],
    users: [],
    audit: [],
  },
  ticketing: {
    companies: ["read"],
    contacts: ["read", "write"],
    deals: [],
    leads: [],
    tasks: ["read", "write"],
    contracts: [],
    offers: [],
    invoices: [],
    tickets: ["read", "write"],
    kb: ["read"],
    campaigns: [],
    social: [],
    reports: ["read"],
    profitability: [],
    budgeting: [],
    projects: [],
    events: [],
    pricing: [],
    inbox: [],
    journeys: [],
    segments: [],
    voip: [],
    tpm: [],
    nonprofit: [],
    commerce: [],
    subscriptions: [],
    payments: [],
    inventory: [],
    loyalty: [],
    "data-cloud": [],
    "revenue-recognition": [],
    education: [],
    "financial-services": [],
    health: [],
    "energy-utilities": [],
    insurance: [],
    "public-sector": [],
    media: [],
    "account-engagement": [],
    mtm: [],
    workforce: [],
    ai: ["read"],
    settings: [],
    users: [],
    audit: [],
  },
  viewer: {
    "*": ["read"],
  },
}

/**
 * Map API route paths to module names for automatic permission resolution.
 */
export const ROUTE_MODULE_MAP: Record<string, Module> = {
  "/api/v1/companies": "companies",
  "/api/v1/contacts": "contacts",
  "/api/v1/deals": "deals",
  "/api/v1/leads": "leads",
  "/api/v1/tasks": "tasks",
  "/api/v1/divisions": "tasks",
  "/api/v1/board-permissions": "tasks",
  "/api/v1/contracts": "contracts",
  "/api/v1/contract-templates": "contracts",
  "/api/v1/contract-approval-stages": "contracts",
  "/api/v1/contract-renewal-alerts": "contracts",
  // CLM dashboard — aggregates renewal-alert + approval-stage queries
  // into one response for the operator surface.
  "/api/v1/contract-lifecycle": "contracts",
  "/api/v1/esign-envelopes": "contracts",
  "/api/v1/esign-signers": "contracts",
  "/api/v1/esign-audit-events": "contracts",
  "/api/v1/performance-obligations": "revenue-recognition",
  "/api/v1/revenue-recognition-schedules": "revenue-recognition",
  "/api/v1/revenue-recognition-entries": "revenue-recognition",
  // N2 Lightning App Builder — admin-side surface, so under "settings"
  // module. Slice-2 may carve out a separate `app-builder` module if
  // we want a tighter UX-designer role distinct from settings admin.
  "/api/v1/lightning-pages": "settings",
  "/api/v1/lightning-page-regions": "settings",
  "/api/v1/lightning-page-widgets": "settings",
  "/api/v1/lightning-page-assignments": "settings",
  "/api/v1/omni-studio-flex-cards": "settings",
  "/api/v1/omni-studio-omni-scripts": "settings",
  "/api/v1/omni-studio-run-sessions": "settings",
  "/api/v1/education-academic-terms": "education",
  "/api/v1/education-faculty": "education",
  "/api/v1/education-courses": "education",
  "/api/v1/education-students": "education",
  "/api/v1/education-enrollments": "education",
  "/api/v1/financial-households": "financial-services",
  "/api/v1/financial-household-members": "financial-services",
  "/api/v1/financial-accounts": "financial-services",
  "/api/v1/financial-goals": "financial-services",
  "/api/v1/financial-life-events": "financial-services",
  "/api/v1/health-providers": "health",
  "/api/v1/health-patients": "health",
  "/api/v1/health-medical-records": "health",
  "/api/v1/health-encounters": "health",
  "/api/v1/health-care-plans": "health",
  "/api/v1/utility-customers": "energy-utilities",
  "/api/v1/metering-points": "energy-utilities",
  "/api/v1/meter-readings": "energy-utilities",
  "/api/v1/outages": "energy-utilities",
  "/api/v1/service-calls": "energy-utilities",
  "/api/v1/policy-holders": "insurance",
  "/api/v1/insurance-service-team-members": "insurance",
  "/api/v1/policies": "insurance",
  "/api/v1/beneficiaries": "insurance",
  "/api/v1/claims": "insurance",
  "/api/v1/public-sector-officials": "public-sector",
  "/api/v1/citizens": "public-sector",
  "/api/v1/public-sector-cases": "public-sector",
  "/api/v1/public-sector-licenses": "public-sector",
  "/api/v1/public-sector-grants": "public-sector",
  "/api/v1/media-subscribers": "media",
  "/api/v1/media-content-inventory": "media",
  "/api/v1/media-ad-campaigns": "media",
  "/api/v1/media-ad-placements": "media",
  "/api/v1/media-consumption-events": "media",
  "/api/v1/marketing-accounts": "account-engagement",
  "/api/v1/account-intent-signals": "account-engagement",
  "/api/v1/abm-journeys": "account-engagement",
  "/api/v1/abm-journey-enrollments": "account-engagement",
  "/api/v1/account-score-snapshots": "account-engagement",
  // C2 Mobile Studio — push / in-app / SMS campaigns. Slotted under
  // the existing `campaigns` module since this is marketing-team
  // surface (same role boundary as email campaigns).
  "/api/v1/mobile-message-templates": "campaigns",
  "/api/v1/mobile-campaigns": "campaigns",
  "/api/v1/mobile-campaign-deliveries": "campaigns",
  // C3 Advertising Studio — FB/Google/LinkedIn ads. Same marketing-team
  // role boundary as mobile campaigns; slice-2 may carve out a separate
  // `advertising` module if compliance-tier separation needs it.
  "/api/v1/ad-providers": "campaigns",
  "/api/v1/ad-audience-syncs": "campaigns",
  "/api/v1/ad-campaign-tracking": "campaigns",
  // C4 Personalization / Interaction Studio — real-time web personalization.
  // Same marketing-team boundary as mobile/advertising; slice-2 may carve a
  // dedicated `personalization` module if visitor-PII boundary demands.
  "/api/v1/personalization-experiences": "campaigns",
  "/api/v1/personalization-variants": "campaigns",
  "/api/v1/personalization-decisions": "campaigns",
  // G5 Segment Activation — bridges G4 DataCloudSegment to external
  // destinations (C3/C2/email/webhook). Under `data-cloud` module since
  // this is the activation surface for Data Cloud segments — same role
  // boundary as segment authoring (data-analyst / RevOps owns).
  "/api/v1/segment-activations": "data-cloud",
  "/api/v1/segment-activation-runs": "data-cloud",
  "/api/v1/offers": "offers",
  "/api/v1/invoices": "invoices",
  "/api/v1/recurring-invoices": "invoices",
  "/api/v1/tickets": "tickets",
  "/api/v1/kb": "kb",
  "/api/v1/campaigns": "campaigns",
  "/api/v1/reports": "reports",
  "/api/v1/projects": "projects",
  "/api/v1/events": "events",
  "/api/v1/segments": "segments",
  "/api/v1/journeys": "journeys",
  "/api/v1/users": "users",
  "/api/v1/audit-log": "audit",
  "/api/v1/settings": "settings",

  // Added 2026-08-29. These org-scoped write routes resolved to no module, and
  // requireAuth/withRls skip the permission check entirely when the module is
  // null — so they accepted writes from any role, `viewer` included. Grouped
  // under the module whose feature they belong to, not a new one, so they
  // inherit the same role rules as their siblings.
  "/api/v1/contract-approval-rules": "contracts",
  "/api/v1/contract-intake-forms": "contracts",
  "/api/v1/custom-domains": "settings",
  "/api/v1/dashboard/widget-config": "settings",
  "/api/v1/dashboard/widgets": "settings",
  "/api/v1/integrations": "settings",
  "/api/v1/plan-requests": "settings",
  "/api/v1/forms": "campaigns",
  "/api/v1/message-snippets": "inbox",
  "/api/v1/whatsapp": "inbox",
  "/api/v1/price-changes": "pricing",
  "/api/v1/products": "pricing",
  "/api/v1/webhooks": "settings",
  "/api/v1/workflows": "settings",
  "/api/v1/custom-fields": "settings",
  "/api/v1/sla-policies": "settings",
  "/api/v1/pipeline-stages": "settings",
  "/api/v1/inbox": "inbox",
  "/api/v1/channels": "inbox",
  "/api/budgeting": "budgeting",
  "/api/v1/cost-model": "profitability",
  "/api/v1/pricing": "pricing",
  "/api/v1/ai": "ai",
  "/api/v1/ai-configs": "ai",
  "/api/v1/ai-sessions": "ai",
  "/api/v1/ai-alerts": "ai",
  "/api/v1/ai-guardrails": "ai",
  "/api/v1/ai-interaction-logs": "ai",
  "/api/v1/calls": "voip",
  // A7 Conversation Intelligence — read-only aggregator over CallLog.insights.
  "/api/v1/conversation-insights": "voip",
  // G3 Calculated Insights mapping already exists at line 571 under the
  // data-cloud block — no separate entry needed.
  "/api/v1/trade-promotions": "tpm",
  "/api/v1/donors": "nonprofit",
  "/api/v1/programs": "nonprofit",
  "/api/v1/donations": "nonprofit",
  "/api/v1/grants": "nonprofit",
  "/api/v1/volunteer-activities": "nonprofit",
  "/api/v1/buyer-accounts": "commerce",
  "/api/v1/buyer-orders": "commerce",
  "/api/v1/rfqs": "commerce",
  "/api/v1/storefronts": "commerce",
  "/api/v1/carts": "commerce",
  "/api/v1/checkout-sessions": "commerce",
  "/api/v1/order-shipments": "commerce",
  "/api/v1/order-returns": "commerce",
  "/api/v1/subscription-plans": "subscriptions",
  "/api/v1/subscriptions": "subscriptions",
  // D4 Subscriptions overview — dashboard aggregator (KPIs / trials /
  // past-due / per-plan MRR). Same module boundary as authoring routes.
  "/api/v1/subscriptions-overview": "subscriptions",
  "/api/v1/dunning-attempts": "subscriptions",
  "/api/v1/payment-providers": "payments",
  "/api/v1/payment-intents": "payments",
  "/api/v1/payment-refunds": "payments",
  "/api/v1/payment-webhooks": "payments",
  "/api/v1/warehouses": "inventory",
  "/api/v1/inventory-items": "inventory",
  "/api/v1/stock-movements": "inventory",
  "/api/v1/low-stock-alerts": "inventory",
  "/api/v1/promo-codes": "loyalty",
  "/api/v1/promo-code-redemptions": "loyalty",
  // Per-id sub-routes (/api/v1/loyalty-accounts/<id>, /<id>/earn, /<id>/redeem)
  // resolve via prefix-match against this entry. Sub-route gating is
  // therefore inherited automatically.
  "/api/v1/loyalty-accounts": "loyalty",
  // D8 Loyalty dashboard — read-only aggregator (tier distribution + top
  // accounts + 30d earn/redeem totals + recent transactions).
  "/api/v1/loyalty-overview": "loyalty",
  "/api/v1/loyalty-transactions": "loyalty",
  // D8 Loyalty slice-2-full Phase B — admin CRUD over tier ladder
  // + earn-rule taxonomy. Per-id sub-routes inherit via prefix-match.
  "/api/v1/loyalty-tiers": "loyalty",
  "/api/v1/loyalty-earn-rules": "loyalty",
  "/api/v1/loyalty-rewards": "loyalty",
  // D8 Loyalty slice-2-full Phase D — storefront earn pipeline.
  // System-driven earn (purchase / signup / referral / ...) computed
  // from EarnRule × tier-multiplier. Distinct from manual admin earn
  // (loyalty-accounts/[id]/earn) which applies points as-given.
  "/api/v1/loyalty-storefront": "loyalty",
  "/api/v1/unified-profiles": "data-cloud",
  "/api/v1/profile-sources": "data-cloud",
  "/api/v1/profile-merge-candidates": "data-cloud",
  // G2 Identity Resolution dashboard — read-only aggregator over
  // profile_merge_candidates for the manual-review queue.
  "/api/v1/identity-merge-queue": "data-cloud",
  "/api/v1/calculated-insights": "data-cloud",
  "/api/v1/profile-insights": "data-cloud",
  "/api/v1/data-cloud-segments": "data-cloud",
  "/api/v1/data-cloud-segment-memberships": "data-cloud",
  // C9 Marketing Attribution — multi-touch attribution engine. Authoring
  // surface (models, runs) sits in the `campaigns` module since marketing
  // operators own attribution-model design. Touchpoint ingestion is
  // server-internal; influences (read-only reports) are also under
  // `campaigns`. Slice-2 may carve a dedicated `attribution` module if
  // a separate analytics-team role becomes needed.
  "/api/v1/attribution-models": "campaigns",
  "/api/v1/campaign-touchpoints": "campaigns",
  "/api/v1/campaign-influences": "campaigns",
  "/api/v1/attribution-calculation-runs": "campaigns",
  // G6 Real-time Event Stream — platform pub/sub infrastructure. Admin
  // surface, so under `settings` module. Slice-2 may carve a dedicated
  // `event-stream` module if subscription-author vs stream-admin role
  // boundary becomes useful. Publish endpoint (slice-2) is API-key
  // authenticated, not role-gated — different access path.
  "/api/v1/event-streams": "settings",
  "/api/v1/event-stream-events": "settings",
  "/api/v1/event-stream-subscriptions": "settings",
  "/api/v1/event-stream-delivery-attempts": "settings",
  "/api/v1/event-stream-dead-letters": "settings",
  // C12 Multi-channel Campaign Orchestrator — per-contact channel
  // preferences + org-level routing policies + cross-channel dedup.
  // Marketing operators own policy + run authoring (`campaigns`
  // module); contact preference rows are technically per-contact
  // data, but slice-2 admin UI puts authoring under the same campaign
  // role boundary. Slice-2 may carve a per-contact `preferences`
  // module if a tighter consent boundary is needed.
  "/api/v1/channel-preferences": "campaigns",
  "/api/v1/orchestration-policies": "campaigns",
  "/api/v1/campaign-orchestration-runs": "campaigns",
  "/api/v1/orchestrated-deliveries": "campaigns",
  // C7 Distributed Marketing — corporate-locked + rep-fillable templates.
  // Marketing operators (campaigns module) own template authoring +
  // distribution assignment. Reps with `campaigns:read` see the gallery,
  // and the slice-2 send route uses operator-level access checks
  // (template visibility = distribution-resolver result) on top of
  // module-level RBAC. Slice-2 may introduce a `template-author` role
  // if a tighter author/sender split is needed.
  "/api/v1/marketing-templates": "campaigns",
  "/api/v1/template-distributions": "campaigns",
  "/api/v1/template-personalizations": "campaigns",
  "/api/v1/template-send-records": "campaigns",
  // A12 Revenue Intelligence — forecast accuracy + pipeline waterfall +
  // deal velocity. The three routes that BACK the Forecast nav pages (moved to
  // the Sales group) gate on `deals` → `sales`, so module availability is
  // coherent with their nav home (these routes use getOrgId, no in-route RBAC —
  // the middleware module-gate is module-only, so reports→deals is a PURE module
  // change, no role-permission impact). The backend-only A12 routes
  // (stage-transitions, velocity-metrics, accuracy-reports — no frontend
  // consumer) stay `reports` (RevOps/sales-ops boundary, same as saved-reports).
  "/api/v1/forecast-snapshots": "deals",            // → sales (Forecast › Snapshots page)
  "/api/v1/pipeline-stage-transitions": "reports",
  "/api/v1/deal-velocity-metrics": "reports",
  "/api/v1/forecast-accuracy-reports": "reports",
  // A12 Pipeline Waterfall — read-only aggregator over stage transitions.
  "/api/v1/pipeline-waterfall": "deals",            // → sales (Forecast › Waterfall page)
  // A12 Deal Velocity — read-only per-stage duration percentiles.
  "/api/v1/deal-velocity": "deals",                 // → sales (Forecast › Velocity page)
  // Forecast main list + pipelines config back Sales nav pages but were
  // previously UNGATED (analytics/forecast = session-only; pipelines = withRls
  // only). Map them to `deals` → `sales` so the middleware module-gate closes
  // the leak (every consumer is a Sales-domain page: forecast / deals / quotes
  // / lead-convert / deal-form).
  "/api/v1/analytics/forecast": "deals",            // → sales (Forecast page)
  "/api/v1/pipelines": "deals",                     // → sales (deal pipelines/stages config)
  // C5 Account Engagement — Pardot-style account list with score/grade/ICP +
  // 30d intent signals. `campaigns` module: marketing-owned ABM view.
  // (Granular per-resource C5 routes already mapped to `account-engagement`
  // module above at lines 470-474; this is the wider UI list endpoint.)
  "/api/v1/account-engagement": "campaigns",
  // C9 `/api/v1/attribution-models` mapping already exists at line 573
  // under the marketing-attribution block — no separate entry needed here.
  // B10 Entitlement Process — granular SLA milestone layer over the
  // existing SlaPolicy. Service Cloud operator surface: under `tickets`
  // module (support managers + service-leads own entitlement +
  // milestone authoring; matches the existing SlaPolicy role boundary).
  // Slice-2 may carve a dedicated `entitlements` module if regulated-
  // industry tenants need a tighter contract-admin audit boundary.
  "/api/v1/entitlements": "tickets",
  "/api/v1/entitlement-milestone-definitions": "tickets",
  "/api/v1/entitlement-ticket-milestones": "tickets",
  "/api/v1/entitlement-audit-events": "tickets",
  // Route & Field (MTM) — all endpoints live under /api/v1/mtm/.
  // Prefix match covers agents, regions, teams, visits, photos,
  // analytics, and any future sub-routes. Mobile JWT callers
  // bypass this module check via getMobileAuth() in the route
  // handler; this map is used only by the web admin panel
  // middleware (cookie-session auth path).
  "/api/v1/mtm": "mtm",
  // Workforce has its own capability wrapper. It is intentionally not mapped
  // to a group ModuleId here; see CAPABILITY_GATED_PERMISSION_SCOPES.
  "/api/v1/workforce": "workforce",
  // Paid-module routes previously absent from this map → resolveModuleFromPath
  // returned null → BOTH the API-key scope check (api-auth.ts) AND the central
  // middleware module gate (middleware.ts) silently skipped them. Each value is
  // verified against the route's nav module (src/lib/nav-items.ts); the middleware
  // bridge then maps it to the gateable ModuleId. (web-chat/whatsapp deliberately
  // omitted — channel routes can have public/visitor sub-paths; review separately.)
  // NOTE: the whole /api/v1/social surface is gated by the `social` group-module
  // (2026-08-01 split — it used to ride on `inbox`→`omnichannel`, which is what
  // made Communication and Social Monitoring one inseparable toggle). The route
  // handlers pass the same `social` scope to withRlsAuth, so the middleware gate
  // and the handler gate agree. EXCEPTION: /api/v1/social/oauth/** is carved out
  // in resolveModuleFromPath — the Meta/TikTok/YouTube connect flow serves BOTH
  // the inbox (Messenger/IG DMs from /settings/channels) and social monitoring,
  // so it enforces an either-module entitlement itself (lib/social/oauth-access.ts)
  // instead of being pinned to one of them.
  "/api/v1/complaints": "tickets",
  "/api/v1/ticket-macros": "tickets",
  "/api/v1/ticket-queues": "tickets",
  "/api/v1/escalation-rules": "tickets",
  "/api/v1/email-log": "campaigns",
  "/api/v1/email-templates": "campaigns",
  "/api/v1/campaign-roi": "campaigns",
  "/api/v1/surveys": "campaigns",
  "/api/v1/social": "social",
  "/api/v1/sequences": "leads",
  "/api/v1/lead-scoring": "leads",
  "/api/v1/lead-rules": "leads",
  "/api/v1/territories": "deals",
  "/api/v1/sales-quotas": "deals",
  "/api/v1/task-templates": "tasks",
  "/api/v1/kb-categories": "kb",
  "/api/v1/quotes": "offers",
  "/api/v1/ai-feedback": "ai",
  "/api/v1/ai-observations": "ai",
  "/api/v1/ai-shadow-actions": "ai",
  "/api/v1/prediction-models": "ai",
  "/api/v1/content-scores": "ai",
  "/api/v1/proactive-alerts": "ai",
}

/**
 * Resolve a module from an API route path.
 */
export function resolveModuleFromPath(path: string): Module | null {
  // Self-service "/me" routes are scoped to the caller's OWN row (every query
  // is `where: { id: userId }` from the verified session), so they must NOT be
  // gated by the `users` ADMIN module — that module governs managing OTHER
  // users (/api/v1/users, /api/v1/users/[id]). Without this, the prefix match
  // below resolves `/api/v1/users/me/*` → `users` and 403s every non-admin from
  // their own profile/password/avatar. Authentication alone gates these.
  if (path === "/api/v1/users/me" || path.startsWith("/api/v1/users/me/")) return null

  // Same trap for the assignee dropdown: /api/v1/users/assignable is a WIDE
  // read (task assignee / deal owner / board-member pickers, gated tasks:read
  // by the route itself) — without this the prefix match resolves it → `users`
  // → bridged to the `settings` ModuleId, and the middleware 403s every org
  // without the settings module (member pickers then spin on "loading" forever).
  if (path === "/api/v1/users/assignable") return null

  // Self-scoped routes, same trap as /users/me above: each writes only the
  // caller's OWN row, so resolving them to an org module would 403 people out
  // of their own settings. `dashboard/layout` filters on
  // `{ organizationId, userId }`, `notifications` on the recipient, and
  // `auth/sms-2fa/*` on `{ id: session.userId }`. Authentication alone gates
  // these. (`dashboard/widget-config` is NOT here — it writes org-wide config.)
  if (path === "/api/v1/dashboard/layout") return null
  if (path === "/api/v1/notifications" || path.startsWith("/api/v1/notifications/")) return null
  if (path.startsWith("/api/v1/auth/")) return null

  // The social OAuth connect flow (start + provider callback) is shared by TWO
  // modules: the inbox connects Messenger/IG DMs through it from
  // /settings/channels, and social monitoring connects the same accounts for
  // mention collection. Resolving it to either module's scope would 403 the
  // other module's tenants, so it stays unresolved here and the start routes do
  // their own either-module entitlement check (lib/social/oauth-access.ts).
  // Callbacks authenticate on their signed state/cookie, not on the session.
  if (path.startsWith("/api/v1/social/oauth/")) return null

  // Try exact match first
  if (ROUTE_MODULE_MAP[path]) return ROUTE_MODULE_MAP[path]

  // Try prefix match (e.g. /api/v1/projects/123/tasks → projects)
  for (const [routePrefix, mod] of Object.entries(ROUTE_MODULE_MAP)) {
    if (path.startsWith(routePrefix + "/") || path === routePrefix) {
      return mod
    }
  }
  return null
}

/**
 * Map HTTP method to permission action.
 */
export function methodToAction(method: string): Action {
  switch (method.toUpperCase()) {
    case "GET": return "read"
    case "POST": return "write"
    case "PUT": case "PATCH": return "write"
    case "DELETE": return "delete"
    default: return "read"
  }
}

export function checkPermission(role: Role, module: Module | string, action: Action): boolean {
  const perms = ROLE_PERMISSIONS[role]
  if (!perms) return false
  // Wildcard roles (admin, viewer)
  if (perms["*"]?.includes(action)) return true
  // Module-specific
  const modulePerms = perms[module]
  if (!modulePerms) return false
  return modulePerms.includes(action)
}

export function requirePermission(role: Role, module: Module | string, action: Action): void {
  if (!checkPermission(role, module, action)) {
    throw new Error(`Permission denied: role "${role}" cannot "${action}" on "${module}"`)
  }
}

export function canRead(role: Role, module: Module): boolean {
  return checkPermission(role, module, "read")
}

export function canWrite(role: Role, module: Module): boolean {
  return checkPermission(role, module, "write")
}

export function canDelete(role: Role, module: Module): boolean {
  return checkPermission(role, module, "delete")
}

export function canExport(role: Role, module: Module): boolean {
  return checkPermission(role, module, "export")
}

export function isAdmin(role: Role): boolean {
  return role === "admin" || role === "superadmin"
}

export function isSuperAdmin(role: Role): boolean {
  return role === "superadmin"
}

export function getUserPermissions(role: Role): Record<string, Action[]> {
  return ROLE_PERMISSIONS[role] || {}
}

/**
 * Get all available modules for permission matrix display.
 */
export const ALL_MODULES: { id: Module; group: string }[] = [
  { id: "companies", group: "CRM" },
  { id: "contacts", group: "CRM" },
  { id: "deals", group: "Sales" },
  { id: "leads", group: "Sales" },
  { id: "tasks", group: "CRM" },
  { id: "contracts", group: "Contracts Control" },
  { id: "offers", group: "Sales" },
  { id: "invoices", group: "CRM" },
  { id: "campaigns", group: "Marketing" },
  { id: "events", group: "Marketing" },
  { id: "journeys", group: "Marketing" },
  { id: "segments", group: "Marketing" },
  { id: "inbox", group: "Communication" },
  { id: "tickets", group: "Support" },
  { id: "kb", group: "Support" },
  { id: "voip", group: "Support" },
  { id: "profitability", group: "Analytics" },
  { id: "budgeting", group: "Analytics" },
  { id: "pricing", group: "Analytics" },
  { id: "reports", group: "Analytics" },
  { id: "ai", group: "Analytics" },
  // Projects is grouped with CRM (not ERP) so admin module-toggle UI
  // matches the sidebar IA — see src/components/sidebar.tsx Phase 2 note.
  { id: "projects", group: "CRM" },
  { id: "revenue-recognition", group: "Finance" },
  { id: "education", group: "Industry" },
  { id: "financial-services", group: "Industry" },
  { id: "health", group: "Industry" },
  { id: "energy-utilities", group: "Industry" },
  { id: "insurance", group: "Industry" },
  { id: "public-sector", group: "Industry" },
  { id: "media", group: "Industry" },
  { id: "account-engagement", group: "Marketing" },
  { id: "mtm", group: "Field Ops" },
  { id: "settings", group: "Settings" },
  { id: "users", group: "Settings" },
  { id: "audit", group: "Settings" },
]

export const ALL_ACTIONS: Action[] = ["read", "write", "delete", "export", "admin"]
export const ALL_ROLES: Role[] = ["superadmin", "admin", "manager", "sales", "support", "ticketing", "viewer"]
