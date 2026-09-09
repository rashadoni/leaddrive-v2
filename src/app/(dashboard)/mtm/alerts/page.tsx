"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { toast } from "sonner"
import { useLocale, useTranslations } from "next-intl"
import { PageDescription } from "@/components/page-description"
import { HelpButton } from "@/components/help/help-button"
import { ColorStatCard } from "@/components/color-stat-card"
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { AlertTriangle, CheckCircle2, Trash2, MoreHorizontal, Search, Bell, Lightbulb, Satellite, AlarmClock, CalendarX2, Coffee, ShieldAlert, Navigation, BatteryLow, Timer, ChevronDown, type LucideIcon } from "lucide-react"
import { formatDateTime } from "@/lib/format-date"
import { readMtmAlertMessage } from "@/lib/mtm/alert-messages"

const categoryColors: Record<string, string> = { CRITICAL: "bg-red-100 text-red-700 border-red-200", WARNING: "bg-amber-100 text-amber-700 border-amber-200", INFO: "bg-blue-100 text-blue-700 border-blue-200" }

// Per-type friendly icon (human label + "what to do" hint come from i18n:
// typeLabel_<TYPE> / typeHint_<TYPE>). Unknown types fall back to AlertTriangle.
const alertTypeIcons: Record<string, LucideIcon> = {
  GPS_ANOMALY: Satellite,
  LATE_START: AlarmClock,
  MISSED_VISIT: CalendarX2,
  LONG_BREAK: Coffee,
  GPS_SPOOFING: ShieldAlert,
  OUT_OF_ZONE: Navigation,
  LOW_BATTERY: BatteryLow,
  OVERTIME: Timer,
}
const stripSeed = (s?: string | null) => (s || "").replace(/^\s*\[SEED\]\s*/i, "").trim()

