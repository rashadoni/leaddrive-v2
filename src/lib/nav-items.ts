/**
 * Single source of truth for the CRM's main navigation.
 *
 * Previously this array (and the per-group colour maps) lived inline in
 * `src/components/sidebar.tsx`. It was extracted here so the four consumers —
 * the sidebar, the App Launcher overlay, the Cmd+K command palette, and the
 * dashboard Quick Access strip — all read the SAME item list and gate it
 * through the SAME `accessibleNavItems` helper. One code path = no drift and
 * one place to reason about multi-tenant module/feature permissions.
 */
import type { ElementType } from "react"
import { type ModuleId, type AddonFlagId, hasModule } from "@/lib/modules"
import { isTenantCapabilityEnabled, type FieldTenantCapabilityId } from "@/lib/tenant-capabilities"
import { checkPermission, type Role } from "@/lib/permissions"
import { isMtmNavigationItemActive } from "@/lib/mtm/navigation"
import {
  LayoutDashboard, Building2, Users, Handshake, UserPlus,
  CheckSquare, FileText, FileSpreadsheet, Calculator, Brain,
  Ticket, BookOpen, BarChart3, Mail, MessageSquare, MessageCircle, Zap,
  Settings, DollarSign, Target, Send, Clock,
  TrendingUp, Filter, Workflow, Server, Bell, CalendarDays, Headphones, Package, RefreshCw,
  FolderKanban, Wallet, MapPin, Route, Camera, AlertTriangle,
  ClipboardList, UserCog, GitBranch, Plug, Keyboard, Shield, Phone,
  Trophy, Activity, FileBarChart, Bot, Sparkles, Inbox, MessageSquareWarning, Key, Gauge, ChartPie, Award,
  Tag, Wrench, ScanLine, LayoutTemplate, Columns3, Library,
  Globe, Globe2, Hash, LayoutGrid, SearchCheck, Reply, Scale,
  CreditCard, BellRing, Lock,
  // Phase 7 Industry Cloud icons
  HeartPulse, Umbrella, Landmark, Tv2, Flame,
  ClipboardPlus, FileBadge, FileCheck, Radio,
} from "lucide-react"

export interface NavItem {
  /**
   * The sidebar GROUP's commercial module — gates visibility when present.
   * Capability-only areas deliberately leave this empty: Workforce must not
   * inherit the Route & Field entitlement just because both share employees.
   */
  module?: ModuleId
  href: string
  icon: ElementType
  tKey: string
  group: string
  /** Task-oriented subgroup used only inside the Support module navigation. */
  supportSection?: SupportNavSection
  feature?: string
  /**
   * Independently sellable capability layered inside a historical group
   * module. When present it replaces the group's commercial module gate while
   * retaining the group's visual placement and role scope.
   */
  tenantCapability?: FieldTenantCapabilityId
  /**
   * Generic capability spelling used by capability-only areas such as
   * Workforce. Both spellings resolve through the same catalog and preserve
   * legacy MTM grants until an explicit split marker is written.
   */
  capability?: FieldTenantCapabilityId
  /**
   * Cross-cutting paid add-on flag ("ai" | "voip"). When present the item is
   * shown only if the org ALSO has the addon module — on top of the group
   * module gate. Applied on both the superadmin and regular paths of
   * `accessibleNavItems`, mirroring `feature` behavior.
   */
  addon?: AddonFlagId
  /**
   * When true, the dashboard layout does NOT hard-block the PAGE for tenants lacking `module` (it still
   * gates SIDEBAR VISIBILITY by `module`). For pages whose real access boundary is enforced server-side
   * by the API (e.g. /settings/channels — gated + grandfathered in gateChannelsAccess), so a tenant who
   * legitimately has data there (e.g. an existing channel) can still reach the page by URL.
   */
  pageUngated?: boolean
  /**
   * Optional PERMISSION scope (permissions.Module vocabulary) the viewer's role
   * must be able to read for this item to appear. The module gate answers "does
   * the TENANT pay for this?"; this answers "is this role allowed to open it?".
   * Used where one paid module contains a stricter sub-surface — today only the
   * Social Monitoring legal desk (`social-legal`, admin-only) inside the
   * otherwise manager-facing `social` module. Without it a manager would see a
   * menu entry that answers 403 — the exact broken pattern the social-mention
   * notifications had.
   */
  permissionScope?: string
  /**
   * Optional role allow-list for a page that is intentionally narrower than a
   * reusable permission scope. Workforce configuration is session-admin-only:
   * managers may operate work time, but must not be sent to a configuration
   * endpoint that correctly returns 403.
   */
  allowedRoles?: readonly Role[]
}

export type SupportNavSection = "work" | "team" | "rules"

export const SUPPORT_NAV_SECTION_ORDER: readonly SupportNavSection[] = ["work", "team", "rules"]

/**
 * Shape of the `org` context the navigation gate needs. Matches the object the
 * dashboard layout builds from the session (see `(dashboard)/layout.tsx`).
 */
export interface OrgNavContext {
  plan: string
  addons?: string[]
  modules?: Record<string, boolean>
  role?: string
}

/**
 * Build the nav permission context from a NextAuth session user. Centralized so
 * the dashboard layout, command palette, and Quick Access strip can't drift on
 * the default plan/role fallbacks (which would silently diverge the gating).
 */
