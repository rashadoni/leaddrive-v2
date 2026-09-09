import {
  DASHBOARD_WIDGETS,
  dashboardWidgetAvailableForOrg,
  type DashboardWidgetConfig,
  type DashboardWidgetDefinition,
  type DashboardWidgetId,
  type DashboardWidgetOrgContext,
} from "@/lib/dashboard/widget-registry"

type WidgetConfigMap = Partial<Record<DashboardWidgetId, Partial<DashboardWidgetConfig>>> & Record<string, Partial<DashboardWidgetConfig> | undefined>

type ResolveDashboardWidgetsInput = {
  config?: WidgetConfigMap | null
  role?: string | null
  org?: DashboardWidgetOrgContext | null
}

function roleAllowed(widget: DashboardWidgetDefinition, configuredRoles: string[] | undefined, role: string): boolean {
  if (role === "superadmin") return true
  const roles = configuredRoles && configuredRoles.length > 0 ? configuredRoles : widget.roles
  return roles.length === 0 || roles.includes(role)
}

export type ResolvedDashboardWidget = DashboardWidgetDefinition & {
  enabled: boolean
  configuredRoles: string[]
  order: number
}

export function resolveDashboardWidgets(input: ResolveDashboardWidgetsInput): ResolvedDashboardWidget[] {
  const role = input.role || "viewer"

  return DASHBOARD_WIDGETS.flatMap((widget) => {
    const configured = input.config?.[widget.id]
    const enabled = configured?.enabled ?? widget.defaultEnabled
    const configuredRoles = configured?.roles ?? widget.roles
    const order = typeof configured?.order === "number" && Number.isFinite(configured.order) ? configured.order : widget.priority

    if (!enabled || !roleAllowed(widget, configuredRoles, role)) return []
    if (!dashboardWidgetAvailableForOrg(widget, input.org)) return []

    return [{
      ...widget,
      enabled,
      configuredRoles,
      order,
    }]
  }).sort((a, b) => a.order - b.order || a.priority - b.priority || a.id.localeCompare(b.id))
}
