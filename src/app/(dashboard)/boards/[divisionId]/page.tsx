"use client"

/**
 * Jira-style Kanban board — /boards/[divisionId]. Feature #12.
 *
 * Pinned one-to-one to the user's screenshot: 6 columns with coloured top
 * accents, Atlassian palette, KHS-NN keys, lucide issue-type + priority glyphs,
 * a sticky toolbar (assigned-to-me / created-by-me pills + search + Tip /
 * Prioritet / Təyin olunan selects), Q-category featured cards, and a DONE
 * column collapsed to "+N daha çox tamamlanmış".
 *
 * Behaviour: dnd-kit drag (PointerSensor, 8px activation so a click still opens
 * the card) with a DragOverlay for smooth drag/drop animation, an optimistic move
 * + rollback on a 403 (the backend gates per-status transitions via BoardPermission); a working
 * "Yeni Tapşırıq" create dialog (POST /api/v1/tasks); a board switcher; filter
 * state mirrored into the URL; and a light refetch on window focus (socket.io
 * realtime is deferred — no socket server exists yet). All copy is next-intl
 * (`board` namespace) with the AZ locale matching the screenshot verbatim.
 */

import { Suspense, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import { formatDate as formatDateI18n } from "@/lib/format-date"
import { useParams, useRouter, usePathname, useSearchParams } from "next/navigation"
import { useSession } from "next-auth/react"
import { useLocale, useTranslations } from "next-intl"
import {
  type LucideIcon,
  CheckSquare, Bug, Bookmark, Sparkles, Zap,
  ChevronsUp, ChevronUp, ChevronDown, Equal,
  Clock, Search, RefreshCw, Plus, MoreHorizontal, X, Loader2, Settings,
  UserCheck, PenLine,
} from "lucide-react"
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors, useDraggable, useDroppable, pointerWithin,
  type DragStartEvent, type DragEndEvent,
} from "@dnd-kit/core"
import { CSS } from "@dnd-kit/utilities"
import { TaskDetailView } from "@/components/tasks/task-detail-view"
import { InlineTasksTable, type InlineTask, type InlineUser } from "@/components/tasks/inline-tasks-table"
import { resolveLaneKey } from "@/lib/tasks/board-columns"
import { BoardReports } from "@/components/boards/board-reports"
import { DepartmentBoardView } from "@/components/boards/department-board-view"
import { OperationalReport } from "@/components/tasks/operational-report"
import { TaskExportMenu } from "@/components/tasks/task-export-menu"
import { useTaskTypes, useEventTypes, type TaskTypeInfo, type TaskTypeDTO } from "@/components/tasks/use-task-types"
import { BoardActionsCtx, CardQuickMenu, type BoardActions } from "@/components/boards/card-quick-menu"
import { HelpButton } from "@/components/help/help-button"

// ── Atlassian palette (one-to-one with the screenshot) ──────────────────────
const C = {
  primary: "#EA580C",
  text: "#172B4D",
  sub: "#6B778C",
  border: "#DFE1E6",
  page: "#F4F5F7",
  colBg: "#F1F2F4",
  card: "#FFFFFF",
  green: "#00875A",
  red: "#DE350B",
  amber: "#FF8B00",
  purple: "#6554C0",
  teal: "#00B8D9",
}

type KanbanStatus = "backlog" | "todo" | "in_progress" | "testing" | "review" | "done"

const COLUMNS: { status: KanbanStatus; label: string; accent: string }[] = [
  { status: "backlog", label: "BACKLOG", accent: "#C1C7D0" },
  { status: "todo", label: "TO DO", accent: "#C1C7D0" },
  { status: "in_progress", label: "IN PROGRESS", accent: C.primary },
  { status: "testing", label: "TESTING", accent: C.purple },
  { status: "review", label: "REVIEW", accent: C.teal },
  { status: "done", label: "DONE", accent: C.green },
]

// Default accent per canonical stage — kept in code (not the DB) so the
// in-progress lane follows the live brand color instead of a frozen hex.
// A custom column with its own `color` overrides this.
const DEFAULT_ACCENT: Record<string, string> = {
  backlog: "#C1C7D0", todo: "#C1C7D0", in_progress: C.primary,
  testing: C.purple, review: C.teal, done: C.green,
}

// A rendered board column (sourced from board_columns, or the legacy fallback).
interface BoardCol { key: string; label: string; mapsToStatus: string; accent: string }

// Jira-style issue-type glyphs (lucide) — coloured per type.
const TYPE_ICON: Record<string, { Icon: LucideIcon; color: string }> = {
  task: { Icon: CheckSquare, color: C.primary },
  bug: { Icon: Bug, color: C.red },
  story: { Icon: Bookmark, color: C.green },
  feature: { Icon: Sparkles, color: C.teal },
  epic: { Icon: Zap, color: C.purple },
}

// Jira-style priority glyphs (lucide) — coloured per priority.
const PRIORITY_ICON: Record<string, { Icon: LucideIcon; color: string }> = {
  critical: { Icon: ChevronsUp, color: C.red },
  urgent: { Icon: ChevronsUp, color: C.red },
  high: { Icon: ChevronUp, color: C.red },
  medium: { Icon: Equal, color: C.amber },
  low: { Icon: ChevronDown, color: C.primary },
}

// Per-board task-type lookup (name → {displayName,color}) provided by BoardInner
// from /api/v1/task-types; consumed by Card so a custom type renders with its
// configured color. Empty default = fall back to the legacy TYPE_ICON glyph.
const TaskTypeCtx = createContext<Map<string, TaskTypeInfo>>(new Map())
// Same lookup for the Event-type axis (channel/source) — a second color dot on cards.
const EventTypeCtx = createContext<Map<string, TaskTypeInfo>>(new Map())
const PRIORITIES = ["critical", "high", "medium", "low"] as const
const CATEGORIES = ["Q1", "Q2", "Q3", "Q4"] as const
const DONE_MAX = 10
const DONE_WINDOW_DAYS = 14

