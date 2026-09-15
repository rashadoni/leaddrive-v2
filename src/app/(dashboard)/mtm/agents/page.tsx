"use client"

import { useEffect, useState, type ReactNode } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useSession } from "next-auth/react"
import { useLocale, useTranslations } from "next-intl"
import { formatDateTime, formatTime } from "@/lib/format-date"
import { mtmWorkdayBreakSummary } from "@/lib/mtm/workday-break-summary"
import { mtmStatusLabel } from "@/lib/mtm/status-labels"
import { useMtmApiError } from "@/components/mtm/use-mtm-api-error"
import { MTM_AGENT_APP_ACTIVE_WINDOW_MS } from "@/lib/mtm/agent-card-activity"
import { buildMtmAgentHierarchy, flattenMtmAgentTeam, isMtmLeaderRole, mtmAgentMatchesSearch, type MtmAgentTeam } from "@/lib/mtm/agent-hierarchy"
import { PageDescription } from "@/components/page-description"
import { HelpButton } from "@/components/help/help-button"
import { ColorStatCard } from "@/components/color-stat-card"
import { MtmAgentForm } from "@/components/mtm/agent-form"
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { UserCog, Plus, Pencil, Trash2, MoreHorizontal, Search, Users, Wifi, Download, Phone, MessageCircle, Smartphone, BellOff, History, MapPinned, X, Filter, AlertCircle, LayoutGrid, List } from "lucide-react"

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
// One freshness window for the "online" dot/counter and the app badge
// (review of #209: 10 min here and 15 min on the badge disagreed).
const ONLINE_WINDOW_MS = MTM_AGENT_APP_ACTIVE_WINDOW_MS
// Cards or a compact list; a per-viewer convenience, so localStorage is enough.
const VIEW_STORAGE_KEY = "mtm-agents-view"
type AgentsView = "cards" | "list"

