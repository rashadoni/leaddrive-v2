import { hasModule, type ModuleId } from "@/lib/modules"

export type DashboardWidgetId =
  | "welcomeGreeting"
  | "welcomeBrief"
  | "quickAccessStrip"
  | "statCards"
  | "risksBanner"
  | "dealPipeline"
  | "revenueTrend"
  | "leadSources"
  | "recentDeals"
  | "aiLeadScoring"
  | "activityFeed"
  | "campaignStats"
  | "upcomingEvents"
  | "weeklyMetrics"
  | "segments"
  | "aiValueMonth"
  | "loyaltyMembers"
  | "loyaltyPoints30d"
  | "loyaltyRedemptions30d"

export type DashboardWidgetCategory =
  | "overview"
  | "advisor"
  | "sales"
  | "support"
  | "marketing"
  | "loyalty"
  | "operations"

export type DashboardWidgetSize =
  | "full"
  | "large"
  | "side"
  | "medium"
  | "standard"
  | "compact"

export type DashboardWidgetConfig = {
  enabled: boolean
  roles: string[]
  order?: number
}

export type DashboardWidgetDefinition = {
  id: DashboardWidgetId
  titleKey: string
  descKey: string
  category: DashboardWidgetCategory
  priority: number
  size: DashboardWidgetSize
  defaultEnabled: boolean
  roles: string[]
  icon: string
  module?: ModuleId
}

const ALL_DASHBOARD_ROLES = ["superadmin", "admin", "manager", "sales", "support", "viewer"]
const ADMIN_MANAGER_ROLES = ["superadmin", "admin", "manager"]
const LOYALTY_DASHBOARD_ROLES = ["superadmin", "admin", "manager", "sales"]

export const DASHBOARD_WIDGETS: readonly DashboardWidgetDefinition[] = [
  // The opening canvas. It renders above the widget grid rather than inside it
  // — it is full-bleed and owns the first screen — but it belongs in this
  // registry all the same, because that is what puts a thing in
  // /settings/dashboard. Shipped outside the registry, it was the one block a
  // tenant could not switch off: turning every widget off still left the
  // greeting and the briefing on screen, with no control anywhere that
  // explained why. Two entries, not one, so the briefing can go while the
  // command field stays, which is the split people actually asked for.
  {
    id: "welcomeGreeting",
    titleKey: "welcomeGreeting",
    descKey: "welcomeGreetingDesc",
    category: "overview",
    priority: 1,
    size: "full",
    defaultEnabled: true,
    roles: ALL_DASHBOARD_ROLES,
    icon: "sparkles",
  },
  {
    id: "welcomeBrief",
    titleKey: "welcomeBrief",
    descKey: "welcomeBriefDesc",
    category: "advisor",
    priority: 2,
    size: "full",
    defaultEnabled: true,
    roles: ALL_DASHBOARD_ROLES,
    icon: "brain",
  },
  {
    // The row of module shortcuts under the hero. Same story as the hero
    // itself: drawn straight into the page, so it was on screen for everyone
    // with no switch anywhere. It is in the registry for the same reason.
    id: "quickAccessStrip",
    titleKey: "quickAccessStrip",
    descKey: "quickAccessStripDesc",
    category: "overview",
    priority: 3,
    size: "full",
    defaultEnabled: true,
    roles: ALL_DASHBOARD_ROLES,
    icon: "layoutGrid",
  },
  {
    id: "statCards",
    titleKey: "statCards",
    descKey: "statCardsDesc",
    category: "overview",
    priority: 10,
    size: "full",
    defaultEnabled: true,
    roles: ALL_DASHBOARD_ROLES,
    icon: "barChart",
  },
  {
    id: "risksBanner",
    titleKey: "risksBanner",
    descKey: "risksBannerDesc",
    category: "advisor",
    priority: 22,
    size: "side",
    defaultEnabled: true,
    roles: ALL_DASHBOARD_ROLES,
    icon: "shield",
  },
  {
    id: "dealPipeline",
    titleKey: "dealPipeline",
    descKey: "dealPipelineDesc",
    category: "sales",
    priority: 30,
    size: "standard",
    defaultEnabled: true,
    roles: ALL_DASHBOARD_ROLES,
    icon: "target",
  },
  {
    id: "revenueTrend",
    titleKey: "revenueTrend",
    descKey: "revenueTrendDesc",
    category: "sales",
    priority: 31,
    size: "standard",
    defaultEnabled: true,
    roles: ALL_DASHBOARD_ROLES,
    icon: "trendingUp",
  },
  {
    id: "leadSources",
    titleKey: "leadSources",
    descKey: "leadSourcesDesc",
    category: "sales",
    priority: 32,
    size: "standard",
    defaultEnabled: true,
    roles: ALL_DASHBOARD_ROLES,
    icon: "pieChart",
  },
  {
    id: "recentDeals",
    titleKey: "recentDeals",
    descKey: "recentDealsDesc",
    category: "sales",
    priority: 40,
    size: "standard",
    defaultEnabled: true,
    roles: ALL_DASHBOARD_ROLES,
    icon: "handshake",
  },
  {
    id: "aiLeadScoring",
    titleKey: "aiLeadScoring",
    descKey: "aiLeadScoringDesc",
    category: "sales",
    priority: 41,
    size: "standard",
    defaultEnabled: true,
    roles: ALL_DASHBOARD_ROLES,
    icon: "brain",
  },
  {
    id: "activityFeed",
    titleKey: "activityFeed",
    descKey: "activityFeedDesc",
    category: "support",
    priority: 42,
    size: "standard",
    defaultEnabled: true,
    roles: ALL_DASHBOARD_ROLES,
    icon: "activity",
  },
  {
    id: "aiValueMonth",
    titleKey: "aiValueMonth",
    descKey: "aiValueMonthDesc",
    category: "advisor",
    priority: 51,
    size: "medium",
    defaultEnabled: true,
    roles: ADMIN_MANAGER_ROLES,
    icon: "sparkles",
  },
  {
    id: "campaignStats",
    titleKey: "campaignStats",
    descKey: "campaignStatsDesc",
    category: "marketing",
    priority: 60,
    size: "standard",
    defaultEnabled: true,
    roles: ALL_DASHBOARD_ROLES,
    icon: "megaphone",
  },
  {
    id: "upcomingEvents",
    titleKey: "upcomingEvents",
    descKey: "upcomingEventsDesc",
    category: "marketing",
    priority: 61,
    size: "standard",
    defaultEnabled: true,
    roles: ALL_DASHBOARD_ROLES,
    icon: "calendar",
  },
  {
    id: "loyaltyMembers",
    titleKey: "loyaltyMembers",
    descKey: "loyaltyMembersDesc",
    category: "loyalty",
    priority: 62,
    size: "standard",
    defaultEnabled: true,
    roles: LOYALTY_DASHBOARD_ROLES,
    icon: "award",
    module: "loyalty",
  },
  {
    id: "loyaltyPoints30d",
    titleKey: "loyaltyPoints30d",
    descKey: "loyaltyPoints30dDesc",
    category: "loyalty",
    priority: 63,
    size: "standard",
    defaultEnabled: true,
    roles: LOYALTY_DASHBOARD_ROLES,
    icon: "sparkles",
    module: "loyalty",
  },
  {
    id: "loyaltyRedemptions30d",
    titleKey: "pointsSpent",
    descKey: "pointsSpentDesc",
    category: "loyalty",
    priority: 64,
    size: "standard",
    defaultEnabled: true,
    roles: LOYALTY_DASHBOARD_ROLES,
    icon: "ticket",
    module: "loyalty",
  },
  {
    id: "weeklyMetrics",
    titleKey: "weeklyMetrics",
    descKey: "weeklyMetricsDesc",
    category: "operations",
    priority: 62,
    size: "standard",
    defaultEnabled: true,
    roles: ALL_DASHBOARD_ROLES,
    icon: "barChart",
  },
  {
    id: "segments",
    titleKey: "segments",
    descKey: "segmentsDesc",
    category: "operations",
    priority: 70,
    size: "standard",
    defaultEnabled: true,
    roles: ALL_DASHBOARD_ROLES,
    icon: "users",
  },
] as const

