"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
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
  ClipboardList,
  Filter,
  LayoutGrid,
  List,
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
}

type LoadPhase = "loading" | "ready" | "permission" | "error"
type ViewMode = "list" | "kanban"
type TaskSort = "due_desc" | "due_asc" | "priority" | "title"

const STATUSES = ["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED", "OVERDUE"] as const
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const
const TASK_SORTS: TaskSort[] = ["due_desc", "due_asc", "priority", "title"]

function taskSortFromUrl(value: string | null): TaskSort {
  return TASK_SORTS.includes(value as TaskSort) ? value as TaskSort : "due_desc"
}

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
  const [viewMode, setViewMode] = useState<ViewMode>(searchParams.get("view") === "kanban" ? "kanban" : "list")
  const [searchInput, setSearchInput] = useState(searchParams.get("search") || "")
  const [search, setSearch] = useState(searchParams.get("search") || "")
  const [status, setStatus] = useState(searchParams.get("status") || "")
  const [priority, setPriority] = useState(searchParams.get("priority") || "")
  const [sort, setSort] = useState<TaskSort>(taskSortFromUrl(searchParams.get("sort")))
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
    if (status) query.set("status", status)
    if (priority) query.set("priority", priority)
    query.set("sort", sort)
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
    setOrDelete("view", viewMode === "kanban" ? "kanban" : "")
    setOrDelete("page", page > 1 ? String(page) : "")
    const nextQuery = params.toString()
    const currentQuery = searchParams.toString()
    const next = `${pathname}${nextQuery ? `?${nextQuery}` : ""}`
    const current = `${pathname}${currentQuery ? `?${currentQuery}` : ""}`
    if (next !== current) router.replace(next, { scroll: false })
  }, [agentId, contactId, page, pathname, priority, router, search, searchParams, sort, status, teamId, viewMode])

  const clearFilters = () => {
    setSearchInput("")
    setSearch("")
    setStatus("")
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
            (data?.tasks || [])
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
    if (viewMode === "kanban") params.set("view", "kanban")
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
  const selectableTasks = pageTasks.filter((task) => !["COMPLETED", "CANCELLED"].includes(task.status))
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1
  const pageCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const task of pageTasks) counts[task.status] = (counts[task.status] || 0) + 1
    return counts
  }, [pageTasks])
  const allPageSelected = selectableTasks.length > 0 && selectableTasks.every((task) => selected.includes(task.id))
  const activeFilters = [search, status, priority, agentId, teamId, contactId].filter(Boolean).length
  const canCreate = capability(data?.capabilities || {}, "canCreate", "CREATE")
  const canCreateRecurring = capability(data?.capabilities || {}, "canCreateRecurring", "CREATE_RECURRING")
  const canBulk = capability(data?.capabilities || {}, "canBulkReassign", "BULK_REASSIGN")

  return (
    <div className="space-y-6 pb-20 lg:pb-6">
      <header className="flex flex-col gap-4 border-b border-zinc-200 pb-5 dark:border-zinc-700 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-2">
          <PageDescription icon={ClipboardList} title={t("title")} description={t("subtitle")} />
          <HelpButton slug="mtm-tasks" variant="label" />
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex rounded-full border border-zinc-200 p-1 dark:border-zinc-700" role="group" aria-label={t("viewMode")}>
            <Button type="button" variant={viewMode === "list" ? "default" : "ghost"} size="icon" className="min-h-11 min-w-11" onClick={() => setViewMode("list")} aria-label={t("listView")} aria-pressed={viewMode === "list"}>
              <List className="h-4 w-4" />
            </Button>
            <Button type="button" variant={viewMode === "kanban" ? "default" : "ghost"} size="icon" className="min-h-11 min-w-11" onClick={() => setViewMode("kanban")} aria-label={t("kanbanView")} aria-pressed={viewMode === "kanban"}>
              <LayoutGrid className="h-4 w-4" />
            </Button>
          </div>
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
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(16rem,1fr)_11rem_13rem_auto]">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder={t("searchPlaceholder")} className="min-h-11 pl-9" aria-label={t("searchPlaceholder")} />
          </div>
          <Select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }} className="min-h-11 sm:w-44" aria-label={t("statusFilter")}>
            <option value="">{t("allStatuses")}</option>
            {STATUSES.map((value) => <option key={value} value={value}>{t(`statuses.${value}`)}</option>)}
          </Select>
          <Select value={sort} onChange={(event) => { setSort(taskSortFromUrl(event.target.value)); setPage(1) }} className="min-h-11" aria-label={t("sortLabel")}>
            <option value="due_desc">{t("sortDueDateDesc")}</option>
            <option value="due_asc">{t("sortDueDateAsc")}</option>
            <option value="priority">{t("sortPriority")}</option>
            <option value="title">{t("sortTitle")}</option>
          </Select>
          <Button type="button" variant="outline" className="min-h-11" onClick={() => setFilterOpen((open) => !open)} aria-expanded={filterOpen}>
            <Filter className="h-4 w-4" />{t("moreFilters")}{activeFilters ? <Badge variant="brand">{activeFilters}</Badge> : null}
          </Button>
        </div>
        {filterOpen ? (
          <div className="grid gap-3 border-y border-zinc-200 py-4 dark:border-zinc-700 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto]">
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
            <Select value={priority} onChange={(event) => { setPriority(event.target.value); setPage(1) }} className="min-h-11" aria-label={t("priorityFilter")}>
              <option value="">{t("allPriorities")}</option>
              {PRIORITIES.map((value) => <option key={value} value={value}>{t(`priorities.${value}`)}</option>)}
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
          <section className="flex flex-col gap-3 border-y border-zinc-200 py-3 dark:border-zinc-700 sm:flex-row sm:items-center sm:justify-between" aria-live="polite">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
              <span className="font-semibold tabular-nums">{phase === "loading" ? t("loading") : t("totalCount", { count: data?.total || 0 })}</span>
              {STATUSES.slice(0, 3).map((value) => (
                <span key={value} className="text-muted-foreground">{t(`statuses.${value}`)}: <span className="font-medium tabular-nums text-foreground">{data?.summary?.[value] ?? pageCounts[value] ?? 0}</span></span>
              ))}
              {!data?.summary ? <span className="text-xs text-muted-foreground">{t("countsOnPage")}</span> : null}
            </div>
            <span className="text-xs text-muted-foreground">{data ? t("timezoneLabel", { timezone: data.timezone }) : null}</span>
          </section>

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
          ) : !pageTasks.length ? (
            <StatePanel icon={ClipboardList} title={activeFilters ? t("noResults") : t("empty")} hint={activeFilters ? t("noResultsHint") : t("emptyHint")} action={activeFilters ? <Button type="button" variant="outline" className="min-h-11" onClick={clearFilters}>{t("clearFilters")}</Button> : canCreate ? <Button type="button" className="min-h-11" onClick={() => setFormOpen(true)}><Plus className="h-4 w-4" />{t("add")}</Button> : undefined} />
          ) : viewMode === "list" ? (
            <TaskList
              tasks={pageTasks}
              selected={selected}
              canBulk={canBulk}
              allSelected={allPageSelected}
              onToggleAll={() => setSelected(allPageSelected ? [] : selectableTasks.map((task) => task.id))}
              onToggle={(id) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])}
              href={taskHref}
              formatDateTime={formatDateTime}
              t={t}
            />
          ) : (
            <TaskKanban tasks={pageTasks} href={taskHref} formatDateTime={formatDateTime} t={t} />
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

function TaskList({ tasks, selected, canBulk, allSelected, onToggleAll, onToggle, href, formatDateTime, t }: TaskProjectionProps & { selected: string[]; canBulk: boolean; allSelected: boolean; onToggleAll: () => void; onToggle: (id: string) => void }) {
  return (
    <>
      <div className="hidden overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-700 lg:block">
        <table className="w-full min-w-[58rem] text-sm">
          <thead className="bg-muted/35 text-left text-xs text-muted-foreground">
            <tr>
              {canBulk ? <th className="w-14 px-1 py-1"><label className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center"><input type="checkbox" className="h-5 w-5 accent-primary" checked={allSelected} onChange={onToggleAll} aria-label={t("selectPage")} /></label></th> : null}
              <th className="px-4 py-3 font-medium">{t("colTitle")}</th>
              <th className="px-4 py-3 font-medium">{t("colAgent")}</th>
              <th className="px-4 py-3 font-medium">{t("colCustomer")}</th>
              <th className="px-4 py-3 font-medium">{t("colPriority")}</th>
              <th className="px-4 py-3 font-medium">{t("colStatus")}</th>
              <th className="px-4 py-3 font-medium">{t("colDueDate")}</th>
              <th className="w-14"><span className="sr-only">{t("openTask")}</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
            {tasks.map((task) => (
              <tr key={task.id} className="transition-colors hover:bg-muted/25">
                {canBulk ? <td className="px-1 py-1"><label className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center"><input type="checkbox" className="h-5 w-5 accent-primary" checked={selected.includes(task.id)} onChange={() => onToggle(task.id)} disabled={["COMPLETED", "CANCELLED"].includes(task.status)} aria-label={["COMPLETED", "CANCELLED"].includes(task.status) ? t("taskNotReassignable", { title: task.title }) : t("selectTask", { title: task.title })} /></label></td> : null}
                <td className="max-w-sm px-4 py-3"><Link href={href(task.id)} className="font-semibold hover:text-primary hover:underline">{task.title}</Link>{task.description ? <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{task.description}</p> : null}</td>
                <td className="px-4 py-3"><span className="flex items-center gap-2"><UserRound className="h-4 w-4 text-muted-foreground" />{task.agent?.name || t("unassigned")}</span></td>
                <td className="px-4 py-3">{task.customer?.name || "—"}</td>
                <td className="px-4 py-3"><Badge variant={PRIORITY_VARIANT[task.priority] || "outline"}>{t(`priorities.${task.priority}` as never)}</Badge></td>
                <td className="px-4 py-3"><Badge variant={STATUS_VARIANT[task.status] || "outline"}>{t(`statuses.${task.status}` as never)}</Badge></td>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDateTime(task.dueDate)}</td>
                <td className="px-2 py-3"><Button asChild variant="ghost" size="icon" className="min-h-11 min-w-11" aria-label={t("openTaskNamed", { title: task.title })}><Link href={href(task.id)}><ChevronRight className="h-4 w-4" /></Link></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-700 dark:border-zinc-700 lg:hidden">
        {tasks.map((task) => (
          <article key={task.id} className="py-5">
            <div className="flex items-start gap-3">
              {canBulk ? <label className="inline-flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center"><input type="checkbox" className="h-5 w-5 accent-primary" checked={selected.includes(task.id)} onChange={() => onToggle(task.id)} disabled={["COMPLETED", "CANCELLED"].includes(task.status)} aria-label={["COMPLETED", "CANCELLED"].includes(task.status) ? t("taskNotReassignable", { title: task.title }) : t("selectTask", { title: task.title })} /></label> : null}
              <Link href={href(task.id)} className="min-w-0 flex-1 space-y-3">
                <div className="flex flex-wrap gap-2"><Badge variant={STATUS_VARIANT[task.status] || "outline"}>{t(`statuses.${task.status}` as never)}</Badge><Badge variant={PRIORITY_VARIANT[task.priority] || "outline"}>{t(`priorities.${task.priority}` as never)}</Badge></div>
                <div><h2 className="text-base font-semibold leading-6">{task.title}</h2>{task.description ? <p className="mt-1 line-clamp-2 text-sm leading-5 text-muted-foreground">{task.description}</p> : null}</div>
                <dl className="grid gap-2 text-sm sm:grid-cols-2">
                  <div className="flex items-center gap-2"><UserRound className="h-4 w-4 text-muted-foreground" /><span>{task.agent?.name || t("unassigned")}</span></div>
                  <div className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-muted-foreground" /><span>{formatDateTime(task.dueDate)}</span></div>
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

function TaskKanban({ tasks, href, formatDateTime, t }: TaskProjectionProps) {
  const columns = ["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const
  return (
    <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-4">
      {columns.map((status) => {
        const items = tasks.filter((task) => task.status === status || (status === "PENDING" && task.status === "OVERDUE"))
        return (
          <section key={status} className="min-w-0 space-y-3" aria-labelledby={`task-column-${status}`}>
            <div className="flex items-center justify-between border-b border-zinc-200 pb-2 dark:border-zinc-700"><h2 id={`task-column-${status}`} className="text-sm font-semibold">{t(`statuses.${status}`)}</h2><Badge variant="outline">{items.length}</Badge></div>
            {items.length ? <div className="space-y-3">{items.map((task) => (
              <Link key={task.id} href={href(task.id)} className="block rounded-xl border border-zinc-200 p-4 transition-colors hover:border-primary/40 hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 dark:border-zinc-700">
                <div className="flex items-start justify-between gap-3"><h3 className="min-w-0 text-sm font-semibold leading-5">{task.title}</h3><div className="flex shrink-0 flex-wrap justify-end gap-1"><Badge variant={PRIORITY_VARIANT[task.priority] || "outline"}>{t(`priorities.${task.priority}` as never)}</Badge>{task.status !== status ? <Badge variant={STATUS_VARIANT[task.status] || "outline"}>{t(`statuses.${task.status}` as never)}</Badge> : null}</div></div>
                {task.description ? <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{task.description}</p> : null}
                <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground"><span className="flex items-center gap-1"><UserRound className="h-3.5 w-3.5" />{task.agent?.name || t("unassigned")}</span><span className="flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" />{formatDateTime(task.dueDate)}</span></div>
              </Link>
            ))}</div> : <p className="flex min-h-24 items-center justify-center rounded-xl border border-dashed border-zinc-300 px-4 text-sm text-muted-foreground dark:border-zinc-600">{t("columnEmpty")}</p>}
          </section>
        )
      })}
    </div>
  )
}