export function orgFromSession(user: unknown): OrgNavContext {
  const u = user as { plan?: string; addons?: string[]; modules?: Record<string, boolean>; role?: string } | undefined
  return {
    plan: u?.plan || "enterprise",
    addons: u?.addons || [],
    modules: u?.modules || undefined,
    role: u?.role || "viewer",
  }
}

export const navItems: NavItem[] = [
  { module: "crm", href: "/dashboard", icon: LayoutDashboard, tKey: "dashboard", group: "CRM" },
  { module: "crm", href: "/companies", icon: Building2, tKey: "companies", group: "CRM" },
  { module: "crm", href: "/contacts", icon: Users, tKey: "contacts", group: "CRM" },
  // "/tasks" (Tapşırıqlar) intentionally removed from the menu — boards are the
  // primary task surface now. The page + /tasks/[id] detail still exist (board
  // cards link to the detail; the DONE-overflow links to /tasks), just unlinked.
  { module: "crm", href: "/boards", icon: Columns3, tKey: "boards", group: "CRM" },
  // ── Sales ────────────────────────────────────────────────────────────────
  // Dedicated Sales group/module (1 группа = 1 модуль): the seller's daily path
  // — leads → deals → quotes (CPQ) → sequences (cadences) → forecast — plus the
  // sales-setup pages (pipelines / quotas / territories). Gated by the `sales`
  // group-module, which is a BASE module (every tenant gets it, like crm), so
  // carving deals/leads out of crm never removes pipeline access. The API gate
  // follows automatically: the deals/leads/offers permission-modules map to
  // `sales` in LEGACY_MODULE_MAP (→ middleware + requireAuth). The FIRST Sales
  // item appears HERE (before Contracts) so the group renders 2nd in the
  // sidebar, right after CRM.
  { module: "sales", href: "/leads", icon: UserPlus, tKey: "leads", group: "Sales" },
  { module: "sales", href: "/deals", icon: Handshake, tKey: "deals", group: "Sales" },
  { module: "sales", href: "/quotes", icon: FileBadge, tKey: "quotes", group: "Sales" },
  { module: "sales", href: "/sequences", icon: Zap, tKey: "sequences", group: "Sales" },
  { module: "sales", href: "/forecast", icon: TrendingUp, tKey: "forecast", group: "Sales" },
  { module: "sales", href: "/forecast/snapshots", icon: Camera, tKey: "forecastSnapshots", group: "Sales" },
  { module: "sales", href: "/forecast/waterfall", icon: Workflow, tKey: "pipelineWaterfall", group: "Sales" },
  { module: "sales", href: "/forecast/velocity", icon: Gauge, tKey: "dealVelocity", group: "Sales" },
  // Sales setup — live under /settings/* but their HOME is the sales module, so
  // they're gated by `sales` and shown at the bottom of the Sales group.
  { module: "sales", href: "/settings/pipelines", icon: GitBranch, tKey: "pipelines", group: "Sales" },
  { module: "sales", href: "/settings/quotas", icon: Target, tKey: "quotas", group: "Sales" },
  { module: "sales", href: "/settings/sales-forecast", icon: TrendingUp, tKey: "salesForecastSettings", group: "Sales" },
  { module: "sales", href: "/settings/territories", icon: MapPin, tKey: "territories", group: "Sales" },
  { module: "sales", href: "/settings/lead-rules", icon: Filter, tKey: "leadRules", group: "Sales" },
  { module: "sales", href: "/settings/web-to-lead", icon: Globe, tKey: "webToLead", group: "Sales" },
  { module: "contracts", href: "/contracts", icon: FileText, tKey: "contracts", group: "Contracts Control" },
  { module: "contracts", href: "/contracts/lifecycle", icon: RefreshCw, tKey: "contractLifecycle", group: "Contracts Control" },
  { module: "contracts", href: "/contracts/templates", icon: Library, tKey: "contractTemplatesNav", group: "Contracts Control" },
  { module: "contracts", href: "/settings/intake-forms", icon: ClipboardList, tKey: "intakeFormsNav", group: "Contracts Control" },
  { module: "contracts", href: "/contracts/request", icon: Send, tKey: "contractRequestsNav", group: "Contracts Control" },
  // Approval config (rules + delegates) lives in the Contracts group — same
  // pattern as intake-forms above: the page sits under /settings/* but its real
  // home is the contracts module, so it's gated by `contracts` and shown here
  // (not buried in the Parametrlər catch-all). The /settings landing no longer
  // duplicates these tiles.
  { module: "contracts", href: "/settings/approval-rules", icon: GitBranch, tKey: "approvalRulesNav", group: "Contracts Control" },
  { module: "contracts", href: "/settings/approval-delegates", icon: UserCog, tKey: "approvalDelegatesNav", group: "Contracts Control" },
  { module: "contracts", href: "/contracts/milestones", icon: CheckSquare, tKey: "contractMilestonesNav", group: "Contracts Control" },
  { module: "contracts", href: "/contracts/analytics", icon: BarChart3, tKey: "contractAnalyticsNav", group: "Contracts Control" },
  { module: "crm", href: "/products", icon: Package, tKey: "products", group: "CRM" },
  { module: "crm", href: "/notifications", icon: Bell, tKey: "notifications", group: "CRM" },
  // CDP / unified customer profile is CRM infrastructure, not Marketing. It is
  // available with the CRM module even when Marketing is disabled, so it must
  // live in the CRM group too. Otherwise a CRM-only tenant sees a misleading
  // "Marketing" section although no Marketing entitlement was selected.
  // CDP (Customer Data Platform) is FREE base infrastructure: its API scope
  // `data-cloud` is intentionally ungated (INTENTIONALLY_UNGATED in modules.ts),
  // so gate the nav on the base `crm` module too — visible to EVERY tenant, not
  // behind the paid `marketing` add-on. `navItem.module` drives both the sidebar
  // AND the page-level ModuleDisabled gate (layout.tsx:76), so navigation,
  // page and API agree (all free). Decision 2026-06-20: CDP = free base.
  { module: "crm", href: "/cdp/insights", icon: Sparkles, tKey: "customerInsights", group: "CRM" },
  { module: "crm", href: "/cdp/merge-queue", icon: GitBranch, tKey: "identityMergeQueue", group: "CRM" },
  { module: "marketing", href: "/campaigns", icon: Mail, tKey: "campaigns", group: "Marketing" },
  { module: "marketing", href: "/segments", icon: Filter, tKey: "segments", group: "Marketing" },
  // Loyalty Program is its own tenant module: all loyalty CRUD/POS sections
  // stay under /loyalty/* routes, but their nav/page/API gate is `loyalty`
  // rather than the broader Marketing module.
  { module: "loyalty", href: "/loyalty/builder", icon: Sparkles, tKey: "loyaltyBuilder", group: "Loyalty Program" },
  { module: "loyalty", href: "/loyalty/dashboard", icon: Award, tKey: "loyaltyProgram", group: "Loyalty Program" },
  { module: "loyalty", href: "/loyalty/pos", icon: ScanLine, tKey: "loyaltyPos", group: "Loyalty Program" },
  { module: "loyalty", href: "/loyalty/tiers", icon: Trophy, tKey: "loyaltyTiers", group: "Loyalty Program" },
  { module: "loyalty", href: "/loyalty/earn-rules", icon: Zap, tKey: "loyaltyEarnRules", group: "Loyalty Program" },
  { module: "loyalty", href: "/loyalty/promo-codes", icon: Ticket, tKey: "loyaltyPromoCodes", group: "Loyalty Program" },
  { module: "marketing", href: "/email-templates", icon: Send, tKey: "emailTemplates", group: "Marketing" },
  { module: "marketing", href: "/email-log", icon: FileText, tKey: "emailLog", group: "Marketing" },
  // Attribution model is the ENGINE that computes Campaign ROI's attributed
  // revenue — keep the two adjacent so they read as configure-model → see-result.
  { module: "marketing", href: "/attribution/models", icon: ChartPie, tKey: "attributionModels", group: "Marketing" },
  { module: "marketing", href: "/campaign-roi", icon: TrendingUp, tKey: "campaignRoi", group: "Marketing" },
  { module: "marketing", href: "/ai-scoring", icon: Target, tKey: "aiScoring", group: "Marketing" },
  { module: "marketing", href: "/journeys", icon: Workflow, tKey: "journeys", group: "Marketing" },
  { module: "marketing", href: "/events", icon: CalendarDays, tKey: "events", group: "Marketing" },
  { module: "marketing", href: "/surveys", icon: Sparkles, tKey: "surveys", group: "Marketing" },
  { module: "marketing", href: "/accounts/engagement", icon: Building2, tKey: "accountEngagement", group: "Marketing" },
  { module: "omnichannel", href: "/inbox", icon: MessageSquare, tKey: "inbox", group: "Communication" },
  { module: "omnichannel", href: "/settings/snippets", icon: Hash, tKey: "snippets", group: "Communication" },
  { module: "omnichannel", href: "/inbox/analytics", icon: BarChart3, tKey: "inboxAnalyticsNav", group: "Communication" },
  { module: "omnichannel", href: "/inbox/chatbot-rules", icon: Bot, tKey: "chatbotRulesNav", group: "Communication" },
  { module: "omnichannel", href: "/inbox/automation", icon: Workflow, tKey: "inboxAutomationNav", group: "Communication" },
  { module: "omnichannel", href: "/inbox/business-hours", icon: Clock, tKey: "businessHoursNav", group: "Communication" },
  { module: "omnichannel", href: "/settings/channels", icon: Radio, tKey: "channelsNav", group: "Communication", pageUngated: true },
  { module: "omnichannel", href: "/inbox/voip", icon: Phone, tKey: "voipCalls", group: "Communication", addon: "voip" },
  // ── Social Monitoring («Sosial monitorinq») ────────────────────────────────
  // Отдельная сайдбар-группа (по просьбе владельца, 2026-07-31): все виды
  // страницы /social-monitoring вынесены из внутристраничной панели в меню.
  // Гейт — СОБСТВЕННЫЙ модуль `social` (2026-08-01): пока группа висела на
  // `omnichannel`, в админке обе группы делили один тумблер и выключение
  // Communication уносило соцмониторинг вместе с собой. Тенантам, у которых был
  // omnichannel, `social` дописан бэкфилл-миграцией 20260801090000.
  // Href'ы несут query-параметры одного роута; sidebar и matchNavItem матчат
  // их по pathname-части (см. navItemPathname), подсветка — по query.
  { module: "social", href: "/social-monitoring?scope=all&view=overview", icon: Activity, tKey: "socialMonitoringOverview", group: "Social Monitoring" },
  { module: "social", href: "/social-monitoring?view=monitors", icon: LayoutGrid, tKey: "socialMonitoringClients", group: "Social Monitoring" },
  { module: "social", href: "/social-monitoring?scope=all&view=mentions", icon: SearchCheck, tKey: "socialMonitoringFindings", group: "Social Monitoring" },
  { module: "social", href: "/social-monitoring?scope=all&view=replies", icon: Reply, tKey: "socialMonitoringReplies", group: "Social Monitoring" },
  { module: "social", href: "/social-monitoring?scope=all&view=sources", icon: Plug, tKey: "socialMonitoringSources", group: "Social Monitoring" },
  { module: "social", href: "/social-monitoring?scope=all&view=scenarios", icon: Target, tKey: "socialMonitoringScenarios", group: "Social Monitoring" },
  { module: "social", href: "/social-monitoring?scope=all&view=subjects", icon: Tag, tKey: "socialMonitoringSubjects", group: "Social Monitoring" },
  { module: "social", href: "/social-monitoring?scope=all&view=media", icon: ScanLine, tKey: "socialMonitoringMedia", group: "Social Monitoring" },
  { module: "social", href: "/social-monitoring?scope=all&view=reports", icon: FileText, tKey: "socialMonitoringReports", group: "Social Monitoring" },
  { module: "social", href: "/social-monitoring?scope=all&view=agent", icon: Sparkles, tKey: "socialMonitoringAgent", group: "Social Monitoring" },
  { module: "social", href: "/social-monitoring?scope=all&view=legal", icon: Scale, tKey: "socialMonitoringLegal", group: "Social Monitoring", permissionScope: "social-legal" },
  { module: "social", href: "/social-monitoring?scope=all&view=settings", icon: Settings, tKey: "socialMonitoringSettings", group: "Social Monitoring" },
  // Post-call analysis is part of the independently purchasable VoIP module,
  // not Support. A tenant with VoIP but without the service-desk module must
  // still see the summaries, transcripts and next steps from its AI calls.
  { module: "voip", href: "/voip/insights", icon: Brain, tKey: "conversationInsights", group: "VoIP" },
  { module: "support", href: "/tickets", icon: Ticket, tKey: "tickets", group: "Support", supportSection: "work" },
  { module: "support", feature: "complaints_register", href: "/complaints", icon: MessageSquareWarning, tKey: "complaints", group: "Support", supportSection: "work" },
  { module: "support", href: "/support/agent-desktop", icon: Headphones, tKey: "agentDesktop", group: "Support", supportSection: "work" },
  { module: "support", href: "/support/voip", icon: Phone, tKey: "voipCalls", group: "Support", addon: "voip", supportSection: "work" },
  { module: "support", href: "/knowledge-base", icon: BookOpen, tKey: "knowledgeBase", group: "Support", supportSection: "work" },
  { module: "support", href: "/support/skill-routing", icon: Route, tKey: "skillRouting", group: "Support", supportSection: "team" },
  { module: "support", href: "/support/calendar", icon: CalendarDays, tKey: "agentCalendar", group: "Support", supportSection: "team" },
  { module: "support", href: "/settings/portal-users", icon: Shield, tKey: "portalUsersNav", group: "Support", supportSection: "team" },
  // Ticket/service-desk rules may live under /support/* or /settings/*, but
  // their product home remains Support rather than the generic Settings group.
  { module: "support", href: "/settings/ticket-categories", icon: Tag, tKey: "ticketCategoriesNav", group: "Support", supportSection: "rules" },
  { module: "support", href: "/settings/sla-policies", icon: Clock, tKey: "slaPoliciesNav", group: "Support", supportSection: "rules" },
  { module: "support", href: "/support/entitlements", icon: Shield, tKey: "entitlements", group: "Support", supportSection: "rules" },
  { module: "support", href: "/settings/entitlement-templates", icon: LayoutTemplate, tKey: "entitlementTemplatesNav", group: "Support", supportSection: "rules" },
  { module: "support", href: "/settings/escalation", icon: AlertTriangle, tKey: "escalationRules", group: "Support", supportSection: "rules" },
  { module: "support", href: "/settings/macros", icon: Keyboard, tKey: "macros", group: "Support", supportSection: "rules" },
  { module: "support", href: "/support/ai-settings", icon: Bot, tKey: "supportAiNav", group: "Support", addon: "ai", allowedRoles: ["admin", "superadmin"], supportSection: "rules" },
  { module: "finance", href: "/invoices", icon: FileSpreadsheet, tKey: "invoices", group: "Finance" },
  { module: "finance", href: "/billing/subscriptions", icon: RefreshCw, tKey: "subscriptionsOverview", group: "Finance" },
  { module: "finance", href: "/finance", icon: Wallet, tKey: "finance", group: "Finance" },
  { module: "finance", href: "/profitability", icon: Calculator, tKey: "profitability", group: "Finance" },
  { module: "finance", href: "/pricing", icon: DollarSign, tKey: "pricing", group: "Finance" },
  { module: "analytics", href: "/reports", icon: BarChart3, tKey: "reports", group: "Analytics" },
  { module: "analytics", href: "/reports/builder", icon: FileSpreadsheet, tKey: "reportBuilder", group: "Analytics" },
  { module: "analytics", href: "/ai/actions", icon: Inbox, tKey: "aiActions", group: "Analytics", addon: "ai" },
  { module: "analytics", href: "/ai-command-center", icon: Brain, tKey: "aiCenter", group: "Analytics", addon: "ai" },
  // Voice console — NOT in the menu. The orb is mounted in the dashboard layout
  // and is present on every page, so a separate entry pointed at a page that
  // does the same thing in one place only. The owner put it plainly: the menu
  // item is redundant when the icon is everywhere. The page still exists and is
  // still gated; nothing links to it.
  // KPI Arena — cross-department gamified leaderboard ("Crypto Bubbles" style).
  // Gated on `analytics` (a base-plan module) for sidebar visibility; the page
  // itself shows only the groups the viewer may see (RBAC + per-group module
  // gate via /api/v1/leaderboard/groups), so a non-manager sees just their dept.
  { module: "analytics", href: "/leaderboard", icon: Award, tKey: "kpiArena", group: "Analytics" },
  // Projects lives in CRM group (next to Tasks/Deals/Contacts) because
  // 90% of usage is around customer projects — sales/onboarding/delivery.
  // Phase 2 (Task→Project rollup) ties these together so the navigation
  // adjacency reflects the data adjacency.
  { module: "crm", href: "/projects", icon: FolderKanban, tKey: "projects", group: "CRM" },
  { module: "mtm", tenantCapability: "route-field", href: "/mtm", icon: MapPin, tKey: "mtmDashboard", group: "Route & Field" },
  { module: "mtm", tenantCapability: "route-field", href: "/mtm/map", icon: MapPin, tKey: "mtmMap", group: "Route & Field" },
  { module: "mtm", tenantCapability: "route-field", href: "/mtm/routes", icon: Route, tKey: "mtmRoutes", group: "Route & Field" },
  { module: "mtm", href: "/mtm/operations", icon: Radio, tKey: "mtmOperations", group: "Route & Field" },
  { module: "mtm", tenantCapability: "route-field", href: "/mtm/visits", icon: CheckSquare, tKey: "mtmVisits", group: "Route & Field" },
  { module: "mtm", href: "/mtm/promotions", icon: FileBadge, tKey: "mtmPromotions", group: "Route & Field" },
  { module: "mtm", tenantCapability: "route-field", href: "/mtm/tasks", icon: ClipboardList, tKey: "mtmTasks", group: "Route & Field" },
  { module: "mtm", tenantCapability: "route-field", href: "/mtm/customers", icon: Building2, tKey: "mtmCustomers", group: "Route & Field" },
  { module: "mtm", tenantCapability: "route-field", href: "/mtm/contacts", icon: Users, tKey: "mtmContacts", group: "Route & Field" },
  { module: "mtm", tenantCapability: "route-field", href: "/mtm/photos", icon: Camera, tKey: "mtmPhotos", group: "Route & Field" },
  { module: "mtm", tenantCapability: "route-field", href: "/mtm/alerts", icon: AlertTriangle, tKey: "mtmAlerts", group: "Route & Field" },
  { module: "mtm", tenantCapability: "route-field", href: "/mtm/agents", icon: UserCog, tKey: "mtmAgents", group: "Route & Field" },
  { module: "mtm", tenantCapability: "route-field", href: "/mtm/analytics", icon: BarChart3, tKey: "mtmAnalytics", group: "Route & Field" },
  { module: "mtm", tenantCapability: "route-field", href: "/mtm/leaderboard", icon: Trophy, tKey: "mtmLeaderboard", group: "Route & Field" },
  { module: "mtm", tenantCapability: "route-field", href: "/mtm/activity", icon: Activity, tKey: "mtmActivity", group: "Route & Field" },
  { module: "mtm", tenantCapability: "route-field", href: "/mtm/reports", icon: FileBarChart, tKey: "mtmReports", group: "Route & Field" },
  { module: "mtm", href: "/mtm/settings", icon: Settings, tKey: "mtmSettings", group: "Route & Field" },
  // Workforce is a first-class capability, not a Route & Field child. It has
  // no `module` on purpose: a tenant can run timekeeping with no routes.
  { href: "/workforce", icon: Clock, tKey: "workforceToday", group: "HRM", capability: "workforce-hrm", permissionScope: "workforce" },
  { href: "/workforce/timesheet", icon: CalendarDays, tKey: "workforceTimesheet", group: "HRM", capability: "workforce-hrm", permissionScope: "workforce" },
  { href: "/workforce/requests", icon: ClipboardList, tKey: "workforceRequests", group: "HRM", capability: "workforce-hrm", permissionScope: "workforce" },
  { href: "/workforce/configuration", icon: Settings, tKey: "workforceConfiguration", group: "HRM", capability: "workforce-hrm", permissionScope: "workforce", allowedRoles: ["admin", "superadmin"] },
  // Phase 7 — R2 Health Cloud
  { module: "health", href: "/health", icon: HeartPulse, tKey: "healthPatients", group: "Health Cloud" },
  { module: "health", href: "/health/encounters", icon: ClipboardPlus, tKey: "healthEncounters", group: "Health Cloud" },
  { module: "health", href: "/health/care-plans", icon: FileCheck, tKey: "healthCarePlans", group: "Health Cloud" },
  { module: "health", href: "/health/providers", icon: Users, tKey: "healthProviders", group: "Health Cloud" },
  // Phase 7 — R7 Insurance Cloud
  { module: "insurance", href: "/insurance", icon: Umbrella, tKey: "insurancePolicyholders", group: "Insurance Cloud" },
  { module: "insurance", href: "/insurance/policies", icon: FileText, tKey: "insurancePolicies", group: "Insurance Cloud" },
  { module: "insurance", href: "/insurance/claims", icon: Shield, tKey: "insuranceClaims", group: "Insurance Cloud" },
  { module: "insurance", href: "/insurance/beneficiaries", icon: Users, tKey: "insuranceBeneficiaries", group: "Insurance Cloud" },
  // Phase 7 — R8 Public Sector Cloud
  { module: "public-sector", href: "/public-sector", icon: Landmark, tKey: "publicSectorCitizens", group: "Public Sector" },
  { module: "public-sector", href: "/public-sector/cases", icon: ClipboardList, tKey: "publicSectorCases", group: "Public Sector" },
  { module: "public-sector", href: "/public-sector/licenses", icon: FileBadge, tKey: "publicSectorLicenses", group: "Public Sector" },
  { module: "public-sector", href: "/public-sector/grants", icon: DollarSign, tKey: "publicSectorGrants", group: "Public Sector" },
  // Phase 7 — R11 Media Cloud
  { module: "media", href: "/media", icon: Tv2, tKey: "mediaSubscribers", group: "Media Cloud" },
  { module: "media", href: "/media/content", icon: FileText, tKey: "mediaContent", group: "Media Cloud" },
  { module: "media", href: "/media/ad-campaigns", icon: Radio, tKey: "mediaAdCampaigns", group: "Media Cloud" },
  // Phase 7 — R6 Energy & Utilities Cloud
  { module: "energy", href: "/energy", icon: Flame, tKey: "energyCustomers", group: "Energy & Utilities" },
  { module: "energy", href: "/energy/metering", icon: Gauge, tKey: "energyMetering", group: "Energy & Utilities" },
  { module: "energy", href: "/energy/outages", icon: Zap, tKey: "energyOutages", group: "Energy & Utilities" },
  { module: "energy", href: "/energy/service-calls", icon: Wrench, tKey: "energyServiceCalls", group: "Energy & Utilities" },
  // ── Module-scoped settings ────────────────────────────────────────────────
  // These pages live under /settings/* but their HOME is a specific module, so
  // they're gated by that module and shown at the BOTTOM of its sidebar group
  // (array order) — NOT in the generic Parametrlər catch-all. Same pattern as
  // intake-forms / approval-rules above. The /settings landing no longer
  // duplicates these as tiles.
  // CRM — pipelines/quotas/territories moved to the Sales group (see top of array).
  { module: "crm", href: "/settings/task-templates", icon: FileText, tKey: "taskTemplates", group: "CRM" },
  // NB: custom-fields + currencies deliberately NOT moved — LEGACY_MODULE_MAP
  // (modules.ts:67) classifies both as `settings` (org-level, cross-cutting:
  // currencies drive deal/invoice amounts, custom-fields span every entity), so
  // they stay in Parametrlər. Moving them would 403 the page for a tenant that
  // has crm/finance but not the settings module.
  // Finance
  { module: "finance", href: "/settings/invoice-settings", icon: FileSpreadsheet, tKey: "invoiceSettingsNav", group: "Finance" },
  { module: "finance", href: "/settings/finance-notifications", icon: Bell, tKey: "financeNotificationsNav", group: "Finance" },
  // Support settings live inside the Support group next to /tickets above.
  // Communication
  { module: "omnichannel", href: "/settings/web-chat", icon: MessageCircle, tKey: "webChatNav", group: "Communication" },
  // Per-group AI agent — last section of the Communication group (omnichannel's own
  // agent + per-channel AI/agent matrix; kept separate from the support/sales agents).
  { module: "omnichannel", href: "/inbox/ai-agent", icon: Sparkles, tKey: "aiAgentNav", group: "Communication", addon: "ai" },

  // ── Org-level / cross-cutting settings ────────────────────────────────────
  // These nine used to exist ONLY as cards on the /settings hub. That made the
  // hub a mandatory second stop — the owner's words: "не нужно чтоб были в
  // bütün parametrlər". They are listed here first, in the hub's original card
  // order, so the org-level pages read as a block before the module setup ones.
  { module: "settings", href: "/settings/organization", icon: Building2, tKey: "organizationSettings", group: "Settings" },
  { module: "settings", href: "/settings/billing", icon: CreditCard, tKey: "billingSettings", group: "Settings" },
  { module: "settings", href: "/settings/roles", icon: UserCog, tKey: "rolesSettings", group: "Settings" },
  { module: "settings", href: "/settings/security", icon: Lock, tKey: "securitySettings", group: "Settings" },
  { module: "settings", href: "/settings/audit-log", icon: FileText, tKey: "auditLogSettings", group: "Settings" },
  { module: "settings", href: "/settings/custom-fields", icon: Sparkles, tKey: "customFieldsSettings", group: "Settings" },
  { module: "settings", href: "/settings/notifications", icon: BellRing, tKey: "notificationSettings", group: "Settings" },
  { module: "settings", href: "/settings/custom-domains", icon: Globe2, tKey: "customDomainsSettings", group: "Settings" },
  { module: "settings", href: "/settings/dashboard", icon: LayoutDashboard, tKey: "dashboardSettings", group: "Settings" },
  { module: "settings", href: "/settings/workflows", icon: Zap, tKey: "workflows", group: "Settings" },
  { module: "settings", href: "/settings/workflows/templates", icon: Sparkles, tKey: "workflowTemplates", group: "Settings" },
  { module: "settings", href: "/settings/users", icon: Users, tKey: "users", group: "Settings" },
  { module: "settings", href: "/settings/smtp-settings", icon: Server, tKey: "smtp", group: "Settings" },
  { module: "settings", href: "/settings/integrations", icon: Plug, tKey: "integrations", group: "Settings" },
  // Telephony provider setup. Lives under Settings (not Support) because that is
  // where owners look for it — the page configures a provider connection, not a
  // support workflow. Still addon-gated: the VoIP add-on covers this page plus
  // the call log and call insights.
  { module: "settings", href: "/settings/voip", icon: Phone, tKey: "voip", group: "Settings", addon: "voip" },
  { module: "settings", href: "/marketplace", icon: Package, tKey: "marketplace", group: "Settings" },
  { module: "settings", href: "/settings/api-keys", icon: Key, tKey: "apiKeys", group: "Settings" },
  { module: "settings", href: "/settings/field-permissions", icon: Shield, tKey: "fieldPermissions", group: "Settings" },
  { module: "settings", href: "/settings/leaderboard", icon: Gauge, tKey: "kpiArenaConfig", group: "Settings" },
  { module: "settings", href: "/settings/call-tasks", icon: ClipboardList, tKey: "callTaskSettings", group: "Settings" },
  { module: "settings", href: "/settings/ai-automation", icon: Bot, tKey: "aiAutomation", group: "Settings", addon: "ai" },
]

