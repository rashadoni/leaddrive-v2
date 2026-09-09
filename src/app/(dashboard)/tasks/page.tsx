"use client"

import { useEffect, useState, useCallback, useMemo, useRef } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useSession } from "next-auth/react"
import { useLocale, useTranslations } from "next-intl"
import { formatDate as formatDateLocale } from "@/lib/format-date"
import { Button } from "@/components/ui/button"
import { InlineTasksTable, type CustomFieldDef, type InlineUser, type InlineProject } from "@/components/tasks/inline-tasks-table"
import { isClosedStatus } from "@/lib/tasks/status"
import { EntityBulkBar } from "@/components/entity-bulk-bar"
import { CustomFieldFilterBar } from "@/components/tasks/custom-field-filter-bar"
import { SavedViewBar, type SavedView } from "@/components/saved-view-bar"
import { TaskExportMenu } from "@/components/tasks/task-export-menu"
import { toast } from "sonner"
import { ColorStatCard } from "@/components/color-stat-card"
import { InfoHint } from "@/components/info-hint"
import { DidYouKnow } from "@/components/did-you-know"
import { TaskForm } from "@/components/task-form"
import { Select } from "@/components/ui/select"
import { CheckSquare, Plus, Clock, AlertTriangle, Pencil, Trash2, CalendarDays, ListChecks, ChevronLeft, ChevronRight, Link2, Copy, Check, ExternalLink, Columns3, User2, CheckCircle2, ChevronsUp, ChevronUp, ChevronDown, Equal, X } from "lucide-react"
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
import { cn } from "@/lib/utils"
import { MotionList, MotionItem } from "@/components/ui/motion"

interface Task {
  id: string
  title: string
  status: string
  priority: string
  dueDate: string | null
  assignedTo: string | null
  assignee?: { id: string; name: string; avatar?: string | null } | null
  collaborators?: { user: { id: string; name: string; avatar?: string | null } }[]
  creator?: { id: string; name: string } | null
  relatedType: string | null
  relatedName?: string | null
  projectId?: string | null
  project?: { id: string; name: string; color?: string | null } | null
  customFields?: Record<string, unknown> | null
  category?: string | null
  type?: string | null
  eventType?: string | null
  completedAt: string | null
  createdAt: string
  checklist?: { completed: boolean }[]
  _count?: { checklist: number; comments: number }
}

type ViewMode = "list" | "kanban" | "calendar"

const categoryIcons: Record<string, string> = {
  call: "📞",
  email: "📧",
  meeting: "🤝",
  deal: "💰",
  contact: "👤",
  company: "🏢",
  lead: "🎯",
  ticket: "🎫",
}

// ─── Atlassian-style 6-column Kanban (matches the design screenshot) ──────────
const KB = {
  text: "#172B4D", sub: "#6B778C", border: "#DFE1E6", colBg: "#F1F2F4",
  primary: "#EA580C", green: "#00875A", red: "#DE350B", amber: "#FF8B00",
}
// Four columns (BACKLOG/TO DO/IN PROGRESS/DONE) so the board fits on screen.
// Existing CRM tasks use pending/todo/in_progress/completed. Tasks that happen
// to carry the board-only "testing"/"review" statuses are folded into IN
// PROGRESS so they never vanish. Dropping onto DONE writes "completed" — the
// status the rest of the app (stats, toggle, rollup) already treats as done.
const KB_COLS: { key: string; label: string; accent: string; statuses: string[]; drop: string }[] = [
  { key: "backlog",     label: "BACKLOG",     accent: "#C1C7D0", statuses: ["backlog"],                          drop: "backlog" },
  { key: "todo",        label: "TO DO",       accent: "#C1C7D0", statuses: ["pending", "todo"],                  drop: "pending" },
  { key: "in_progress", label: "IN PROGRESS", accent: "#EA580C", statuses: ["in_progress", "testing", "review"], drop: "in_progress" },
  { key: "done",        label: "DONE",        accent: "#00875A", statuses: ["completed", "done"],                drop: "completed" },
]
const KB_PRIORITY: Record<string, { Icon: typeof ChevronUp; color: string }> = {
  critical: { Icon: ChevronsUp, color: "#DE350B" },
  urgent:   { Icon: ChevronsUp, color: "#DE350B" },
  high:     { Icon: ChevronUp,  color: "#DE350B" },
  medium:   { Icon: Equal,      color: "#FF8B00" },
  low:      { Icon: ChevronDown, color: "#EA580C" },
}

// One canonical status pill per kanban-stage family (mirrors KB_COLS'
// statuses). The summary chips' COUNTS, the client-side list FILTER and the
// export status param must all fold through this same map — otherwise a task
// in `done`/`testing`/`review` is counted under no chip while a chip click
// silently drops it (architect P3, deferred_findings 2026-06-10).
const STATUS_PILL_BUCKETS: Record<string, string[]> = {
  backlog: ["backlog"],
  pending: ["pending", "todo"],
  in_progress: ["in_progress", "testing", "review"],
  completed: ["completed", "done"],
  cancelled: ["cancelled"],
}
function pillOf(status: string): string {
  for (const pill of Object.keys(STATUS_PILL_BUCKETS)) {
    if (STATUS_PILL_BUCKETS[pill].includes(status)) return pill
  }
  return status
}

function isOverdue(dueDate: string | null): boolean {
  if (!dueDate) return false
  // Date-granular overdue (kept in sync with inline-tasks-table's
  // isOverdueDate): a task due TODAY is not overdue yet — red rows, the
  // "Overdue" stat and kanban date color all flip only after the day passes.
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  return new Date(dueDate) < startOfToday
}

function formatDate(dateStr: string | null, locale: string): string {
  if (!dateStr) return "—"
  return formatDateLocale(dateStr, locale, { day: "2-digit", month: "short", year: "numeric" })
}

function isToday(dateStr: string | null): boolean {
  if (!dateStr) return false
  const d = new Date(dateStr)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}

function isTodayDate(year: number, month: number, day: number): boolean {
  const now = new Date()
  return now.getFullYear() === year && now.getMonth() === month && now.getDate() === day
}

function isThisWeek(dateStr: string | null): boolean {
  if (!dateStr) return false
  const d = new Date(dateStr)
  const now = new Date()
  const startOfWeek = new Date(now)
  startOfWeek.setDate(now.getDate() - now.getDay())
  startOfWeek.setHours(0, 0, 0, 0)
  const endOfWeek = new Date(startOfWeek)
  endOfWeek.setDate(startOfWeek.getDate() + 7)
  return d >= startOfWeek && d < endOfWeek
}