interface Task {
  id: string
  taskKey: string | null
  title: string
  status: string
  boardColumnKey?: string | null
  boardPosition: number
  priority: string
  type: string | null
  eventType: string | null
  category: string | null
  dueDate: string | null
  completedAt: string | null
  checklist?: { completed: boolean }[] // for the Q-card progress bar (API returns it)
  assignee?: { id: string; name: string; avatar: string | null } | null
  collaborators?: { user: { id: string; name: string; avatar: string | null } }[]
  creator?: { id: string; name: string } | null
  /** Who the work is for — the lead/company behind the task, resolved by the API. */
  relatedType?: string | null
  relatedName?: string | null
}

interface BoardColumnDTO { key: string; label: string; sortOrder: number; mapsToStatus: string; color: string | null }
interface Division { id: string; key: string; name: string; color: string | null; isDepartment?: boolean; boardColumns?: BoardColumnDTO[] }
interface OrgUser { id: string; name: string; avatar?: string | null }

function fmtDate(d: string | null, locale: string): string {
  // Locale-aware short date, e.g. en "Jun 2", ru "2 июн.", az "2 iyn" — via the
  // shared util, which renders az named months itself (raw Intl gave "M03").
  return formatDateI18n(d, locale, { day: "numeric", month: "short" })
}

function initials(name: string): string {
  return name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase()
}

export default function BoardPage() {
  // useSearchParams() must sit under a Suspense boundary (Next.js requirement).
  return (
    <Suspense fallback={<div style={{ background: C.page, minHeight: "100%" }} />}>
      <BoardInner />
    </Suspense>
  )
}

