"use client"

import { useEffect, useMemo, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Card } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import {
  Award, BarChart3, TrendingUp, Users, Target, Brain,
  Activity, Megaphone, Calendar, Shield, Handshake,
  Eye, EyeOff, Loader2, Inbox, Sparkles, Ticket,
  PieChart, LayoutGrid, X, Plus,
  type LucideIcon,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"
import {
  DASHBOARD_WIDGETS,
  dashboardWidgetAvailableForOrg,
  normalizeDashboardWidgetConfig,
  type DashboardWidgetDefinition,
} from "@/lib/dashboard/widget-registry"
import { orgFromSession } from "@/lib/nav-items"
import {
  availableQuickActions,
  normalizeQuickActionHrefs,
  storedQuickActionHrefs,
  MAX_DASHBOARD_QUICK_ACTIONS,
  type ResolvedQuickAction,
} from "@/lib/dashboard/quick-actions"

type WidgetConfig = { enabled: boolean; roles: string[]; order?: number }
type DashboardWidgetTranslator = (key: string) => string

const WIDGET_ICONS: Record<string, LucideIcon> = {
  shield: Shield,
  barChart: BarChart3,
  target: Target,
  trendingUp: TrendingUp,
  pieChart: PieChart,
  handshake: Handshake,
  brain: Brain,
  activity: Activity,
  megaphone: Megaphone,
  calendar: Calendar,
  inbox: Inbox,
  sparkles: Sparkles,
  users: Users,
  award: Award,
  ticket: Ticket,
  layoutGrid: LayoutGrid,
}

function widgetEnabled(config: Record<string, WidgetConfig>, widget: DashboardWidgetDefinition): boolean {
  return config[widget.id]?.enabled ?? widget.defaultEnabled
}

function widgetOrder(config: Record<string, WidgetConfig>, widget: DashboardWidgetDefinition): number {
  const order = config[widget.id]?.order
  return typeof order === "number" && Number.isFinite(order) ? order : widget.priority
}

export default function DashboardSettingsPage() {
  const { data: session, status: sessionStatus } = useSession()
  const t = useTranslations("dashboardWidgets")
  useAutoTour("dashboardSettings")
  const tDashboard = useTranslations("dashboard")
  const tNav = useTranslations("nav")
  const [widgets, setWidgets] = useState<Record<string, WidgetConfig>>({})
  const [quickActions, setQuickActions] = useState<string[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    const orgId = session?.user?.organizationId
    if (sessionStatus === "loading") return
    if (!orgId) {
      setLoading(false)
      return
    }

    setLoading(true)
    fetch("/api/v1/dashboard/widget-config", {
      headers: { "x-organization-id": String(orgId) },
    })
      .then(r => r.json())
      .then(j => {
        if (j.success && j.data?.widgets) {
          setWidgets(normalizeDashboardWidgetConfig(j.data.widgets))
        }
        if (j.success) setQuickActions(storedQuickActionHrefs(j.data?.quickActions))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [session?.user?.organizationId, sessionStatus])

  function buildUpdatedWidgets(key: string, enabled: boolean) {
    const definition = DASHBOARD_WIDGETS.find((widget) => widget.id === key)
    const normalized = normalizeDashboardWidgetConfig(widgets)
    const enabledRows = DASHBOARD_WIDGETS
      .filter((widget) => widget.id !== key && widgetEnabled(normalized, widget))
      .sort((a, b) => widgetOrder(normalized, a) - widgetOrder(normalized, b) || a.priority - b.priority)

    normalized[key] = {
      roles: normalized[key]?.roles || definition?.roles || [],
      enabled,
      order: enabled ? enabledRows.length : normalized[key]?.order,
    }

    return normalizeDashboardWidgetConfig(normalized)
  }

  async function setWidgetEnabled(key: string, enabled: boolean) {
    const previous = widgets
    const updated = buildUpdatedWidgets(key, enabled)
    setWidgets(updated)
    setSaving(key)

    try {
      const orgId = session?.user?.organizationId
      const response = await fetch("/api/v1/dashboard/widget-config", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-organization-id": String(orgId),
        },
        body: JSON.stringify({ widgets: updated }),
      })
      const json = await response.json().catch(() => null)
      if (!response.ok || json?.success !== true) throw new Error("Failed to save dashboard widgets")
      if (json.data?.widgets) setWidgets(normalizeDashboardWidgetConfig(json.data.widgets))
    } catch (e) {
      console.error(e)
      setWidgets(previous)
    } finally {
      setTimeout(() => setSaving(null), 300)
    }
  }

  async function saveQuickActions(next: string[]) {
    const previous = quickActions
    const normalized = normalizeQuickActionHrefs(next)
    setQuickActions(normalized)
    setSaving("quickActions")

    try {
      const orgId = session?.user?.organizationId
      const response = await fetch("/api/v1/dashboard/widget-config", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-organization-id": String(orgId),
        },
        // The widgets travel with it: this endpoint requires them, and sending
        // the current set keeps the two settings from overwriting each other.
        body: JSON.stringify({ widgets: normalizeDashboardWidgetConfig(widgets), quickActions: normalized }),
      })
      const json = await response.json().catch(() => null)
      if (!response.ok || json?.success !== true) throw new Error("Failed to save quick actions")
      if (Array.isArray(json.data?.quickActions)) {
        setQuickActions(normalizeQuickActionHrefs(json.data.quickActions))
      }
    } catch (e) {
      console.error(e)
      setQuickActions(previous)
    } finally {
      setTimeout(() => setSaving(null), 300)
    }
  }

  const normalizedWidgets = useMemo(() => normalizeDashboardWidgetConfig(widgets), [widgets])
  const org = useMemo(() => orgFromSession(session?.user), [session?.user])
  const quickActionChoices = useMemo(() => availableQuickActions(org), [org])
  const quickActionLabel = useMemo(
    () => (action: ResolvedQuickAction) =>
      action.labelNamespace === "nav" ? tNav(action.labelKey) : tDashboard(action.labelKey),
    [tDashboard, tNav],
  )
  const quickActionById = useMemo(
    () => new Map(quickActionChoices.map((action) => [action.href, action])),
    [quickActionChoices],
  )
  // `nav.groups` carries the sidebar's own group names; fall back to the raw
  // key so a new group shows up readable rather than as a missing message.
  const groupLabel = useMemo(
    () => (group: string) => {
      try {
        return tNav(`groups.${group}`)
      } catch {
        return group
      }
    },
    [tNav],
  )

  // The picker: what is not already chosen, filtered by the query, grouped by
  // module in the navigation's own order.
  const pickerGroups = useMemo(() => {
    const query = pickerQuery.trim().toLowerCase()
    const grouped = new Map<string, ResolvedQuickAction[]>()
    for (const action of quickActionChoices) {
      if (quickActions.includes(action.href)) continue
      if (query) {
        const haystack = `${quickActionLabel(action)} ${groupLabel(action.group)}`.toLowerCase()
        if (!haystack.includes(query)) continue
      }
      const bucket = grouped.get(action.group)
      if (bucket) bucket.push(action)
      else grouped.set(action.group, [action])
    }
    return [...grouped.entries()]
  }, [groupLabel, pickerQuery, quickActionChoices, quickActionLabel, quickActions])

  function toggleQuickAction(href: string) {
    const next = quickActions.includes(href)
      ? quickActions.filter((item) => item !== href)
      : [...quickActions, href]
    // Silently ignore a pick past the cap rather than dropping an earlier
    // choice the person cannot see being dropped.
    if (next.length > MAX_DASHBOARD_QUICK_ACTIONS) return
    void saveQuickActions(next)
  }
  const availableWidgetDefinitions = useMemo(
    () => DASHBOARD_WIDGETS.filter((widget) => dashboardWidgetAvailableForOrg(widget, org)),
    [org],
  )
  const activeWidgets = useMemo(() => {
    return availableWidgetDefinitions
      .filter((widget) => widgetEnabled(normalizedWidgets, widget))
      .sort((a, b) => widgetOrder(normalizedWidgets, a) - widgetOrder(normalizedWidgets, b) || a.priority - b.priority)
  }, [availableWidgetDefinitions, normalizedWidgets])
  const hiddenWidgets = useMemo(() => {
    return availableWidgetDefinitions
      .filter((widget) => !widgetEnabled(normalizedWidgets, widget))
      .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
  }, [availableWidgetDefinitions, normalizedWidgets])
  const enabledCount = activeWidgets.length
  const totalCount = availableWidgetDefinitions.length

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 bg-muted rounded animate-pulse" />
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {[1,2,3,4,5,6].map(i => <div key={i} className="h-20 bg-muted rounded-lg animate-pulse" />)}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 data-tour-id="widget-header" className="text-2xl font-bold flex items-center gap-2">{t("title")} <TourReplayButton tourId="dashboardSettings" /><HelpButton slug="settings-dashboard" variant="label" /></h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("subtitle")}
        </p>
        <div className="flex items-center gap-3 mt-3">
          <div className="flex items-center gap-1.5 text-xs">
            <Eye className="h-3.5 w-3.5 text-emerald-500" />
            <span className="text-emerald-600 font-medium">{enabledCount} {t("active")}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">{totalCount - enabledCount} {t("hidden")}</span>
          </div>
        </div>
      </div>

      {/* The buttons under the greeting on the dashboard. They used to be three
          hardcoded links — a fair guess for a sales team, wrong for everyone
          else, with no way to say so. */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">{t("quickActionsTitle")}</h2>
          <p className="text-xs text-muted-foreground">
            {t("quickActionsDesc", { max: MAX_DASHBOARD_QUICK_ACTIONS })}
          </p>
        </div>
        {/* Only the chosen actions are on screen, in the order they appear on
            the dashboard, each with its own remove control — plus one "add"
            that opens the navigation as a tree: module first, sections inside
            it. The first version listed every accessible destination as a flat
            chip; on a full-featured tenant that is ~150 of them, a wall to read
            rather than a choice to make. */}
        <Card className="p-3 sm:p-4">
          <div className="flex flex-wrap items-center gap-2">
            {quickActions.map((href, index) => {
              const action = quickActionById.get(href)
              if (!action) return null
              const Icon = action.icon
              return (
                <span
                  key={href}
                  data-quick-action={href}
                  className="flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium"
                >
                  <span className="tabular-nums text-[11px] font-semibold text-primary">{index + 1}</span>
                  <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  {quickActionLabel(action)}
                  <button
                    type="button"
                    aria-label={t("quickActionsRemove", { name: quickActionLabel(action) })}
                    onClick={() => toggleQuickAction(href)}
                    className="-mr-1 rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )
            })}

            {quickActions.length < MAX_DASHBOARD_QUICK_ACTIONS && (
              <Popover open={pickerOpen} onOpenChange={(open) => { setPickerOpen(open); if (!open) setPickerQuery("") }}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    data-quick-action-add
                    className="flex items-center gap-1.5 rounded-full border border-dashed border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {t("quickActionsAdd")}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-80 p-0">
                  <div className="border-b p-2">
                    <Input
                      autoFocus
                      value={pickerQuery}
                      onChange={(event) => setPickerQuery(event.target.value)}
                      placeholder={t("quickActionsSearch")}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="max-h-72 overflow-y-auto p-1">
                    {pickerGroups.length === 0 ? (
                      <p className="p-3 text-xs text-muted-foreground">{t("quickActionsNoResults")}</p>
                    ) : (
                      pickerGroups.map(([group, items]) => (
                        <div key={group} className="mb-1">
                          <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                            {groupLabel(group)}
                          </p>
                          {items.map((action) => {
                            const Icon = action.icon
                            return (
                              <button
                                key={action.href}
                                type="button"
                                data-quick-action-option={action.href}
                                onClick={() => {
                                  toggleQuickAction(action.href)
                                  setPickerOpen(false)
                                  setPickerQuery("")
                                }}
                                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted"
                              >
                                <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                <span className="truncate">{quickActionLabel(action)}</span>
                              </button>
                            )
                          })}
                        </div>
                      ))
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </div>
          {quickActions.length === 0 && (
            <p className="mt-3 text-xs text-muted-foreground">{t("quickActionsEmpty")}</p>
          )}
          {saving === "quickActions" && (
            <Loader2 className="mt-3 h-3.5 w-3.5 animate-spin text-muted-foreground" />
          )}
        </Card>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold">{t("activeQueue")}</h2>
            <p className="text-xs text-muted-foreground">{t("activeQueueDesc")}</p>
          </div>
          <Card className="overflow-hidden">
            <div className="divide-y divide-border">
              {activeWidgets.map((widget, index) => (
                <WidgetSettingsRow
                  key={widget.id}
                  widget={widget}
                  enabled
                  index={index}
                  saving={saving === widget.id}
                  t={t}
                  onToggle={(enabled) => setWidgetEnabled(widget.id, enabled)}
                />
              ))}
            </div>
          </Card>
        </section>

        <aside className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold">{t("hiddenWidgets")}</h2>
            <p className="text-xs text-muted-foreground">{t("hiddenWidgetsDesc")}</p>
          </div>
          <Card className="overflow-hidden">
            {hiddenWidgets.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">{t("noHiddenWidgets")}</div>
            ) : (
              <div className="divide-y divide-border">
                {hiddenWidgets.map((widget) => (
                  <WidgetSettingsRow
                    key={widget.id}
                    widget={widget}
                    enabled={false}
                    saving={saving === widget.id}
                    t={t}
                    onToggle={(enabled) => setWidgetEnabled(widget.id, enabled)}
                  />
                ))}
              </div>
            )}
          </Card>
        </aside>
      </div>
    </div>
  )
}

function WidgetSettingsRow({
  widget,
  enabled,
  index,
  saving,
  t,
  onToggle,
}: {
  widget: DashboardWidgetDefinition
  enabled: boolean
  index?: number
  saving: boolean
  t: DashboardWidgetTranslator
  onToggle: (enabled: boolean) => void
}) {
  const Icon = WIDGET_ICONS[widget.icon] || BarChart3

  return (
    <div
      data-settings-widget={widget.id}
      className="flex items-center gap-3 p-3 transition-colors hover:bg-muted/35 sm:p-4"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        {enabled ? (
          <span className="text-xs font-semibold tabular-nums">{String((index ?? 0) + 1).padStart(2, "0")}</span>
        ) : (
          <Icon className="h-4 w-4" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold">{t(widget.titleKey)}</span>
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
        <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted-foreground">{t(widget.descKey)}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="rounded-full bg-muted px-2 py-0.5">{t(`group.${widget.category}`)}</span>
          <span className="rounded-full bg-muted px-2 py-0.5">{t(`size.${widget.size}`)}</span>
        </div>
      </div>
      <Switch
        checked={enabled}
        aria-label={enabled ? t("disableWidget") : t("enableWidget")}
        onCheckedChange={onToggle}
      />
    </div>
  )
}