// ─── Calendar Integration Modal ─────────────────────────────────
function CalendarIntegrationModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("tasks")
  const [token, setToken] = useState<string | null>(null)
  const [feedUrl, setFeedUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (open) {
      fetch("/api/v1/calendar/token").then(r => r.json()).then(j => {
        if (j.success) {
          setToken(j.data.token)
          setFeedUrl(j.data.feedUrl)
        }
      }).catch(() => {})
    }
  }, [open])

  async function generateToken() {
    setLoading(true)
    try {
      const res = await fetch("/api/v1/calendar/generate-token", { method: "POST" })
      const json = await res.json()
      if (json.success) {
        setToken(json.data.token)
        setFeedUrl(json.data.feedUrl)
      }
    } catch (err) { console.error(err) } finally { setLoading(false) }
  }

  async function copyUrl() {
    if (!feedUrl) return
    try {
      await navigator.clipboard.writeText(feedUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) { console.error(err) }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-background rounded-lg shadow-xl w-full max-w-lg mx-4 p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Link2 className="h-5 w-5" /> {t("connectCalendar")}
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl">&times;</button>
        </div>

        <p className="text-sm text-muted-foreground mb-4">
          {t("calendarSubscribeDesc")}
        </p>

        {feedUrl ? (
          <>
            <div className="mb-4">
              <label className="text-sm font-medium mb-1 block">{t("calendarLinkLabel")}</label>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={feedUrl}
                  className="flex-1 text-xs bg-muted px-3 py-2 rounded-md border font-mono truncate"
                />
                <Button size="sm" variant="outline" onClick={copyUrl}>
                  {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div className="space-y-3 mb-4">
              <h3 className="text-sm font-semibold">{t("calendarInstructions")}:</h3>
              <div className="space-y-2 text-sm text-muted-foreground">
                <div className="flex gap-2">
                  <span className="font-medium text-foreground min-w-[120px]">{t("appleCalendar")}</span>
                  <span>{t("appleCalendarInstr")}</span>
                </div>
                <div className="flex gap-2">
                  <span className="font-medium text-foreground min-w-[120px]">{t("googleCalendar")}</span>
                  <span>{t("googleCalendarInstr")}</span>
                </div>
                <div className="flex gap-2">
                  <span className="font-medium text-foreground min-w-[120px]">{t("outlookCalendar")}</span>
                  <span>{t("outlookCalendarInstr")}</span>
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <a
                href={feedUrl.replace("https://", "webcal://").replace("http://", "webcal://")}
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" /> {t("calendarOpenInApp")}
              </a>
              <span className="text-muted-foreground">·</span>
              <button onClick={generateToken} disabled={loading} className="text-sm text-muted-foreground hover:text-foreground">
                {t("calendarGenerateNew")}
              </button>
            </div>

            <div className="mt-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-md text-xs text-yellow-700 dark:text-yellow-300">
              {t("calendarWarning")}
            </div>
          </>
        ) : (
          <div className="text-center py-6">
            <p className="text-sm text-muted-foreground mb-4">{t("calendarNoLink")}</p>
            <Button onClick={generateToken} disabled={loading}>
              {loading ? t("calendarGenerating") : t("calendarGenerateBtn")}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Calendar Grid Component ────────────────────────────────────
function TaskCalendar({
  tasks, orgId, onTaskClick, onCreateOnDate, onMoveToDate,
}: {
  tasks: Task[]
  orgId?: string
  onTaskClick?: (id: string) => void
  // #23a — click an empty cell area (not a chip) → open create form prefilled with this date
  onCreateOnDate?: (year: number, month: number, day: number) => void
  // #23b — drop a task chip onto another day → parent PATCHes dueDate via optimistic update
  onMoveToDate?: (taskId: string, year: number, month: number, day: number) => void
}) {
  const t = useTranslations("tasks")
  const tc = useTranslations("common")
  const now = new Date()
  const [calMonth, setCalMonth] = useState(now.getMonth())
  const [calYear, setCalYear] = useState(now.getFullYear())
  // #23b: highlight the day currently being hovered while dragging
  const [dragOverDay, setDragOverDay] = useState<number | null>(null)

  // Calendar #23a/b cleanup: use parent's `tasks` prop directly instead of a
  // separate /api/v1/tasks/calendar fetch. The parent already fetches all
  // tasks (limit=200) and updates the array optimistically on inline edits,
  // so drag-drop + create both reflect instantly without a stale-data refetch.
  // Filter client-side to the visible month.
  //
  // KNOWN LIMITATION (v1, document for future fix):
  //   Parent fetches limit=200 (hard cap in tasks API). Tenants with >200
  //   tasks see a truncated calendar — tasks beyond the limit don't appear
  //   in any month. Acceptable until we hit that scale; then either page
  //   the parent fetch OR reintroduce a per-month endpoint (with optimistic
  //   delta layer to preserve the drag-drop UX from #23b).
  const calTasks = useMemo(
    () => tasks.filter(t => {
      if (!t.dueDate) return false
      const d = new Date(t.dueDate)
      return d.getMonth() === calMonth && d.getFullYear() === calYear
    }),
    [tasks, calMonth, calYear]
  )

  const monthNames = [
    t("monthJan"), t("monthFeb"), t("monthMar"), t("monthApr"), t("monthMay"), t("monthJun"),
    t("monthJul"), t("monthAug"), t("monthSep"), t("monthOct"), t("monthNov"), t("monthDec")
  ]

  const dayNames = [t("dayMon"), t("dayTue"), t("dayWed"), t("dayThu"), t("dayFri"), t("daySat"), t("daySun")]

  const priorityLabels: Record<string, string> = {
    urgent: t("priorityUrgent"),
    high: t("priorityHigh"),
    medium: t("priorityMedium"),
    low: t("priorityLow"),
  }

  // Calendar data now derives from parent's `tasks` prop (see useMemo above)
  // — drops the separate /api/v1/tasks/calendar fetch entirely so drag-drop
  // + create reflect instantly via parent's optimistic state.

  function prevMonth() {
    if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1) }
    else setCalMonth(m => m - 1)
  }

  function nextMonth() {
    if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1) }
    else setCalMonth(m => m + 1)
  }

  const tasksByDay: Record<number, Task[]> = {}
  for (const task of calTasks) {
    if (!task.dueDate) continue
    const d = new Date(task.dueDate)
    const day = d.getDate()
    if (!tasksByDay[day]) tasksByDay[day] = []
    tasksByDay[day].push(task)
  }

  const firstDay = new Date(calYear, calMonth, 1)
  let startDow = firstDay.getDay() - 1
  if (startDow < 0) startDow = 6
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate()

  const cells: (number | null)[] = []
  for (let i = 0; i < startDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <Button variant="outline" size="sm" onClick={prevMonth}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-3">
          <h3 className="font-semibold text-lg">
            {monthNames[calMonth]} {calYear}
          </h3>
          <Button variant="outline" size="sm" onClick={() => { setCalMonth(now.getMonth()); setCalYear(now.getFullYear()) }}>
            {tc("today") || "Today"}
          </Button>
        </div>
        <Button variant="outline" size="sm" onClick={nextMonth}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-px bg-muted rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-700">
        {dayNames.map(d => (
          <div key={d} className="bg-muted py-2 text-center text-xs font-semibold text-muted-foreground">
            {d}
          </div>
        ))}
        {cells.map((day, i) => (
          <div
            key={i}
            // #23a: click on cell background (not chip) opens create form prefilled with this date.
            // Chips below stopPropagation so chip-click doesn't trigger this.
            onClick={day ? () => onCreateOnDate?.(calYear, calMonth, day) : undefined}
            // #23b: accept drops of task chips. preventDefault on dragover allows the drop.
            onDragOver={day && onMoveToDate ? (e) => { e.preventDefault(); setDragOverDay(day) } : undefined}
            onDragLeave={day && onMoveToDate ? () => setDragOverDay(d => d === day ? null : d) : undefined}
            onDrop={day && onMoveToDate ? (e) => {
              e.preventDefault()
              setDragOverDay(null)
              const taskId = e.dataTransfer.getData("text/plain")
              if (taskId) onMoveToDate(taskId, calYear, calMonth, day)
            } : undefined}
            className={cn(
              "bg-background min-h-[100px] p-1.5 transition-colors",
              day === null && "bg-muted/30",
              day && "cursor-pointer hover:bg-muted/40",
              day && isTodayDate(calYear, calMonth, day) && "ring-2 ring-inset ring-primary/50 bg-primary/5",
              day && dragOverDay === day && "ring-2 ring-inset ring-primary bg-primary/10"
            )}
            title={day ? t("calendarClickToCreate") : undefined}
          >
            {day && (
              <>
                <div className={cn(
                  "text-xs font-medium mb-1",
                  isTodayDate(calYear, calMonth, day) && "text-primary font-bold"
                )}>
                  {day}
                </div>
                <div className="space-y-0.5">
                  {(tasksByDay[day] || []).slice(0, 3).map(task => (
                    <div
                      key={task.id}
                      // #23b: drag source. dataTransfer carries the task id.
                      draggable
                      onDragStart={(e) => { e.dataTransfer.setData("text/plain", task.id); e.dataTransfer.effectAllowed = "move" }}
                      // stopPropagation so chip-click doesn't also fire the cell's create handler
                      onClick={(e) => { e.stopPropagation(); onTaskClick?.(task.id) }}
                      className={cn(
                        "text-[10px] leading-tight px-1 py-0.5 rounded truncate cursor-pointer hover:opacity-80 transition-opacity",
                        task.status === "completed" || task.status === "done"
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          : task.priority === "high" || task.priority === "urgent"
                            ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                            : "bg-muted text-foreground/70"
                      )}
                      title={`${task.title} — ${priorityLabels[task.priority] || task.priority} (drag to reschedule)`}
                    >
                      {categoryIcons[task.relatedType || ""] || ""} {task.title}
                    </div>
                  ))}
                  {(tasksByDay[day] || []).length > 3 && (
                    <div className="text-[10px] text-muted-foreground text-center">
                      +{(tasksByDay[day] || []).length - 3}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Bulk Actions Bar (uses shared EntityBulkBar shell — Roadmap #19) ──
// The visual chrome (count badge, primary-tinted bg, clear X) lives in
// EntityBulkBar so every entity's bulk bar looks identical. This wrapper
// supplies tasks-specific action buttons + the custom-field-set popover.
function BulkActionsBar({ selectedIds, onAction, onClear, customFieldDefs }: {
  selectedIds: Set<string>
  onAction: (action: string, value?: string, extra?: { fieldName: string; fieldValue: unknown }) => void
  onClear: () => void
  customFieldDefs: CustomFieldDef[]
}) {
  const t = useTranslations("tasks")
  const tc = useTranslations("common")
  const [setFieldOpen, setSetFieldOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close popover on outside click
  useEffect(() => {
    if (!setFieldOpen) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setSetFieldOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [setFieldOpen])

  // Only select-type custom fields make sense for bulk-set in v1
  const bulkable = customFieldDefs.filter(d => d.isActive && d.fieldType === "select")

  return (
    <EntityBulkBar
      selectedCount={selectedIds.size}
      onClearSelection={onClear}
      countLabel={`${selectedIds.size} ${t("selected")}`}
    >
      <Button size="sm" variant="outline" onClick={() => onAction("complete")}>
        <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> {t("markComplete")}
      </Button>

      {/* Bulk-set custom field (Roadmap #8). Hidden when no select-type defs exist. */}
      {bulkable.length > 0 && (
        <div ref={containerRef} className="relative">
          <Button size="sm" variant="outline" onClick={() => setSetFieldOpen(o => !o)}>
            {t("inlineSetCustomFieldButton")}
          </Button>
          {setFieldOpen && (
            <div className="absolute z-50 mt-1 min-w-[220px] rounded-lg border border-zinc-200 dark:border-zinc-700 bg-popover shadow-md py-1 max-h-[400px] overflow-y-auto">
              {bulkable.map(def => (
                <div key={def.id} className="px-2 py-1.5">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-1 mb-0.5">
                    {def.fieldLabel}
                  </div>
                  {(def.options || []).map(opt => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => {
                        setSetFieldOpen(false)
                        onAction("update_custom_field", undefined, { fieldName: def.fieldName, fieldValue: opt })
                      }}
                      className="w-full text-left px-2 py-1 text-xs hover:bg-muted transition-colors rounded"
                    >
                      {opt}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      setSetFieldOpen(false)
                      onAction("update_custom_field", undefined, { fieldName: def.fieldName, fieldValue: null })
                    }}
                    className="w-full text-left px-2 py-1 text-xs italic text-muted-foreground hover:bg-muted transition-colors rounded"
                  >
                    {t("inlineClearValue")}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <Button size="sm" variant="outline" onClick={() => onAction("delete")} className="text-red-600 hover:text-red-700">
        <Trash2 className="h-3.5 w-3.5 mr-1" /> {tc("delete")}
      </Button>
    </EntityBulkBar>
  )
}

// ─── Main Page ──────────────────────────────────────────────────
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"

export default function TasksPage() {
  const t = useTranslations("tasks")
  const tc = useTranslations("common")
  const locale = useLocale()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data: session } = useSession()
  const [tasks, setTasks] = useState<Task[]>([])
  useAutoTour("tasks")
  // Default to the grouped table view (Bordio-style Open/Closed); Kanban stays one click away.
  const [view, setView] = useState<ViewMode>("list")
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editData, setEditData] = useState<Record<string, any> | undefined>()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteItem, setDeleteItem] = useState<Task | null>(null)
  const [activeFilter, setActiveFilter] = useState<string>("all")
  // Project filter — shared across list/kanban/calendar views (Phase 3 of
  // Notion-tasks plan). "" means "no project filter applied"; "__none__"
  // means "only tasks NOT linked to any project"; any other string is a
  // projectId. Filter is in-memory over the already-fetched tasks[], so
  // it composes with status / myTasksOnly / custom-field filters without
  // an extra API roundtrip.
  const [projectFilter, setProjectFilter] = useState<string>("")
  const [sortBy, setSortBy] = useState("date_asc")
  const [calModalOpen, setCalModalOpen] = useState(false)
  const [myTasksOnly, setMyTasksOnly] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [dragTask, setDragTask] = useState<string | null>(null)
  const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDef[]>([])
  const [users, setUsers] = useState<InlineUser[]>([])
  const [projects, setProjects] = useState<InlineProject[]>([])
  const [customFieldFilters, setCustomFieldFilters] = useState<Record<string, string[]>>({})
  const orgId = session?.user?.organizationId
  const currentUserId = session?.user?.id
  const advisorAssignedTo = searchParams.get("assignedTo")

  // Roadmap #20 — current filter snapshot for the SavedViewBar. Captured
  // into a saved view on click; applied back when a view chip is clicked.
  const currentFiltersSnapshot = useMemo(() => ({
    activeFilter,
    projectFilter,
    myTasksOnly,
    sortBy,
    customFieldFilters,
  }), [activeFilter, projectFilter, myTasksOnly, sortBy, customFieldFilters])

  const applySavedView = useCallback((view: SavedView) => {
    // Architect P1: each filter value is runtime-validated before being
    // written into state. A malformed JSON in the DB (e.g. someone
    // hand-edits the row, or a stale schema sneaks through) shouldn't
    // crash the page. typeof checks gate primitives; the customFields
    // block validates every value is a string[] before passing in.
    const f = view.filters as Record<string, unknown>
    if (typeof f.activeFilter === "string") setActiveFilter(f.activeFilter)
    if (typeof f.projectFilter === "string") setProjectFilter(f.projectFilter)
    if (typeof f.myTasksOnly === "boolean") setMyTasksOnly(f.myTasksOnly)
    if (typeof f.sortBy === "string") setSortBy(f.sortBy)
    if (f.customFieldFilters && typeof f.customFieldFilters === "object" && !Array.isArray(f.customFieldFilters)) {
      const safe: Record<string, string[]> = {}
      for (const [k, v] of Object.entries(f.customFieldFilters as Record<string, unknown>)) {
        if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
          safe[k] = v as string[]
        }
      }
      setCustomFieldFilters(safe)
    }
  }, [])

  const statusLabels: Record<string, string> = {
    backlog: t("statusBacklog"),
    pending: t("statusTodo"),
    todo: t("statusTodo"),
    in_progress: t("statusInProgress"),
    // Board-vocabulary statuses leak into the global list (tasks live on
    // multi-stage boards); without these the chip falls back to the raw enum.
    testing: t("statusTesting"),
    review: t("statusReview"),
    done: t("statusCompleted"),
    completed: t("statusCompleted"),
    cancelled: t("statusCancelled"),
  }

  const priorityLabels: Record<string, string> = {
    urgent: t("priorityUrgent"),
    high: t("priorityHigh"),
    medium: t("priorityMedium"),
    low: t("priorityLow"),
  }

  const advisorAssigneeLabel = useMemo(() => {
    if (!advisorAssignedTo) return ""
    const user = users.find((item) => item.id === advisorAssignedTo)
    if (user?.name) return user.name
    const task = tasks.find((item) => item.assignedTo === advisorAssignedTo)
    return task?.assignee?.name || advisorAssignedTo
  }, [advisorAssignedTo, tasks, users])

  // Map the in-memory status pill to the export endpoint's server-side `status`
  // filter (the kanban columns fold several raw statuses into one pill). NOTE:
  // custom-field filters are client-only and are NOT reflected in the export yet
  // (declared follow-up).
  const exportStatusParam =
    activeFilter === "all" ? ""
    // legacy saved-filter values from old saved views
    : activeFilter === "todo" ? "pending,todo"
    : activeFilter === "done" ? "completed,done"
    : STATUS_PILL_BUCKETS[activeFilter] ? STATUS_PILL_BUCKETS[activeFilter].join(",")
    : activeFilter

  async function fetchTasks() {
    try {
      const res = await fetch("/api/v1/tasks?limit=200", {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      const json = await res.json()
      if (json.success) {
        setTasks(json.data.tasks)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTasks()
    fetchCustomFieldDefs()
    fetchUsers()
    fetchProjects()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  async function toggleComplete(task: Task) {
    const newStatus = task.status === "completed" ? "pending" : "completed"
    try {
      await fetch(`/api/v1/tasks/${task.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>),
        },
        body: JSON.stringify({ status: newStatus }),
      })
      fetchTasks()
    } catch (err) { console.error(err) }
  }

  // Inline editing helpers (used by InlineTasksTable)
  //
  // OPTIMISTIC UPDATE (Roadmap #11):
  // 1. Snapshot the SPECIFIC fields this patch touches (not the whole row)
  // 2. Apply patch locally → UI reflects change INSTANTLY
  // 3. Fire server PATCH in background
  // 4. On error: restore ONLY the snapshotted fields (preserves any concurrent
  //    optimistic edits to OTHER fields on the same row that are still in
  //    flight when this one fails)
  // 5. On success: keep optimistic state (no refetch — would clobber any
  //    in-flight follow-up edits)
  //
  // KNOWN LIMITATION (deferred): If another user changes customFields
  // between our local fetch and our PATCH, our optimistic merge uses local
  // state, so the on-screen merge may diverge from the server's eventual
  // state until next refetch. Acceptable for v1.
  async function inlineUpdate(taskId: string, patch: Record<string, unknown>): Promise<void> {
    const original = tasks.find(t => t.id === taskId)
    if (!original) return

    // Snapshot ONLY the fields this patch touches — for field-level rollback.
    // (Full-row snapshot would wipe concurrent optimistic edits on other fields.)
    const snapshotPatch: Record<string, unknown> = {}
    for (const key of Object.keys(patch)) {
      snapshotPatch[key] = (original as any)[key]
    }

    // Mirror server's JSONB customFields merge: null deletes key, non-null overwrites.
    // Other fields are simple overwrite. For `projectId`, also resolve the nested
    // `project` object from the projects[] state so the UI updates the
    // displayed name immediately instead of waiting for the next fetch.
    setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t
      const next: Task & { customFields?: Record<string, unknown> | null } = { ...t, ...patch } as any
      if (patch.customFields !== undefined && patch.customFields !== null && typeof patch.customFields === "object") {
        const existing = (t.customFields ?? {}) as Record<string, unknown>
        const merged: Record<string, unknown> = { ...existing }
        for (const [k, v] of Object.entries(patch.customFields as Record<string, unknown>)) {
          if (v === null) delete merged[k]
          else merged[k] = v
        }
        next.customFields = merged
      }
      if ("projectId" in patch) {
        const newId = patch.projectId as string | null
        if (!newId) {
          next.project = null
        } else {
          const found = projects.find(p => p.id === newId)
          next.project = found ? { id: found.id, name: found.name, color: found.color ?? null } : null
        }
      }
      // Same resolution for assignee: without this the row keeps showing the
      // OLD assignee's name until the next fetch (id updates, object doesn't).
      if ("assignedTo" in patch) {
        const newId = patch.assignedTo as string | null
        const found = newId ? users.find(u => u.id === newId) : null
        next.assignee = newId ? (found ? { id: found.id, name: found.name, avatar: null } : t.assignee) : null
      }
      // And for co-assignees (replace-set → rebuild the {user} wrappers).
      if ("collaboratorIds" in patch) {
        const ids = (patch.collaboratorIds as string[] | undefined) ?? []
        next.collaborators = ids.map(cid => {
          const found = users.find(u => u.id === cid)
          return { user: { id: cid, name: found?.name ?? cid, avatar: null } }
        })
      }
      return next
    }))

    // Field-level rollback: restore each snapshotted field individually, leaving
    // OTHER fields (potentially mutated by concurrent in-flight patches) intact.
    // For customFields, undo only the specific keys our patch touched.
    // For projectId, also restore the nested `project` object (set via the
    // projects[] lookup above) so the UI's project chip matches the FK again.
    const rollback = () => setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t
      const reverted: Task & { customFields?: Record<string, unknown> | null } = { ...t } as any
      for (const key of Object.keys(snapshotPatch)) {
        if (key === "customFields" && patch.customFields && typeof patch.customFields === "object") {
          const origCF = (original.customFields ?? {}) as Record<string, unknown>
          const currentCF = (t.customFields ?? {}) as Record<string, unknown>
          const next: Record<string, unknown> = { ...currentCF }
          for (const k of Object.keys(patch.customFields as Record<string, unknown>)) {
            if (k in origCF) next[k] = origCF[k]
            else delete next[k]
          }
          reverted.customFields = next
        } else {
          ;(reverted as any)[key] = snapshotPatch[key]
        }
      }
      // Re-derive `project` from the now-restored projectId so the displayed
      // name matches the FK after rollback.
      if ("projectId" in patch) {
        const restoredId = reverted.projectId
        reverted.project = restoredId
          ? (() => {
              const found = projects.find(p => p.id === restoredId)
              return found ? { id: found.id, name: found.name, color: found.color ?? null } : (original.project ?? null)
            })()
          : null
      }
      // Mirror for the assignee object + collaborators (set optimistically above).
      if ("assignedTo" in patch) reverted.assignee = original.assignee ?? null
      if ("collaboratorIds" in patch) reverted.collaborators = original.collaborators
      return reverted
    }))

    try {
      const res = await fetch(`/api/v1/tasks/${taskId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>),
        },
        body: JSON.stringify(patch),
      })
      if (!res.ok) {
        const msg = (await res.json().catch(() => ({})))?.error || "Update failed"
        rollback()
        toast.error(msg)
        throw Object.assign(new Error(msg), { handled: true })
      }
      // Success: keep optimistic state. No fetchTasks() — would clobber follow-up edits.
    } catch (err: any) {
      if (!err?.handled) {
        rollback()
        toast.error(t("inlineNetworkErrorReverted"))
      }
      throw err
    }
  }

  async function inlineCreate(patch: Record<string, unknown>): Promise<void> {
    const res = await fetch("/api/v1/tasks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>),
      },
      body: JSON.stringify(patch),
    })
    if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Create failed")
    fetchTasks()
  }

  // Fetch custom field definitions (for task entityType) — used by InlineTasksTable columns
  async function fetchCustomFieldDefs() {
    try {
      const res = await fetch("/api/v1/custom-fields?entityType=task", {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      const json = await res.json()
      if (json.success) setCustomFieldDefs(json.data || [])
    } catch (err) { console.error("[customFieldDefs]", err) }
  }

  // Fetch users — used by InlineAssigneeCell dropdown.
  // Uses /assignable variant which gates on tasks:read (not settings:read),
  // so sales/support roles can also load the user list.
  async function fetchUsers() {
    try {
      const res = await fetch("/api/v1/users/assignable", {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      if (res.status === 429) {
        console.warn("[users/assignable] 429 — user-list throttled (Roadmap #16 rate-limit)")
        toast.error("Too many user-list requests — try again in a minute")
        return
      }
      const json = await res.json()
      if (json.success) {
        const arr = Array.isArray(json.data) ? json.data : (json.data?.users || [])
        setUsers(arr.map((u: any) => ({ id: u.id, name: u.name || u.email, email: u.email })))
      }
    } catch (err) { console.error("[users]", err) }
  }

  // Fetch projects for the InlineProjectCell dropdown. Cached on the page —
  // there are rarely more than a couple hundred projects per org and they
  // change rarely, so one fetch per page-load is fine.
  async function fetchProjects() {
    try {
      const res = await fetch("/api/v1/projects?limit=200", {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      const json = await res.json()
      if (json.success) {
        const rows = json.data?.projects ?? json.data ?? []
        setProjects(
          rows.map((p: { id: string; name: string; color?: string | null }) => ({
            id: p.id,
            name: p.name,
            color: p.color ?? null,
          })),
        )
      }
    } catch (err) { console.error("[projects]", err) }
  }

  function handleEdit(item: Task) {
    setEditData(item)
    setFormOpen(true)
  }

  function handleAdd(presetStatus?: string) {
    setEditData(presetStatus ? { status: presetStatus } : undefined)
    setFormOpen(true)
  }

  function handleDelete(item: Task) {
    setDeleteItem(item)
    setDeleteOpen(true)
  }

  async function confirmDelete() {
    if (!deleteItem) return
    const res = await fetch(`/api/v1/tasks/${deleteItem.id}`, {
      method: "DELETE",
      headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
    })
    if (!res.ok) throw new Error((await res.json()).error || tc("errorDeleteFailed"))
    fetchTasks()
  }

  // Selection helpers
  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filtered.map(t => t.id)))
    }
  }

  async function handleBulkAction(action: string, value?: string, extra?: { fieldName: string; fieldValue: unknown }) {
    if (selectedIds.size === 0) return
    try {
      const res = await fetch("/api/v1/tasks/bulk", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>),
        },
        body: JSON.stringify({ ids: Array.from(selectedIds), action, value, ...(extra || {}) }),
      })
      if (res.ok) {
        setSelectedIds(new Set())
        fetchTasks()
      }
    } catch (err) { console.error(err) }
  }

  // Kanban drag handlers
  async function handleKanbanDrop(taskId: string, newStatus: string) {
    setDragTask(null)
    const prev = tasks
    // Optimistic move first, then revert if the server rejects. A task that
    // lives on a board (has divisionId) is gated by BoardPermission, so a
    // forward move without the per-column flag returns 403 — without this
    // rollback the card would appear moved while the DB never changed.
    setTasks(p => p.map(t =>
      t.id === taskId ? { ...t, status: newStatus, completedAt: newStatus === "completed" ? new Date().toISOString() : t.completedAt } : t
    ))
    try {
      const res = await fetch(`/api/v1/tasks/${taskId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>),
        },
        body: JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) {
        setTasks(prev)
        const j = await res.json().catch(() => ({}))
        toast.error(j?.message || j?.error || t("inlineNetworkErrorReverted"))
      }
    } catch (err) {
      console.error(err)
      setTasks(prev)
      toast.error(t("inlineNetworkErrorReverted"))
    }
  }

  // Filter + sort
  let filtered = tasks.filter(t => {
    if (activeFilter === "all") return true
    const bucket = STATUS_PILL_BUCKETS[activeFilter]
    if (bucket) return bucket.includes(t.status)
    // legacy saved-filter values from old saved views
    if (activeFilter === "todo") return t.status === "pending" || t.status === "todo"
    if (activeFilter === "done") return t.status === "completed" || t.status === "done"
    return t.status === activeFilter
  })

  // My Tasks filter — primary assignee OR co-assignee.
  if (myTasksOnly && currentUserId) {
    filtered = filtered.filter(t =>
      t.assignedTo === currentUserId || (t.collaborators ?? []).some(c => c.user.id === currentUserId),
    )
  }

  if (advisorAssignedTo) {
    filtered = filtered.filter(t =>
      t.assignedTo === advisorAssignedTo || (t.collaborators ?? []).some(c => c.user.id === advisorAssignedTo),
    )
  }

  // Project filter — see useState comment above for "__none__" semantics.
  if (projectFilter) {
    if (projectFilter === "__none__") {
      filtered = filtered.filter(t => !t.projectId)
    } else {
      filtered = filtered.filter(t => t.projectId === projectFilter)
    }
  }

  // Custom field filters — task must match ALL active filters (AND across fields,
  // OR within a single field's allowed values).
  const activeFilterEntries = Object.entries(customFieldFilters).filter(([, vals]) => vals.length > 0)
  if (activeFilterEntries.length > 0) {
    filtered = filtered.filter((t) => {
      const cf = (t.customFields ?? {}) as Record<string, unknown>
      for (const [fieldName, allowed] of activeFilterEntries) {
        const raw = cf[fieldName]
        // Coerce primitives to string for the comparison. Booleans → "true"/"false",
        // numbers → "1"/"42", strings stay as-is. Anything else → "" (won't match).
        let taskValue = ""
        if (typeof raw === "boolean" || typeof raw === "number") taskValue = String(raw)
        else if (typeof raw === "string") taskValue = raw
        if (!allowed.includes(taskValue)) return false
      }
      return true
    })
  }

  filtered = filtered.sort((a, b) => {
    const priorityOrder: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 }
    const statusOrder: Record<string, number> = { pending: 0, todo: 0, in_progress: 1, completed: 2, cancelled: 3 }
    switch (sortBy) {
      case "date_asc":      return new Date(a.dueDate || "9999").getTime() - new Date(b.dueDate || "9999").getTime()
      case "date_desc":     return new Date(b.dueDate || "0").getTime() - new Date(a.dueDate || "0").getTime()
      case "priority":      return (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2)
      case "priority_desc": return (priorityOrder[b.priority] ?? 2) - (priorityOrder[a.priority] ?? 2)
      case "status":        return (statusOrder[a.status] ?? 0) - (statusOrder[b.status] ?? 0)
      case "status_desc":   return (statusOrder[b.status] ?? 0) - (statusOrder[a.status] ?? 0)
      case "created_desc":  return new Date(b.createdAt || "0").getTime() - new Date(a.createdAt || "0").getTime()
      case "name":          return a.title.localeCompare(b.title)
      case "name_desc":     return b.title.localeCompare(a.title)
      default: return 0
    }
  })

  // Closed = completed OR board-vocabulary done OR cancelled (isClosedStatus is
  // the single source of truth shared with the table + detail view). Without
  // `done` here, board tasks finished via a multi-stage board kept counting as
  // overdue/today.
  const overdue = tasks.filter(t => isOverdue(t.dueDate) && !isClosedStatus(t.status)).length
  const completed = tasks.filter(t => t.status === "completed" || t.status === "done").length
  const todayCount = tasks.filter(t => isToday(t.dueDate) && !isClosedStatus(t.status)).length
  const weekCount = tasks.filter(t => isThisWeek(t.dueDate) && !isClosedStatus(t.status)).length

  const statusCounts: Record<string, number> = {}
  for (const t of tasks) {
    const key = pillOf(t.status)
    statusCounts[key] = (statusCounts[key] || 0) + 1
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <div className="animate-pulse space-y-4">
          <div className="grid gap-4 md:grid-cols-6">
            {[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="h-24 bg-muted rounded-lg" />)}
          </div>
          <div className="h-96 bg-muted rounded-lg" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header — two tiers so controls stop piling onto one wrap row:
          (1) identity + primary CTA, (2) a toolbar with the view switch + scope
          on the left and data actions on the right. Every control is preserved. */}
      <div className="space-y-4">
        {/* Tier 1 — title + primary action */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
              <TourReplayButton tourId="tasks" />
              <HelpButton slug="tasks" variant="label" />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
          </div>
          <Button onClick={() => handleAdd()} data-tour-id="tasks-new" className="shrink-0 shadow-sm">
            <Plus className="h-4 w-4 mr-1.5" /> {t("newTask")}
          </Button>
        </div>

        {/* Tier 2 — toolbar: view switch + scope (left), data actions (right) */}
        <div className="flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700" data-tour-id="tasks-views">
              <button
                onClick={() => setView("list")}
                className={cn("px-3 py-1.5 text-sm flex items-center gap-1 transition-colors", view === "list" ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
              >
                <ListChecks className="h-3.5 w-3.5" /> {t("list")}
              </button>
              <button
                onClick={() => setView("kanban")}
                className={cn("px-3 py-1.5 text-sm flex items-center gap-1 border-x border-zinc-200 transition-colors dark:border-zinc-700", view === "kanban" ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
              >
                <Columns3 className="h-3.5 w-3.5" /> {t("kanban")}
              </button>
              <button
                onClick={() => setView("calendar")}
                className={cn("px-3 py-1.5 text-sm flex items-center gap-1 transition-colors", view === "calendar" ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
              >
                <CalendarDays className="h-3.5 w-3.5" /> {t("calendar")}
              </button>
            </div>
            <Button
              variant={myTasksOnly ? "default" : "outline"}
              size="sm"
              onClick={() => setMyTasksOnly(!myTasksOnly)}
            >
              <User2 className="h-3.5 w-3.5 mr-1" /> {t("myTasks") || "My Tasks"}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <TaskExportMenu
              label={tc("export")}
              params={{
                status: exportStatusParam,
                projectId: projectFilter,
                assigneeId: advisorAssignedTo || (myTasksOnly ? (currentUserId ?? "") : ""),
              }}
            />
            <Button variant="outline" size="sm" onClick={() => setCalModalOpen(true)}>
              <Link2 className="h-4 w-4 mr-1" /> {t("connectCalendar")}
            </Button>
          </div>
        </div>
      </div>
      <DidYouKnow page="tasks" className="mb-4" />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 stagger-children" data-tour-id="tasks-stats">
        <ColorStatCard label={t("statAll")} value={tasks.length} icon={<CheckSquare className="h-4 w-4" />} hint={t("hintTotalTasks")} />
        <ColorStatCard label={t("statCompleted")} value={completed} icon={<CheckSquare className="h-4 w-4" />} hint={t("hintCompletedWeek")} />
        <ColorStatCard label={t("statOverdue")} value={overdue} icon={<AlertTriangle className="h-4 w-4" />} hint={t("hintOverdueTasks")} />
        <ColorStatCard label={t("statInProgress")} value={tasks.filter(t => t.status === "in_progress").length} icon={<Clock className="h-4 w-4" />} hint={t("hintCompletionRate")} />
        <ColorStatCard label={t("statToday")} value={todayCount} icon={<CalendarDays className="h-4 w-4" />} />
        <ColorStatCard label={t("statThisWeek")} value={weekCount} icon={<CalendarDays className="h-4 w-4" />} />
      </div>

      {/* Bulk actions bar */}
      <BulkActionsBar selectedIds={selectedIds} onAction={handleBulkAction} onClear={() => setSelectedIds(new Set())} customFieldDefs={customFieldDefs} />

      {/* Status filter tabs + project filter (shared across all views) */}
      <div className="flex flex-wrap items-center gap-2">
        {advisorAssignedTo ? (
          <Button
            variant="outline"
            size="sm"
            className="border-primary/30 bg-primary/5"
            onClick={() => router.push("/tasks")}
          >
            <User2 className="h-3.5 w-3.5 mr-1" />
            {t("advisorScope")}: {advisorAssigneeLabel}
            <X className="h-3.5 w-3.5 ml-1" />
          </Button>
        ) : null}
        <Button
          variant={activeFilter === "all" ? "default" : "outline"}
          size="sm"
          onClick={() => setActiveFilter("all")}
        >
          {t("statAll")} ({tasks.length})
        </Button>
        {(["backlog", "pending", "in_progress", "completed", "cancelled"] as const).map(key => (
          <Button
            key={key}
            variant={activeFilter === key ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveFilter(key)}
          >
            {statusLabels[key]} ({statusCounts[key] || 0})
          </Button>
        ))}
        {/* Project filter — pushed to the right via an outer wrapper because
            our Select component wraps its native <select> in a div, so any
            `ml-auto` on Select itself lands on the inner element and won't
            move the flex item. Always visible when ≥1 project exists. */}
        {projects.length > 0 && (
          <div className="ml-auto">
            <Select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className="w-[200px] h-9 text-sm"
            >
              <option value="">{tc("project")}: {tc("all") || "All"}</option>
              <option value="__none__">{tc("noProject") || "— No project —"}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </div>
        )}
      </div>

      {/* Sort (not shown in calendar view) */}
      {view !== "calendar" && (
        <div className="flex justify-end">
          <Select value={sortBy} onChange={e => setSortBy(e.target.value)} className="w-[200px]">
            <option value="date_asc">{t("sortDueDateAsc")}</option>
            <option value="date_desc">{t("sortDueDateDesc")}</option>
            <option value="created_desc">{t("sortCreatedDesc")}</option>
            <option value="priority">{t("sortPriority")} ↑</option>
            <option value="priority_desc">{t("sortPriority")} ↓</option>
            <option value="status">{t("sortStatus")} ↑</option>
            <option value="status_desc">{t("sortStatus")} ↓</option>
            <option value="name">{t("sortNameAsc")}</option>
            <option value="name_desc">{t("sortNameDesc")}</option>
          </Select>
        </div>
      )}

      {view === "list" && (
        <>
          {/* Roadmap #20 — saved views chip bar. Captures current filter
              state on save; applies on chip click. Default-marked view
              auto-applies via onDefaultLoad. */}
          <SavedViewBar
            entityType="tasks"
            currentFilters={currentFiltersSnapshot}
            onApply={applySavedView}
            onDefaultLoad={applySavedView}
          />
          <CustomFieldFilterBar
            defs={customFieldDefs}
            filters={customFieldFilters}
            onFiltersChange={setCustomFieldFilters}
          />
          <InlineTasksTable
            tasks={filtered.map(t => ({ ...t, collaborators: t.collaborators?.map(c => c.user) }))}
            groupOpenClosed
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onToggleSelectAll={toggleSelectAll}
          onUpdate={inlineUpdate}
          onCreate={inlineCreate}
          onDelete={(id) => {
            const item = filtered.find((x) => x.id === id)
            if (item) handleDelete(item)
          }}
          onEdit={(item) => handleEdit(item as Task)}
          onOpenDetail={(id) => router.push(`/tasks/${id}`)}
          rowClassName={(item) =>
            isOverdue(item.dueDate) && item.status !== "completed" && item.status !== "done" && item.status !== "cancelled"
              ? "!bg-red-100/70 dark:!bg-red-950/40"
              : ""
          }
          statusLabels={statusLabels}
          priorityLabels={priorityLabels}
          customFieldDefs={customFieldDefs}
          users={users}
          projects={projects}
          sortBy={sortBy}
          onSortChange={setSortBy}
        />
        </>
      )}

      {view === "kanban" && (
        <KanbanView
          filtered={filtered}
          priorityLabels={priorityLabels}
          dragTask={dragTask}
          setDragTask={setDragTask}
          handleKanbanDrop={handleKanbanDrop}
          toggleComplete={toggleComplete}
          handleAdd={handleAdd}
          router={router}
          formatDate={(d: string | null) => formatDate(d, locale)}
          isOverdue={isOverdue}
          customFieldDefs={customFieldDefs}
        />
      )}

      {view === "calendar" && (
        <TaskCalendar
          tasks={filtered}
          orgId={orgId ? String(orgId) : undefined}
          onTaskClick={(id) => router.push(`/tasks/${id}`)}
          onCreateOnDate={(year, month, day) => {
            // Calendar #23a: click empty day → open TaskForm with prefilled dueDate.
            // Use noon (12:00) local time so the stored UTC instant is robust to
            // ±12h timezone shifts on display — midnight would land on the wrong
            // calendar day for any user east of the server's TZ (architect P0).
            const iso = new Date(year, month, day, 12, 0, 0).toISOString()
            setEditData({ dueDate: iso })
            setFormOpen(true)
          }}
          onMoveToDate={(taskId, year, month, day) => {
            // Calendar #23b: drag-and-drop chip to another day → PATCH dueDate.
            // Same noon-ISO trick as above for TZ-safe round-trip.
            // Reuses Roadmap #11 optimistic update — UI moves instantly,
            // rollback + toast on error.
            const iso = new Date(year, month, day, 12, 0, 0).toISOString()
            inlineUpdate(taskId, { dueDate: iso }).catch(() => { /* handled in helper */ })
          }}
        />
      )}

      <TaskForm open={formOpen} onOpenChange={setFormOpen} onSaved={fetchTasks} initialData={editData} orgId={orgId} />
      <DeleteConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} onConfirm={confirmDelete} title={t("deleteTask")} itemName={deleteItem?.title} />
      <CalendarIntegrationModal open={calModalOpen} onClose={() => setCalModalOpen(false)} />
    </div>
  )
}

// ─── Kanban View with collapse ─────────────────────────────────
function KanbanView({ filtered, priorityLabels, dragTask, setDragTask, handleKanbanDrop, toggleComplete, handleAdd, router, formatDate, isOverdue, customFieldDefs }: any) {
  // Show only select-type custom fields on kanban cards — they fit visually as
  // small badges. Text/number/date/boolean fields are noisier on a compact card
  // and remain editable via the row in list-view or on /tasks/[id] sidebar.
  const cardFieldDefs = (customFieldDefs || []).filter((d: any) => d.isActive && d.fieldType === "select")
  const t = useTranslations("tasks")
  const [expandedCols, setExpandedCols] = useState<Record<string, boolean>>({})
  const COLLAPSE_LIMIT = 10

  return (
        <MotionList className="flex gap-3 overflow-x-auto pb-4" staggerDelay={0.06}>
          {KB_COLS.map((col) => {
            const columnTasks = filtered.filter((task: any) => col.statuses.includes(task.status))
            const isExpanded = expandedCols[col.key] || false
            const visibleTasks = columnTasks.length > COLLAPSE_LIMIT && !isExpanded ? columnTasks.slice(0, COLLAPSE_LIMIT) : columnTasks
            const hiddenCount = columnTasks.length - COLLAPSE_LIMIT
            return (
              <MotionItem key={col.key} className="w-[290px] flex-shrink-0">
                <div
                  className="flex flex-col rounded-xl"
                  style={{ background: KB.colBg, borderTop: `3px solid ${col.accent}`, outline: dragTask ? `2px dashed ${KB.border}` : "none" }}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move" }}
                  onDrop={(e) => {
                    e.preventDefault()
                    const taskId = e.dataTransfer.getData("text/plain")
                    if (taskId) handleKanbanDrop(taskId, col.drop)
                  }}
                >
                  <div className="flex items-center justify-between px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold tracking-wide" style={{ color: KB.sub }}>{col.label}</span>
                      <span className="rounded-full px-1.5 text-[11px]" style={{ background: KB.border, color: KB.sub }}>{columnTasks.length}</span>
                    </div>
                    <button
                      onClick={() => handleAdd(col.drop)}
                      className="rounded p-0.5 transition-colors hover:bg-black/5"
                      style={{ color: KB.sub }}
                      title={t("newTask")}
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex flex-col gap-2.5 px-2 pb-3" style={{ minHeight: 120 }}>
                  {visibleTasks.map((task: any) => {
                    const pr = KB_PRIORITY[task.priority] || KB_PRIORITY.medium
                    const done = task.status === "completed" || task.status === "done"
                    const overdue = isOverdue(task.dueDate) && !done
                    // Quarterly (Q1-Q4) tasks get the featured card: orange badge,
                    // tinted border + a checklist-completion progress bar (like the
                    // design screenshot). Progress = checked items / total items.
                    const featured = !!task.category && /^Q[1-4]$/.test(task.category)
                    const clTotal = task.checklist?.length ?? 0
                    const clDone = task.checklist?.filter((c: any) => c.completed).length ?? 0
                    const progress = clTotal > 0 ? Math.round((clDone / clTotal) * 100) : 0
                    return (
                    <div
                      key={task.id}
                      draggable
                      onDragStart={(e: any) => { e.dataTransfer.setData("text/plain", task.id); setDragTask(task.id) }}
                      onDragEnd={() => setDragTask(null)}
                      className={cn(
                        "cursor-grab rounded-xl p-3 shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing",
                        dragTask === task.id && "opacity-50"
                      )}
                      style={{ background: featured ? "#FFFBF5" : "#FFFFFF", border: `1px solid ${featured ? KB.amber : KB.border}` }}
                      onClick={() => router.push(`/tasks/${task.id}`)}
                    >
                      {featured && (
                        <span className="mb-1.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{ background: KB.amber }}>
                          {task.category}
                        </span>
                      )}
                      <div className="flex items-start gap-2">
                        <button
                          onClick={(e: any) => { e.stopPropagation(); toggleComplete(task) }}
                          className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-2"
                          style={{ borderColor: done ? KB.green : KB.border, background: done ? KB.green : "transparent" }}
                          title={t("toggleComplete")}
                        >
                          {done && <Check className="h-3 w-3 text-white" />}
                        </button>
                        <span
                          className={cn("text-sm leading-snug", done && "line-through")}
                          style={{ color: done ? KB.sub : KB.text, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
                        >
                          {task.title}
                        </span>
                      </div>
                      {cardFieldDefs.length > 0 && (() => {
                        // Only render badges for fields with a non-empty value on this task
                        const cf = (task.customFields ?? {}) as Record<string, unknown>
                        const withValues = cardFieldDefs
                          .map((def: any) => ({ def, value: cf[def.fieldName] }))
                          .filter((x: any) => typeof x.value === "string" && x.value.length > 0)
                        if (withValues.length === 0) return null
                        const CAP = 3
                        const visible = withValues.slice(0, CAP)
                        const overflow = withValues.slice(CAP)
                        return (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1">
                            {visible.map(({ def, value }: any) => (
                              <span
                                key={def.id}
                                title={`${def.fieldLabel}: ${value}`}
                                className="inline-flex max-w-[140px] items-center truncate whitespace-nowrap rounded-full bg-purple-50 px-1.5 py-0.5 text-[10px] text-purple-700 dark:bg-purple-900/30 dark:text-purple-300"
                              >
                                <span className="mr-1 font-medium opacity-70">{def.fieldLabel}:</span>
                                <span className="truncate">{value as string}</span>
                              </span>
                            ))}
                            {overflow.length > 0 && (
                              <span
                                title={overflow.map((x: any) => `${x.def.fieldLabel}: ${x.value}`).join("\n")}
                                className="inline-flex cursor-help items-center whitespace-nowrap rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                              >
                                +{overflow.length}
                              </span>
                            )}
                          </div>
                        )
                      })()}
                      <div className="mt-2 flex items-center gap-1.5 text-[11px]" style={{ color: KB.sub }}>
                        <pr.Icon className="h-3.5 w-3.5" style={{ color: pr.color }} aria-label={priorityLabels[task.priority] || task.priority} />
                        {task.relatedType && <span title={task.relatedName || task.relatedType}>{categoryIcons[task.relatedType] || "📋"}</span>}
                        {task.project && (
                          <span className="inline-block h-2 w-2 rounded-full" style={{ background: task.project.color || KB.sub }} title={task.project.name} />
                        )}
                        {task.dueDate && (
                          <span className="inline-flex items-center gap-0.5" style={overdue ? { color: KB.red, fontWeight: 600 } : undefined}>
                            <Clock className="h-3 w-3" /> {formatDate(task.dueDate)}
                          </span>
                        )}
                        <span className="ml-auto" />
                        {task.assignee && (
                          <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full text-[10px] font-semibold text-white" style={{ background: KB.primary }} title={task.assignee.name}>
                            {task.assignee.name?.charAt(0)?.toUpperCase()}
                          </span>
                        )}
                      </div>
                      {featured && (
                        <div className="mt-2 flex items-center gap-2" title={`${clDone}/${clTotal}`}>
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: KB.border }}>
                            <div className="h-full rounded-full" style={{ width: `${progress}%`, background: KB.amber }} />
                          </div>
                          <span className="text-[10px] font-semibold" style={{ color: KB.amber }}>{progress}%</span>
                        </div>
                      )}
                    </div>
                    )
                  })}
                  {columnTasks.length > COLLAPSE_LIMIT && !isExpanded && (
                    <button
                      onClick={() => setExpandedCols(prev => ({ ...prev, [col.key]: true }))}
                      className="w-full rounded-md border border-dashed py-2 text-center text-xs"
                      style={{ borderColor: KB.border, color: KB.sub, background: "#FFFFFF" }}
                    >
                      {t("showMore", { count: hiddenCount }) || `+${hiddenCount}`}
                    </button>
                  )}
                  {isExpanded && columnTasks.length > COLLAPSE_LIMIT && (
                    <button
                      onClick={() => setExpandedCols(prev => ({ ...prev, [col.key]: false }))}
                      className="w-full py-2 text-center text-xs"
                      style={{ color: KB.sub }}
                    >
                      {t("showLess") || "Show less"}
                    </button>
                  )}
                  </div>
                </div>
              </MotionItem>
            )
          })}
        </MotionList>
  )
}