export default function MtmAgentsPage() {
  const { data: session } = useSession()
  const t = useTranslations("mtmAgents")
  const locale = useLocale()
  const ts = useTranslations("mtmStatus")
  const explainError = useMtmApiError()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  // One employee in focus, from a link or the card menu. The visits page
  // does not filter by employee, so "show me this person" lives here.
  const focusAgentId = searchParams.get("agentId")?.trim() || ""
  const [agents, setAgents] = useState<any[]>([])
  const [loadError, setLoadError] = useState("")
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editData, setEditData] = useState<any>(undefined)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteItem, setDeleteItem] = useState<any>(null)
  const [search, setSearch] = useState("")
  const [activeFilter, setActiveFilter] = useState("all")
  const [sortBy, setSortBy] = useState("activity")
  const [view, setView] = useState<AgentsView>("cards")
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(VIEW_STORAGE_KEY)
      if (stored === "cards" || stored === "list") setView(stored)
    } catch { /* storage blocked: stay on cards */ }
  }, [])
  const changeView = (next: AgentsView) => {
    setView(next)
    try { window.localStorage.setItem(VIEW_STORAGE_KEY, next) } catch { /* not remembered, still switched */ }
  }
  const orgId = session?.user?.organizationId

  const fetchAgents = async () => {
    try {
      const res = await fetch("/api/v1/mtm/agents?limit=200", { headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string> })
      const r = await res.json().catch(() => null)
      if (!res.ok || !r?.success) {
        setLoadError(explainError(r, res.status))
      } else {
        setLoadError("")
        setAgents(r.data.agents || [])
      }
    } catch {
      setLoadError(explainError(null))
    } finally { setLoading(false) }
  }
  useEffect(() => { fetchAgents() }, [orgId])

  const now = Date.now()
  // The newest mobile signal the server computed for the badge (GPS point or
  // lastSeenAt), so the dot and the badge read the same fact.
  const seenMs = (a: any) => {
    const at = a.app?.lastSignalAt ?? a.lastSeenAt
    return at ? now - new Date(at).getTime() : Infinity
  }
  const isOnline = (a: any) => seenMs(a) <= ONLINE_WINDOW_MS
  // A break and a dead phone both stop GPS; only one of them is a reason to
  // call the rep. The workday's own state answers that, so it goes first and
  // "last seen" stays for the case where nothing else explains the silence.
  const presenceText = (a: any): { text: string; tone: "working" | "paused" | "quiet" } => {
    const presence = a?.presence
    // Through the shared helper, not toLocaleTimeString: the C2 gate exists
    // because the root-locale fallback cannot be trusted to give Azerbaijani
    // the 24-hour clock it needs.
    const at = (value: string | null) => (value ? formatTime(value, locale) : "")
    if (presence?.kind === "paused") {
      return { text: presence.since ? t("presencePausedSince", { time: at(presence.since) }) : t("presencePaused"), tone: "paused" }
    }
    if (presence?.kind === "finished") {
      return { text: presence.at ? t("presenceFinishedAt", { time: at(presence.at) }) : t("presenceFinished"), tone: "quiet" }
    }
    // Отсутствие записи рабочего дня НЕ объясняет молчание, поэтому оно не
    // должно перебивать живую точку. Записи закономерно нет у руководителей и
    // супервайзеров — они делятся геопозицией другим механизмом, который смены
    // не создаёт, — и у любого агента после полуночи: день не закрывается сам,
    // второй начать нельзя, а точки продолжают писаться в старую запись.
    // Свежая точка — это факт; «день не начат» — вывод из отсутствия строки,
    // и факт сильнее вывода. Иначе счётчик «Онлайн» в шапке считает по GPS и
    // показывает троих, пока все три карточки уверяют, что никто не начинал.
    if (presence?.kind === "not-started" && !isOnline(a)) {
      return { text: t("presenceNotStarted"), tone: "quiet" }
    }
    return { text: lastSeenText(a), tone: isOnline(a) ? "working" : "quiet" }
  }

  const lastSeenText = (a: any) => {
    const ms = seenMs(a)
    if (!isFinite(ms)) return t("neverSeen")
    if (ms <= ONLINE_WINDOW_MS) return t("online")
    const min = Math.floor(ms / 60000)
    if (min < 60) return `${min} ${t("agoMin")}`
    const h = Math.floor(min / 60)
    if (h < 24) return `${h} ${t("agoHour")}`
    return `${Math.floor(h / 24)} ${t("agoDay")}`
  }
  const setFocusAgent = (id: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (id) params.set("agentId", id)
    else params.delete("agentId")
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }
  const focusAgent = focusAgentId ? agents.find(a => a.id === focusAgentId) : null
  const digits = (p?: string) => (p || "").replace(/[^\d+]/g, "")

  const filtered = agents.filter(a => {
    if (focusAgentId && a.id !== focusAgentId) return false
    if (activeFilter === "online") { if (!isOnline(a)) return false }
    else if (activeFilter === "managers") { if (!isMtmLeaderRole(a.role)) return false }
    else if (activeFilter !== "all" && a.status !== activeFilter) return false
    if (search && !mtmAgentMatchesSearch(a, search)) return false
    return true
  }).sort((a, b) => {
    switch (sortBy) {
      case "name_asc": return (a.name || "").localeCompare(b.name || "")
      case "name_desc": return (b.name || "").localeCompare(a.name || "")
      case "role": return (a.role || "").localeCompare(b.role || "")
      case "status": return (a.status || "").localeCompare(b.status || "")
      case "lastSeen": return seenMs(a) - seenMs(b)
      case "activity": return (b.activity?.visits || 0) - (a.activity?.visits || 0)
      default: return 0
    }
  })

  const statusCounts: Record<string, number> = {}
  for (const a of agents) statusCounts[a.status] = (statusCounts[a.status] || 0) + 1
  const totalActive = statusCounts["ACTIVE"] || 0
  const totalOnline = agents.filter(isOnline).length
  const totalManagers = agents.filter(a => a.role === "MANAGER" || a.role === "SUPERVISOR").length

  // Teams, not name buckets (prod 2026-09-15): a manager heads their own team
  // instead of sinking into "no manager". Rules live in agent-hierarchy.ts.
  const hierarchy = buildMtmAgentHierarchy(filtered, agents)

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

  // Edit + "⋯" — the same controls on a card and on a list row.
  const renderActions = (agent: any) => (
    <div className="flex gap-1 shrink-0">
      <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={t("edit")} onClick={() => { setEditData(agent); setFormOpen(true) }}><Pencil className="h-3.5 w-3.5" /></Button>
      {/* C14: удаление уезжает в «⋯». Рядом с «изменить» оно стояло на
          расстоянии промаха от ежедневного действия, а отменить его
          нельзя. Тот же приём уже применён на «Визитах». */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={t("moreActions")}><MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setFocusAgent(agent.id)}>
            <Filter className="mr-2 h-4 w-4" aria-hidden="true" />
            {t("focusAgent")}
          </DropdownMenuItem>
          <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => { setDeleteItem(agent); setDeleteOpen(true) }}>
            <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
            {t("delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )

  const renderContactLinks = (agent: any) => {
    const phone = digits(agent.phone)
    const historyHref = `/mtm/map?mode=history&agentId=${encodeURIComponent(agent.id)}`
    return (
      <div className="flex gap-1 shrink-0">
        {phone && <a href={`tel:${phone}`} title={t("actionCall")} aria-label={t("actionCall")} className="h-6 w-6 rounded flex items-center justify-center hover:bg-muted text-muted-foreground"><Phone className="h-3.5 w-3.5" /></a>}
        {phone && <a href={`https://wa.me/${phone.replace(/^\+/, "")}`} target="_blank" rel="noopener noreferrer" title={t("actionMessage")} aria-label={t("actionMessage")} className="h-6 w-6 rounded flex items-center justify-center hover:bg-muted text-muted-foreground"><MessageCircle className="h-3.5 w-3.5" /></a>}
        <a href={`/mtm/map?agentId=${encodeURIComponent(agent.id)}`} title={t("actionMap")} aria-label={t("actionMap")} className="h-6 w-6 rounded flex items-center justify-center hover:bg-muted text-muted-foreground"><MapPinned className="h-3.5 w-3.5" /></a>
        <a href={historyHref} title={t("actionHistory")} aria-label={t("actionHistory")} className="h-6 w-6 rounded flex items-center justify-center hover:bg-muted text-muted-foreground"><History className="h-3.5 w-3.5" /></a>
      </div>
    )
  }

  const presenceDot = (agent: any, presence: { text: string; tone: string }) => (
    <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card ${presence.tone === "working" ? "bg-green-500" : presence.tone === "paused" ? "bg-amber-500" : "bg-muted-foreground/40"}`} title={`${presence.text} · ${lastSeenText(agent)}`} />
  )
  const avatar = (agent: any, size: "sm" | "md") => {
    const box = size === "md" ? "h-10 w-10" : "h-8 w-8"
    return agent.avatar
      ? <img src={agent.avatar} alt="" className={`${box} rounded-full object-cover`} />
      : <div className={`${box} rounded-full bg-cyan-100 dark:bg-cyan-900/30 flex items-center justify-center text-cyan-700 dark:text-cyan-400 font-semibold`}>{agent.name?.charAt(0)?.toUpperCase()}</div>
  }
  const appBadge = (app: { state: "active" | "quiet" | "never"; lastSignalAt: string | null } | undefined) => app ? (
    <span
      className={`text-[10px] px-2 py-0.5 rounded-full inline-flex items-center gap-1 whitespace-nowrap ${app.state === "active" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300" : "bg-muted text-muted-foreground"}`}
      title={app.lastSignalAt ? t("appLastSignal", { time: formatDateTime(app.lastSignalAt, locale) }) : undefined}
      data-testid="mtm-agent-app-state"
    >
      <Smartphone className="h-2.5 w-2.5" />{app.state === "active" ? t("appActive") : app.state === "quiet" ? t("appQuiet") : t("appNever")}
    </span>
  ) : null

  // Equal-height cards (prod 2026-09-15, "what is this emptiness"): the card is
  // a column whose chip row grows and whose footer is pinned to the bottom, and
  // the grid stretches every row to the tallest card, so an extra
  // "notifications off" chip or a missing phone no longer shifts neighbours.
  const renderCard = (agent: any, team?: MtmAgentTeam<any>) => {
    const presence = presenceText(agent)
    const breaks = mtmWorkdayBreakSummary(agent?.breaks, new Date())
    const activity = agent.activity as { periodDays: number; visits: number; planFulfillment: number | null } | null | undefined
    const app = agent.app as { state: "active" | "quiet" | "never"; lastSignalAt: string | null; notificationsConnected: boolean } | undefined
    const historyHref = `/mtm/map?mode=history&agentId=${encodeURIComponent(agent.id)}`
    const leads = !!team && team.leader?.id === agent.id
    return (
      <div
        key={agent.id}
        data-testid={leads ? "mtm-agent-leader-card" : "mtm-agent-card"}
        className={`h-full rounded-lg border bg-card p-4 flex flex-col gap-3 ${leads ? "border-blue-300 dark:border-blue-800 ring-1 ring-blue-100 dark:ring-blue-900/40 shadow-sm" : "border-zinc-200 dark:border-zinc-700"}`}
      >
        <div className="flex items-start gap-3 min-h-[2.75rem]">
          <div className="relative h-10 w-10 shrink-0">
            {avatar(agent, "md")}
            {presenceDot(agent, presence)}
          </div>
          <div className="flex-1 min-w-0">
            <a href={historyHref} title={t("actionHistory")} className={`text-sm truncate hover:underline block ${leads ? "font-semibold" : "font-medium"}`}>{agent.name}</a>
            {breaks.count > 0 ? (
              // The segments, not just the state: two twenty-minute breaks and
              // one two-hour break read the same as "on a break" and are very
              // different days (A7 tail).
              <div className="text-[10px] text-muted-foreground" data-testid="mtm-agent-breaks">
                {t("breaksSummary", { count: breaks.count, minutes: breaks.minutes })}
              </div>
            ) : null}
            <div className={`text-[11px] truncate ${presence.tone === "working" ? "text-green-600 dark:text-green-400" : presence.tone === "paused" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>{presence.text}</div>
          </div>
          {renderActions(agent)}
        </div>

        {/* Activity over the analytics "weekly" window: visits and plan
            fulfilment from the same route points analytics counts. No plan in
            the window is said as such, never printed as 0%. */}
        {activity ? (
          <div className="flex items-center gap-2 rounded-md bg-muted/40 px-2.5 py-1.5 text-xs" data-testid="mtm-agent-activity">
            <span className="text-muted-foreground">{t("periodLastDays", { count: activity.periodDays })}</span>
            <span className="font-semibold tabular-nums">{activity.visits}</span><span className="text-muted-foreground">{t("shortVisits")}</span>
            {activity.planFulfillment === null
              ? <span className="ml-auto text-muted-foreground">{t("planNone")}</span>
              : <span className="ml-auto"><span className="text-muted-foreground">{t("planFulfillment")}</span> <span className="font-semibold tabular-nums">{activity.planFulfillment}%</span></span>}
          </div>
        ) : null}

        {/* Badges: role · status · app — one wrapping row with a reserved height */}
        <div className="flex flex-1 flex-wrap content-start items-start gap-1.5 min-h-[2.75rem]">
          <span className={`text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap ${leads ? "font-semibold " : ""}${roleColors[agent.role] || ""}`}>{roleLabel(agent.role)}</span>
          {leads && team ? <span className="text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300" data-testid="mtm-agent-team-size">{t("teamSize", { count: team.size - 1 })}</span> : null}
          <span className={`text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap ${statusColors[agent.status] || ""}`}>{statusLabel(agent.status)}</span>
          {appBadge(app)}
          {app && !app.notificationsConnected ? (
            <span className="text-[10px] px-2 py-0.5 rounded-full inline-flex items-center gap-1 whitespace-nowrap bg-muted text-muted-foreground">
              <BellOff className="h-2.5 w-2.5" />{t("notificationsOff")}
            </span>
          ) : null}
        </div>

        {/* Contact + quick actions — a fixed-height footer at the bottom */}
        <div className="mt-auto flex h-8 items-center justify-between gap-2 border-t border-zinc-100 dark:border-zinc-800 pt-2">
          <span className="text-[11px] text-muted-foreground truncate">{agent.phone || agent.email || agent.userEmail || "—"}</span>
          {renderContactLinks(agent)}
        </div>
      </div>
    )
  }

  const cardGrid = "grid auto-rows-fr gap-3 grid-cols-[repeat(auto-fill,minmax(18rem,1fr))]"

  const teamHeader = (label: string, count: number, hint?: string, nested?: boolean) => (
    <div className="flex items-center gap-2 mb-2 min-w-0">
      <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <h3 className={`truncate text-xs font-semibold uppercase tracking-wide ${nested ? "text-muted-foreground" : "text-foreground/80"}`}>{label}</h3>
      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">{count}</span>
      {hint ? <span className="truncate text-[10px] text-muted-foreground">{hint}</span> : null}
    </div>
  )

  // A team: the leader's card first, then direct reports; a report who leads a
  // team of their own is a nested sub-team here and nowhere else.
  const renderTeam = (team: MtmAgentTeam<any>, depth: number): ReactNode => {
    const cards = [...(team.leader ? [team.leader] : []), ...team.members]
    return (
      <section key={team.key} data-testid="mtm-agent-team" className={depth > 0 ? "border-l-2 border-blue-200 pl-3 dark:border-blue-900" : ""}>
        {teamHeader(team.label, team.size, team.leader ? undefined : t("leaderHidden"), depth > 0)}
        {cards.length ? <div className={cardGrid}>{cards.map(agent => renderCard(agent, team))}</div> : null}
        {team.subteams.length ? <div className={`space-y-4 ${cards.length ? "mt-4" : ""}`}>{team.subteams.map(sub => renderTeam(sub, depth + 1))}</div> : null}
      </section>
    )
  }

  // Small teams (one or two cards, no sub-teams) share a row instead of each
  // leaving a wide blank strip in a three-column grid.
  const teamSlot = (team: MtmAgentTeam<any>) => {
    const cards = [...(team.leader ? [team.leader] : []), ...team.members]
    const small = team.subteams.length === 0 && cards.length <= 2
    if (!small) return <div key={team.key} className="basis-full min-w-0">{renderTeam(team, 0)}</div>
    return (
      <section key={team.key} data-testid="mtm-agent-team" className={`min-w-0 w-full ${cards.length === 2 ? "sm:flex-[2_1_36rem] sm:max-w-[60rem]" : "sm:flex-[1_1_18rem] sm:max-w-[30rem]"}`}>
        {teamHeader(team.label, team.size, team.leader ? undefined : t("leaderHidden"))}
        <div className={`grid auto-rows-fr gap-3 ${cards.length === 2 ? "sm:grid-cols-2" : "grid-cols-1"}`}>
          {cards.map(agent => renderCard(agent, team))}
        </div>
      </section>
    )
  }

  // Compact list: one row per person, grouped the same way as the cards.
  // No horizontal scroll frame — secondary columns drop out on narrow screens.
  const renderRow = (agent: any, depth: number, leads: boolean, team?: MtmAgentTeam<any>) => {
    const presence = presenceText(agent)
    const activity = agent.activity as { visits: number; planFulfillment: number | null } | null | undefined
    const app = agent.app as { state: "active" | "quiet" | "never"; lastSignalAt: string | null } | undefined
    return (
      <tr key={agent.id} data-testid="mtm-agent-row" className={`border-t border-zinc-100 dark:border-zinc-800 ${leads ? "bg-blue-50/40 dark:bg-blue-950/10" : ""}`}>
        <td className="py-2 pr-2" style={{ paddingLeft: `${0.75 + Math.min(depth, 4) * 1.25}rem` }}>
          <div className="flex items-center gap-2 min-w-0">
            <div className="relative h-8 w-8 shrink-0">{avatar(agent, "sm")}{presenceDot(agent, presence)}</div>
            <div className="min-w-0">
              <a href={`/mtm/map?mode=history&agentId=${encodeURIComponent(agent.id)}`} className={`block truncate hover:underline ${leads ? "font-semibold" : "font-medium"}`}>{agent.name}</a>
              <div className="flex flex-wrap items-center gap-1">
                <span className={`text-[10px] px-1.5 rounded-full ${roleColors[agent.role] || ""}`}>{roleLabel(agent.role)}</span>
                {leads && team ? <span className="text-[10px] text-muted-foreground">{t("teamSize", { count: team.size - 1 })}</span> : null}
              </div>
            </div>
          </div>
        </td>
        <td className="hidden lg:table-cell py-2 pr-2 text-xs text-muted-foreground truncate">{agent.manager?.name || "—"}</td>
        <td className={`py-2 pr-2 text-xs ${presence.tone === "working" ? "text-green-600 dark:text-green-400" : presence.tone === "paused" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>{presence.text}</td>
        <td className="hidden md:table-cell py-2 pr-2 text-xs tabular-nums">{activity ? activity.visits : "—"}</td>
        <td className="hidden md:table-cell py-2 pr-2 text-xs tabular-nums">{activity ? (activity.planFulfillment === null ? <span className="text-muted-foreground">{t("planNone")}</span> : `${activity.planFulfillment}%`) : "—"}</td>
        <td className="hidden xl:table-cell py-2 pr-2">{appBadge(app)}</td>
        <td className="hidden sm:table-cell py-2 pr-2">
          <div className="flex items-center gap-1 min-w-0">
            <span className="hidden xl:inline truncate text-[11px] text-muted-foreground max-w-[12rem]">{agent.phone || agent.email || agent.userEmail || "—"}</span>
            {renderContactLinks(agent)}
          </div>
        </td>
        <td className="py-2 pr-2 text-right">{renderActions(agent)}</td>
      </tr>
    )
  }
  const groupRow = (key: string, label: string, count: number, hint?: string) => (
    <tr key={`group-${key}`} className="border-t border-zinc-200 dark:border-zinc-700 bg-muted/40">
      <td colSpan={8} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label} <span className="ml-1 rounded-full bg-muted px-1.5 text-[10px] font-normal">{count}</span>
        {hint ? <span className="ml-2 text-[10px] font-normal normal-case">{hint}</span> : null}
      </td>
    </tr>
  )
  const renderList = () => (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card" data-testid="mtm-agents-list">
      <table className="w-full table-fixed text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 font-medium w-[45%] md:w-[28%]">{t("colName")}</th>
            <th className="hidden lg:table-cell py-2 pr-2 font-medium">{t("colManager")}</th>
            <th className="py-2 pr-2 font-medium">{t("colToday")}</th>
            <th className="hidden md:table-cell py-2 pr-2 font-medium">{t("colVisits7d")}</th>
            <th className="hidden md:table-cell py-2 pr-2 font-medium">{t("colPlan")}</th>
            <th className="hidden xl:table-cell py-2 pr-2 font-medium">{t("colApp")}</th>
            <th className="hidden sm:table-cell py-2 pr-2 font-medium">{t("colContacts")}</th>
            <th className="py-2 pr-2 w-20"><span className="sr-only">{t("moreActions")}</span></th>
          </tr>
        </thead>
        <tbody>
          {hierarchy.teams.flatMap(team => [
            groupRow(team.key, team.label, team.size, team.leader ? undefined : t("leaderHidden")),
            ...flattenMtmAgentTeam(team).map(row => renderRow(row.agent, row.depth, row.isLeader, row.team)),
          ])}
          {hierarchy.unassigned.length ? [
            groupRow("unassigned", t("unassignedGroup"), hierarchy.unassigned.length),
            ...hierarchy.unassigned.map(agent => renderRow(agent, 0, false)),
          ] : null}
        </tbody>
      </table>
    </div>
  )

  const toggleManagers = () => setActiveFilter(activeFilter === "managers" ? "all" : "managers")

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

      {loadError ? (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span>{loadError}</span>
        </div>
      ) : null}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 stagger-children">
        <ColorStatCard label={t("statTotal")} value={agents.length} icon={<UserCog className="h-4 w-4" />} hint={t("hintTotal")} />
        <ColorStatCard label={t("statActive")} value={totalActive} icon={<Users className="h-4 w-4" />} hint={t("hintActive")} />
        <ColorStatCard label={t("statOnline")} value={totalOnline} icon={<Wifi className="h-4 w-4" />} hint={t("hintOnline")} />
        {/* The managers tile is a filter: click shows managers and supervisors, click again shows everyone. */}
        <div
          role="button"
          tabIndex={0}
          aria-pressed={activeFilter === "managers"}
          aria-label={t("filterManagersHint")}
          data-testid="mtm-agents-managers-tile"
          onClick={toggleManagers}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleManagers() } }}
          className="cursor-pointer rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <ColorStatCard className={`h-full ${activeFilter === "managers" ? "border-blue-400 ring-1 ring-blue-300 dark:border-blue-700 dark:ring-blue-800" : ""}`} label={t("statManagers")} value={totalManagers} icon={<Users className="h-4 w-4" />} hint={t("hintManagers")} />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {focusAgentId ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-zinc-300 bg-muted px-3 text-sm dark:border-zinc-600" data-testid="mtm-agent-focus-chip">
            {t("focusChip", { name: focusAgent?.name ?? t("focusUnknown") })}
            <button type="button" className="inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/10" onClick={() => setFocusAgent("")} aria-label={t("focusClear")}><X className="h-3.5 w-3.5" /></button>
          </span>
        ) : null}
        <Button variant={activeFilter === "all" ? "default" : "outline"} size="sm" onClick={() => setActiveFilter("all")}>{t("all")} ({agents.length})</Button>
        <Button variant={activeFilter === "online" ? "default" : "outline"} size="sm" onClick={() => setActiveFilter("online")}>{t("filterOnline")} ({totalOnline})</Button>
        <Button variant={activeFilter === "managers" ? "default" : "outline"} size="sm" onClick={() => setActiveFilter("managers")}>{t("filterManagers")} ({totalManagers})</Button>
        {(["ACTIVE", "INACTIVE", "SUSPENDED"] as const).map(s => (
          <Button key={s} variant={activeFilter === s ? "default" : "outline"} size="sm" onClick={() => setActiveFilter(s)}>{t(`filter${s.charAt(0) + s.slice(1).toLowerCase()}` as any)} ({statusCounts[s] || 0})</Button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[12rem]">
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
        <div className="inline-flex rounded-md border border-zinc-200 dark:border-zinc-700" role="group" aria-label={t("viewToggle")} data-testid="mtm-agents-view-toggle">
          <Button variant={view === "cards" ? "default" : "ghost"} size="sm" className="rounded-r-none" aria-pressed={view === "cards"} onClick={() => changeView("cards")}><LayoutGrid className="h-4 w-4 sm:mr-1" aria-hidden="true" /><span className="hidden sm:inline">{t("viewCards")}</span><span className="sr-only sm:hidden">{t("viewCards")}</span></Button>
          <Button variant={view === "list" ? "default" : "ghost"} size="sm" className="rounded-l-none" aria-pressed={view === "list"} onClick={() => changeView("list")}><List className="h-4 w-4 sm:mr-1" aria-hidden="true" /><span className="hidden sm:inline">{t("viewList")}</span><span className="sr-only sm:hidden">{t("viewList")}</span></Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-muted-foreground border border-zinc-200 dark:border-zinc-700 rounded-lg bg-card">{loadError ? loadError : agents.length === 0 ? t("empty") : t("noResults")}</div>
      ) : view === "list" ? renderList() : (
        <div className="flex flex-wrap gap-x-3 gap-y-5">
          {hierarchy.teams.map(teamSlot)}
          {hierarchy.unassigned.length ? (
            <section className="basis-full min-w-0" data-testid="mtm-agents-unassigned">
              {teamHeader(t("unassignedGroup"), hierarchy.unassigned.length)}
              <div className={cardGrid}>{hierarchy.unassigned.map(agent => renderCard(agent))}</div>
            </section>
          ) : null}
        </div>
      )}

      <MtmAgentForm open={formOpen} onOpenChange={setFormOpen} onSaved={fetchAgents} initialData={editData} orgId={orgId ? String(orgId) : undefined} />
      <DeleteConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} onConfirm={confirmDelete} title={t("delete")} itemName={deleteItem?.name} />
    </div>
  )
}