/**
 * Premium mono nav palette (2026-06-07 — replaced the per-group "rainbow" where
 * every section had its own saturated colour, which read as un-premium). One
 * restrained accent: group labels stay uniform-muted; the active nav item is a
 * white "capsule" (white icon + text + a slightly stronger bg) marked by a
 * single brand-orange (#FF4D00) left bar — the only colour left in the menu.
 * Named constants (not per-group maps) = single source of truth, consumed by the
 * sidebar + command palette.
 */
export const NAV_GROUP_LABEL = "text-white/60"        // group header text — uniform, muted but clearly legible
export const NAV_ACTIVE_ICON = "text-white"           // active item icon — white (the accent is the bar only)
export const NAV_ACTIVE_BAR = "before:bg-[#FF4D00]"   // active item left accent bar — the single brand accent

/**
 * Stable group order = order of first appearance in `navItems`. The launcher
 * and sidebar both iterate groups in this order so the two views stay aligned.
 */
export const NAV_GROUP_ORDER: string[] = [...new Set(navItems.map((i) => i.group))]

/**
 * Richer, more varied palette used ONLY by the App Launcher / Quick Access tiles
 * (the sidebar keeps its restrained dark-navy accents). Each group gets a
 * distinct hue so the grid is colourful and scannable instead of all-orange.
 * `chip` = soft tinted icon-chip background, `icon` = vivid glyph colour, `dot`
 * = solid accent for section headers. Literal class strings so Tailwind detects
 * them. Works in light, dark, and wallpaper themes (tint + vivid glyph read on
 * any background).
 */
