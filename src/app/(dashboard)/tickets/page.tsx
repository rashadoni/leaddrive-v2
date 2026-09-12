"use client"

import { useCallback, useEffect, useState, type DragEvent, type ReactNode } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { toast } from "sonner"
import { useEnumLabel } from "@/lib/status-labels"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { DataTable } from "@/components/data-table"
import { TicketForm } from "@/components/ticket-form"
import { Plus, AlertTriangle, Pencil, Trash2, UserX, ShieldAlert, ChevronDown, ChevronUp, List, Columns3, ChartNoAxesCombined, ArrowUpRight, RotateCw, CircleDot, Search, Loader2, X, UserCheck } from "lucide-react"
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
import { cn } from "@/lib/utils"
import { MotionList, MotionItem } from "@/components/ui/motion"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"
import { SupportPageShell } from "@/components/support/support-page-shell"
import { TicketingReport } from "@/components/tickets/ticketing-report"
import { safeTicketReturnTo, ticketDetailHref, ticketScrollStorageKey } from "@/lib/ticketing/workspace-state"
import { checkPermission, type Role } from "@/lib/permissions"
import { hasModule } from "@/lib/modules"

interface TicketData extends Record<string, unknown> {
  id: string
  ticketNumber: string
  subject: string
  priority: string
  status: string
  categoryName?: string | null
  categorySlug?: string | null
  requesterName?: string | null
  requesterEmail?: string | null
  requesterPhone?: string | null
  company: string
  companyName?: string | null
  assignedTo: string
  assigneeName?: string | null
  createdAt: string
  slaDueAt: string
  slaFirstResponseDueAt: string
  slaPolicyName: string
  firstResponseAt: string
  escalationLevel: number
}

type ViewMode = "list" | "kanban" | "reports"
type FocusFilter = "all" | "sla"
type OwnershipFilter = "all" | "unassigned" | "mine"
type TicketColumn = {
  key: string
  label: string
  hint?: string
  sortable?: boolean
  render?: (item: TicketData) => ReactNode
  className?: string
}

const priorityColors: Record<string, string> = {
  urgent: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  critical: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  low: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
}
const priorityDot: Record<string, string> = {
  urgent: "bg-red-600", critical: "bg-red-500", high: "bg-orange-500", medium: "bg-yellow-500", low: "bg-green-500",
}
// Semantic status pills (was a flat outline badge) — color + a leading dot per lifecycle stage.
const statusColors: Record<string, string> = {
  new: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  open: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300",
  in_progress: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  waiting: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  resolved: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  closed: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400",
}
const statusDot: Record<string, string> = {
  new: "bg-blue-500", open: "bg-sky-500", in_progress: "bg-amber-500", waiting: "bg-zinc-400", resolved: "bg-green-500", closed: "bg-zinc-400",
}
const kanbanStatuses = ["new", "open", "in_progress", "waiting", "resolved", "closed"] as const
type KanbanStatus = (typeof kanbanStatuses)[number]
const KANBAN_COLLAPSE_LIMIT = 8
const escalationLevelColors: Record<number, string> = {
  1: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  2: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  3: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  4: "bg-red-200 text-red-900 dark:bg-red-900/50 dark:text-red-300",
  5: "bg-red-300 text-red-950 dark:bg-red-900/70 dark:text-red-200",
}
function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase()
}

function getSlaStatus(slaDueAt: string | null, status: string): "breached" | "warning" | "ok" | "none" | "done" {
  if (!slaDueAt) return "none"
  if (["resolved", "closed"].includes(status)) return "done"
  const now = Date.now()
  const due = new Date(slaDueAt).getTime()
  if (due < now) return "breached"
  if (due - now < 2 * 3600000) return "warning"
  return "ok"
}