function BoardInner() {
  const t = useTranslations("board")
  const params = useParams<{ divisionId: string }>()
  const divisionId = params.divisionId
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const { data: session } = useSession()
  const myId = (session?.user as { id?: string } | undefined)?.id ?? ""
  // Board-admin (same rule as the boards list + the server PATCH gate) — controls
  // the inline SLA-target editor in Reports. Server still enforces; this only hides.
  const myRole = (session?.user as { role?: string } | undefined)?.role ?? "viewer"
  const canManageBoard = myRole === "admin" || myRole === "superadmin" || myRole === "manager"
  const locale = useLocale()
  // Org task types (active only) for the type filter, the create dialog, and the
  // card color dots. Falls back to the legacy TYPE_ICON glyphs if none load.
  const { types: taskTypes, typeMap: taskTypeMap } = useTaskTypes(true)
  const { types: eventTypes, typeMap: eventTypeMap } = useEventTypes(true)

  const [division, setDivision] = useState<Division | null>(null)
  const [divisions, setDivisions] = useState<Division[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [openTaskId, setOpenTaskId] = useState<string | null>(null) // task open in the detail modal
  const [view, setView] = useState<"board" | "list" | "reports">("board")
  const [reportsReloadKey, setReportsReloadKey] = useState(0)
  const [showAllDone, setShowAllDone] = useState(false) // DONE column expanded in-place (vs navigating away)

  // ── filters (initialised from the URL, then mirrored back to it) ──────────
  const [search, setSearch] = useState(sp.get("q") ?? "")
  const [type, setType] = useState(sp.get("type") ?? "")
  const [priority, setPriority] = useState(sp.get("priority") ?? "")
  const [assignee, setAssignee] = useState(sp.get("assignee") ?? "")
  const [eventType, setEventType] = useState(sp.get("eventType") ?? "")
  const [mine, setMine] = useState(sp.get("mine") === "1")
  const [mineCreated, setMineCreated] = useState(sp.get("created") === "1")

  useEffect(() => {
    // Debounced so typing in the search box writes one history entry, not one
    // per keystroke (filtering itself stays instant — it reads `search` state).
    const id = setTimeout(() => {
      const q = new URLSearchParams()
      if (search) q.set("q", search)
      if (type) q.set("type", type)
      if (priority) q.set("priority", priority)
      if (assignee) q.set("assignee", assignee)
      if (eventType) q.set("eventType", eventType)
      if (mine) q.set("mine", "1")
      if (mineCreated) q.set("created", "1")
      const qs = q.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    }, 300)
    return () => clearTimeout(id)
  }, [search, type, priority, assignee, eventType, mine, mineCreated, pathname, router])

  const loadTasks = useCallback(async () => {
    const res = await fetch(`/api/v1/tasks?divisionId=${encodeURIComponent(divisionId)}&limit=200`, { credentials: "include" })
    if (!res.ok) throw new Error(`Failed to load tasks (${res.status})`)
    const j = await res.json()
    setTasks(j?.data?.tasks ?? [])
  }, [divisionId])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [divRes] = await Promise.all([
        fetch("/api/v1/divisions", { credentials: "include" }),
        loadTasks(),
      ])
      if (divRes.ok) {
        const dj = await divRes.json()
        const list: Division[] = dj?.data?.divisions ?? []
        setDivisions(list)
        setDivision(list.find((d) => d.id === divisionId) ?? null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load board")
    } finally {
      setLoading(false)
    }
  }, [divisionId, loadTasks])

  useEffect(() => { load() }, [load])

  // Light realtime substitute: refetch tasks when the tab regains focus.
  useEffect(() => {
    const onFocus = () => { loadTasks().catch(() => {}) }
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [loadTasks])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return tasks.filter((t2) => {
      if (q && !(`${t2.title}`.toLowerCase().includes(q) || `${t2.taskKey ?? ""}`.toLowerCase().includes(q))) return false
      if (type && t2.type !== type) return false
      if (priority && t2.priority !== priority) return false
      if (assignee && t2.assignee?.id !== assignee) return false
      if (eventType && t2.eventType !== eventType) return false
      if (mine && t2.assignee?.id !== myId && !(t2.collaborators ?? []).some((c) => c.user.id === myId)) return false
      if (mineCreated && t2.creator?.id !== myId) return false
      return true
    })
  }, [tasks, search, type, priority, assignee, eventType, mine, mineCreated, myId])

  // Toolbar assignee-filter options derive from assignees already on this
  // board's tasks, so the board doesn't fetch the whole org user list just to
  // populate a filter (the full list is fetched lazily by the create dialog).
  const assigneeOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const t2 of tasks) if (t2.assignee && !seen.has(t2.assignee.id)) seen.set(t2.assignee.id, t2.assignee.name)
    return Array.from(seen, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [tasks])

  // The board's columns come from board_columns (the custom-columns source of
  // truth), ordered by sortOrder. Legacy fallback (a board with no board_columns
  // yet): all six canonical stages. Each column carries its mapsToStatus (the
  // canonical state written on a move) and a resolved accent.
  const visibleColumns = useMemo<BoardCol[]>(() => {
    const bc = division?.boardColumns
    if (bc && bc.length) {
      return [...bc]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((c) => ({
          key: c.key,
          label: c.label,
          mapsToStatus: c.mapsToStatus,
          accent: c.color || DEFAULT_ACCENT[c.mapsToStatus] || DEFAULT_ACCENT[c.key] || C.sub,
        }))
    }
    // Legacy fallback (a board with no board_columns yet): all six canonical
    // stages. Division.columns is deprecated (Phase 3) and no longer read.
    // Effectively dead — every board is seeded (on create + the 20260602210000
    // backfill); kept only as a defensive default. Do NOT resurrect Division.columns.
    return COLUMNS.map((c) => ({
      key: c.status, label: c.label, mapsToStatus: c.status, accent: c.accent,
    }))
  }, [division])

  // Group tasks into lanes. resolveLaneKey: explicit boardColumnKey if it's a
  // visible column, else fold by status into the nearest visible stage —
  // render-identical to the legacy fold (locked by board-columns.test.ts).
  const byColumn = useMemo(() => {
    const map = new Map<string, Task[]>()
    for (const c of visibleColumns) map.set(c.key, [])
    const laneCols = visibleColumns.map((c) => ({ key: c.key, mapsToStatus: c.mapsToStatus }))
    for (const t2 of filtered) {
      const lane = resolveLaneKey(t2, laneCols)
      if (lane && map.has(lane)) map.get(lane)!.push(t2)
    }
    for (const items of map.values()) {
      items.sort((a, b) => (a.boardPosition ?? 0) - (b.boardPosition ?? 0))
    }
    return map
  }, [filtered, visibleColumns])

  // The DONE lane (the column whose mapsToStatus === "done") gets the windowed view.
  const doneColumnKey = useMemo(() => visibleColumns.find((c) => c.mapsToStatus === "done")?.key ?? null, [visibleColumns])

  // DONE column: by default last 14 days, max 10, newest first; "+N more"
  // expands the column IN PLACE (showAllDone) rather than navigating to /tasks.
  const doneView = useMemo(() => {
    const doneItems = (doneColumnKey ? byColumn.get(doneColumnKey) : null) ?? []
    const sorted = [...doneItems].sort((a, b) => new Date(b.completedAt ?? 0).getTime() - new Date(a.completedAt ?? 0).getTime())
    if (showAllDone) return { shown: sorted, overflow: 0 }
    const cutoff = Date.now() - DONE_WINDOW_DAYS * 86_400_000
    const shown = sorted
      .filter((t2) => (t2.completedAt ? new Date(t2.completedAt).getTime() >= cutoff : true))
      .slice(0, DONE_MAX)
    return { shown, overflow: Math.max(0, doneItems.length - shown.length) }
  }, [byColumn, doneColumnKey, showAllDone])

  const flashToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }, [])

  // Board move: co-write status (canonical = the target column's mapsToStatus)
  // AND boardColumnKey (the lane), optimistically and on the wire.
  async function move(taskId: string, col: BoardCol, boardPosition?: number) {
    const prev = tasks
    setTasks((ts) => ts.map((x) => (x.id === taskId ? {
      ...x,
      status: col.mapsToStatus,
      boardColumnKey: col.key,
      ...(boardPosition !== undefined ? { boardPosition } : {}),
    } : x)))
    try {
      const res = await fetch(`/api/v1/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          status: col.mapsToStatus,
          boardColumnKey: col.key,
          ...(boardPosition !== undefined ? { boardPosition } : {}),
        }),
      })
      if (!res.ok) {
        setTasks(prev) // rollback
        flashToast(res.status === 403 ? t("noPermission") : t("changeFailed"))
      }
    } catch {
      setTasks(prev)
      flashToast(t("networkError"))
    }
  }

  // Generic quick-action PATCH from the card ⋯ menu (priority/type/assignee).
  // Status changes go through move() (which co-writes boardColumnKey). Refetch on
  // success so derived display (assignee name, type color) updates.
  const patchTask = useCallback(async (taskId: string, patch: Record<string, unknown>) => {
    try {
      const res = await fetch(`/api/v1/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(patch),
      })
      if (!res.ok) { flashToast(res.status === 403 ? t("noEditPermission") : t("changeFailed")); return }
      loadTasks().catch(() => {})
    } catch { flashToast(t("networkError")) }
  }, [flashToast, loadTasks, t])

  // ── List view (Bordio-style table of THIS board's tasks) ──────────────────
  // Reuses the same <InlineTasksTable> as /tasks: its own search + Open/Closed
  // grouping + lean default columns. Open/edit reuse the board's task modal
  // (setOpenTaskId); inline field edits reuse patchTask. Custom-field columns
  // aren't shown here (the board fetch doesn't carry customFields).
  const tc = useTranslations("common")
  const tTask = useTranslations("tasks")
  const [listSelected, setListSelected] = useState<Set<string>>(new Set())
  const [listSort, setListSort] = useState("")
  const listStatusLabels: Record<string, string> = {
    backlog: tTask("statusBacklog"), pending: tTask("statusTodo"), todo: tTask("statusTodo"),
    in_progress: tTask("statusInProgress"), completed: tTask("statusCompleted"), cancelled: tTask("statusCancelled"),
    // Boards use the 6 canonical stages — label done/testing/review too so the
    // Status column (and the editor dropdown) shows distinct real words.
    done: tTask("statusCompleted"), testing: tTask("statusTesting"), review: tTask("statusReview"),
  }
  const listPriorityLabels: Record<string, string> = {
    urgent: tTask("priorityUrgent"), high: tTask("priorityHigh"), medium: tTask("priorityMedium"), low: tTask("priorityLow"),
  }
  // Status vocabulary for the list's inline status editor = this board's real
  // columns (mapsToStatus, in column order, deduped) + cancelled (a legitimate
  // terminal state that has no lane). Without this the editor offered only the
  // legacy 4 CRM statuses — a lossy downgrade for backlog/testing/review/done.
  const listStatusOptions = useMemo(() => {
    const seen = new Set<string>()
    const opts: string[] = []
    for (const c of visibleColumns) if (!seen.has(c.mapsToStatus)) { seen.add(c.mapsToStatus); opts.push(c.mapsToStatus) }
    if (!seen.has("cancelled")) opts.push("cancelled")
    return opts
  }, [visibleColumns])
  // Inline edits from the list: a status change must co-write boardColumnKey
  // (resolveLaneKey prefers boardColumnKey, so status alone would leave the
  // card stuck in its old kanban lane).
  const listUpdate = useCallback(async (taskId: string, patch: Record<string, unknown>) => {
    if (typeof patch.status === "string") {
      const col = visibleColumns.find((c) => c.mapsToStatus === patch.status)
      if (col) patch = { ...patch, boardColumnKey: col.key }
    }
    await patchTask(taskId, patch)
  }, [patchTask, visibleColumns])
  const listTasks: InlineTask[] = useMemo(() => tasks.map((x) => ({
    id: x.id, title: x.title, status: x.status, boardColumnKey: x.boardColumnKey ?? null, priority: x.priority,
    type: x.type, eventType: x.eventType, dueDate: x.dueDate,
    assignedTo: x.assignee?.id ?? null, assignee: x.assignee ?? null,
    collaborators: x.collaborators?.map((c) => c.user),
    relatedType: x.category, relatedName: null,
  })), [tasks])
  // List groups = the board's OWN kanban columns (same keys, same labels) so
  // Lövhə and Siyahı never disagree on stages or names. Bucketing reuses
  // resolveLaneKey — the exact lane fold the kanban uses. Cancelled (no lane)
  // is an optional trailing section, shown only when non-empty.
  const listLaneCols = useMemo(() => visibleColumns.map((c) => ({ key: c.key, mapsToStatus: c.mapsToStatus })), [visibleColumns])
  const cancelledLabel = listStatusLabels.cancelled
  const listGroups = useMemo(() => [
    ...visibleColumns.map((c) => ({ key: c.key, label: c.label })),
    { key: "__cancelled__", label: cancelledLabel, optional: true },
  ], [visibleColumns, cancelledLabel])
  const listGroupKeyOf = useCallback((tk: InlineTask) => {
    if (tk.status === "cancelled") return "__cancelled__"
    return resolveLaneKey({ status: tk.status, boardColumnKey: tk.boardColumnKey }, listLaneCols) ?? listLaneCols[0]?.key ?? "__cancelled__"
  }, [listLaneCols])
  const listUsers: InlineUser[] = useMemo(() => assigneeOptions.map((u) => ({ id: u.id, name: u.name })), [assigneeOptions])
  const toggleListSelect = (id: string) => setListSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleListSelectAll = () => setListSelected((p) => (p.size === listTasks.length ? new Set<string>() : new Set(listTasks.map((x) => x.id))))
  const listCreate = useCallback(async (patch: Record<string, unknown>) => {
    try {
      const res = await fetch("/api/v1/tasks", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ ...patch, divisionId }),
      })
      if (!res.ok) { flashToast(res.status === 403 ? t("noEditPermission") : t("changeFailed")); return }
      loadTasks().catch(() => {})
    } catch { flashToast(t("networkError")) }
  }, [divisionId, flashToast, loadTasks, t])
  const listDelete = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/v1/tasks/${id}`, { method: "DELETE", credentials: "include" })
      if (!res.ok) { flashToast(res.status === 403 ? t("noEditPermission") : t("changeFailed")); return }
      loadTasks().catch(() => {})
    } catch { flashToast(t("networkError")) }
  }, [flashToast, loadTasks, t])

  // Lazy assignable-users list for the card ⋯ menu (cached after first open).
  const assignablesRef = useRef<OrgUser[] | null>(null)
  const fetchAssignables = useCallback(async (): Promise<OrgUser[]> => {
    if (assignablesRef.current) return assignablesRef.current
    try {
      const res = await fetch("/api/v1/users/assignable", { credentials: "include" })
      const j = res.ok ? await res.json() : null
      const list = (j?.data ?? []) as OrgUser[]
      assignablesRef.current = list
      return list
    } catch { return [] }
  }, [])

  const boardActions: BoardActions = {
    columns: visibleColumns,
    types: taskTypes,
    eventTypes,
    moveToColumn: move,
    patchTask,
    fetchAssignables,
  }

  // ── dnd-kit drag ──
  // PointerSensor with an 8px activation distance: a plain click (no movement)
  // still falls through to the card's onClick (open); only a >8px drag starts a
  // move. onDragEnd reuses move() (same optimistic + rollback path). DragOverlay
  // renders the lifted card so the drag/drop is animated.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))
  const activeTask = activeId ? tasks.find((x) => x.id === activeId) ?? null : null
  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id))
  }
  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null)
    const { active, over } = e
    const taskId = String(active.id)
    const overId = over ? String(over.id) : null
    // Dropping a card on itself is not a move. Without this the card's own
    // droppable — which dnd-kit measures at the drag ORIGIN — wins nearly every
    // gesture, and the drop resolves to the lane the card is already in.
    if (overId === taskId) return
    const overTask = overId ? tasks.find((task) => task.id === overId) : null
    // A card target means "insert at this exact point"; a column target means
    // append to that lane. This keeps cross-column movement and adds true
    // above/below/between-card ordering.
    const targetKey = overTask
      ? visibleColumns.find((c) => (byColumn.get(c.key) ?? []).some((task) => task.id === overTask.id))?.key ?? null
      : visibleColumns.some((column) => column.key === overId) ? overId : null
    if (!targetKey) return
    const targetCol = visibleColumns.find((c) => c.key === targetKey)
    if (!targetCol) return

    const targetItems = (byColumn.get(targetKey) ?? []).filter((task) => task.id !== taskId)
    let insertAt = targetItems.length
    if (overTask) {
      const overIndex = targetItems.findIndex((task) => task.id === overTask.id)
      if (overIndex >= 0) {
        const activeTop = active.rect.current.translated?.top ?? active.rect.current.initial?.top ?? 0
        const overMiddle = over.rect.top + over.rect.height / 2
        insertAt = overIndex + (activeTop > overMiddle ? 1 : 0)
      }
    }
    const before = targetItems[insertAt - 1]?.boardPosition
    const after = targetItems[insertAt]?.boardPosition
    const position = before === undefined
      ? after === undefined ? 1024 : after - 1024
      : after === undefined ? before + 1024 : (before + after) / 2
    move(taskId, targetCol, position)
  }

  const pill = (active: boolean) => ({
    borderColor: active ? C.primary : C.border,
    background: active ? "#E9F2FF" : C.card,
    color: active ? C.primary : C.text,
  })

  // Access gate: once loaded, if this board isn't in the user's accessible set
  // (the divisions API filters by BoardPermission), `division` stays null → show
  // a denial instead of an empty board. The tasks API is also access-scoped, so
  // this is UX on top of a server-enforced boundary.
  if (!loading && !division) {
    return (
      <div style={{ background: C.page, minHeight: "100%", color: C.text }} className="flex flex-col items-center justify-center gap-2 p-10 text-center">
        <h1 className="text-lg font-semibold">{t("noAccessTitle")}</h1>
        <p className="text-sm" style={{ color: C.sub }}>{t("noAccessHint")}</p>
        <a href="/boards" className="mt-2 rounded px-3 py-1.5 text-sm font-medium text-white" style={{ background: C.primary }}>{t("boardsTitle")}</a>
      </div>
    )
  }

  // A DEPARTMENT renders the aggregate overview (combined board + Reports across
  // its sections), not the single-board Kanban — see DepartmentBoardView.
  if (!loading && division?.isDepartment) {
    return <DepartmentBoardView division={division} />
  }

  return (
    <TaskTypeCtx.Provider value={taskTypeMap}>
    <EventTypeCtx.Provider value={eventTypeMap}>
    <BoardActionsCtx.Provider value={boardActions}>
    {/* force-light: the board chrome is light-locked (C palette), so embedded
        theme-aware components (list table, operational report, task modal)
        must not flip dark inside it — see globals.css .force-light. */}
    <div style={{ background: C.page, minHeight: "100%", color: C.text }} className="force-light flex flex-col">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4 pb-2">
        <div className="flex items-center gap-3">
          <div className="min-w-0">
            <Link href="/boards" className="text-xs font-medium transition-colors hover:underline" style={{ color: C.sub }}>
              {t("boardsTitle")}
            </Link>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2" style={{ color: C.text }}>{division?.name ?? "Board"} <HelpButton slug="board-view" variant="label" /></h1>
              {division?.key && (
                <span
                  className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold"
                  style={{ background: C.card, border: `1px solid ${C.border}`, color: C.sub }}
                >
                  {division.key}
                </span>
              )}
            </div>
          </div>
          {divisions.length > 1 && (
            <select
              value={divisionId}
              onChange={(e) => router.push(`/boards/${e.target.value}`)}
              className="rounded border px-2 py-1 text-xs"
              style={{ borderColor: C.border, background: C.card, color: C.text }}
            >
              {divisions.map((d) => <option key={d.id} value={d.id}>{d.key} — {d.name}</option>)}
            </select>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => loadTasks().catch(() => {})}
            title={t("refresh")}
            className="rounded-md border p-1.5 transition-colors hover:opacity-80"
            style={{ borderColor: C.border, background: C.card, color: C.sub }}
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          {canManageBoard && (
            <Link
              href={`/boards/${divisionId}/settings`}
              title="Configuration"
              aria-label="Configuration"
              className="inline-flex items-center rounded-md border p-1.5 transition-colors hover:opacity-80"
              style={{ borderColor: C.border, background: C.card, color: C.sub }}
            >
              <Settings className="h-4 w-4" />
            </Link>
          )}
          <TaskExportMenu
            params={{ divisionId, type, eventType, priority, assigneeId: mine ? myId : assignee, createdBy: mineCreated ? myId : "", search }}
          />
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90"
            style={{ background: C.primary }}
          >
            <Plus className="h-4 w-4" /> {t("newTask")}
          </button>
        </div>
      </div>

      {/* Board / Reports tab switch */}
      <div className="flex items-center gap-1 px-5 pt-1">
        {(["board", "list", "reports"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className="rounded-t px-3 py-1.5 text-sm font-medium"
            style={view === v
              ? { color: C.primary, borderBottom: `2px solid ${C.primary}` }
              : { color: C.sub, borderBottom: "2px solid transparent" }}
          >
            {v === "board" ? t("boardView") : v === "list" ? tc("list") : t("reportsTab")}
          </button>
        ))}
      </div>

      {view === "board" && (
        <>
      {/* Toolbar (sticky, single row) */}
      <div
        className="sticky top-0 z-10 flex flex-wrap items-center gap-2 px-5 py-2"
        style={{ background: C.page, borderBottom: `1px solid ${C.border}` }}
      >
        <button onClick={() => setMine((v) => !v)} className="inline-flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs" style={pill(mine)}>
          <UserCheck className="h-3.5 w-3.5" /> {t("assignedToMe")}
        </button>
        <button onClick={() => setMineCreated((v) => !v)} className="inline-flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs" style={pill(mineCreated)}>
          <PenLine className="h-3.5 w-3.5" /> {t("createdByMe")}
        </button>
        <div className="flex items-center rounded border px-2" style={{ borderColor: C.border, background: C.card }}>
          <Search className="h-3.5 w-3.5" style={{ color: C.sub }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("search")}
            className="bg-transparent px-2 py-1.5 text-xs outline-none"
          />
        </div>
        <select value={type} onChange={(e) => setType(e.target.value)} className="rounded border px-2 py-1.5 text-xs" style={{ borderColor: C.border, background: C.card, color: C.text }}>
          <option value="">{t("type")}</option>
          {taskTypes.map((tt) => <option key={tt.id} value={tt.name}>{tt.displayName}</option>)}
        </select>
        <select value={eventType} onChange={(e) => setEventType(e.target.value)} className="rounded border px-2 py-1.5 text-xs" style={{ borderColor: C.border, background: C.card, color: C.text }}>
          <option value="">{t("event")}</option>
          {eventTypes.map((et) => <option key={et.id} value={et.name}>{et.displayName}</option>)}
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value)} className="rounded border px-2 py-1.5 text-xs" style={{ borderColor: C.border, background: C.card, color: C.text }}>
          <option value="">{t("priority")}</option>
          {PRIORITIES.map((x) => <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</option>)}
        </select>
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="rounded border px-2 py-1.5 text-xs" style={{ borderColor: C.border, background: C.card, color: C.text }}>
          <option value="">{t("assignee")}</option>
          {assigneeOptions.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </div>

      {error && <div className="px-5 py-3 text-sm" style={{ color: C.red }}>{error}</div>}
      {loading && (
        <div className="flex items-center gap-2 px-5 py-3 text-sm" style={{ color: C.sub }}>
          <Loader2 className="h-4 w-4 animate-spin" /> {t("loading")}
        </div>
      )}

      {/* Columns */}
      <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex flex-1 gap-3 overflow-x-auto px-5 py-3">
          {visibleColumns.map((col) => {
            const colItems = byColumn.get(col.key) ?? []
            const isDone = col.key === doneColumnKey
            const items = isDone ? doneView.shown : colItems
            const count = colItems.length
            return (
              <DroppableColumn key={col.key} col={col} count={count}>
                {items.map((t2) => (
                  <DraggableCard key={t2.id} task={t2} locale={locale} onOpen={() => setOpenTaskId(t2.id)} />
                ))}
                {isDone && (doneView.overflow > 0 || showAllDone) && (
                  <button
                    type="button"
                    onClick={() => setShowAllDone((v) => !v)}
                    className="rounded-md border border-dashed px-3 py-3 text-center text-xs"
                    style={{ borderColor: C.border, color: C.sub, background: C.card }}
                  >
                    {showAllDone ? t("doneShowLess") : t("doneOverflow", { count: doneView.overflow })}
                  </button>
                )}
              </DroppableColumn>
            )
          })}
        </div>
        {/* lifted copy that follows the cursor + animates the drop settle */}
        <DragOverlay dropAnimation={{ duration: 200, easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)" }}>
          {activeTask ? <Card task={activeTask} locale={locale} overlay /> : null}
        </DragOverlay>
      </DndContext>
        </>
      )}

      {view === "list" && (
        <div className="px-5 pb-8 pt-3">
          <InlineTasksTable
            tasks={listTasks}
            customGroups={listGroups}
            groupKeyOf={listGroupKeyOf}
            selectedIds={listSelected}
            onToggleSelect={toggleListSelect}
            onToggleSelectAll={toggleListSelectAll}
            onUpdate={listUpdate}
            onCreate={listCreate}
            onDelete={listDelete}
            onEdit={(task) => setOpenTaskId(task.id)}
            onOpenDetail={(id) => setOpenTaskId(id)}
            statusOptions={listStatusOptions}
            statusLabels={listStatusLabels}
            priorityLabels={listPriorityLabels}
            customFieldDefs={[]}
            users={listUsers}
            categoryColumnLabel={tc("quarter")}
            sortBy={listSort}
            onSortChange={setListSort}
          />
        </div>
      )}

      {view === "reports" && (
        <>
          <BoardReports divisionId={divisionId} assignees={assigneeOptions} onOpenTask={setOpenTaskId} reloadKey={reportsReloadKey} canEditSla={canManageBoard} />
          {/* Per-board operational report — locked to THIS board so it shows only
              this board's tasks (isolated; the global cross-board page was removed). */}
          <div className="px-5 pb-10 pt-2">
            <h2 className="mb-3 text-base font-semibold" style={{ color: C.text }}>
              {tTask("opTitle")}{division?.key ? ` — ${division.key}` : ""}
            </h2>
            <OperationalReport lockedDivisionId={divisionId} />
          </div>
        </>
      )}

      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 rounded px-4 py-2 text-sm text-white shadow-lg" style={{ background: C.text }}>
          {toast}
        </div>
      )}

      {showCreate && division && (
        <CreateTaskDialog
          divisionId={divisionId}
          taskTypes={taskTypes}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); loadTasks().catch(() => {}) }}
        />
      )}

      {/* Task detail modal — Jira-style: clicking a card opens the full task
          detail/edit UI (shared <TaskDetailView>) over the board. Closing
          refetches so edits (status, title, assignee, delete) reflect on the board. */}
      {openTaskId && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-6"
          onClick={() => { setOpenTaskId(null); loadTasks().catch(() => {}); setReportsReloadKey((k) => k + 1) }}
        >
          <div
            className="relative my-4 w-full max-w-5xl rounded-lg shadow-xl"
            style={{ background: C.card }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => { setOpenTaskId(null); loadTasks().catch(() => {}); setReportsReloadKey((k) => k + 1) }}
              aria-label={t("cancel")}
              className="absolute right-3 top-3 z-10 rounded p-1.5 hover:bg-black/5"
              style={{ color: C.sub }}
            >
              <X className="h-5 w-5" />
            </button>
            <div className="max-h-[88vh] overflow-y-auto p-5 sm:p-6">
              <TaskDetailView
                taskIdProp={openTaskId}
                modal
                boardColumns={visibleColumns.map((c) => ({ key: c.mapsToStatus, label: c.label, columnKey: c.key }))}
                onClose={() => { setOpenTaskId(null); loadTasks().catch(() => {}); setReportsReloadKey((k) => k + 1) }}
                onMutated={() => loadTasks().catch(() => {})}
              />
            </div>
          </div>
        </div>
      )}
    </div>
    </BoardActionsCtx.Provider>
    </EventTypeCtx.Provider>
    </TaskTypeCtx.Provider>
  )
}

// Droppable column (dnd-kit): the whole column is the drop zone; it highlights
// (darker bg + accent dashed outline) while a card hovers over it.
function DroppableColumn({ col, count, children }: { col: BoardCol; count: number; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: col.key })
  return (
    <div
      ref={setNodeRef}
      className="flex w-72 shrink-0 flex-col rounded-lg transition-colors"
      style={{ background: isOver ? "#E9EBEE" : C.colBg, borderTop: `3px solid ${col.accent}`, outline: isOver ? `2px dashed ${col.accent}` : "none" }}
    >
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold tracking-wide" style={{ color: C.sub }}>{col.label}</span>
          <span className="rounded-full px-1.5 text-[11px]" style={{ background: C.border, color: C.sub }}>{count}</span>
        </div>
        <MoreHorizontal className="h-4 w-4" style={{ color: C.sub }} />
      </div>
      <div className="flex min-h-[60px] flex-1 flex-col gap-2 px-2 pb-3">{children}</div>
    </div>
  )
}

// Draggable wrapper (dnd-kit): holds the interactive role/click/keyboard so a
// click opens the card and a >8px drag moves it. The visual is <Card>; while
// dragging the source dims (the DragOverlay renders the lifted copy).
function DraggableCard({ task, locale, onOpen }: { task: Task; locale: string; onOpen: () => void }) {
  const draggable = useDraggable({ id: task.id })
  const droppable = useDroppable({ id: task.id })
  const setNodeRef = useCallback((node: HTMLDivElement | null) => {
    draggable.setNodeRef(node)
    droppable.setNodeRef(node)
  }, [draggable, droppable])
  return (
    <div
      ref={setNodeRef}
      {...draggable.attributes}
      {...draggable.listeners}
      role="button"
      tabIndex={0}
      aria-label={task.title}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen() } }}
      className="cursor-grab rounded-md transition-shadow hover:shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-[#EA580C] focus-visible:ring-offset-1 active:cursor-grabbing"
      style={{
        opacity: draggable.isDragging ? 0.4 : 1,
        transform: CSS.Transform.toString(draggable.transform),
        outline: droppable.isOver ? `2px solid ${C.primary}` : "none",
        outlineOffset: droppable.isOver ? 2 : 0,
      }}
    >
      <Card task={task} locale={locale} />
    </div>
  )
}

// Presentational card. `overlay` = rendered inside <DragOverlay> (tilted + lifted).
function Card({ task, locale, overlay }: { task: Task; locale: string; overlay?: boolean }) {
  // Resolve the type's configured color/label; keep the legacy glyph for the
  // built-in 5 (tinted by config), use a color dot for custom types.
  const typeMap = useContext(TaskTypeCtx)
  const typeInfo = task.type ? typeMap.get(task.type) : undefined
  const legacyType = task.type ? TYPE_ICON[task.type] : undefined
  const typeColor = typeInfo?.color ?? legacyType?.color ?? C.sub
  const typeTitle = typeInfo?.displayName ?? (task.type ? task.type[0].toUpperCase() + task.type.slice(1) : "")
  // Event-type (channel/source) — a second color dot when set.
  const eventMap = useContext(EventTypeCtx)
  const eventInfo = task.eventType ? eventMap.get(task.eventType) : undefined
  const pr = PRIORITY_ICON[task.priority] ?? PRIORITY_ICON.medium
  const featured = !!task.category && /^Q[1-4]$/.test(task.category)
  // Checklist-completion progress bar — shown on any card with checklist items
  // (the list API returns task.checklist). Progress = checked / total.
  const clTotal = task.checklist?.length ?? 0
  const clDone = task.checklist?.filter((c) => c.completed).length ?? 0
  const progress = clTotal > 0 ? Math.round((clDone / clTotal) * 100) : 0
  return (
    <div
      className={`relative rounded-md p-3 shadow-sm transition-shadow${overlay ? " rotate-2 cursor-grabbing shadow-xl" : ""}`}
      style={{ background: C.card, border: `1px solid ${C.border}`, ...(featured ? { borderColor: C.amber, background: "#FFFBF5" } : {}) }}
    >
      {!overlay && (
        <div className="absolute right-1 top-1 z-10">
          <CardQuickMenu
            taskId={task.id}
            currentStatus={task.status}
            currentType={task.type}
            currentEventType={task.eventType}
            currentPriority={task.priority}
            currentAssigneeId={task.assignee?.id}
          />
        </div>
      )}
      {featured && (
        <span className="mb-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{ background: C.amber }}>
          {task.category}
        </span>
      )}
      <div className="text-sm leading-snug pr-5" style={{ color: C.text, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
        {task.title}
      </div>
      {/* A task born from a call says what to do but not for whom; the customer
          is the first thing the salesperson needs and it was a click away in a
          modal. The number stays in the lead card, where access to it is
          governed — a board is not the place to publish a phone. */}
      {task.relatedName && (
        <div className="mt-1 truncate text-xs" style={{ color: C.sub }} title={task.relatedName}>
          {task.relatedName}
        </div>
      )}
      <div className="mt-2 flex items-center gap-1.5 text-[11px]" style={{ color: C.sub }}>
        <span className="inline-flex items-center" title={typeTitle} aria-label={typeTitle}>
          {legacyType
            ? <legacyType.Icon className="h-3.5 w-3.5" style={{ color: typeColor }} />
            : <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: typeColor }} />}
        </span>
        {eventInfo && (
          <span className="inline-block h-2.5 w-2.5 rounded-full" title={eventInfo.displayName} aria-label={eventInfo.displayName} style={{ background: eventInfo.color }} />
        )}
        <span className="font-medium">{task.taskKey ?? "—"}</span>
        <pr.Icon className="h-3.5 w-3.5" style={{ color: pr.color }} />
        {task.dueDate && (
          <span className="inline-flex items-center gap-0.5">
            <Clock className="h-3 w-3" /> {fmtDate(task.dueDate, locale)}
          </span>
        )}
        <span className="ml-auto" />
        {task.assignee && (
          task.assignee.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={task.assignee.avatar} alt={task.assignee.name} title={task.assignee.name} className="h-[22px] w-[22px] rounded-full object-cover" />
          ) : (
            <span
              className="flex h-[22px] w-[22px] items-center justify-center rounded-full text-[10px] font-semibold text-white"
              style={{ background: C.primary }}
              title={task.assignee.name}
            >
              {initials(task.assignee.name)}
            </span>
          )
        )}
      </div>
      {clTotal > 0 && (
        <div className="mt-2 flex items-center gap-2" title={`${clDone}/${clTotal}`}>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: C.border }}>
            <div className="h-full rounded-full" style={{ width: `${progress}%`, background: C.amber }} />
          </div>
          <span className="text-[10px] font-semibold" style={{ color: C.amber }}>{progress}%</span>
        </div>
      )}
    </div>
  )
}

function CreateTaskDialog({
  divisionId, taskTypes, onClose, onCreated,
}: {
  divisionId: string
  taskTypes: TaskTypeDTO[]
  onClose: () => void
  onCreated: () => void
}) {
  const t = useTranslations("board")
  // Lazy: the full org user list is only fetched when this dialog opens.
  const [users, setUsers] = useState<OrgUser[]>([])
  useEffect(() => {
    let alive = true
    fetch("/api/v1/users/assignable", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && j) setUsers(j.data ?? []) })
      .catch(() => {})
    return () => { alive = false }
  }, [])
  const [title, setTitle] = useState("")
  const [type, setType] = useState<string>(taskTypes[0]?.name ?? "task")
  const [priority, setPriority] = useState<string>("medium")
  const [category, setCategory] = useState<string>("")
  const [assignedTo, setAssignedTo] = useState<string>("")
  const [dueDate, setDueDate] = useState<string>("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Spec: the board "New Task" dialog enforces title 3..200 client-side.
  const valid = title.trim().length >= 3 && title.trim().length <= 200

  async function submit() {
    if (!valid || saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/v1/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          title: title.trim(),
          divisionId,
          status: "backlog",
          type,
          priority,
          ...(category ? { category } : {}),
          ...(assignedTo ? { assignedTo } : {}),
          ...(dueDate ? { dueDate: new Date(dueDate).toISOString() } : {}),
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j?.message || j?.error || t("changeFailed"))
        return
      }
      onCreated()
    } catch {
      setError(t("networkError"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="mx-4 w-full max-w-md rounded-lg p-6 shadow-xl" style={{ background: C.card, color: C.text }} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{t("newTask")}</h2>
          <button onClick={onClose} style={{ color: C.sub }}><X className="h-5 w-5" /></button>
        </div>

        <label className="mb-1 block text-sm font-medium">{t("titleLabel")}</label>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          placeholder={t("titlePlaceholder")}
          className="mb-3 w-full rounded-md border px-3 py-2 text-sm outline-none"
          style={{ borderColor: C.border }}
        />

        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium">{t("type")}</label>
            <select value={type} onChange={(e) => setType(e.target.value)} className="w-full rounded-md border px-2 py-2 text-sm" style={{ borderColor: C.border, background: C.card }}>
              {taskTypes.map((tt) => <option key={tt.id} value={tt.name}>{tt.displayName}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">{t("priority")}</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value)} className="w-full rounded-md border px-2 py-2 text-sm" style={{ borderColor: C.border, background: C.card }}>
              {PRIORITIES.map((x) => <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</option>)}
            </select>
          </div>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium">{t("assignee")}</label>
            <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className="w-full rounded-md border px-2 py-2 text-sm" style={{ borderColor: C.border, background: C.card }}>
              <option value="">—</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">{t("category")}</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full rounded-md border px-2 py-2 text-sm" style={{ borderColor: C.border, background: C.card }}>
              <option value="">—</option>
              {CATEGORIES.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </div>
        </div>

        <label className="mb-1 block text-sm font-medium">{t("dueDate")}</label>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="mb-4 w-full rounded-md border px-3 py-2 text-sm outline-none"
          style={{ borderColor: C.border }}
        />

        {error && <p className="mb-3 text-sm" style={{ color: C.red }}>{error}</p>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: C.border }}>{t("cancel")}</button>
          <button
            onClick={submit}
            disabled={!valid || saving}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            style={{ background: C.primary }}
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? t("creating") : t("create")}
          </button>
        </div>
      </div>
    </div>
  )
}