export const GROUP_LAUNCHER_STYLE: Record<string, { chip: string; icon: string; dot: string }> = {
  CRM:                    { chip: "bg-orange-500/15",  icon: "text-orange-500",  dot: "bg-orange-500" },
  Sales:                  { chip: "bg-red-500/15",     icon: "text-red-500",     dot: "bg-red-500" },
  "Contracts Control":    { chip: "bg-blue-500/15",    icon: "text-blue-500",    dot: "bg-blue-500" },
  Marketing:              { chip: "bg-pink-500/15",    icon: "text-pink-500",    dot: "bg-pink-500" },
  "Loyalty Program":      { chip: "bg-lime-500/15",    icon: "text-lime-600",    dot: "bg-lime-500" },
  Communication:        { chip: "bg-violet-500/15",  icon: "text-violet-500",  dot: "bg-violet-500" },
  "Social Monitoring":  { chip: "bg-green-500/15",   icon: "text-green-600",   dot: "bg-green-500" },
  VoIP:                 { chip: "bg-cyan-500/15",    icon: "text-cyan-600",    dot: "bg-cyan-500" },
  Support:              { chip: "bg-emerald-500/15", icon: "text-emerald-500", dot: "bg-emerald-500" },
  Finance:              { chip: "bg-amber-500/15",   icon: "text-amber-600",   dot: "bg-amber-500" },
  Analytics:            { chip: "bg-purple-500/15",  icon: "text-purple-500",  dot: "bg-purple-500" },
  ERP:                  { chip: "bg-indigo-500/15",  icon: "text-indigo-500",  dot: "bg-indigo-500" },
  "Route & Field":      { chip: "bg-cyan-500/15",    icon: "text-cyan-500",    dot: "bg-cyan-500" },
  HRM:                  { chip: "bg-sky-500/15",     icon: "text-sky-600",     dot: "bg-sky-500" },
  "Health Cloud":       { chip: "bg-rose-500/15",    icon: "text-rose-500",    dot: "bg-rose-500" },
  "Insurance Cloud":    { chip: "bg-sky-500/15",     icon: "text-sky-500",     dot: "bg-sky-500" },
  "Public Sector":      { chip: "bg-teal-500/15",    icon: "text-teal-500",    dot: "bg-teal-500" },
  "Media Cloud":        { chip: "bg-fuchsia-500/15", icon: "text-fuchsia-500", dot: "bg-fuchsia-500" },
  "Energy & Utilities": { chip: "bg-yellow-500/15",  icon: "text-yellow-600",  dot: "bg-yellow-500" },
  Settings:             { chip: "bg-slate-500/15",   icon: "text-slate-500",   dot: "bg-slate-500" },
}