function formatTimeLeft(slaDueAt: string, hrAbbr = "h", minAbbr = "m"): string {
  const diff = new Date(slaDueAt).getTime() - Date.now()
  if (diff <= 0) return "—"
  const h = Math.floor(diff / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  return h > 0 ? `${h}${hrAbbr} ${m}${minAbbr}` : `${m}${minAbbr}`
}

function isSlaBreached(slaDueAt: string | null): boolean {
  if (!slaDueAt) return false
  return new Date(slaDueAt) < new Date()
}

function parseViewMode(value: string | null): ViewMode {
  if (value === "kanban" || value === "reports") return value
  return "list"
}

export default function TicketsPage() {
  const t = useTranslations("tickets")
  const tc = useTranslations("common")
  const locale = useLocale()
  const priorityLabel = useEnumLabel("common", "priority", Object.keys(priorityColors))
  const router = useRouter()
  const { data: session } = useSession()
  const [tickets, setTickets] = useState<TicketData[]>([])
  // Highlight tickets that ARRIVE while the agent is away/watching, until they OPEN the ticket.
  // Persisted in localStorage so the orange accent survives polls, reloads and tab-switches and
  // only clears on open — see the `known`/`new` localStorage sets wired below.
  const [newIds, setNewIds] = useState<Set<string>>(new Set())
  useAutoTour("tickets")
  const [view, setView] = useState<ViewMode>("list")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [focusFilter, setFocusFilter] = useState<FocusFilter>("all")
  const [priorityFilter, setPriorityFilter] = useState("all")
  const [ownershipFilter, setOwnershipFilter] = useState<OwnershipFilter>("all")
  const [searchQuery, setSearchQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editData, setEditData] = useState<TicketData | undefined>()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteItem, setDeleteItem] = useState<TicketData | null>(null)
  const [escalatedFilter, setEscalatedFilter] = useState(false)
  const [expandedKanbanColumns, setExpandedKanbanColumns] = useState<Record<string, boolean>>({})
  const [draggedTicketId, setDraggedTicketId] = useState<string | null>(null)
  const [dragOverStatus, setDragOverStatus] = useState<string | null>(null)
  const [movingTicketId, setMovingTicketId] = useState<string | null>(null)
  const [takingNext, setTakingNext] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null)
  const orgId = session?.user?.organizationId
  const currentUserId = session?.user?.id
  const canTakeNext = Boolean(session?.user?.role && checkPermission(session.user.role as Role, "tickets", "write"))
  const capabilityUser = session?.user as { role?: string; plan?: string; addons?: string[]; modules?: Record<string, boolean> } | undefined
  const canViewReports = Boolean(capabilityUser?.role
    && checkPermission(capabilityUser.role as Role, "reports", "read")
    && hasModule({ plan: capabilityUser.plan || "", addons: capabilityUser.addons, modules: capabilityUser.modules }, "analytics"))
  const workspaceViews = [
    { key: "list" as const, label: t("list"), icon: List },
    { key: "kanban" as const, label: t("kanban"), icon: Columns3 },
    ...(canViewReports ? [{ key: "reports" as const, label: t("reports"), icon: ChartNoAxesCombined }] : []),
  ]

  const updateWorkspaceParams = useCallback((updates: Record<string, string | null>) => {
    const params = new URLSearchParams(window.location.search)
    Object.entries(updates).forEach(([key, value]) => {
      if (!value || value === "all" || (key === "view" && value === "list")) params.delete(key)
      else params.set(key, value)
    })
    const query = params.toString()
    router.replace(query ? `/tickets?${query}` : "/tickets", { scroll: false })
  }, [router])

  useEffect(() => {
    const syncWorkspaceFromUrl = () => {
      const params = new URLSearchParams(window.location.search)
      setView(parseViewMode(params.get("view")))
      setStatusFilter(params.get("status") || "all")
      setPriorityFilter(params.get("priority") || "all")
      const owner = params.get("owner")
      setOwnershipFilter(owner === "mine" || owner === "unassigned" ? owner : "all")
      setFocusFilter(params.get("focus") === "sla" ? "sla" : "all")
      setEscalatedFilter(params.get("escalated") === "1")
      setSearchQuery(params.get("q") || "")
    }

    syncWorkspaceFromUrl()
    window.addEventListener("popstate", syncWorkspaceFromUrl)

    return () => window.removeEventListener("popstate", syncWorkspaceFromUrl)
  }, [])

  useEffect(() => {
    if (!capabilityUser || view !== "reports" || canViewReports) return
    setView("list")
    updateWorkspaceParams({ view: "list" })
    toast.error(t("reportsUnavailable"))
  }, [canViewReports, capabilityUser, t, updateWorkspaceParams, view])

  useEffect(() => {
    const timeout = window.setTimeout(() => updateWorkspaceParams({ q: searchQuery.trim() || null }), 250)
    return () => window.clearTimeout(timeout)
  }, [searchQuery, updateWorkspaceParams])

  function selectView(nextView: ViewMode) {
    setView(nextView)
    updateWorkspaceParams({ view: nextView })
  }

  // localStorage-backed highlight: `known` = every ticket id this browser has already seen for this
  // org (so the existing backlog never blinks), `new` = arrived-but-not-yet-opened ids — the orange
  // accent persists across polls / reloads / tab-switches and only clears when the agent opens it.
  const knownKey = orgId ? `tickets:known:${orgId}` : ""
  const newKey = orgId ? `tickets:new:${orgId}` : ""
  const persistNew = useCallback((s: Set<string>) => { try { if (newKey) localStorage.setItem(newKey, JSON.stringify([...s])) } catch {} }, [newKey])
  // Restore the unopened-new set once orgId is known (survives reload / tab re-open).
  useEffect(() => {
    if (!newKey) return
    try { const raw = localStorage.getItem(newKey); if (raw) setNewIds(new Set(JSON.parse(raw) as string[])) } catch {}
  }, [newKey])

  const statusLabels: Record<string, string> = {
    new: t("statusNew"),
    open: t("statusOpen"),
    in_progress: t("statusInProgress"),
    waiting: t("statusWaiting"),
    resolved: t("statusResolved"),
    closed: t("statusClosed"),
  }

  const fetchTickets = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/tickets?limit=200", {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      if (!res.ok) {
        setPermissionDenied(res.status === 403)
        throw new Error(`ticket_request_failed:${res.status}`)
      }
      const json = await res.json()
      if (json.success) {
        setLoadError(false)
        setPermissionDenied(false)
        setLastUpdatedAt(new Date())
        const list: TicketData[] = json.data.tickets
        setTickets(list)
        // Flag genuinely-new arrivals (present now, never seen on this browser) so the row blinks and
        // stays highlighted until opened. Gated on knownKey so the pre-auth fetch (orgId not yet
        // resolved) never seeds — otherwise the first real fetch would flag the whole backlog.
        if (knownKey) {
          const ids = list.map((tk) => tk.id)
          try {
            const raw = localStorage.getItem(knownKey)
            if (raw === null) {
              localStorage.setItem(knownKey, JSON.stringify(ids)) // first ever load → seed, don't flag
            } else {
              const known = new Set<string>(JSON.parse(raw) as string[])
              const fresh = ids.filter((id) => !known.has(id))
              localStorage.setItem(knownKey, JSON.stringify(ids))
              if (fresh.length > 0) {
                setNewIds((prev) => { const next = new Set([...prev, ...fresh]); persistNew(next); return next })
              }
            }
          } catch { /* localStorage unavailable → just skip the highlight */ }
        }
      } else throw new Error("ticket_request_failed")
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [knownKey, orgId, persistNew])

  useEffect(() => {
    fetchTickets()
  }, [fetchTickets])

  useEffect(() => {
    if (loading) return
    const returnTo = safeTicketReturnTo(`${window.location.pathname}${window.location.search}`)
    const key = ticketScrollStorageKey(returnTo)
    const stored = sessionStorage.getItem(key)
    if (!stored) return
    sessionStorage.removeItem(key)
    const top = Number(stored)
    if (!Number.isFinite(top) || top < 0) return
    requestAnimationFrame(() => {
      const scroller = document.querySelector("main")
      const restore = () => {
        if (scroller) scroller.scrollTo({ top, behavior: "instant" })
        else window.scrollTo({ top, behavior: "instant" })
      }
      restore()
      requestAnimationFrame(restore)
      window.setTimeout(restore, 120)
    })
  }, [loading])

  // Poll for new tickets every 20 seconds
  useEffect(() => {
    const interval = setInterval(fetchTickets, 20000)
    return () => clearInterval(interval)
  }, [fetchTickets])

  function handleEdit(item: TicketData) {
    setEditData(item)
    setFormOpen(true)
  }

  function handleAdd() {
    setEditData(undefined)
    setFormOpen(true)
  }

  // Opening a ticket clears its highlight (the agent has now seen it) — persisted so it stays cleared.
  function openTicket(id: string) {
    setNewIds((prev) => { const next = new Set(prev); next.delete(id); persistNew(next); return next })
    const returnTo = safeTicketReturnTo(`${window.location.pathname}${window.location.search}`)
    const scroller = document.querySelector("main")
    sessionStorage.setItem(ticketScrollStorageKey(returnTo), String(scroller?.scrollTop ?? window.scrollY))
    router.push(ticketDetailHref(id, returnTo))
  }

  async function takeNextTicket() {
    if (takingNext) return
    setTakingNext(true)
    try {
      const res = await fetch("/api/v1/tickets/take-next", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
      const json = await res.json().catch(() => null)
      if (res.ok && json?.data?.id) {
        toast.success(t("takeNextSuccess", { number: json.data.ticketNumber }))
        openTicket(json.data.id)
        return
      }
      if (res.status === 404) {
        toast.info(t("takeNextEmpty"))
        await fetchTickets()
        return
      }
      if (res.status === 409) {
        toast.info(t("takeNextConflict"))
        await fetchTickets()
        return
      }
      throw new Error(t("takeNextError"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("takeNextError"))
    } finally {
      setTakingNext(false)
    }
  }

  function handleDelete(item: TicketData) {
    setDeleteItem(item)
    setDeleteOpen(true)
  }

  async function confirmDelete() {
    if (!deleteItem) return
    const res = await fetch(`/api/v1/tickets/${deleteItem.id}`, {
      method: "DELETE",
      headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
    })
    if (!res.ok) throw new Error(tc("errorDeleteFailed"))
    fetchTickets()
  }

  async function moveTicketToStatus(ticket: TicketData, status: KanbanStatus) {
    if (ticket.status === status || movingTicketId === ticket.id) return

    const previousStatus = ticket.status
    setMovingTicketId(ticket.id)
    setTickets(prev => prev.map(item => item.id === ticket.id ? { ...item, status } : item))

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" }
      if (orgId) headers["x-organization-id"] = String(orgId)
      const res = await fetch(`/api/v1/tickets/${ticket.id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ status }),
      })
      if (!res.ok) {
        throw new Error(tc("errorUpdateFailed"))
      }
      toast.success(t("moveSuccess", { number: ticket.ticketNumber, status: statusLabels[status] }))
    } catch (err) {
      setTickets(prev => prev.map(item => item.id === ticket.id ? { ...item, status: previousStatus } : item))
      toast.error(err instanceof Error ? err.message : tc("errorUpdateFailed"))
    } finally {
      setMovingTicketId(null)
    }
  }

  function handleKanbanDragStart(event: DragEvent<HTMLElement>, ticket: TicketData) {
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData("text/plain", ticket.id)
    setDraggedTicketId(ticket.id)
  }

  function handleKanbanDrop(event: DragEvent<HTMLDivElement>, status: KanbanStatus) {
    event.preventDefault()
    const ticketId = event.dataTransfer.getData("text/plain") || draggedTicketId
    const ticket = tickets.find(item => item.id === ticketId)
    setDraggedTicketId(null)
    setDragOverStatus(null)
    if (ticket) moveTicketToStatus(ticket, status)
  }

  const columns: TicketColumn[] = [
    {
      key: "ticketNumber", label: t("colNumber"), hint: t("hintColNumber"), sortable: true,
      render: (item: TicketData) => <span className="font-mono text-xs text-muted-foreground whitespace-nowrap">{item.ticketNumber}</span>,
    },
    {
      key: "subject", label: t("colSubject"), hint: t("hintColSubject"), sortable: true,
      render: (item: TicketData) => <span className="block max-w-[280px] truncate font-medium" title={item.subject}>{item.subject}</span>,
    },
    {
      key: "categoryName", label: t("colCategory"), hint: t("hintColCategory"), sortable: true,
      render: (item: TicketData) => (
        <Badge variant="outline" className="max-w-[150px] truncate font-normal" title={item.categoryName || item.categorySlug || undefined}>
          {item.categoryName || item.categorySlug || "—"}
        </Badge>
      ),
    },
    {
      key: "requesterName", label: t("colRequester"), hint: t("hintColRequester"), sortable: true,
      render: (item: TicketData) => {
        const detail = item.requesterEmail || item.requesterPhone || ""
        return (
          <div className="max-w-[160px] truncate" title={detail || item.requesterName || undefined}>
            <span className="block truncate">{item.requesterName || "—"}</span>
            {detail && <span className="block truncate text-xs text-muted-foreground">{detail}</span>}
          </div>
        )
      },
    },
    {
      key: "priority", label: t("colPriority"), hint: t("hintColPriority"), sortable: true,
      render: (item: TicketData) => (
        <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap", priorityColors[item.priority])}>
          <span className={cn("h-1.5 w-1.5 rounded-full", priorityDot[item.priority] || "bg-zinc-400")} />
          {priorityLabel(item.priority)}
        </span>
      ),
    },
    { key: "companyName", label: t("colCompany"), hint: t("hintColCompany"), sortable: true, render: (item: TicketData) => <span className="block max-w-[140px] truncate text-muted-foreground" title={item.companyName || undefined}>{item.companyName || "—"}</span> },
    {
      key: "status", label: t("colStatus"), hint: t("hintColStatus"), sortable: true,
      render: (item: TicketData) => (
        <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap", statusColors[item.status] || statusColors.open)}>
          <span className={cn("h-1.5 w-1.5 rounded-full", statusDot[item.status] || "bg-zinc-400")} />
          {statusLabels[item.status]}
        </span>
      ),
    },
    {
      key: "slaDueAt", label: t("colSla"), hint: t("hintColSla"), sortable: true,
      render: (item: TicketData) => {
        if (!item.slaDueAt) return <span className="text-xs text-muted-foreground">—</span>
        const slaStatus = getSlaStatus(item.slaDueAt, item.status)
        const colorMap = {
          breached: "text-red-700 dark:text-red-300",
          warning: "text-amber-700 dark:text-amber-300",
          ok: "text-green-700 dark:text-green-300",
          done: "text-muted-foreground",
          none: "text-muted-foreground",
        }
        const dotColorMap = {
          breached: "bg-red-500",
          warning: "bg-amber-500",
          ok: "bg-green-500",
          done: "bg-muted-foreground",
          none: "bg-muted-foreground",
        }
        // One compact line: status dot + remaining time. The SLA policy name moves into the tooltip
        // (it was a second line that made every row taller).
        return (
          <div className={cn("flex items-center gap-1.5 text-xs whitespace-nowrap", colorMap[slaStatus])} title={item.slaPolicyName || undefined}>
            <span className={cn("inline-block h-2 w-2 rounded-full flex-shrink-0", dotColorMap[slaStatus])} />
            <span>
              {slaStatus === "breached" && <>{t("slaBreached")} <AlertTriangle className="inline h-3 w-3" /></>}
              {slaStatus === "warning" && <>{formatTimeLeft(item.slaDueAt, t("hrAbbr"), t("minAbbr"))}</>}
              {slaStatus === "ok" && <>{formatTimeLeft(item.slaDueAt, t("hrAbbr"), t("minAbbr"))}</>}
              {slaStatus === "done" && <>{t("slaResolved")}</>}
            </span>
          </div>
        )
      },
    },
    {
      key: "escalationLevel", label: t("colEscalation"), sortable: true,
      render: (item: TicketData) => {
        if (!item.escalationLevel || item.escalationLevel === 0) return <span className="text-xs text-muted-foreground">—</span>
        return (
          <Badge className={escalationLevelColors[item.escalationLevel] || escalationLevelColors[3]}>
            <ShieldAlert className="h-3 w-3 mr-1" />
            L{item.escalationLevel}
          </Badge>
        )
      },
    },
    {
      key: "firstResponseAt", label: t("colResponse"), sortable: true,
      render: (item: TicketData) => {
        if (!item.firstResponseAt) return <span className="text-xs text-muted-foreground">—</span>
        const ms = new Date(item.firstResponseAt).getTime() - new Date(item.createdAt).getTime()
        const mins = Math.floor(ms / 60000)
        const hours = Math.floor(mins / 60)
        const label = hours > 0 ? `${hours}${tc("hours")} ${mins % 60}${tc("min")}` : `${mins}${tc("min")}`
        return <span className={cn("text-xs font-mono", hours > 4 ? "text-red-700 dark:text-red-300" : hours > 1 ? "text-amber-700 dark:text-amber-300" : "text-green-700 dark:text-green-300")}>{label}</span>
      },
    },
    {
      key: "assigneeName", label: t("colAssigned"), hint: t("hintColAssigned"), sortable: true,
      render: (item: TicketData) => item.assigneeName ? (
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">{initials(item.assigneeName)}</span>
          <span className="truncate max-w-[100px]" title={item.assigneeName}>{item.assigneeName}</span>
        </div>
      ) : <span className="text-muted-foreground">—</span>,
    },
    {
      key: "actions",
      label: "",
      className: "w-20",
      render: (item: TicketData) => (
        <div className="flex items-center gap-1" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
          <button data-testid={`ticket-edit-${item.id}`} type="button" aria-label={tc("edit")} onClick={() => handleEdit(item)} className="flex h-11 w-11 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" title={tc("edit")}>
            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          <button type="button" aria-label={tc("delete")} onClick={() => handleDelete(item)} className="flex h-11 w-11 items-center justify-center rounded-md hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-red-900/20" title={tc("delete")}>
            <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-red-500" />
          </button>
        </div>
      ),
    },
  ]

  const openCount = tickets.filter(t => !["resolved", "closed"].includes(t.status)).length
  const breachedCount = tickets.filter(t => isSlaBreached(t.slaDueAt) && !["resolved", "closed"].includes(t.status)).length
  const newCount = tickets.filter(t => t.status === "new").length
  const unassignedCount = tickets.filter(t => !t.assignedTo && !["resolved", "closed"].includes(t.status)).length
  const escalatedCount = tickets.filter(t => t.escalationLevel > 0 && !["resolved", "closed"].includes(t.status)).length
  const filteredTickets = (() => {
    let filtered = statusFilter === "all" ? tickets : tickets.filter(t => t.status === statusFilter)
    if (escalatedFilter) filtered = filtered.filter(t => t.escalationLevel > 0)
    if (focusFilter === "sla") filtered = filtered.filter(t => isSlaBreached(t.slaDueAt) && !["resolved", "closed"].includes(t.status))
    if (priorityFilter !== "all") filtered = filtered.filter(t => t.priority === priorityFilter)
    if (ownershipFilter === "unassigned") filtered = filtered.filter(t => !t.assignedTo)
    if (ownershipFilter === "mine") filtered = filtered.filter(t => t.assignedTo === currentUserId)
    if (searchQuery.trim()) {
      const query = searchQuery.trim().toLocaleLowerCase()
      filtered = filtered.filter(ticket => [
        ticket.ticketNumber,
        ticket.subject,
        ticket.requesterName,
        ticket.requesterEmail,
        ticket.requesterPhone,
        ticket.companyName,
        ticket.assigneeName,
      ].some(value => value?.toLocaleLowerCase().includes(query)))
    }
    return filtered
  })()
  const mostUrgentTicket = [...tickets]
    .filter(ticket => !["resolved", "closed"].includes(ticket.status))
    .sort((a, b) => {
      const aDue = a.slaDueAt ? new Date(a.slaDueAt).getTime() : Number.MAX_SAFE_INTEGER
      const bDue = b.slaDueAt ? new Date(b.slaDueAt).getTime() : Number.MAX_SAFE_INTEGER
      return aDue - bDue
    })[0]
  const nextUnassignedTicket = [...tickets]
    .filter(ticket => !ticket.assignedTo && !["resolved", "closed"].includes(ticket.status))
    .sort((a, b) => {
      const aDue = a.slaDueAt ? new Date(a.slaDueAt).getTime() : Number.MAX_SAFE_INTEGER
      const bDue = b.slaDueAt ? new Date(b.slaDueAt).getTime() : Number.MAX_SAFE_INTEGER
      return aDue - bDue || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    })[0]
  const visibleKanbanStatuses = statusFilter === "all"
    ? kanbanStatuses
    : kanbanStatuses.filter(status => status === statusFilter)
  const hasActiveFilters = statusFilter !== "all" || priorityFilter !== "all" || ownershipFilter !== "all" || focusFilter !== "all" || escalatedFilter || Boolean(searchQuery.trim())
  const activeFilterChips: Array<{ key: string; label: string; onClear: () => void }> = []
  if (statusFilter !== "all") activeFilterChips.push({ key: "status", label: t("filterChip", { label: t("statusFilterLabel"), value: statusLabels[statusFilter] || statusFilter }), onClear: () => { setStatusFilter("all"); updateWorkspaceParams({ status: null }) } })
  if (priorityFilter !== "all") activeFilterChips.push({ key: "priority", label: t("filterChip", { label: t("priorityFilterLabel"), value: priorityLabel(priorityFilter) }), onClear: () => { setPriorityFilter("all"); updateWorkspaceParams({ priority: null }) } })
  if (ownershipFilter !== "all") activeFilterChips.push({ key: "owner", label: t("filterChip", { label: t("ownershipFilterLabel"), value: ownershipFilter === "mine" ? t("assignedToMe") : t("notAssigned") }), onClear: () => { setOwnershipFilter("all"); updateWorkspaceParams({ owner: null }) } })
  if (focusFilter === "sla") activeFilterChips.push({ key: "sla", label: t("slaAtRisk"), onClear: () => { setFocusFilter("all"); updateWorkspaceParams({ focus: null }) } })
  if (escalatedFilter) activeFilterChips.push({ key: "escalated", label: t("escalatedFilter"), onClear: () => { setEscalatedFilter(false); updateWorkspaceParams({ escalated: null }) } })
  if (searchQuery.trim()) activeFilterChips.push({ key: "search", label: t("filterChip", { label: tc("search"), value: searchQuery.trim() }), onClear: () => setSearchQuery("") })

  function resetFilters() {
    setStatusFilter("all")
    setPriorityFilter("all")
    setOwnershipFilter("all")
    setFocusFilter("all")
    setEscalatedFilter(false)
    setSearchQuery("")
    updateWorkspaceParams({ status: null, priority: null, owner: null, focus: null, escalated: null, q: null })
  }

  if (loading) {
    return (
      <div data-testid="tickets-loading" role="status" className="space-y-4">
        <h1 className="text-xl font-semibold tracking-tight">{t("title")}</h1>
        <div className="animate-pulse space-y-3 motion-reduce:animate-none">
          <div className="grid gap-2 sm:grid-cols-3">
            {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-muted rounded-lg" />)}
          </div>
          <div className="h-96 bg-muted rounded-lg" />
        </div>
        <span className="sr-only">{tc("loading")}</span>
      </div>
    )
  }

  return (
    <SupportPageShell
      data-testid="tickets-workspace"
      width="fluid"
      className="overflow-x-clip [contain:inline-size]"
      title={t("title")}
      description={t("subtitle")}
      descriptionClassName="hidden sm:block"
      utilities={<>
            <div className="hidden shrink-0 items-center gap-2 sm:flex">
              <TourReplayButton tourId="tickets" />
              <HelpButton slug="tickets" variant="label" />
            </div>
          <div className="flex min-h-11 items-center gap-2 sm:hidden">
            <TourReplayButton tourId="tickets" className="min-h-11 px-2" />
            <HelpButton slug="tickets" className="h-11 w-11 shrink-0" />
          </div>
        </>}
      actions={
          <Button data-tour-id="tickets-new" onClick={handleAdd} className="h-11 shrink-0 sm:h-9"><Plus className="h-4 w-4" /> {t("newTicket")}</Button>
      }
    >

      <div data-tour-id="tickets-list" className="rounded-xl border bg-card p-2 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <div className="grid grid-cols-3 gap-1">
          {([
            { key: "new", label: t("newQueue"), value: newCount, meta: t("openQueue", { count: openCount }), icon: CircleDot, active: statusFilter === "new", onSelect: () => { const value = statusFilter === "new" ? "all" : "new"; setStatusFilter(value); setFocusFilter("all"); updateWorkspaceParams({ status: value, focus: null }) } },
            { key: "unassigned", label: t("statUnassigned"), value: unassignedCount, meta: t("needsOwner"), icon: UserX, active: ownershipFilter === "unassigned", onSelect: () => { const value = ownershipFilter === "unassigned" ? "all" : "unassigned"; setOwnershipFilter(value); setFocusFilter("all"); updateWorkspaceParams({ owner: value, focus: null }) } },
            { key: "sla", label: t("slaAtRisk"), value: breachedCount, meta: t("needsAttention"), icon: AlertTriangle, active: focusFilter === "sla", onSelect: () => { const value = focusFilter === "sla" ? "all" : "sla"; setFocusFilter(value); updateWorkspaceParams({ focus: value }) } },
          ]).map(({ key, label, value, meta, icon: Icon, active, onSelect }) => (
            <button
              key={key}
              type="button"
              onClick={onSelect}
              aria-pressed={active}
              className={cn(
                "flex min-h-14 flex-col items-stretch gap-0.5 rounded-lg px-1 py-2 text-center transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 sm:flex-row sm:items-center sm:gap-3 sm:px-3 sm:text-left motion-reduce:transition-none",
                active && "bg-muted"
              )}
            >
              <span className={cn("hidden h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground sm:flex sm:h-8 sm:w-8", key === "sla" && value > 0 && "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400")}>
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-col items-center sm:flex-row sm:items-baseline sm:gap-1.5"><strong className="text-base tabular-nums sm:text-lg">{value}</strong><span className="line-clamp-2 text-xs font-medium leading-tight sm:truncate sm:text-sm">{label}</span></span>
                <span className="hidden truncate text-xs text-muted-foreground sm:block">{meta}</span>
              </span>
            </button>
          ))}
        </div>
        {(nextUnassignedTicket || mostUrgentTicket) && (
          <div className="mt-1 flex items-center justify-between gap-2 border-t px-2 pt-2">
            <p className="min-w-0 truncate text-xs text-muted-foreground">
              {t("priorityHook")}: <span className="font-medium text-foreground">{(nextUnassignedTicket || mostUrgentTicket)?.ticketNumber} · {(nextUnassignedTicket || mostUrgentTicket)?.subject}</span>
            </p>
            {nextUnassignedTicket && canTakeNext ? (
              <Button data-testid="tickets-take-next" size="sm" className="h-11 shrink-0 justify-start px-3 sm:h-9" onClick={() => void takeNextTicket()} disabled={takingNext}>
                {takingNext ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <UserCheck className="h-3.5 w-3.5" />}
                {takingNext ? t("takingNext") : t("takeNext")}
              </Button>
            ) : (nextUnassignedTicket || mostUrgentTicket) ? (
              <Button size="sm" variant="ghost" className="h-11 shrink-0 justify-start px-2 sm:h-9" onClick={() => openTicket((nextUnassignedTicket || mostUrgentTicket).id)}>
                {t("openUrgent")} <ArrowUpRight className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </div>
        )}
      </div>

      {loadError && (
        <div data-testid="tickets-load-error" role="alert" className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50/60 px-3 py-2 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300 sm:flex-row sm:items-center sm:justify-between">
          <span>{permissionDenied ? t("permissionError") : tickets.length > 0 ? t("loadError") : t("initialLoadError")}</span>
          <Button data-testid="tickets-retry-load" size="sm" variant="outline" className="h-11 sm:h-8" onClick={() => { setLoading(true); void fetchTickets() }}><RotateCw className="h-3.5 w-3.5" /> {t("retry")}</Button>
        </div>
      )}

      <div className="z-20 rounded-xl border bg-background/95 p-2 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/90 md:sticky md:top-2" aria-label={t("workspaceFilters")}>
          <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
            <label className="relative min-w-0 flex-1 xl:max-w-sm">
              <span className="sr-only">{t("searchPlaceholder")}</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                data-testid="tickets-search"
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={t("searchPlaceholder")}
                className="h-11 w-full rounded-md border bg-background pl-9 pr-3 text-sm outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring/30 sm:h-9 motion-reduce:transition-none"
              />
            </label>
            <div className="w-full min-w-0 max-w-full overflow-hidden [contain:inline-size] sm:overflow-visible xl:w-auto xl:flex-1">
            <div data-testid="tickets-filter-scroller" className="flex gap-2 overflow-x-auto pb-0.5 sm:grid sm:grid-cols-[repeat(3,minmax(0,1fr))_auto_auto] sm:overflow-visible sm:pb-0 xl:flex">
              <label className="w-36 shrink-0 sm:w-auto sm:min-w-0">
                <span className="sr-only">{t("statusFilterLabel")}</span>
                <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setFocusFilter("all"); updateWorkspaceParams({ status: event.target.value, focus: null }) }} className="h-11 w-full rounded-md border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 sm:h-9 xl:w-36">
                  <option value="all">{t("allStatuses")}</option>
                  {kanbanStatuses.map(status => <option key={status} value={status}>{statusLabels[status]}</option>)}
                </select>
              </label>
              <label className="w-36 shrink-0 sm:w-auto sm:min-w-0">
                <span className="sr-only">{t("priorityFilterLabel")}</span>
                <select value={priorityFilter} onChange={(event) => { setPriorityFilter(event.target.value); updateWorkspaceParams({ priority: event.target.value }) }} className="h-11 w-full rounded-md border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 sm:h-9 xl:w-36">
                  <option value="all">{t("allPriorities")}</option>
                  {Object.keys(priorityColors).map(priority => <option key={priority} value={priority}>{priorityLabel(priority)}</option>)}
                </select>
              </label>
              <label className="w-36 shrink-0 sm:w-auto sm:min-w-0">
                <span className="sr-only">{t("ownershipFilterLabel")}</span>
                <select value={ownershipFilter} onChange={(event) => { const value = event.target.value as OwnershipFilter; setOwnershipFilter(value); updateWorkspaceParams({ owner: value }) }} className="h-11 w-full rounded-md border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 sm:h-9 xl:w-36">
                  <option value="all">{t("allOwners")}</option>
                  <option value="unassigned">{t("notAssigned")}</option>
                  <option value="mine">{t("assignedToMe")}</option>
                </select>
              </label>
              <div data-tour-id="tickets-kanban-toggle" className="order-first flex h-11 min-w-32 shrink-0 rounded-md border bg-card p-0.5 sm:order-none sm:h-9 sm:w-auto" role="group" aria-label={t("viewLabel")}>
                {workspaceViews.map(({ key, label, icon: Icon }) => (
                  <button key={key} type="button" aria-label={label} title={label} aria-pressed={view === key} onClick={() => selectView(key)} className={cn("flex min-h-11 min-w-11 flex-1 items-center justify-center rounded px-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 motion-reduce:transition-none sm:min-h-8 sm:min-w-8", view === key ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
                    <Icon className="h-3.5 w-3.5" />
                    <span className={view === key ? "ml-1 whitespace-nowrap sm:sr-only" : "sr-only"}>{label}</span>
                  </button>
                ))}
              </div>
              <Button data-testid="tickets-refresh" type="button" size="icon" variant="outline" className="h-11 w-11 shrink-0 sm:h-9 sm:w-9" aria-label={tc("refresh")} title={tc("refresh")} disabled={loading} onClick={() => void fetchTickets()}>
                <RotateCw className={cn("h-4 w-4", loading && "animate-spin motion-reduce:animate-none")} />
              </Button>
            </div>
            </div>
            {(escalatedCount > 0 || hasActiveFilters) && (
              <div className="flex items-center gap-1.5">
                {escalatedCount > 0 && (
                  <button
                    data-testid="tickets-escalated-filter"
                    type="button"
                    onClick={() => { const value = !escalatedFilter; setEscalatedFilter(value); updateWorkspaceParams({ escalated: value ? "1" : null }) }}
                    aria-pressed={escalatedFilter}
                    className={cn(
                      "flex h-11 shrink-0 items-center gap-1 rounded-md border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 sm:h-9 motion-reduce:transition-none",
                      escalatedFilter ? "border-red-700 bg-red-700 text-white" : "bg-background text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-900/20",
                    )}
                  >
                    <ShieldAlert className="h-3.5 w-3.5" />
                    {t("escalatedFilter")} ({escalatedCount})
                  </button>
                )}
                {hasActiveFilters && <Button type="button" size="sm" variant="ghost" className="h-11 shrink-0 sm:h-9" onClick={resetFilters}><X className="h-3.5 w-3.5" /> {t("resetFilters")}</Button>}
              </div>
            )}
          </div>
          <div className="mt-1 flex items-center justify-between gap-3 px-1 text-xs text-muted-foreground" aria-live="polite">
            <span>{t("filteredResults", { visible: filteredTickets.length, total: tickets.length })}</span>
            {lastUpdatedAt && <span className="hidden sm:inline">{t("updatedAt", { time: lastUpdatedAt.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) })}</span>}
          </div>
          {activeFilterChips.length > 0 && (
            <div className="mt-2 flex gap-1.5 overflow-x-auto" aria-label={t("activeFilters")}>
              {activeFilterChips.map(chip => (
                <button key={chip.key} type="button" onClick={chip.onClear} aria-label={t("removeFilter", { filter: chip.label })} className="flex h-11 shrink-0 items-center gap-1 rounded-full border bg-muted/50 px-2.5 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 sm:h-8">
                  {chip.label}<X className="h-3 w-3" aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
      </div>

      {view === "list" && (!loadError || tickets.length > 0) && (
        <DataTable<TicketData>
          columns={columns}
          data={filteredTickets}
          searchPlaceholder={t("searchPlaceholder")}
          searchKey="subject"
          hideSearch
          dense
          compact
          emptyContent={(
            <div data-testid={tickets.length === 0 ? "tickets-empty-state" : "tickets-no-results-state"} className="mx-auto flex max-w-sm flex-col items-center gap-2">
              <p className="font-medium text-foreground">{tickets.length === 0 ? t("emptyQueueTitle") : t("noResultsTitle")}</p>
              <p className="text-xs">{tickets.length === 0 ? t("emptyQueueHint") : t("noResultsHint")}</p>
              <Button data-testid="tickets-empty-action" size="sm" variant="outline" className="h-11 sm:h-9" onClick={tickets.length === 0 ? handleAdd : resetFilters}>
                {tickets.length === 0 ? <Plus className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                {tickets.length === 0 ? t("newTicket") : t("resetFilters")}
              </Button>
            </div>
          )}
          onRowClick={(item) => openTicket((item as TicketData).id)}
          rowClassName={(item) => (newIds.has((item as TicketData).id) ? "ticket-new-blink" : "")}
          mobileCardRender={(item) => {
            const slaStatus = getSlaStatus(item.slaDueAt, item.status)
            return (
              <article
                role="link"
                tabIndex={0}
                onClick={() => openTicket(item.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault()
                    openTicket(item.id)
                  }
                }}
                className={cn("rounded-xl border bg-card p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30", newIds.has(item.id) && "ticket-new-blink")}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">{item.ticketNumber}</span>
                      <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium", statusColors[item.status] || statusColors.open)}>
                        <span className={cn("h-1.5 w-1.5 rounded-full", statusDot[item.status] || "bg-zinc-400")} />
                        {statusLabels[item.status]}
                      </span>
                    </div>
                    <h2 className="mt-1 line-clamp-2 text-sm font-semibold leading-5">{item.subject}</h2>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{item.requesterName || item.companyName || "—"}</p>
                  </div>
                  <span className={cn("shrink-0 rounded-full px-2 py-1 text-xs font-medium", priorityColors[item.priority])}>{priorityLabel(item.priority)}</span>
                </div>
                <div className="mt-3 flex items-center justify-between border-t pt-2">
                  <span className={cn("flex items-center gap-1.5 text-xs", slaStatus === "breached" ? "text-red-700 dark:text-red-300" : slaStatus === "warning" ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
                    <span className={cn("h-1.5 w-1.5 rounded-full", slaStatus === "breached" ? "bg-red-500" : slaStatus === "warning" ? "bg-amber-500" : slaStatus === "none" || slaStatus === "done" ? "bg-zinc-400" : "bg-emerald-500")} />
                    {slaStatus === "breached" ? t("slaBreached") : item.slaDueAt ? formatTimeLeft(item.slaDueAt, t("hrAbbr"), t("minAbbr")) : t("slaNotSet")}
                  </span>
                  <span className="text-xs text-muted-foreground">{item.assigneeName || t("notAssigned")}</span>
                </div>
              </article>
            )
          }}
        />
      )}

      {view === "kanban" && (!loadError || tickets.length > 0) && filteredTickets.length === 0 && (
        <div data-testid={tickets.length === 0 ? "tickets-kanban-empty-state" : "tickets-kanban-no-results-state"} className="rounded-xl border border-dashed px-4 py-10 text-center">
          <p className="font-medium">{tickets.length === 0 ? t("emptyQueueTitle") : t("noResultsTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{tickets.length === 0 ? t("emptyQueueHint") : t("noResultsHint")}</p>
          <Button className="mt-4 h-11 sm:h-9" size="sm" variant="outline" onClick={tickets.length === 0 ? handleAdd : resetFilters}>
            {tickets.length === 0 ? <Plus className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
            {tickets.length === 0 ? t("newTicket") : t("resetFilters")}
          </Button>
        </div>
      )}

      {view === "kanban" && (!loadError || tickets.length > 0) && filteredTickets.length > 0 && (
        <div data-testid="tickets-kanban-viewport" className="w-full min-w-0 max-w-full overflow-x-auto overscroll-x-contain pb-4 [contain:inline-size]">
        <MotionList className="flex w-max min-w-full items-start gap-3" staggerDelay={0.06}>
          {visibleKanbanStatuses.map((status) => {
            const columnTickets = filteredTickets.filter(t => t.status === status)
            const isExpanded = expandedKanbanColumns[status] || false
            const visibleTickets = columnTickets.length > KANBAN_COLLAPSE_LIMIT && !isExpanded
              ? columnTickets.slice(0, KANBAN_COLLAPSE_LIMIT)
              : columnTickets
            const hiddenCount = columnTickets.length - KANBAN_COLLAPSE_LIMIT

            return (
              <MotionItem key={status} className="w-[292px] flex-shrink-0">
                <div
                  className={cn(
                    "flex min-h-[220px] flex-col rounded-lg border border-zinc-200 bg-muted/30 transition-colors dark:border-zinc-800 dark:bg-zinc-900/25 motion-reduce:transition-none",
                    dragOverStatus === status && "border-primary/60 bg-primary/5 ring-2 ring-primary/20"
                  )}
                  onDragEnter={(event) => {
                    event.preventDefault()
                    setDragOverStatus(status)
                  }}
                  onDragOver={(event) => {
                    event.preventDefault()
                    event.dataTransfer.dropEffect = "move"
                    if (dragOverStatus !== status) setDragOverStatus(status)
                  }}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOverStatus(null)
                  }}
                  onDrop={(event) => handleKanbanDrop(event, status)}
                >
                  <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-200 bg-background/95 px-3 py-2 backdrop-blur dark:border-zinc-800">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={cn("h-2 w-2 flex-shrink-0 rounded-full", statusDot[status] || "bg-zinc-400")} />
                      <span className="truncate text-sm font-semibold">{statusLabels[status]}</span>
                    </div>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">{columnTickets.length}</span>
                  </div>
                  <div className="flex flex-col gap-2 p-2">
                    {visibleTickets.map(ticket => (
                      <article
                        key={ticket.id}
                        draggable={movingTicketId !== ticket.id}
                        className={cn(
                          "cursor-grab rounded-lg border border-zinc-200 bg-card p-2.5 transition-[border-color,box-shadow,opacity,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-sm motion-reduce:transform-none motion-reduce:transition-none active:cursor-grabbing dark:border-zinc-800",
                          newIds.has(ticket.id) && "ticket-new-blink",
                          draggedTicketId === ticket.id && "opacity-50",
                          movingTicketId === ticket.id && "pointer-events-none opacity-60"
                        )}
                        onDragStart={(event) => handleKanbanDragStart(event, ticket)}
                        onDragEnd={() => {
                          setDraggedTicketId(null)
                          setDragOverStatus(null)
                        }}
                      >
                        <button type="button" className="min-h-11 w-full rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30" onClick={() => openTicket(ticket.id)}>
                          <div className="mb-1.5 flex min-w-0 items-center gap-1.5">
                            <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{ticket.ticketNumber}</span>
                            {ticket.escalationLevel > 0 && (
                              <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium", escalationLevelColors[ticket.escalationLevel] || escalationLevelColors[3])}>
                                <ShieldAlert className="h-3 w-3" />
                                L{ticket.escalationLevel}
                              </span>
                            )}
                            <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", priorityColors[ticket.priority])}>{priorityLabel(ticket.priority)}</span>
                          </div>
                          <span className="line-clamp-2 text-sm font-medium leading-snug" title={ticket.subject}>{ticket.subject}</span>
                          <span className="mt-2 flex min-w-0 items-center justify-between gap-2">
                            <span className="min-w-0 truncate text-xs text-muted-foreground" title={ticket.requesterName || ticket.companyName || undefined}>{ticket.requesterName || ticket.companyName || "—"}</span>
                            {ticket.slaDueAt && (() => {
                              const s = getSlaStatus(ticket.slaDueAt, ticket.status)
                              const dotColor = { breached: "bg-red-500", warning: "bg-amber-500", ok: "bg-green-500", done: "bg-muted-foreground", none: "" }
                              if (s === "none") return null
                              return (
                                <span className="flex flex-shrink-0 items-center gap-1">
                                  <span className={cn("h-1.5 w-1.5 rounded-full", dotColor[s])} />
                                  {s !== "done" && s !== "breached" && <span className="text-xs text-muted-foreground">{formatTimeLeft(ticket.slaDueAt, t("hrAbbr"), t("minAbbr"))}</span>}
                                  {s === "breached" && <AlertTriangle className="h-3 w-3 text-red-500" />}
                                </span>
                              )
                            })()}
                          </span>
                          <span className="mt-1 block truncate text-xs text-muted-foreground">{ticket.assigneeName || t("notAssigned")}</span>
                        </button>
                        <label className="mt-2 block border-t pt-2">
                          <span className="sr-only">{t("moveTicket", { number: ticket.ticketNumber })}</span>
                          <select
                            data-testid={`ticket-move-${ticket.id}`}
                            aria-label={t("moveTicket", { number: ticket.ticketNumber })}
                            value={ticket.status}
                            disabled={movingTicketId === ticket.id}
                            onPointerDown={(event) => event.stopPropagation()}
                            onChange={(event) => void moveTicketToStatus(ticket, event.target.value as KanbanStatus)}
                            className="h-11 w-full rounded-md border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 sm:h-9"
                          >
                            {kanbanStatuses.map(nextStatus => <option key={nextStatus} value={nextStatus}>{t("moveToStatus", { status: statusLabels[nextStatus] })}</option>)}
                          </select>
                        </label>
                      </article>
                    ))}
                    {columnTickets.length > KANBAN_COLLAPSE_LIMIT && (
                      <button
                        onClick={() => setExpandedKanbanColumns(prev => ({ ...prev, [status]: !isExpanded }))}
                        className="flex min-h-11 w-full items-center justify-center gap-1 rounded-md border border-dashed border-zinc-300 bg-background px-2 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-zinc-700 motion-reduce:transition-none"
                      >
                        {isExpanded ? (
                          <>
                            <ChevronUp className="h-3.5 w-3.5" />
                            {t("kanbanShowLess")}
                          </>
                        ) : (
                          <>
                            <ChevronDown className="h-3.5 w-3.5" />
                            {t("kanbanShowMore", { count: hiddenCount })}
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </MotionItem>
            )
          })}
        </MotionList>
        </div>
      )}

      {view === "reports" && canViewReports && (
        <TicketingReport orgId={orgId ? String(orgId) : undefined} />
      )}

      <TicketForm open={formOpen} onOpenChange={setFormOpen} onSaved={fetchTickets} initialData={editData} orgId={orgId} />
      <DeleteConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} onConfirm={confirmDelete} title={t("deleteTicket")} itemName={deleteItem?.subject} />
    </SupportPageShell>
  )
}
