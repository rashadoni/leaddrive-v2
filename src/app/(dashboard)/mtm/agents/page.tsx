"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { toast } from "sonner"
import { useLocale, useTranslations } from "next-intl"
import { mtmStatusLabel } from "@/lib/mtm/status-labels"
import { PageDescription } from "@/components/page-description"
import { HelpButton } from "@/components/help/help-button"
import { ColorStatCard } from "@/components/color-stat-card"
import { MtmAgentForm } from "@/components/mtm/agent-form"
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { UserCog, Plus, Pencil, Trash2, MoreHorizontal, Search, Users, Wifi, Download, Phone, MessageCircle, MapPin, Smartphone, ClipboardList, MapPinned } from "lucide-react"

const roleColors: Record<string, string> = {
  ADMIN: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  MANAGER: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  SUPERVISOR: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
  AGENT: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300",
}
const statusColors: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  INACTIVE: "bg-muted text-muted-foreground",
  SUSPENDED: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300",
}
const ONLINE_WINDOW_MS = 10 * 60 * 1000

export default function MtmAgentsPage() {
  const { data: session } = useSession()
  const t = useTranslations("mtmAgents")
  const locale = useLocale()
  const ts = useTranslations("mtmStatus")
  const [agents, setAgents] = useState<any[]>([])
  const [statsByAgent, setStatsByAgent] = useState<Record<string, { visits: number; eff: number }>>({})
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editData, setEditData] = useState<any>(undefined)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteItem, setDeleteItem] = useState<any>(null)
  const [search, setSearch] = useState("")
  const [activeFilter, setActiveFilter] = useState("all")
  const [sortBy, setSortBy] = useState("activity")
  const orgId = session?.user?.organizationId

  const fetchAgents = async () => {
    try {
      const res = await fetch("/api/v1/mtm/agents?limit=200", { headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string> })
      const r = await res.json()
      if (!res.ok || !r.success) toast.error(`Failed to load agents: ${r.error || "Unknown error"}`)
      else setAgents(r.data.agents || [])
    } catch (e) {
      toast.error(`Failed to load agents: ${e instanceof Error ? e.message : "Network error"}`)
    } finally { setLoading(false) }
  }
  // Per-agent weekly activity (visits + effectiveness) — joined from the analytics KPI endpoint.
  const fetchStats = async () => {
    try {
      const r = await (await fetch("/api/v1/mtm/analytics?period=weekly", { headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string> })).json()
      const m: Record<string, { visits: number; eff: number }> = {}
      for (const a of (r?.data?.agentKpis || [])) m[a.agentId] = { visits: a.totalVisits, eff: a.visitEffectiveness }
      setStatsByAgent(m)
    } catch { /* stats are best-effort */ }
  }
  useEffect(() => { fetchAgents(); fetchStats() }, [orgId])

  const now = Date.now()
  const seenMs = (a: any) => (a.lastSeenAt ? now - new Date(a.lastSeenAt).getTime() : Infinity)
  const isOnline = (a: any) => seenMs(a) < ONLINE_WINDOW_MS
  // A break and a dead phone both stop GPS; only one of them is a reason to
  // call the rep. The workday's own state answers that, so it goes first and
  // "last seen" stays for the case where nothing else explains the silence.
  const presenceText = (a: any): { text: string; tone: "working" | "paused" | "quiet" } => {
    const presence = a?.presence
    const at = (value: string | null) =>
      value ? new Date(value).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) : ""
    if (presence?.kind === "paused") {
      return { text: presence.since ? t("presencePausedSince", { time: at(presence.since) }) : t("presencePaused"), tone: "paused" }
    }
    if (presence?.kind === "finished") {
      return { text: presence.at ? t("presenceFinishedAt", { time: at(presence.at) }) : t("presenceFinished"), tone: "quiet" }
    }
    if (presence?.kind === "not-started") return { text: t("presenceNotStarted"), tone: "quiet" }
    return { text: lastSeenText(a), tone: isOnline(a) ? "working" : "quiet" }
  }

  const lastSeenText = (a: any) => {
    const ms = seenMs(a)
    if (!isFinite(ms)) return t("neverSeen")
    if (ms < ONLINE_WINDOW_MS) return t("online")
    const min = Math.floor(ms / 60000)
    if (min < 60) return `${min} ${t("agoMin")}`
    const h = Math.floor(min / 60)
    if (h < 24) return `${h} ${t("agoHour")}`
    return `${Math.floor(h / 24)} ${t("agoDay")}`
  }
  const appInstalled = (a: any) => Boolean(a.expoPushToken)
  const digits = (p?: string) => (p || "").replace(/[^\d+]/g, "")

  const filtered = agents.filter(a => {
    if (activeFilter === "online") { if (!isOnline(a)) return false }
    else if (activeFilter !== "all" && a.status !== activeFilter) return false
    if (search) { const s = search.toLowerCase(); if (!a.name?.toLowerCase().includes(s) && !a.email?.toLowerCase().includes(s) && !a.phone?.toLowerCase().includes(s)) return false }
    return true
  }).sort((a, b) => {
    switch (sortBy) {
      case "name_asc": return (a.name || "").localeCompare(b.name || "")
      case "name_desc": return (b.name || "").localeCompare(a.name || "")
      case "role": return (a.role || "").localeCompare(b.role || "")
      case "status": return (a.status || "").localeCompare(b.status || "")
      case "lastSeen": return seenMs(a) - seenMs(b)
      case "activity": return (statsByAgent[b.id]?.visits || 0) - (statsByAgent[a.id]?.visits || 0)
      default: return 0
    }
  })

  const statusCounts: Record<string, number> = {}
  for (const a of agents) statusCounts[a.status] = (statusCounts[a.status] || 0) + 1
  const totalActive = statusCounts["ACTIVE"] || 0
  const totalOnline = agents.filter(isOnline).length
  const totalManagers = agents.filter(a => a.role === "MANAGER" || a.role === "SUPERVISOR").length

  // Group agents under their manager (falls back to a "no manager" bucket).
  const noMgrLabel = t("noManager")
  const groups: { key: string; label: string; items: any[] }[] = []
  const gIndex: Record<string, number> = {}
  for (const a of filtered) {
    const key = a.manager?.name || noMgrLabel
    if (gIndex[key] === undefined) { gIndex[key] = groups.length; groups.push({ key, label: key, items: [] }) }
    groups[gIndex[key]].items.push(a)
  }
  // Biggest team first so the page opens on a full grid; the "no manager" bucket sinks to the end.
  groups.sort((a, b) => {
    const an = a.key === noMgrLabel ? 1 : 0, bn = b.key === noMgrLabel ? 1 : 0
    return an !== bn ? an - bn : b.items.length - a.items.length
  })

  async function confirmDelete() {
    if (!deleteItem) return
    const res = await fetch(`/api/v1/mtm/agents/${deleteItem.id}`, { method: "DELETE", headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string> })
    if (!res.ok) throw new Error((await res.json()).error || "Failed to delete")
    fetchAgents()
  }

  if (loading) return (
    <div className="space-y-6">
      <PageDescription icon={UserCog} title={t("title")} description={t("subtitle")} />
      <div className="animate-pulse space-y-4">
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">{[1, 2, 3, 4].map(i => <div key={i} className="h-24 bg-muted rounded-lg" />)}</div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">{[1, 2, 3, 4, 5, 6].map(i => <div key={i} className="h-32 bg-muted rounded-lg" />)}</div>
      </div>
    </div>
  )

  // A5: два локальных списка вместо словаря стоили двух ошибок сразу.
  // Незнакомое значение печаталось как есть, а администратор показывался
  // менеджером — ADMIN и MANAGER вели на одну подпись.
  const roleLabel = (role: string) => mtmStatusLabel(ts, "role", role)
  const statusLabel = (value: string) => mtmStatusLabel(ts, "agentStatus", value)

  const renderCard = (agent: any) => {
    const presence = presenceText(agent)
    const stat = statsByAgent[agent.id]
    const phone = digits(agent.phone)
    return (
      <div key={agent.id} className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-4 flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <div className="relative h-10 w-10 shrink-0">
            {agent.avatar
              ? <img src={agent.avatar} alt="" className="h-10 w-10 rounded-full object-cover" />
              : <div className="h-10 w-10 rounded-full bg-cyan-100 dark:bg-cyan-900/30 flex items-center justify-center text-cyan-700 dark:text-cyan-400 font-semibold">{agent.name?.charAt(0)?.toUpperCase()}</div>}
            <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card ${presence.tone === "working" ? "bg-green-500" : presence.tone === "paused" ? "bg-amber-500" : "bg-muted-foreground/40"}`} title={presence.text} />
          </div>
          <div className="flex-1 min-w-0">
            <a href={`/mtm/visits?agentId=${agent.id}`} className="font-medium text-sm truncate hover:underline block">{agent.name}</a>
            <div className={`text-[11px] ${presence.tone === "working" ? "text-green-600 dark:text-green-400" : presence.tone === "paused" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>{presence.text}</div>
          </div>
          <div className="flex gap-1 shrink-0">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditData(agent); setFormOpen(true) }}><Pencil className="h-3.5 w-3.5" /></Button>
            {/* C14: удаление уезжает в «⋯». Рядом с «изменить» оно стояло на
                расстоянии промаха от ежедневного действия, а отменить его
                нельзя. Тот же приём уже применён на «Визитах». */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={t("moreActions")}><MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => { setDeleteItem(agent); setDeleteOpen(true) }}>
                  <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                  {t("delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* This-week activity snapshot */}
        <div className="flex items-center gap-3 rounded-md bg-muted/40 px-2.5 py-1.5 text-xs">
          <span className="text-muted-foreground">{t("weekLabel")}</span>
          <span className="font-semibold">{stat?.visits ?? 0}</span><span className="text-muted-foreground">{t("shortVisits")}</span>
          <span className="ml-auto font-semibold">{stat?.eff ?? 0}%</span><span className="text-muted-foreground">{t("shortEff")}</span>
        </div>

        {/* Badges: role · status · app */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-[10px] px-2 py-0.5 rounded-full ${roleColors[agent.role] || ""}`}>{roleLabel(agent.role)}</span>
          <span className={`text-[10px] px-2 py-0.5 rounded-full ${statusColors[agent.status] || ""}`}>{statusLabel(agent.status)}</span>
          <span className={`text-[10px] px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${appInstalled(agent) ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"}`}>
            <Smartphone className="h-2.5 w-2.5" />{appInstalled(agent) ? t("appInstalled") : t("appNotActivated")}
          </span>
        </div>

        {/* Contact + quick actions */}
        <div className="flex items-center justify-between gap-2 border-t border-zinc-100 dark:border-zinc-800 pt-2">
          <span className="text-[11px] text-muted-foreground truncate">{agent.phone || agent.email || "—"}</span>
          <div className="flex gap-1 shrink-0">
            {phone && <a href={`tel:${phone}`} title={t("actionCall")} className="h-6 w-6 rounded flex items-center justify-center hover:bg-muted text-muted-foreground"><Phone className="h-3.5 w-3.5" /></a>}
            {phone && <a href={`https://wa.me/${phone.replace(/^\+/, "")}`} target="_blank" rel="noopener noreferrer" title={t("actionMessage")} className="h-6 w-6 rounded flex items-center justify-center hover:bg-muted text-muted-foreground"><MessageCircle className="h-3.5 w-3.5" /></a>}
            <a href={`/mtm/map?agentId=${agent.id}`} title={t("actionMap")} className="h-6 w-6 rounded flex items-center justify-center hover:bg-muted text-muted-foreground"><MapPinned className="h-3.5 w-3.5" /></a>
            <a href={`/mtm/visits?agentId=${agent.id}`} title={t("actionHistory")} className="h-6 w-6 rounded flex items-center justify-center hover:bg-muted text-muted-foreground"><ClipboardList className="h-3.5 w-3.5" /></a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <PageDescription icon={UserCog} title={`${t("title")} (${filtered.length})`} description={t("subtitle")} />
          <HelpButton slug="mtm-agents" variant="label" />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => {
            const csv = ["Name,Email,Phone,Role,Status,LastSeen", ...filtered.map(a => `${a.name || ""},${a.email || ""},${a.phone || ""},${a.role || ""},${a.status || ""},${a.lastSeenAt || ""}`)].join("\n")
            const blob = new Blob([csv], { type: "text/csv" })
            const el = document.createElement("a"); el.href = URL.createObjectURL(blob); el.download = "field-agents.csv"; el.click()
          }}><Download className="h-4 w-4 mr-1" /> {t("export")}</Button>
          <Button onClick={() => { setEditData(undefined); setFormOpen(true) }}><Plus className="h-4 w-4 mr-1" /> {t("add")}</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 stagger-children">
        <ColorStatCard label={t("statTotal")} value={agents.length} icon={<UserCog className="h-4 w-4" />} hint={t("hintTotal")} />
        <ColorStatCard label={t("statActive")} value={totalActive} icon={<Users className="h-4 w-4" />} hint={t("hintActive")} />
        <ColorStatCard label={t("statOnline")} value={totalOnline} icon={<Wifi className="h-4 w-4" />} hint={t("hintOnline")} />
        <ColorStatCard label={t("statManagers")} value={totalManagers} icon={<Users className="h-4 w-4" />} hint={t("hintManagers")} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant={activeFilter === "all" ? "default" : "outline"} size="sm" onClick={() => setActiveFilter("all")}>{t("all")} ({agents.length})</Button>
        <Button variant={activeFilter === "online" ? "default" : "outline"} size="sm" onClick={() => setActiveFilter("online")}>{t("filterOnline")} ({totalOnline})</Button>
        {(["ACTIVE", "INACTIVE", "SUSPENDED"] as const).map(s => (
          <Button key={s} variant={activeFilter === s ? "default" : "outline"} size="sm" onClick={() => setActiveFilter(s)}>{t(`filter${s.charAt(0) + s.slice(1).toLowerCase()}` as any)} ({statusCounts[s] || 0})</Button>
        ))}
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder={t("searchPlaceholder")} value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={sortBy} onChange={e => setSortBy(e.target.value)} className="w-[170px]">
          <option value="activity">{t("sortActivity")}</option>
          <option value="lastSeen">{t("sortLastSeen")}</option>
          <option value="name_asc">{t("sortNameAsc")}</option>
          <option value="name_desc">{t("sortNameDesc")}</option>
          <option value="role">{t("sortRole")}</option>
          <option value="status">{t("sortStatus")}</option>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-muted-foreground border border-zinc-200 dark:border-zinc-700 rounded-lg bg-card">{agents.length === 0 ? t("empty") : t("noResults")}</div>
      ) : (
        <div className="space-y-5">
          {groups.map(g => (
            <div key={g.key}>
              <div className="flex items-center gap-2 mb-2">
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.label}</h3>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">{g.items.length}</span>
              </div>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">{g.items.map(renderCard)}</div>
            </div>
          ))}
        </div>
      )}

      <MtmAgentForm open={formOpen} onOpenChange={setFormOpen} onSaved={fetchAgents} initialData={editData} orgId={orgId ? String(orgId) : undefined} />
      <DeleteConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} onConfirm={confirmDelete} title={t("delete")} itemName={deleteItem?.name} />
    </div>
  )
}