const FALLBACK_LAUNCHER_STYLE = { chip: "bg-muted", icon: "text-muted-foreground", dot: "bg-muted-foreground" }

/** Launcher tile/chip colours for a group, with a neutral fallback. */
export function groupLauncherStyle(group: string) {
  return GROUP_LAUNCHER_STYLE[group] ?? FALLBACK_LAUNCHER_STYLE
}

/**
 * The nav items the given org may see, gated identically to the sidebar:
 * superadmin sees every module-backed item (subject to feature, add-on and
 * capability flags); every other role is additionally gated by `hasModule` on
 * the item's GROUP module.
 * `feature` (when present) must be explicitly enabled in `org.modules`;
 * `addon` (when present) must pass `hasModule` — the AI/VoIP add-ons are paid
 * cross-cutting flags layered ON TOP of the group module, so they gate on both
 * paths exactly like `feature` does.
 */
export function isNavItemEnabled(
  org: OrgNavContext,
  item: NavItem,
  options: { ignoreModuleGate?: boolean } = {},
): boolean {
  const featureEnabled = !item.feature || org.modules?.[item.feature] === true
  const addonEnabled = !item.addon || hasModule(org, item.addon)
  const capability = item.tenantCapability ?? item.capability
  const moduleEnabled = options.ignoreModuleGate || !item.module || Boolean(capability) || hasModule(org, item.module)
  const capabilityEnabled = !capability || isTenantCapabilityEnabled(capability, {
    plan: org.plan,
    addons: org.addons,
    modules: org.modules,
  })
  return moduleEnabled && featureEnabled && addonEnabled && capabilityEnabled
}