export const DASHBOARD_WIDGET_GROUPS: readonly DashboardWidgetCategory[] = [
  "overview",
  "advisor",
  "sales",
  "support",
  "marketing",
  "loyalty",
  "operations",
] as const

export type DashboardWidgetOrgContext = {
  plan: string
  addons?: string[]
  modules?: Record<string, boolean>
  role?: string | null
}

export function dashboardWidgetAvailableForOrg(
  widget: DashboardWidgetDefinition,
  org?: DashboardWidgetOrgContext | null
): boolean {
  if (!widget.module) return true
  if (org?.role === "superadmin") return true
  if (!org) return false
  return hasModule(org, widget.module)
}

export function getDashboardWidgetDefinition(id: string): DashboardWidgetDefinition | undefined {
  return DASHBOARD_WIDGETS.find((widget) => widget.id === id)
}

export function getDefaultDashboardWidgetConfig(): Record<DashboardWidgetId, DashboardWidgetConfig> {
  return DASHBOARD_WIDGETS.reduce((acc, widget, index) => {
    acc[widget.id] = {
      enabled: widget.defaultEnabled,
      roles: [...widget.roles],
      order: index,
    }
    return acc
  }, {} as Record<DashboardWidgetId, DashboardWidgetConfig>)
}

export function normalizeDashboardWidgetConfig(
  input?: Record<string, Partial<DashboardWidgetConfig> | undefined> | null
): Record<string, DashboardWidgetConfig> {
  const knownIds = new Set<string>(DASHBOARD_WIDGETS.map((widget) => widget.id))
  const rows = DASHBOARD_WIDGETS.map((widget, index) => {
    const configured = input?.[widget.id]
    const configuredOrder = configured?.order
    return {
      id: widget.id,
      priority: widget.priority,
      config: {
        enabled: configured?.enabled ?? widget.defaultEnabled,
        roles: configured?.roles && configured.roles.length > 0 ? [...configured.roles] : [...widget.roles],
        order: typeof configuredOrder === "number" && Number.isFinite(configuredOrder) ? configuredOrder : index,
      },
    }
  })

  const enabledRows = rows
    .filter((row) => row.config.enabled)
    .sort((a, b) => (a.config.order ?? a.priority) - (b.config.order ?? b.priority) || a.priority - b.priority || a.id.localeCompare(b.id))

  enabledRows.forEach((row, index) => {
    row.config.order = index
  })

  let nextOrder = enabledRows.length
  rows
    .filter((row) => !row.config.enabled)
    .sort((a, b) => (a.config.order ?? a.priority) - (b.config.order ?? b.priority) || a.priority - b.priority || a.id.localeCompare(b.id))
    .forEach((row) => {
      row.config.order = nextOrder
      nextOrder += 1
    })

  const normalized: Record<string, DashboardWidgetConfig> = {}
  for (const row of rows) {
    normalized[row.id] = row.config
  }

  for (const [id, config] of Object.entries(input ?? {})) {
    if (!config || knownIds.has(id)) continue
    const order = config.order
    normalized[id] = {
      enabled: config.enabled ?? false,
      roles: config.roles && config.roles.length > 0 ? [...config.roles] : [],
      order: typeof order === "number" && Number.isFinite(order) ? order : nextOrder,
    }
    nextOrder += 1
  }

  return normalized
}
