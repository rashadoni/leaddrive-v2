import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"
import { ALL_ROLES } from "@/lib/constants"
import {
  getDefaultDashboardWidgetConfig,
  normalizeDashboardWidgetConfig,
  type DashboardWidgetConfig,
} from "@/lib/dashboard/widget-registry"
import { normalizeQuickActionHrefs, storedQuickActionHrefs } from "@/lib/dashboard/quick-actions"

type DashboardWidgetSettings = Record<string, Partial<DashboardWidgetConfig>>
type OrganizationSettings = {
  dashboardWidgets?: DashboardWidgetSettings
  dashboardQuickActions?: unknown
}

const DEFAULT_WIDGETS: Record<string, DashboardWidgetConfig> = {
  ...getDefaultDashboardWidgetConfig(),
  // Legacy/off-canvas widgets remain readable so existing tenant settings do not break.
  revenueChart: { enabled: false, roles: [...ALL_ROLES] },
  forecast: { enabled: false, roles: [...ALL_ROLES] },
  clientHealth: { enabled: false, roles: [...ALL_ROLES] },
  taskSummary: { enabled: false, roles: [...ALL_ROLES] },
  ticketSummary: { enabled: false, roles: [...ALL_ROLES] },
  leadFunnel: { enabled: false, roles: [...ALL_ROLES] },
  // New additional widgets
  invoiceStats: { enabled: false, roles: [...ALL_ROLES] },
  campaignRoi: { enabled: false, roles: [...ALL_ROLES] },
  dealConversion: { enabled: false, roles: [...ALL_ROLES] },
  ticketSla: { enabled: false, roles: [...ALL_ROLES] },
  leadFunnelDetailed: { enabled: false, roles: [...ALL_ROLES] },
  revenueByClient: { enabled: false, roles: [...ALL_ROLES] },
  profitMargin: { enabled: false, roles: [...ALL_ROLES] },
  taskCompletion: { enabled: false, roles: [...ALL_ROLES] },
  overdueInvoices: { enabled: false, roles: [...ALL_ROLES] },
  teamPerformance: { enabled: false, roles: [...ALL_ROLES] },
}

function readOrganizationSettings(settings: unknown): OrganizationSettings {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return {}
  return settings as OrganizationSettings
}

export const GET = withRls(async (_req, { orgId }) => {
  try {
    const org = await prisma.organization.findFirst({
      where: { id: orgId },
      select: { settings: true },
    })

    const settings = readOrganizationSettings(org?.settings)
    const widgets = normalizeDashboardWidgetConfig({ ...DEFAULT_WIDGETS, ...settings.dashboardWidgets })

    // Get unique roles from users in this org
    const users = await prisma.user.findMany({
      where: { organizationId: orgId },
      select: { role: true },
      distinct: ["role"],
    })
    const orgRoles = [...new Set(users.map((u: { role: string | null }) => u.role).filter(Boolean))]

    return NextResponse.json({
      success: true,
      data: {
        widgets,
        roles: orgRoles.length > 0 ? orgRoles : ALL_ROLES,
        quickActions: storedQuickActionHrefs(settings.dashboardQuickActions),
      },
    })
  } catch (e) {
    console.error("Widget config GET error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const PUT = withRls(async (req, { orgId }) => {
  try {
    let body
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
    }
    const { widgets, quickActions } = body

    if (!widgets || typeof widgets !== "object") {
      return NextResponse.json({ error: "Invalid widgets config" }, { status: 400 })
    }
    const normalizedWidgets = normalizeDashboardWidgetConfig({ ...DEFAULT_WIDGETS, ...widgets })

    // Get current settings and merge
    const org = await prisma.organization.findFirst({
      where: { id: orgId },
      select: { settings: true },
    })
    const currentSettings = readOrganizationSettings(org?.settings)

    // Quick actions are optional in the body: the widget toggles and the
    // action picker save through the same endpoint, and neither may wipe the
    // other's setting by omitting it.
    //
    // Present but not a list is rejected rather than sanitised. Sanitising it
    // would turn `quickActions: null` into the defaults and overwrite a
    // deliberately empty selection — a save silently undoing the choice it was
    // supposed to record.
    if (quickActions !== undefined && !Array.isArray(quickActions)) {
      return NextResponse.json({ error: "Invalid quickActions config" }, { status: 400 })
    }
    const normalizedQuickActions = quickActions === undefined
      ? storedQuickActionHrefs(currentSettings.dashboardQuickActions)
      : normalizeQuickActionHrefs(quickActions)

    await prisma.organization.update({
      where: { id: orgId },
      data: {
        settings: {
          ...currentSettings,
          dashboardWidgets: normalizedWidgets,
          dashboardQuickActions: normalizedQuickActions,
        },
      },
    })

    return NextResponse.json({
      success: true,
      data: { widgets: normalizedWidgets, quickActions: normalizedQuickActions },
    })
  } catch (e) {
    console.error("Widget config PUT error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