export function accessibleNavItems(org: OrgNavContext): NavItem[] {
  const showAll = org.role === "superadmin"
  // Роль-гейт для под-поверхностей с более строгой границей, чем у модуля
  // (сейчас — юридический стол соцмониторинга). Superadmin проходит по wildcard
  // внутри checkPermission, так что отдельная ветка не нужна.
  const roleAllowed = (i: NavItem) =>
    (!i.permissionScope || checkPermission((org.role as Role) || "viewer", i.permissionScope, "read"))
    && (!i.allowedRoles || i.allowedRoles.includes((org.role as Role) || "viewer"))
  return navItems.filter((item) =>
    isNavItemEnabled(org, item, { ignoreModuleGate: showAll }) && roleAllowed(item)
  )
}

/**
 * Страницы, управляющие своим URL через raw History API (сейчас — только
 * /social-monitoring), диспатчат это событие после каждого pushState/
 * replaceState. Сайдбар слушает его (плюс popstate), чтобы подсветка
 * query-пунктов читала РЕАЛЬНЫЙ window.location, а не устаревший
 * canonicalUrl роутера Next (raw-запись помечена __NA и роутером игнорится).
 */
export const RAW_LOCATION_CHANGE_EVENT = "leaddrive:rawlocationchange"

/**
 * Pathname part of a nav href: items of query-параметризованных разделов (все
 * виды /social-monitoring) несут `?…` в href, а сравнение с usePathname() и
 * módule-гейт по URL должны идти по чистому pathname.
 */