export default function MtmAlertsPage() {
  const { data: session } = useSession()
  const t = useTranslations("mtmAlertsPage")
  const locale = useLocale()
  const [alerts, setAlerts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showResolved, setShowResolved] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteItem, setDeleteItem] = useState<any>(null)
  const [search, setSearch] = useState("")
  const [activeFilter, setActiveFilter] = useState("all")
  const [sortBy, setSortBy] = useState("date_desc")
  const [collapsedTypes, setCollapsedTypes] = useState<Set<string>>(new Set())
  const orgId = session?.user?.organizationId
  const toggleType = (type: string) => setCollapsedTypes(prev => { const n = new Set(prev); if (n.has(type)) n.delete(type); else n.add(type); return n })

  const fetchAlerts = async () => {
    try {
      const resolved = showResolved ? "" : "&resolved=false"
      const res = await fetch(`/api/v1/mtm/alerts?limit=200${resolved}`, { headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string> })
      const r = await res.json()
      if (!res.ok || !r.success) {
        toast.error(`Failed to load alerts: ${r.error || "Unknown error"}`)
      } else {
        setAlerts(r.data.alerts || [])
      }
    } catch (e) {
      toast.error(`Failed to load alerts: ${e instanceof Error ? e.message : "Network error"}`)
    } finally { setLoading(false) }
  }

  useEffect(() => { setLoading(true); fetchAlerts() }, [orgId, showResolved])

  const filtered = alerts.filter(a => {
    if (activeFilter !== "all" && a.category !== activeFilter) return false
    if (search) { const s = search.toLowerCase(); if (!a.title?.toLowerCase().includes(s) && !a.agent?.name?.toLowerCase().includes(s)) return false }
    return true
  }).sort((a, b) => {
    switch (sortBy) {
      case "date_desc": return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      case "category": { const order: Record<string, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 }; return (order[a.category] ?? 2) - (order[b.category] ?? 2) }
      default: return 0
    }
  })

  const catCounts: Record<string, number> = {}
  for (const a of alerts) catCounts[a.category] = (catCounts[a.category] || 0) + 1
  const resolvedCount = alerts.filter(a => a.isResolved).length

  const resolveAlert = async (alertId: string) => {
    try {
      const res = await fetch(`/api/v1/mtm/alerts/${alertId}`, { method: "PATCH", headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>) }, body: JSON.stringify({ isResolved: true }) })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        toast.error(`Failed to resolve alert: ${body?.error || res.statusText}`)
        return
      }
      toast.success("Alert resolved")
      fetchAlerts()
    } catch (e) {
      toast.error(`Failed to resolve alert: ${e instanceof Error ? e.message : "Network error"}`)
    }
  }

  async function confirmDelete() {
    if (!deleteItem) return
    const res = await fetch(`/api/v1/mtm/alerts/${deleteItem.id}`, { method: "DELETE", headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string> })
    if (!res.ok) throw new Error((await res.json()).error || "Failed to delete")
    fetchAlerts()
  }

  if (loading) return (
    <div className="space-y-6">
      <PageDescription icon={AlertTriangle} title={t("title")} description={t("subtitle")} />
      <div className="animate-pulse space-y-4"><div className="grid gap-3 grid-cols-2 sm:grid-cols-4">{[1,2,3,4].map(i => <div key={i} className="h-24 bg-muted rounded-lg" />)}</div><div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-20 bg-muted rounded-lg" />)}</div></div>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PageDescription icon={AlertTriangle} title={`${t("title")} (${filtered.length})`} description={t("subtitle")} />
          <HelpButton slug="mtm-alerts" variant="label" />
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowResolved(!showResolved)}>
          {showResolved ? t("hideResolved") : t("showAll")}
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 stagger-children">
        <ColorStatCard label={t("statTotal")} value={alerts.length} icon={<Bell className="h-4 w-4" />} hint={t("hintTotal")} />
        <ColorStatCard label={t("statCritical")} value={catCounts["CRITICAL"] || 0} icon={<AlertTriangle className="h-4 w-4" />} hint={t("hintCritical")} />
        <ColorStatCard label={t("statWarning")} value={catCounts["WARNING"] || 0} icon={<AlertTriangle className="h-4 w-4" />} hint={t("hintWarning")} />
        <ColorStatCard label={t("statResolved")} value={resolvedCount} icon={<CheckCircle2 className="h-4 w-4" />} hint={t("hintResolved")} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant={activeFilter === "all" ? "default" : "outline"} size="sm" onClick={() => setActiveFilter("all")}>{t("all")} ({alerts.length})</Button>
        {(["CRITICAL", "WARNING", "INFO"] as const).map(cat => (
          <Button key={cat} variant={activeFilter === cat ? "default" : "outline"} size="sm" onClick={() => setActiveFilter(cat)}>
            {t(`filter${cat.charAt(0) + cat.slice(1).toLowerCase()}` as any)} ({catCounts[cat] || 0})
          </Button>
        ))}
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input placeholder={t("searchPlaceholder")} value={search} onChange={e => setSearch(e.target.value)} className="pl-9" /></div>
        <Select value={sortBy} onChange={e => setSortBy(e.target.value)} className="w-[160px]">
          <option value="date_desc">{t("sortDateDesc")}</option>
          <option value="category">{t("sortCategory")}</option>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-muted-foreground border border-zinc-200 dark:border-zinc-700 rounded-lg bg-card">{alerts.length === 0 ? t("empty") : t("noResults")}</div>
      ) : (
        <div className="space-y-3">
          {(() => {
            const groups: { type: string; items: any[] }[] = []
            const idx: Record<string, number> = {}
            for (const a of filtered) {
              if (idx[a.type] === undefined) { idx[a.type] = groups.length; groups.push({ type: a.type, items: [] }) }
              groups[idx[a.type]].items.push(a)
            }
            return groups.map(g => {
              const TypeIcon = alertTypeIcons[g.type] || AlertTriangle
              const known = g.type in alertTypeIcons
              const label = known ? t(`typeLabel_${g.type}` as any) : t("typeLabel_OTHER")
              const hint = known ? t(`typeHint_${g.type}` as any) : ""
              const category = g.items[0]?.category || "INFO"
              const cat = categoryColors[category] || categoryColors.INFO
              const catLabel = t(`filter${category.charAt(0)}${category.slice(1).toLowerCase()}` as any)
              const isCollapsed = collapsedTypes.has(g.type)
              const openCount = g.items.filter(a => !a.isResolved).length
              return (
                <div key={g.type} className={`rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden ${cat}`}>
                  <button onClick={() => toggleType(g.type)} className="w-full flex items-start gap-2.5 p-2.5 text-left hover:bg-black/[0.03] dark:hover:bg-white/[0.04] transition-colors">
                    <ChevronDown className={`h-4 w-4 mt-1.5 shrink-0 transition-transform ${isCollapsed ? "-rotate-90" : ""}`} />
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/60 dark:bg-black/25"><TypeIcon className="h-4 w-4" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{label}</span>
                        <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-white/60 dark:bg-black/25">{g.items.length}</span>
                        <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-white/50 dark:bg-black/25 font-semibold">{catLabel}</span>
                      </div>
                      {hint && openCount > 0 && (
                        <div className="flex items-start gap-1 mt-1 text-[11px] opacity-90">
                          <Lightbulb className="h-3 w-3 mt-0.5 shrink-0" />
                          <span><span className="font-medium">{t("actionLabel")}</span> {hint}</span>
                        </div>
                      )}
                    </div>
                  </button>
                  {!isCollapsed && (
                    <div className="px-2.5 pb-2.5 space-y-1.5">
                      {g.items.map(alert => {
                        const title = stripSeed(alert.title)
                        // A4: an alert written after the dictionary landed carries
                        // what happened and with which numbers, so it reads in the
                        // manager's language. An older row has only the English
                        // sentence the generator baked in — show it rather than
                        // nothing, and say plainly that it predates translation.
                        const message = readMtmAlertMessage(alert.metadata)
                        const localized = message.kind === "localized"
                          ? t(`messages.${message.key}`, message.params)
                          : null
                        return (
                          <div key={alert.id} className={`rounded-md bg-white/45 dark:bg-black/20 p-2 ${alert.isResolved ? "opacity-60" : ""}`}>
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                {title && title.toLowerCase() !== String(label).toLowerCase() && <div className="text-xs font-medium truncate">{title}</div>}
                                {localized
                                  ? <p className="text-xs opacity-90 mt-0.5">{localized}</p>
                                  : alert.description && (
                                      <p className="text-xs opacity-90 mt-0.5">
                                        {alert.description}
                                        <span className="ml-1 opacity-60">({t("legacyBadge")})</span>
                                      </p>
                                    )}
                              </div>
                              <div className="flex flex-col items-end gap-1 shrink-0 text-right">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs whitespace-nowrap">{alert.agent?.name}</span>
                                  {/* C14: удаление оповещения — в «⋯», а не
                                      вплотную к имени агента и кнопке
                                      «решено», которую жмут каждый день. */}
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button variant="ghost" size="icon" className="h-6 w-6" aria-label={t("moreActions")}><MoreHorizontal className="h-3 w-3" aria-hidden="true" /></Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => { setDeleteItem(alert); setDeleteOpen(true) }}>
                                        <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                                        {t("delete")}
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                                <span className="text-[10px] opacity-70 whitespace-nowrap">{formatDateTime(new Date(alert.createdAt), locale)}</span>
                                {!alert.isResolved
                                  ? <Button size="sm" variant="outline" className="h-6 text-[10px] bg-white/50 hover:bg-white/80" onClick={() => resolveAlert(alert.id)}><CheckCircle2 className="h-3 w-3 mr-1" /> {t("resolve")}</Button>
                                  : <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">{t("resolved")}</span>}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })
          })()}
        </div>
      )}

      <DeleteConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} onConfirm={confirmDelete} title={t("delete")} itemName={deleteItem?.title} />
    </div>
  )
}
