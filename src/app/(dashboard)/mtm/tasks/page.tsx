"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useSession } from "next-auth/react"
import { useLocale, useTranslations } from "next-intl"
import { toast } from "sonner"
import {
  AlertCircle,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  CalendarOff,
  ClipboardList,
  Filter,
  Plus,
  RefreshCw,
  Search,
  UserRound,
  X,
} from "lucide-react"

import { HelpButton } from "@/components/help/help-button"
import { PageDescription } from "@/components/page-description"
import { mtmTaskDueFormat } from "@/lib/mtm/task-due"
import { MtmTaskForm, type TaskAgentOption, type TaskGroupOption } from "@/components/mtm/task-form"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { invalidateOperationalWeekSnapshotsAfterTaskMutation } from "@/lib/mtm/operational-week-cache"
import { formatInTimezone } from "@/lib/timezone"

type TaskSummary = {
  id: string
  title: string
  description?: string | null
  status: string
  priority: string
  scheduledStartAt?: string | null
  dueDate?: string | null
  /** Days past the due date for an open task; computed by the server. */
  overdueDays?: number | null
  /** Completed, neither accepted nor returned by a manager; computed by the server. */
  awaitingReview?: boolean
  progress?: number | null
  version: number
  agentId: string
  agent?: TaskAgentOption | null
  customer?: { id: string; name: string; locality?: string | null; city?: string | null; address?: string | null } | null
  visit?: { id: string } | null
}

type TeamOption = { id: string; name: string }
type TaskListCapabilities = Record<string, unknown> & { actions?: string[] }

type TaskListData = {
  tasks: TaskSummary[]
  total: number
  page: number
  limit: number
  filters: {
    agents: TaskAgentOption[]
    teams: TeamOption[]
    taskGroups: TaskGroupOption[]
    taskGroupCatalogAvailable: boolean
  }
  timezone: string
  capabilities: TaskListCapabilities
  summary?: Record<string, number>
  /** Undated open tasks, lifted above the paginated list (task-undated-group.ts). */
  undatedOpen?: { tasks: TaskSummary[]; total: number }
}

type LoadPhase = "loading" | "ready" | "permission" | "error"
type TaskSort = "due_desc" | "due_asc" | "priority" | "title"


/**
 * Tasks audit 2026-09-24: the page opened on every task, latest due date
 * first — 41 of the first 50 rows were completed, the first one a test task.
 * It now opens on the open ones, longest overdue first, then the nearest due.
 * «All» is still one choice away and is kept in the address as status=ALL.
 */
const DEFAULT_TASK_STATUS = "OPEN"
const ALL_TASK_STATUSES = "ALL"


const STATUS_VARIANT: Record<string, "outline" | "info" | "success" | "warning" | "destructive"> = {
  PENDING: "outline",
  IN_PROGRESS: "info",
  COMPLETED: "success",
  CANCELLED: "destructive",
  OVERDUE: "warning",
}

const PRIORITY_VARIANT: Record<string, "outline" | "info" | "warning" | "destructive"> = {
  LOW: "outline",
  MEDIUM: "info",
  HIGH: "warning",
  URGENT: "destructive",
}

function capability(capabilities: TaskListCapabilities, ...names: string[]): boolean {
  const actions = Array.isArray(capabilities.actions)
    ? capabilities.actions.map((action) => String(action).toUpperCase())
    : []
  return names.some((name) => capabilities[name] === true || actions.includes(name.toUpperCase()))
}

export function taskReturnPath(pathname: string, params: URLSearchParams): string {
  const query = params.toString()
  return `${pathname}${query ? `?${query}` : ""}`
}