export function navItemPathname(href: string): string {
  const queryIndex = href.indexOf("?")
  return queryIndex === -1 ? href : href.slice(0, queryIndex)
}

/**
 * Resolve a pathname to the most specific nav item it belongs to. Exact href
 * wins; otherwise the longest href that is a path-prefix (so `/deals/123` →
 * `/deals`, but `/mtm/map` → `/mtm/map`, not the shorter `/mtm`). Used by the
 * recents tracker to record the module a visited page belongs to. Query-часть
 * href игнорируется: первый item с совпавшим pathname представляет страницу.
 */
/**
 * Path-part of the ONE item a URL selects, out of the items actually shown:
 * of every item whose base matches, the LONGEST wins.
 *
 * Landing pages are a path-prefix of their own children (`/settings` of
 * `/settings/users`, `/mtm` of `/mtm/map`), so a plain prefix test lit the hub
 * and the child at once — two selected destinations, which is the bug the
 * `/mtm` special case was originally added to stop. Longest-match generalises
 * that fix instead of naming each landing page: `/settings/users` selects only
 * the users item, while `/settings/security` — a page with a card on the
 * settings hub but no sidebar item of its own — still selects the hub rather
 * than leaving the whole sidebar unhighlighted.
 *
 * `/mtm` keeps its exact-only matcher: it must never win a child's URL even
 * when no MTM child item matched, which is stricter than longest-match alone.
 *
 * Pass the items the caller actually renders (accessibleNavItems), not the raw
 * list — an item this org cannot see must not win and leave every rendered item
 * unhighlighted. Query-параметризованные пункты (виды /social-monitoring) делят
 * один base: они все совпадут, а различает их проверка query у вызывающего.
 */
export function activeNavBase(items: readonly NavItem[], pathname: string): string {
  let best = ""
  for (const item of items) {
    const base = navItemPathname(item.href)
    const matches = base === "/mtm"
      ? isMtmNavigationItemActive(base, pathname)
      : pathname === base || (base !== "/" && pathname.startsWith(base + "/"))
    if (matches && base.length > best.length) best = base
  }
  return best
}

export function matchNavItem(pathname: string): NavItem | undefined {
  const exact = navItems.find((i) => navItemPathname(i.href) === pathname)
  if (exact) return exact
  let best: NavItem | undefined
  for (const i of navItems) {
    const base = navItemPathname(i.href)
    if (base !== "/" && pathname.startsWith(base + "/")) {
      if (!best || base.length > navItemPathname(best.href).length) best = i
    }
  }
  return best
}
