"use client"

import { useEffect, useState, type DragEvent, type ReactNode } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { useEnumLabel } from "@/lib/status-labels"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { DataTable } from "@/components/data-table"
import { ColorStatCard } from "@/components/color-stat-card"
import { PageDescription } from "@/components/page-description"
import { TicketForm } from "@/components/ticket-form"
import { Ticket, Plus, Clock, AlertTriangle, CheckCircle, Pencil, Trash2, UserX, ShieldAlert, ChevronDown, ChevronUp } from "lucide-react"
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
import { cn } from "@/lib/utils"
import { MotionList, MotionItem } from "@/components/ui/motion"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"
import { DidYouKnow } from "@/components/did-you-know"
import { TicketingReport } from "@/components/tickets/ticketing-report"

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
type TicketColumn = {
  key: string
  label: string
  hint?: string
  sortable?: boolean
  render?: (item: TicketData) => ReactNode
  className?: string
}

const priorityColors: Record<string, string> = {
  critical: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  low: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
}
const priorityDot: Record<string, string> = {
  critical: "bg-red-500", high: "bg-orange-500", medium: "bg-yellow-500", low: "bg-green-500",
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
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editData, setEditData] = useState<TicketData | undefined>()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteItem, setDeleteItem] = useState<TicketData | null>(null)
  const [escalatedFilter, setEscalatedFilter] = useState(false)
  const [expandedKanbanColumns, setExpandedKanbanColumns] = useState<Record<string, boolean>>({})
  const [draggedTicketId, setDraggedTicketId] = useState<string | null>(null)
  const [dragOverStatus, setDragOverStatus] = useState<string | null>(null)
  const [movingTicketId, setMovingTicketId] = useState<string | null>(null)
  const orgId = session?.user?.organizationId

  useEffect(() => {
    const syncViewFromUrl = () => {
      setView(parseViewMode(new URLSearchParams(window.location.search).get("view")))
    }

    syncViewFromUrl()
    window.addEventListener("popstate", syncViewFromUrl)

    return () => window.removeEventListener("popstate", syncViewFromUrl)
  }, [])

  function selectView(nextView: ViewMode) {
    setView(nextView)
    router.replace(nextView === "list" ? "/tickets" : `/tickets?view=${nextView}`, { scroll: false })
  }

  // localStorage-backed highlight: `known` = every ticket id this browser has already seen for this
  // org (so the existing backlog never blinks), `new` = arrived-but-not-yet-opened ids — the orange
  // accent persists across polls / reloads / tab-switches and only clears when the agent opens it.
  const knownKey = orgId ? `tickets:known:${orgId}` : ""
  const newKey = orgId ? `tickets:new:${orgId}` : ""
  const persistNew = (s: Set<string>) => { try { if (newKey) localStorage.setItem(newKey, JSON.stringify([...s])) } catch {} }
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

  async function fetchTickets() {
    try {
      const res = await fetch("/api/v1/tickets?limit=200", {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      const json = await res.json()
      if (json.success) {
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
      }
    } catch {
      // keep empty
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTickets()
  }, [session])

  // Poll for new tickets every 20 seconds
  useEffect(() => {
    const interval = setInterval(fetchTickets, 20000)
    return () => clearInterval(interval)
  }, [session])

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
    router.push(`/tickets/${id}`)
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
    if (!res.ok) throw new Error((await res.json()).error || tc("errorDeleteFailed"))
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
        const json = await res.json().catch(() => null)
        throw new Error(json?.error || tc("errorUpdateFailed"))
      }
    } catch (err) {
      setTickets(prev => prev.map(item => item.id === ticket.id ? { ...item, status: previousStatus } : item))
      toast.error(err instanceof Error ? err.message : tc("errorUpdateFailed"))
    } finally {
      setMovingTicketId(null)
    }
  }

  function handleKanbanDragStart(event: DragEvent<HTMLDivElement>, ticket: TicketData) {
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
            {detail && <span className="block truncate text-[11px] text-muted-foreground">{detail}</span>}
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
          breached: "text-red-500",
          warning: "text-amber-500",
          ok: "text-green-600 dark:text-green-400",
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
              {slaStatus === "done" && <>{t("slaResolved") || "Resolved"}</>}
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
        return <span className={cn("text-xs font-mono", hours > 4 ? "text-red-500" : hours > 1 ? "text-amber-500" : "text-green-500")}>{label}</span>
      },
    },
    {
      key: "assigneeName", label: t("colAssigned"), hint: t("hintColAssigned"), sortable: true,
      render: (item: TicketData) => item.assigneeName ? (
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-medium text-primary">{initials(item.assigneeName)}</span>
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
          <button onClick={() => handleEdit(item)} className="p-1.5 rounded hover:bg-muted" title={tc("edit")}>
            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          <button onClick={() => handleDelete(item)} className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20" title={tc("delete")}>
            <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-red-500" />
          </button>
        </div>
      ),
    },
  ]

  const openCount = tickets.filter(t => !["resolved", "closed"].includes(t.status)).length
  const breachedCount = tickets.filter(t => isSlaBreached(t.slaDueAt) && !["resolved", "closed"].includes(t.status)).length
  const resolvedCount = tickets.filter(t => t.status === "resolved").length
  const unassignedCount = tickets.filter(t => !t.assignedTo).length
  const escalatedCount = tickets.filter(t => t.escalationLevel > 0 && !["resolved", "closed"].includes(t.status)).length
  const filteredTickets = (() => {
    let filtered = statusFilter === "all" ? tickets : tickets.filter(t => t.status === statusFilter)
    if (escalatedFilter) filtered = filtered.filter(t => t.escalationLevel > 0)
    return filtered
  })()
  const visibleKanbanStatuses = statusFilter === "all"
    ? kanbanStatuses
    : kanbanStatuses.filter(status => status === statusFilter)

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <div className="animate-pulse space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            {[1, 2, 3, 4].map((i) => <div key={i} className="h-24 bg-muted rounded-lg" />)}
          </div>
          <div className="h-96 bg-muted rounded-lg" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">{t("title")} <TourReplayButton tourId="tickets" /> <HelpButton slug="tickets" variant="label" /></h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
          <PageDescription text={t("pageDescription")} />
        </div>
        <div className="flex items-center gap-2">
          <div data-tour-id="tickets-kanban-toggle" className="flex rounded-lg border border-zinc-200 dark:border-zinc-700">
            <button onClick={() => selectView("list")} className={cn("px-3 py-1.5 text-sm", view === "list" ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>{t("list")}</button>
            <button onClick={() => selectView("kanban")} className={cn("px-3 py-1.5 text-sm", view === "kanban" ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>{t("kanban")}</button>
            <button onClick={() => selectView("reports")} className={cn("px-3 py-1.5 text-sm", view === "reports" ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>{t("reports")}</button>
          </div>
          <Button data-tour-id="tickets-new" onClick={handleAdd}><Plus className="h-4 w-4" /> {t("newTicket")}</Button>
        </div>
      </div>

      <DidYouKnow page="tickets" className="mb-4" />

      <div data-tour-id="tickets-list" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 stagger-children">
        <ColorStatCard label={t("statTotal")} value={tickets.length} icon={<Ticket className="h-4 w-4" />} hint={t("hintTotalTickets")} />
        <ColorStatCard label={t("statOpen")} value={openCount} icon={<Clock className="h-4 w-4" />} hint={t("hintFirstResponseRate")} />
        <ColorStatCard label={t("statUnassigned")} value={unassignedCount} icon={<UserX className="h-4 w-4" />} />
        <div data-tour-id="tickets-sla"><ColorStatCard label={t("statSlaBreach")} value={breachedCount} icon={<AlertTriangle className="h-4 w-4" />} hint={t("hintSlaBreached")} /></div>
        <ColorStatCard label={t("statResolved")} value={resolvedCount} icon={<CheckCircle className="h-4 w-4" />} hint={t("hintAvgResolution")} />
      </div>

      {view !== "reports" && (
        <div className="flex items-center gap-2 flex-wrap">
          {escalatedCount > 0 && (
            <button
              onClick={() => setEscalatedFilter(!escalatedFilter)}
              className={cn(
                "px-3 py-1.5 text-sm rounded-full border transition-colors flex items-center gap-1",
                escalatedFilter
                  ? "bg-red-500 text-white border-red-500"
                  : "bg-background hover:bg-red-50 dark:hover:bg-red-900/20 border-zinc-200 dark:border-zinc-700 text-red-600"
              )}
            >
              <ShieldAlert className="h-3.5 w-3.5" />
              {t("escalatedFilter")} ({escalatedCount})
            </button>
          )}
          {[
            { key: "all", label: tc("all"), count: tickets.length },
            { key: "new", label: t("statusNew"), count: tickets.filter(t => t.status === "new").length },
            { key: "open", label: t("statusOpen"), count: tickets.filter(t => t.status === "open").length },
            { key: "in_progress", label: t("statusInProgress"), count: tickets.filter(t => t.status === "in_progress").length },
            { key: "waiting", label: t("statusWaiting"), count: tickets.filter(t => t.status === "waiting").length },
            { key: "resolved", label: t("statusResolved"), count: tickets.filter(t => t.status === "resolved").length },
            { key: "closed", label: t("statusClosed"), count: tickets.filter(t => t.status === "closed").length },
          ].filter(tab => tab.key === "all" || tab.count > 0).map(tab => (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              className={cn(
                "px-3 py-1.5 text-sm rounded-full border transition-colors",
                statusFilter === tab.key
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background hover:bg-muted border-zinc-200 dark:border-zinc-700"
              )}
            >
              {tab.label} ({tab.count})
            </button>
          ))}
        </div>
      )}

      {view === "list" && (
        <DataTable<TicketData>
          columns={columns}
          data={filteredTickets}
          searchPlaceholder={t("searchPlaceholder")}
          searchKey="subject"
          dense
          onRowClick={(item) => openTicket((item as TicketData).id)}
          rowClassName={(item) => (newIds.has((item as TicketData).id) ? "ticket-new-blink" : "")}
        />
      )}

      {view === "kanban" && (
        <MotionList className="flex items-start gap-3 overflow-x-auto pb-4" staggerDelay={0.06}>
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
                    "flex min-h-[220px] flex-col rounded-lg border border-zinc-200 bg-muted/30 transition-colors dark:border-zinc-800 dark:bg-zinc-900/25",
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
                      <div
                        key={ticket.id}
                        draggable={movingTicketId !== ticket.id}
                        className={cn(
                          "cursor-grab rounded-lg border border-zinc-200 bg-card p-2.5 transition-[border-color,box-shadow,opacity,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-sm active:cursor-grabbing dark:border-zinc-800",
                          newIds.has(ticket.id) && "ticket-new-blink",
                          draggedTicketId === ticket.id && "opacity-50",
                          movingTicketId === ticket.id && "pointer-events-none opacity-60"
                        )}
                        onDragStart={(event) => handleKanbanDragStart(event, ticket)}
                        onDragEnd={() => {
                          setDraggedTicketId(null)
                          setDragOverStatus(null)
                        }}
                        onClick={() => openTicket(ticket.id)}
                      >
                        <div className="mb-1.5 flex min-w-0 items-center gap-1.5">
                          <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">{ticket.ticketNumber}</span>
                          {ticket.escalationLevel > 0 && (
                            <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium", escalationLevelColors[ticket.escalationLevel] || escalationLevelColors[3])}>
                              <ShieldAlert className="h-3 w-3" />
                              L{ticket.escalationLevel}
                            </span>
                          )}
                          <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", priorityColors[ticket.priority])}>{priorityLabel(ticket.priority)}</span>
                        </div>
                        <div className="line-clamp-2 text-sm font-medium leading-snug" title={ticket.subject}>{ticket.subject}</div>
                        <div className="mt-2 flex min-w-0 items-center justify-between gap-2">
                          <span className="min-w-0 truncate text-xs text-muted-foreground" title={ticket.companyName || undefined}>{ticket.companyName || "—"}</span>
                          {ticket.slaDueAt && (() => {
                            const s = getSlaStatus(ticket.slaDueAt, ticket.status)
                            const dotColor = { breached: "bg-red-500", warning: "bg-amber-500", ok: "bg-green-500", done: "bg-muted-foreground", none: "" }
                            if (s === "none") return null
                            return (
                              <span className="flex flex-shrink-0 items-center gap-1">
                                <span className={cn("h-1.5 w-1.5 rounded-full", dotColor[s])} />
                                {s !== "done" && s !== "breached" && <span className="text-[10px] text-muted-foreground">{formatTimeLeft(ticket.slaDueAt, t("hrAbbr"), t("minAbbr"))}</span>}
                                {s === "breached" && <AlertTriangle className="h-3 w-3 text-red-500" />}
                              </span>
                            )
                          })()}
                        </div>
                      </div>
                    ))}
                    {columnTickets.length > KANBAN_COLLAPSE_LIMIT && (
                      <button
                        onClick={() => setExpandedKanbanColumns(prev => ({ ...prev, [status]: !isExpanded }))}
                        className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-zinc-300 bg-background px-2 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground dark:border-zinc-700"
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
      )}

      {view === "reports" && (
        <TicketingReport orgId={orgId ? String(orgId) : undefined} />
      )}

      <TicketForm open={formOpen} onOpenChange={setFormOpen} onSaved={fetchTickets} initialData={editData} orgId={orgId} />
      <DeleteConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} onConfirm={confirmDelete} title={t("deleteTicket")} itemName={deleteItem?.subject} />
    </div>
  )
}