export default function MtmTasksPage() {
  const t = useTranslations("mtmTasksPage")
  const locale = useLocale()
  const { data: session } = useSession()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const orgId = session?.user?.organizationId

  const [data, setData] = useState<TaskListData | null>(null)
  const [phase, setPhase] = useState<LoadPhase>("loading")
  const [error, setError] = useState("")
  const [formOpen, setFormOpen] = useState(false)
  const [searchInput, setSearchInput] = useState(searchParams.get("search") || "")
  const [search, setSearch] = useState(searchParams.get("search") || "")
  const [status, setStatus] = useState(searchParams.get("status") || DEFAULT_TASK_STATUS)
  const [priority, setPriority] = useState(searchParams.get("priority") || "")
  // Tasks audit 2026-09-24: the order follows the chip — open work oldest
  // due first, finished work newest first — instead of a separate dropdown.
  const sort: TaskSort = ["COMPLETED", "CANCELLED", ALL_TASK_STATUSES].includes(status) ? "due_desc" : "due_asc"
  const [agentId, setAgentId] = useState(searchParams.get("agentId") || "")
  const [teamId, setTeamId] = useState(searchParams.get("teamId") || "")
  const [page, setPage] = useState(Math.max(1, Number(searchParams.get("page")) || 1))
  const [selected, setSelected] = useState<string[]>([])
  const [bulkAgentId, setBulkAgentId] = useState("")
  const [bulkSaving, setBulkSaving] = useState(false)
  const [filterOpen, setFilterOpen] = useState(Boolean(searchParams.get("agentId") || searchParams.get("teamId")))
  const [contactId, setContactId] = useState(searchParams.get("contactId") || "")
  const requestRef = useRef<AbortController | null>(null)
  const limit = 50

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(1)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  const load = useCallback(async () => {
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    setPhase("loading")
    setError("")
    const query = new URLSearchParams({ page: String(page), limit: String(limit) })
    if (search) query.set("search", search)
    if (status && status !== ALL_TASK_STATUSES) query.set("status", status)
    if (priority) query.set("priority", priority)
    query.set("sort", sort)
    query.set("undated", "group")
    if (agentId) query.set("agentId", agentId)
    if (teamId) query.set("teamId", teamId)
    if (contactId) query.set("contactId", contactId)
    try {
      const response = await fetch(`/api/v1/mtm/tasks?${query.toString()}`, {
        cache: "no-store",
        signal: controller.signal,
        headers: orgId ? { "x-organization-id": String(orgId) } : undefined,
      })
      const body = await response.json().catch(() => null)
      if (response.status === 401 || response.status === 403) {
        setPhase("permission")
        return
      }
      if (!response.ok || !body?.success) throw new Error(t("loadFailed"))
      const payload = body.data || {}
      setData({
        tasks: Array.isArray(payload.tasks) ? payload.tasks : [],
        total: Number(payload.total) || 0,
        page: Number(payload.page) || page,
        limit: Number(payload.limit) || limit,
        filters: {
          agents: Array.isArray(payload.filters?.agents) ? payload.filters.agents : [],
          teams: Array.isArray(payload.filters?.teams) ? payload.filters.teams : [],
        },
        timezone: payload.timezone || "UTC",
        capabilities: payload.capabilities || {},
        summary: payload.summary && typeof payload.summary === "object" ? payload.summary : undefined,
        undatedOpen: payload.undatedOpen && Array.isArray(payload.undatedOpen.tasks)
          ? { tasks: payload.undatedOpen.tasks, total: Number(payload.undatedOpen.total) || payload.undatedOpen.tasks.length }
          : undefined,
      })
      setSelected([])
      setPhase("ready")
    } catch (loadError) {
      if ((loadError as Error).name === "AbortError") return
      setError(t("loadFailed"))
      setPhase("error")
    }
  }, [agentId, contactId, orgId, page, priority, search, sort, status, t, teamId])

  useEffect(() => {
    load()
    return () => requestRef.current?.abort()
  }, [load])

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString())
    const setOrDelete = (key: string, value: string) => value ? params.set(key, value) : params.delete(key)
    setOrDelete("search", search)
    setOrDelete("status", status)
    setOrDelete("priority", priority)
    params.set("sort", sort)
    setOrDelete("agentId", agentId)
    setOrDelete("teamId", teamId)
    setOrDelete("contactId", contactId)
    params.delete("view")
    setOrDelete("page", page > 1 ? String(page) : "")
    const nextQuery = params.toString()
    const currentQuery = searchParams.toString()
    const next = `${pathname}${nextQuery ? `?${nextQuery}` : ""}`
    const current = `${pathname}${currentQuery ? `?${currentQuery}` : ""}`
    if (next !== current) router.replace(next, { scroll: false })
  }, [agentId, contactId, page, pathname, priority, router, search, searchParams, sort, status, teamId])

  const clearFilters = () => {
    setSearchInput("")
    setSearch("")
    setStatus(DEFAULT_TASK_STATUS)
    setPriority("")
    setAgentId("")
    setTeamId("")
    setContactId("")
    setPage(1)
  }

  const bulkReassign = async () => {
    if (!selected.length || !bulkAgentId || bulkSaving) return
    setBulkSaving(true)
    try {
      const response = await fetch("/api/v1/mtm/tasks/bulk-reassign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {}),
        },
        body: JSON.stringify({
          taskIds: selected,
          agentId: bulkAgentId,
          expectedVersions: Object.fromEntries(
            [...(data?.tasks || []), ...(data?.undatedOpen?.tasks || [])]
              .filter((task) => selected.includes(task.id))
              .map((task) => [task.id, task.version]),
          ),
        }),
      })
      const body = await response.json().catch(() => null)
      if (response.status === 409) {
        toast.error(t("bulkConflict"))
        return
      }
      if (!response.ok || !body?.success) {
        toast.error(t("bulkFailed"))
        return
      }
      toast.success(t("bulkSuccess", { count: body.data?.reassigned ?? selected.length }))
      invalidateOperationalWeekSnapshotsAfterTaskMutation()
      setBulkAgentId("")
      await load()
    } catch {
      toast.error(t("bulkFailed"))
    } finally {
      setBulkSaving(false)
    }
  }

  const taskHref = (taskId: string) => {
    const params = new URLSearchParams()
    if (search) params.set("search", search)
    if (status) params.set("status", status)
    if (priority) params.set("priority", priority)
    params.set("sort", sort)
    if (agentId) params.set("agentId", agentId)
    if (teamId) params.set("teamId", teamId)
    if (contactId) params.set("contactId", contactId)
    if (page > 1) params.set("page", String(page))
    const current = taskReturnPath(pathname, params)
    return `/mtm/tasks/${encodeURIComponent(taskId)}?returnTo=${encodeURIComponent(current)}`
  }

  const formatDateTime = (value?: string | null) => {
    if (!value || Number.isNaN(new Date(value).getTime())) return "—"
    const timezone = data?.timezone || "UTC"
    // C11: a deadline that sits exactly on midnight was not chosen at midnight,
    // it was set as a date. Printing "00:00" makes it look like a time someone
    // picked.
    return formatInTimezone(value, timezone, mtmTaskDueFormat(new Date(value), timezone), locale)
  }

  const pageTasks = data?.tasks || []
  const undatedTasks = data?.undatedOpen?.tasks || []
  const undatedTotal = data?.undatedOpen?.total || 0
  const selectableTasks = pageTasks.filter((task) => !["COMPLETED", "CANCELLED"].includes(task.status))
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1
  const allPageSelected = selectableTasks.length > 0 && selectableTasks.every((task) => selected.includes(task.id))
  // The page's own default is not a filter the reader chose.
  const activeFilters = [search, status === DEFAULT_TASK_STATUS ? "" : status, priority, agentId, teamId, contactId].filter(Boolean).length
  // The badge on «More filters» counts only what is inside that panel.
  const panelFilters = [agentId, teamId].filter(Boolean).length
  const canCreate = capability(data?.capabilities || {}, "canCreate", "CREATE")
  const canCreateRecurring = capability(data?.capabilities || {}, "canCreateRecurring", "CREATE_RECURRING")
  const canBulk = capability(data?.capabilities || {}, "canBulkReassign", "BULK_REASSIGN")

  return (
    <div className="space-y-6 pb-20 lg:pb-6">
      <header className="flex flex-col gap-4 border-b border-zinc-200 pb-5 dark:border-zinc-700 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-2">
          <PageDescription icon={ClipboardList} title={t("title")} />
          <HelpButton slug="mtm-tasks" variant="label" />
        </div>
        <div className="flex flex-wrap gap-2">
          {canCreate ? (
            <Button type="button" className="min-h-11" onClick={() => setFormOpen(true)}>
              <Plus className="h-4 w-4" />{t("add")}
            </Button>
          ) : null}
        </div>
      </header>

      <section className="space-y-4" aria-label={t("filtersTitle")}>
        {contactId ? (
          <div className="flex flex-wrap items-center gap-2" role="status">
            <Badge variant="info" className="min-h-8 gap-2 px-3">
              {t("contactContext", { id: contactId })}
              <button type="button" className="inline-flex min-h-7 min-w-7 items-center justify-center rounded-full hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 dark:hover:bg-white/10" onClick={() => { setContactId(""); setPage(1) }} aria-label={t("clearContactContext")}><X className="h-3.5 w-3.5" /></button>
            </Badge>
            <span className="text-xs text-muted-foreground">{t("contactContextHint")}</span>
          </div>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder={t("searchPlaceholder")} className="min-h-11 pl-9" aria-label={t("searchPlaceholder")} />
          </div>
          <Button type="button" variant="outline" className="min-h-11" onClick={() => setFilterOpen((open) => !open)} aria-expanded={filterOpen}>
            <Filter className="h-4 w-4" />{t("moreFilters")}{panelFilters ? <Badge variant="brand">{panelFilters}</Badge> : null}
          </Button>
        </div>
        {filterOpen ? (
          <div className="grid gap-3 border-y border-zinc-200 py-4 dark:border-zinc-700 sm:grid-cols-[1fr_1fr_auto]">
            <Select value={teamId} onChange={(event) => {
              const nextTeamId = event.target.value
              setTeamId(nextTeamId)
              const selectedAgent = (data?.filters.agents || []).find((agent) => agent.id === agentId)
              if (selectedAgent && nextTeamId && selectedAgent.teamId !== nextTeamId && selectedAgent.team?.id !== nextTeamId) setAgentId("")
              setPage(1)
            }} className="min-h-11" aria-label={t("teamFilter")}>
              <option value="">{t("allTeams")}</option>
              {(data?.filters.teams || []).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </Select>
            <Select value={agentId} onChange={(event) => { setAgentId(event.target.value); setPage(1) }} className="min-h-11" aria-label={t("agentFilter")}>
              <option value="">{t("allAgents")}</option>
              {(data?.filters.agents || []).filter((agent) => !teamId || agent.teamId === teamId || agent.team?.id === teamId).map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </Select>
            <Button type="button" variant="ghost" className="min-h-11" onClick={clearFilters}>{t("clearFilters")}</Button>
          </div>
        ) : null}
      </section>

      {phase === "permission" ? (
        <StatePanel icon={AlertCircle} title={t("permissionTitle")} hint={t("permissionHint")} />
      ) : phase === "error" ? (
        <StatePanel icon={AlertCircle} title={t("errorTitle")} hint={error || t("loadFailed")} action={<Button type="button" className="min-h-11" onClick={load}><RefreshCw className="h-4 w-4" />{t("retry")}</Button>} />
      ) : (
        <>
          {/* Tasks audit 2026-09-24: a status dropdown, a sort dropdown and a
              strip of numbers that could not be pressed become one row of
              chips; the pressed chip is the filter, its number is the list. */}
          <nav className="flex flex-wrap gap-2" aria-label={t("statusFilter")} aria-live="polite" data-testid="mtm-task-status-chips">
            {([
              { value: DEFAULT_TASK_STATUS, label: t("openStatuses"), count: data?.summary?.OPEN ?? 0, tone: "" },
              { value: "OVERDUE", label: t("statuses.OVERDUE"), count: data?.summary?.OVERDUE ?? 0, tone: "text-red-600 dark:text-red-400" },
              { value: "AWAITING_REVIEW", label: t("statuses.AWAITING_REVIEW"), count: data?.summary?.AWAITING_REVIEW ?? 0, tone: "text-amber-700 dark:text-amber-400" },
              { value: "COMPLETED", label: t("statuses.COMPLETED"), count: data?.summary?.COMPLETED ?? 0, tone: "" },
              { value: "CANCELLED", label: t("statuses.CANCELLED"), count: data?.summary?.CANCELLED ?? 0, tone: "" },
            ]).filter((chip) => chip.value !== "CANCELLED" || chip.count > 0 || status === "CANCELLED").map((chip) => {
              const pressed = status === chip.value
              return (
                <button
                  key={chip.value}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => { setStatus(chip.value); setPage(1) }}
                  className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm transition-colors ${pressed ? "border-primary bg-primary/10 font-semibold text-primary" : "border-zinc-200 hover:bg-muted dark:border-zinc-700"}`}
                >
                  <span className={pressed ? "" : chip.tone}>{chip.label}</span>
                  {phase === "loading" || !data ? null : <span className="tabular-nums text-muted-foreground">{chip.count}</span>}
                </button>
              )
            })}
          </nav>

          {canBulk && selected.length ? (
            <section className="sticky top-16 z-20 flex flex-col gap-3 rounded-xl border border-zinc-300 bg-background p-3 shadow-sm dark:border-zinc-600 sm:flex-row sm:items-center" aria-label={t("bulkTitle")}>
              <span className="text-sm font-semibold">{t("selectedCount", { count: selected.length })}</span>
              <Select value={bulkAgentId} onChange={(event) => setBulkAgentId(event.target.value)} className="min-h-11 min-w-56" aria-label={t("bulkAssignee")}>
                <option value="">{t("chooseAssignee")}</option>
                {(data?.filters.agents || []).map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
              </Select>
              <Button type="button" className="min-h-11" disabled={!bulkAgentId || bulkSaving} onClick={bulkReassign}>{bulkSaving ? t("reassigning") : t("reassign")}</Button>
              <Button type="button" variant="ghost" className="min-h-11 sm:ml-auto" onClick={() => setSelected([])}>{t("clearSelection")}</Button>
            </section>
          ) : null}

          {phase === "loading" ? (
            <div className="space-y-3" role="status"><div className="h-14 animate-pulse rounded-lg bg-muted/60 motion-reduce:animate-none" />{Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-20 animate-pulse rounded-lg bg-muted/40 motion-reduce:animate-none" />)}<span className="sr-only">{t("loading")}</span></div>
          ) : !pageTasks.length && !undatedTasks.length ? (
            <StatePanel icon={ClipboardList} title={activeFilters ? t("noResults") : t("empty")} hint={activeFilters ? t("noResultsHint") : t("emptyHint")} action={activeFilters ? <Button type="button" variant="outline" className="min-h-11" onClick={clearFilters}>{t("clearFilters")}</Button> : canCreate ? <Button type="button" className="min-h-11" onClick={() => setFormOpen(true)}><Plus className="h-4 w-4" />{t("add")}</Button> : undefined} />
          ) : (
            <>
              {undatedTasks.length ? (
                <section className="space-y-3" aria-labelledby="mtm-tasks-undated" data-testid="mtm-tasks-undated-group">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 id="mtm-tasks-undated" className="flex items-center gap-2 text-sm font-semibold"><CalendarOff className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{t("undatedTitle")}<Badge variant="warning">{undatedTotal}</Badge></h2>
                    <p className="text-xs text-muted-foreground">{undatedTotal > undatedTasks.length ? t("undatedHintPartial", { shown: undatedTasks.length, count: undatedTotal }) : t("undatedHint")}</p>
                  </div>
                  <TaskList
                    tasks={undatedTasks}
                    selected={selected}
                    canBulk={canBulk}
                    allSelected={false}
                    showSelectAll={false}
                    onToggleAll={() => undefined}
                    onToggle={(id) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])}
                    href={taskHref}
                    formatDateTime={formatDateTime}
                    t={t}
                  />
                </section>
              ) : null}
              {!pageTasks.length ? null : (
            <TaskList
              tasks={pageTasks}
              selected={selected}
              canBulk={canBulk}
              allSelected={allPageSelected}
              // Merge, not replace: ticked tasks in the «Tarixsiz» group above
              // stay selected when the page is (un)selected as a whole.
              onToggleAll={() => {
                const pageIds = selectableTasks.map((task) => task.id)
                setSelected((current) => allPageSelected
                  ? current.filter((id) => !pageIds.includes(id))
                  : [...new Set([...current, ...pageIds])])
              }}
              onToggle={(id) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])}
              href={taskHref}
              formatDateTime={formatDateTime}
              t={t}
            />
          )}
            </>
          )}

          {data && data.total > data.limit ? (
            <nav className="flex items-center justify-between gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-700" aria-label={t("pagination")}>
              <Button type="button" variant="outline" className="min-h-11" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft className="h-4 w-4" />{t("previous")}</Button>
              <span className="text-sm tabular-nums text-muted-foreground">{t("pageOf", { page, total: totalPages })}</span>
              <Button type="button" variant="outline" className="min-h-11" disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>{t("next")}<ChevronRight className="h-4 w-4" /></Button>
            </nav>
          ) : null}
        </>
      )}

      <MtmTaskForm open={formOpen} onOpenChange={setFormOpen} onSaved={load} orgId={orgId ? String(orgId) : undefined} agentOptions={data?.filters.agents || []} taskGroupOptions={data?.filters.taskGroups || []} taskGroupCatalogAvailable={Boolean(data?.filters.taskGroupCatalogAvailable)} timezone={data?.timezone || "UTC"} canCreateRecurring={canCreateRecurring} />
    </div>
  )
}

function StatePanel({ icon: Icon, title, hint, action }: { icon: typeof AlertCircle; title: string; hint: string; action?: ReactNode }) {
  return (
    <section className="flex min-h-60 flex-col items-center justify-center gap-3 border-y border-zinc-200 px-4 py-10 text-center dark:border-zinc-700" role="status">
      <Icon className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <p className="max-w-lg text-sm text-muted-foreground">{hint}</p>
      {action}
    </section>
  )
}

type TaskProjectionProps = {
  tasks: TaskSummary[]
  href: (id: string) => string
  formatDateTime: (value?: string | null) => string
  t: ReturnType<typeof useTranslations<"mtmTasksPage">>
}

function TaskList({ tasks, selected, canBulk, allSelected, showSelectAll = true, onToggleAll, onToggle, href, formatDateTime, t }: TaskProjectionProps & { selected: string[]; canBulk: boolean; allSelected: boolean; showSelectAll?: boolean; onToggleAll: () => void; onToggle: (id: string) => void }) {
  // Tasks audit 2026-09-24: on a computer only the title letters and a bare
  // chevron opened a task — 2 spots out of 7 cells. The whole row opens it now.
  const router = useRouter()
  return (
    <>
      <div className="hidden overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-700 lg:block">
        <table className="w-full text-sm">
          <thead className="bg-muted/35 text-left text-xs text-muted-foreground">
            <tr>
              {canBulk && !showSelectAll ? <th className="w-14 px-1 py-1"><span className="sr-only">{t("selectPage")}</span></th> : null}
              {canBulk && showSelectAll ? <th className="w-14 px-1 py-1"><label className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center"><input type="checkbox" className="h-5 w-5 accent-primary" checked={allSelected} onChange={onToggleAll} aria-label={t("selectPage")} /></label></th> : null}
              <th className="px-4 py-3 font-medium">{t("colTitle")}</th>
              <th className="px-4 py-3 font-medium">{t("colAgent")}</th>
              <th className="px-4 py-3 font-medium">{t("colCustomer")}</th>
              <th className="px-4 py-3 font-medium">{t("colPriority")}</th>
              <th className="px-4 py-3 font-medium">{t("colStatus")}</th>
              <th className="px-4 py-3 font-medium">{t("colDueDate")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
            {tasks.map((task) => (
              <tr key={task.id} className="cursor-pointer transition-colors hover:bg-muted/25" onClick={() => router.push(href(task.id))}>
                {/* A finished task cannot be reassigned: no box at all rather than a grey one. */}
                {canBulk ? <td className="px-1 py-1" onClick={(event) => event.stopPropagation()}>{["COMPLETED", "CANCELLED"].includes(task.status) ? null : <label className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center"><input type="checkbox" className="h-5 w-5 accent-primary" checked={selected.includes(task.id)} onChange={() => onToggle(task.id)} aria-label={t("selectTask", { title: task.title })} /></label>}</td> : null}
                <td className="max-w-sm px-4 py-3"><Link href={href(task.id)} onClick={(event) => event.stopPropagation()} className="font-semibold hover:text-primary hover:underline">{task.title}</Link>{task.description ? <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{task.description}</p> : null}</td>
                <td className="px-4 py-3"><span className="flex items-center gap-2"><UserRound className="h-4 w-4 text-muted-foreground" />{task.agent?.name || t("unassigned")}</span></td>
                <td className="px-4 py-3">{task.customer?.name || "—"}</td>
                <td className="px-4 py-3"><Badge variant={PRIORITY_VARIANT[task.priority] || "outline"}>{t(`priorities.${task.priority}` as never)}</Badge></td>
                <td className="px-4 py-3">{task.awaitingReview ? <Badge variant="warning">{t("statuses.AWAITING_REVIEW")}</Badge> : <Badge variant={STATUS_VARIANT[task.status] || "outline"}>{t(`statuses.${task.status}` as never)}</Badge>}</td>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDateTime(task.dueDate)}{task.overdueDays ? <span className="block text-xs font-medium text-red-600 dark:text-red-400">{t("overdueBy", { count: task.overdueDays })}</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-700 dark:border-zinc-700 lg:hidden">
        {tasks.map((task) => (
          <article key={task.id} className="py-5">
            <div className="flex items-start gap-3">
              {canBulk ? (["COMPLETED", "CANCELLED"].includes(task.status) ? <span className="min-w-11 shrink-0" aria-hidden="true" /> : <label className="inline-flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center"><input type="checkbox" className="h-5 w-5 accent-primary" checked={selected.includes(task.id)} onChange={() => onToggle(task.id)} aria-label={t("selectTask", { title: task.title })} /></label>) : null}
              <Link href={href(task.id)} className="min-w-0 flex-1 space-y-3">
                <div className="flex flex-wrap gap-2">{task.awaitingReview ? <Badge variant="warning">{t("statuses.AWAITING_REVIEW")}</Badge> : <Badge variant={STATUS_VARIANT[task.status] || "outline"}>{t(`statuses.${task.status}` as never)}</Badge>}<Badge variant={PRIORITY_VARIANT[task.priority] || "outline"}>{t(`priorities.${task.priority}` as never)}</Badge></div>
                <div><h2 className="text-base font-semibold leading-6">{task.title}</h2>{task.description ? <p className="mt-1 line-clamp-2 text-sm leading-5 text-muted-foreground">{task.description}</p> : null}</div>
                <dl className="grid gap-2 text-sm sm:grid-cols-2">
                  <div className="flex items-center gap-2"><UserRound className="h-4 w-4 text-muted-foreground" /><span>{task.agent?.name || t("unassigned")}</span></div>
                  <div className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-muted-foreground" /><span>{formatDateTime(task.dueDate)}</span>{task.overdueDays ? <span className="text-xs font-medium text-red-600 dark:text-red-400">{t("overdueBy", { count: task.overdueDays })}</span> : null}</div>
                </dl>
              </Link>
              <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            </div>
          </article>
        ))}
      </div>
    </>
  )
}

