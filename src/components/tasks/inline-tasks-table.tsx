"use client"

/**
 * InlineTasksTable — Notion-style inline-editable table for /tasks list view.
 *
 * Phase A (shipped): inline create + inline edit Title/Priority/Status
 * Phase B (this file):
 *  - Sortable column headers (click header → toggle asc/desc) with ↑↓
 *  - Custom fields as dynamic columns (Outcome/Channel/etc. — all 6 fieldType)
 *  - Inline-edit Due Date (date picker popover)
 *  - Inline-edit Assignee (searchable users dropdown)
 *  - Inline-edit Custom Field cells (per fieldType: text/textarea/number/date/select/boolean)
 *
 * Phase C (deferred): Tab/Enter navigation between cells, optimistic updates,
 * per-cell loading indicators, column visibility toggle.
 */

import { Fragment, useState, useRef, useEffect, useMemo, KeyboardEvent, type ReactNode } from "react"
import { useTranslations, useLocale } from "next-intl"
import { formatDate as formatDateI18n } from "@/lib/format-date"
import { cn } from "@/lib/utils"
import {
  Search, Plus, ExternalLink, Loader2, Pencil, Trash2,
  ArrowUp, ArrowDown, ArrowUpDown, X, Check, Columns3,
  ChevronDown, ChevronRight, ChevronUp, ChevronsUp, Equal,
  Calendar as CalendarIcon,
  Mail, Inbox, Wrench, FlaskConical, Eye, Ban,
  MessageSquare, ListChecks,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { useEventTypes, useTaskTypes, type TaskTypeInfo } from "@/components/tasks/use-task-types"
import { CLOSED_STATUSES } from "@/lib/tasks/status"

export interface InlineTask {
  id: string
  title: string
  status: string
  boardColumnKey?: string | null
  priority: string
  type?: string | null
  eventType?: string | null
  dueDate: string | null
  assignedTo: string | null
  assignee?: { id: string; name: string; avatar?: string | null } | null
  collaborators?: { id: string; name: string }[]
  relatedType: string | null
  relatedName?: string | null
  projectId?: string | null
  project?: { id: string; name: string; color?: string | null } | null
  customFields?: Record<string, unknown> | null
  checklist?: { completed: boolean }[]
  _count?: { comments?: number; checklist?: number }
}

export interface InlineProject {
  id: string
  name: string
  color?: string | null
}

export interface CustomFieldDef {
  id: string
  fieldName: string
  fieldLabel: string
  fieldType: string // "text" | "textarea" | "number" | "date" | "select" | "boolean"
  options: string[]
  isRequired: boolean
  defaultValue: string | null
  sortOrder: number
  isActive: boolean
}

export interface InlineUser {
  id: string
  name: string
  email?: string
  avatar?: string | null
}

interface Props {
  tasks: InlineTask[]
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onToggleSelectAll: () => void
  onUpdate: (taskId: string, patch: Record<string, unknown>) => Promise<void>
  onCreate: (patch: Record<string, unknown>) => Promise<void>
  onDelete: (taskId: string) => void
  onEdit: (task: InlineTask) => void
  onOpenDetail: (taskId: string) => void
  rowClassName?: (task: InlineTask) => string
  statusLabels: Record<string, string>
  priorityLabels: Record<string, string>
  customFieldDefs: CustomFieldDef[]
  users: InlineUser[]
  projects?: InlineProject[]
  /** Override the "category" column header. The board reuses this column (it
      maps Task.category → relatedType) to display the QUARTER (Q1–Q4), so it
      passes the form's "Rüb"/"Quarter" label here — otherwise the same field is
      "Quarter" in the editor but "Category" in the list. /tasks (where the
      column shows the real related entity) keeps the default. */
  categoryColumnLabel?: string
  /** Group rows into Open / Closed sections with collapsible headers (Bordio table view). */
  groupOpenClosed?: boolean
  /** Board-parity grouping: ordered sections mirroring the board's own kanban
      columns (same keys + labels). When set, overrides groupOpenClosed; tasks
      bucket via groupKeyOf; rows with a key not in the list render as trailing
      sections so nothing is ever silently dropped. `optional` groups are only
      shown when non-empty (e.g. Cancelled, which has no kanban lane). */
  customGroups?: { key: string; label: string; optional?: boolean }[]
  groupKeyOf?: (t: InlineTask) => string
  /** Status vocabulary for the inline status editor. Defaults to the legacy
      4-stage CRM set; a board passes its canonical stages so a backlog/done
      task can be edited without a lossy downgrade. */
  statusOptions?: string[]
  sortBy: string
  onSortChange: (sort: string) => void
}

const STATUS_OPTIONS = ["pending", "in_progress", "completed", "cancelled"] as const
const PRIORITY_OPTIONS = ["low", "medium", "high", "urgent"] as const
// Closed = these statuses; everything else is Open (Bordio-style grouped default view).
// Intentionally BROADER than the kanban "DONE" lane (completed/done): the Closed
// SECTION also folds in `cancelled`, since a cancelled task is not open work.
// CLOSED_STATUSES is the single source of truth (imported at top), shared with
// the detail view + tasks page.

const PRIORITY_BADGE_CLASSES: Record<string, string> = {
  urgent: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  high:   "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  medium: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  low:    "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
}

const STATUS_BADGE_CLASSES: Record<string, string> = {
  pending:     "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  todo:        "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  backlog:     "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  in_progress: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  testing:     "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  review:      "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400",
  completed:   "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  done:        "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  cancelled:   "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500 line-through",
}

const CATEGORY_ICONS: Record<string, string> = {
  call: "📞", email: "📧", meeting: "🤝",
  deal: "💰", contact: "👤", company: "🏢",
  lead: "🎯", ticket: "🎫",
}

// Board quarter-axis values (category mapped into relatedType by the boards
// page) — rendered as the compact amber Q-badge instead of the emoji+name
// category chip. Same #FF8B00 as the kanban featured-card badge.
const QUARTER_RE = /^Q[1-4]$/

// ─── Bordio-style cell glyphs ────────────────────────────────────
// Status/priority render as a small colored icon + plain label instead of a
// colored pill, so each column is only as wide as its content (more columns
// fit on screen). Keys cover every status in STATUS_BADGE_CLASSES; unknown
// board statuses fall back to a neutral square.
const STATUS_ICONS: Record<string, { Icon: typeof Mail; cls: string }> = {
  backlog:     { Icon: Inbox,        cls: "text-zinc-400" },
  pending:     { Icon: Mail,         cls: "text-sky-500" },
  todo:        { Icon: Mail,         cls: "text-sky-500" },
  in_progress: { Icon: Wrench,       cls: "text-amber-600" },
  testing:     { Icon: FlaskConical, cls: "text-purple-500" },
  review:      { Icon: Eye,          cls: "text-cyan-600" },
  cancelled:   { Icon: Ban,          cls: "text-zinc-400" },
}

function StatusGlyph({ status }: { status: string }) {
  if (status === "completed" || status === "done") {
    // Filled green check-square (reference look) — lucide has no filled
    // variant, so compose one.
    return (
      <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] bg-green-600">
        <Check className="h-2.5 w-2.5 text-white" strokeWidth={3.5} />
      </span>
    )
  }
  const m = STATUS_ICONS[status]
  if (!m) return <span className="h-3.5 w-3.5 shrink-0 rounded-[3px] bg-zinc-300 dark:bg-zinc-600" />
  return <m.Icon className={cn("h-3.5 w-3.5 shrink-0", m.cls)} />
}

const PRIORITY_ICONS: Record<string, { Icon: typeof ChevronUp; cls: string }> = {
  urgent: { Icon: ChevronsUp,  cls: "text-red-600" },
  high:   { Icon: ChevronUp,   cls: "text-orange-500" },
  medium: { Icon: Equal,       cls: "text-amber-500" },
  low:    { Icon: ChevronDown, cls: "text-blue-500" },
}

function PriorityGlyph({ priority }: { priority: string }) {
  const m = PRIORITY_ICONS[priority] ?? PRIORITY_ICONS.medium
  return <m.Icon className={cn("h-3.5 w-3.5 shrink-0", m.cls)} strokeWidth={2.5} />
}

/** Build the value→glyph map for InlineSelectCell (options + current value). */
function statusIconMap(statuses: string[]): Record<string, ReactNode> {
  return Object.fromEntries(statuses.map(s => [s, <StatusGlyph key={s} status={s} />]))
}

// Column-visibility (Roadmap #12): keys that can be hidden via the "Columns" menu.
// _select / title / _actions are intentionally NOT hideable.
// "project" added with Phase 2 (Task→Project relations + rollup).
export const HIDEABLE_COLUMN_KEYS = ["category", "type", "eventType", "priority", "status", "dueDate", "assignee", "project"] as const
type HideableKey = typeof HIDEABLE_COLUMN_KEYS[number]
export const LOCAL_STORAGE_COLUMNS_KEY = "tasks-table-hidden-columns"
// Reserved shared SavedView (entityType "tasks") holding the ORG-WIDE default
// column set in filters.hiddenColumns. "__" prefix = internal, hidden from the
// saved-view chips bar. Written from the board Configuration page.
export const ORG_DEFAULT_VIEW_NAME = "__table_default__"

// Map sortable column keys to parent sort values (must match parent's sortBy contract)
const COLUMN_SORT_KEYS: Record<string, { asc: string; desc: string }> = {
  title:    { asc: "name",       desc: "name_desc" },
  priority: { asc: "priority",   desc: "priority_desc" },
  status:   { asc: "status",     desc: "status_desc" },
  dueDate:  { asc: "date_asc",   desc: "date_desc" },
}

function formatDate(d: string | null, locale: string): string {
  if (!d) return "—"
  return formatDateI18n(d, locale, { day: "2-digit", month: "short" })
}

function toDateInputValue(d: string | null): string {
  if (!d) return ""
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return ""
  return dt.toISOString().slice(0, 10)
}

function isOverdueDate(d: string | null, status: string): boolean {
  // CLOSED_STATUSES (not a completed/cancelled pair-check) so board tasks in
  // `done` don't show their past due date as overdue-red (bug seen live on
  // the boards table 2026-06-12).
  if (!d || CLOSED_STATUSES.has(status)) return false
  // Date-granular: due TODAY is not overdue (matches the reference UX —
  // red is reserved for dates before today), regardless of time-of-day.
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  return new Date(d) < startOfToday
}

function isTodayStr(d: string | null): boolean {
  if (!d) return false
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return false
  const now = new Date()
  return dt.getFullYear() === now.getFullYear() && dt.getMonth() === now.getMonth() && dt.getDate() === now.getDate()
}

// Whole calendar days a due date is past (date-granular, local TZ; matches
// isOverdueDate's startOfToday boundary). Due today/future → 0.
function daysOverdueOf(d: string | null): number {
  if (!d) return 0
  const due = new Date(d)
  if (isNaN(due.getTime())) return 0
  due.setHours(0, 0, 0, 0)
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const diff = Math.round((startOfToday.getTime() - due.getTime()) / 86400000)
  return diff > 0 ? diff : 0
}

export function InlineTasksTable({
  tasks, selectedIds, onToggleSelect, onToggleSelectAll,
  onUpdate, onCreate, onDelete, onEdit, onOpenDetail,
  rowClassName, categoryColumnLabel, statusLabels, priorityLabels,
  customFieldDefs, users, projects = [], groupOpenClosed = false, customGroups, groupKeyOf, statusOptions, sortBy, onSortChange,
}: Props) {
  const t = useTranslations("tasks")
  const tc = useTranslations("common")
  const [search, setSearch] = useState("")

  // Column visibility (Roadmap #12). Hidden = explicitly excluded by user via
  // the "Columns" popover. Persisted to localStorage so the user's choice
  // survives reload. Custom fields use "cf:<defId>" as the key.
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set())

  // Column visibility — three tiers, strongest first:
  //  1. The user's OWN saved choice (localStorage) always wins.
  //  2. Otherwise the ORG default — the reserved shared SavedView
  //     "__table_default__" (entityType tasks), curated from the board
  //     Configuration page.
  //  3. Otherwise the LEAN Bordio-style default — hide Category, Project and
  //     every custom field (Name · Type · Event · Priority · Status · Due ·
  //     Assignee out of the box).
  // Tiers 2-3 are NOT persisted; only an explicit toggle writes localStorage,
  // so org/lean defaults keep applying until the user curates their own.
  // Re-runs when customFieldDefs load so async-fetched custom fields are
  // hidden in the lean tier too.
  useEffect(() => {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(LOCAL_STORAGE_COLUMNS_KEY) : null
      if (raw) {
        const arr = JSON.parse(raw)
        if (Array.isArray(arr)) { setHiddenColumns(new Set(arr)); return }
      }
    } catch { /* ignore corrupted localStorage */ }
    let cancelled = false
    const leanDefault = () => {
      const customFieldKeys = customFieldDefs.filter(d => d.isActive).map(d => `cf:${d.id}`)
      setHiddenColumns(new Set(["category", "project", ...customFieldKeys]))
    }
    fetch(`/api/v1/saved-views?entityType=tasks`, { credentials: "include" })
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (cancelled) return
        const v = (j?.data ?? []).find((x: { name: string; isShared: boolean }) => x.name === ORG_DEFAULT_VIEW_NAME && x.isShared)
        const cols = (v?.filters as { hiddenColumns?: unknown } | undefined)?.hiddenColumns
        if (Array.isArray(cols)) setHiddenColumns(new Set(cols.map(String)))
        else leanDefault()
      })
      .catch(() => { if (!cancelled) leanDefault() })
    return () => { cancelled = true }
  }, [customFieldDefs])

  // Persist on change
  const updateHiddenColumns = (next: Set<string>) => {
    setHiddenColumns(next)
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(LOCAL_STORAGE_COLUMNS_KEY, JSON.stringify([...next]))
      }
    } catch { /* localStorage full or disabled — non-fatal */ }
  }

  const isVisible = (key: string) => !hiddenColumns.has(key)

  const filtered = useMemo(() => {
    if (!search) return tasks
    const q = search.toLowerCase()
    return tasks.filter(task => task.title.toLowerCase().includes(q))
  }, [tasks, search])

  const allSelected = filtered.length > 0 && selectedIds.size === filtered.length
  const activeCustomFields = useMemo(
    () => customFieldDefs.filter(d => d.isActive),
    [customFieldDefs]
  )

  // Visible custom fields (after column-visibility filter).
  // Inline the hiddenColumns.has check (don't go through isVisible helper)
  // to make the useMemo dep graph explicit — ESLint exhaustive-deps wouldn't
  // see the indirect closure ref to hiddenColumns through isVisible.
  const visibleCustomFields = useMemo(
    () => activeCustomFields.filter(d => !hiddenColumns.has(`cf:${d.id}`)),
    [activeCustomFields, hiddenColumns]
  )

  // Event-type (channel) label/color map for the read-only Event column.
  const { typeMap: eventTypeMap } = useEventTypes(true)
  const { typeMap: taskTypeMap } = useTaskTypes(true)
  // Total column count for empty-state colspan + AddTaskRow.
  // _select + title + actions (always 3) + hideable visible + custom-fields visible.
  const visibleStandardCount = HIDEABLE_COLUMN_KEYS.filter(k => isVisible(k)).length
  const totalCols = 3 + visibleStandardCount + visibleCustomFields.length

  // Open/Closed grouping (Bordio table view). Closed = done/completed/cancelled.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggleGroup = (k: string) => setCollapsed(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n })
  const openTasks = groupOpenClosed ? filtered.filter(t => !CLOSED_STATUSES.has(t.status)) : filtered
  const closedTasks = groupOpenClosed ? filtered.filter(t => CLOSED_STATUSES.has(t.status)) : []
  // Board-parity bucketing (customGroups mode): known keys in group order,
  // stragglers kept aside and rendered as their own trailing sections.
  const groupedByKey = useMemo(() => {
    if (!customGroups || !groupKeyOf) return null
    const known = new Map<string, InlineTask[]>(customGroups.map(g => [g.key, []]))
    const extra = new Map<string, InlineTask[]>()
    for (const tk of filtered) {
      const k = groupKeyOf(tk)
      if (known.has(k)) known.get(k)!.push(tk)
      else { if (!extra.has(k)) extra.set(k, []); extra.get(k)!.push(tk) }
    }
    return { known, extra }
  }, [customGroups, groupKeyOf, filtered])
  const renderRow = (task: InlineTask) => (
    <TaskRow
      key={task.id}
      task={task}
      isSelected={selectedIds.has(task.id)}
      onToggleSelect={() => onToggleSelect(task.id)}
      onUpdate={onUpdate}
      onDelete={() => onDelete(task.id)}
      onEdit={() => onEdit(task)}
      onOpenDetail={() => onOpenDetail(task.id)}
      rowClassName={rowClassName}
      statusLabels={statusLabels}
      priorityLabels={priorityLabels}
      customFieldDefs={visibleCustomFields}
      users={users}
      projects={projects}
      hiddenColumns={hiddenColumns}
      taskTypeMap={taskTypeMap}
      eventTypeMap={eventTypeMap}
      statusOptions={statusOptions}
    />
  )

  return (
    <div className="space-y-3 pb-20">
      {/* Search bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("searchPlaceholder")}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <span className="text-sm text-muted-foreground">
          {tc("results", { count: filtered.length })}
        </span>
        {activeCustomFields.length > 0 && (
          <span className="text-xs text-muted-foreground border-l border-zinc-200 dark:border-zinc-700 pl-3 ml-1">
            + {activeCustomFields.length} custom field{activeCustomFields.length === 1 ? "" : "s"}
          </span>
        )}
        <ColumnVisibilityMenu
          activeCustomFields={activeCustomFields}
          hiddenColumns={hiddenColumns}
          onChange={updateHiddenColumns}
          labels={{
            category: categoryColumnLabel ?? t("colCategory"),
            type: t("opGbType"),
            eventType: t("opGbEvent"),
            priority: t("colPriority"),
            status: t("colStatus"),
            dueDate: t("colDueDate"),
            assignee: t("colAssignee"),
            project: t("colProject"),
          }}
        />
      </div>

      {/* Mobile stacked-card view — shown below md: breakpoint. Tap-friendly
          summary that opens the task detail page (where full inline-editing
          works); avoids the 9-column horizontal scroll on narrow screens. */}
      <div className="md:hidden space-y-2">
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card p-8 text-center text-sm text-muted-foreground">
            {search ? tc("noResults") : t("noTasks") || tc("noData")}
          </div>
        ) : (
          filtered.map((task) => (
            <MobileTaskCard
              key={task.id}
              task={task}
              isSelected={selectedIds.has(task.id)}
              onToggleSelect={() => onToggleSelect(task.id)}
              onOpenDetail={() => onOpenDetail(task.id)}
              onEdit={() => onEdit(task)}
              onDelete={() => onDelete(task.id)}
              rowClassName={rowClassName}
              statusLabels={statusLabels}
              priorityLabels={priorityLabels}
            />
          ))
        )}
      </div>

      {/* Desktop table — hidden below md: breakpoint (mobile cards take over) */}
      <div className="hidden md:block rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
        <div className="overflow-x-auto">
          {/* Column sizing relies on AUTO table layout: w-px+nowrap columns
              shrink to content, the w-full/max-w-0 title column absorbs the
              rest. Adding `table-fixed` here would break title truncation. */}
          <table className="w-full text-sm">
            <thead>
              {/* Compact header (Bordio reference): every data column is
                  shrink-to-fit (w-px + nowrap) so it's exactly as wide as its
                  content; the Task column absorbs the remaining width. More
                  columns fit on screen without horizontal scrolling. */}
              <tr className="border-b border-zinc-200 dark:border-zinc-700 bg-muted/40 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="w-8 px-2 py-2.5">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={onToggleSelectAll}
                    className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-600"
                  />
                </th>
                <SortableHeader
                  label={t("colTask")}
                  columnKey="title"
                  currentSort={sortBy}
                  onSort={onSortChange}
                  className="w-full min-w-[220px] text-left"
                />
                {isVisible("category") && (
                  <th className="w-px whitespace-nowrap px-2 py-2.5 text-left">{categoryColumnLabel ?? t("colCategory")}</th>
                )}
                {isVisible("type") && (
                  <th className="w-px whitespace-nowrap px-2 py-2.5 text-left">{t("opGbType")}</th>
                )}
                {isVisible("eventType") && (
                  <th className="w-px whitespace-nowrap px-2 py-2.5 text-left">{t("opGbEvent")}</th>
                )}
                {isVisible("priority") && (
                  <SortableHeader
                    label={t("colPriority")}
                    columnKey="priority"
                    currentSort={sortBy}
                    onSort={onSortChange}
                    className="w-px whitespace-nowrap text-left"
                  />
                )}
                {isVisible("status") && (
                  <SortableHeader
                    label={t("colStatus")}
                    columnKey="status"
                    currentSort={sortBy}
                    onSort={onSortChange}
                    className="w-px whitespace-nowrap text-left"
                  />
                )}
                {isVisible("dueDate") && (
                  <SortableHeader
                    label={t("colDueDate")}
                    columnKey="dueDate"
                    currentSort={sortBy}
                    onSort={onSortChange}
                    className="w-px whitespace-nowrap text-left"
                  />
                )}
                {isVisible("assignee") && (
                  <th className="w-px whitespace-nowrap px-2 py-2.5 text-left">{t("colAssignee")}</th>
                )}
                {isVisible("project") && (
                  <th className="w-px whitespace-nowrap px-2 py-2.5 text-left">{t("colProject")}</th>
                )}
                {visibleCustomFields.map(def => (
                  <th key={def.id} className="w-px whitespace-nowrap px-2 py-2.5 text-left">
                    {def.fieldLabel}
                    {def.isRequired && <span className="text-red-500 ml-0.5">*</span>}
                  </th>
                ))}
                <th className="w-px px-2 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {/* Add-task row always renders FIRST (above all groups): with
                  long lists the bottom placement forced scrolling past every
                  row just to create a task (user feedback 2026-06-12). */}
              {groupedByKey && customGroups ? (
                <>
                  <AddTaskRow onCreate={onCreate} totalCols={totalCols} />
                  {customGroups.map((g) => {
                    const rows = groupedByKey.known.get(g.key) ?? []
                    if (g.optional && rows.length === 0) return null
                    return (
                      <Fragment key={g.key}>
                        <GroupHeaderRow label={g.label} count={rows.length} collapsed={collapsed.has(g.key)} onToggle={() => toggleGroup(g.key)} colSpan={totalCols} />
                        {!collapsed.has(g.key) && rows.map(renderRow)}
                      </Fragment>
                    )
                  })}
                  {[...groupedByKey.extra].map(([k, rows]) => (
                    <Fragment key={k}>
                      <GroupHeaderRow label={k} count={rows.length} collapsed={collapsed.has(k)} onToggle={() => toggleGroup(k)} colSpan={totalCols} />
                      {!collapsed.has(k) && rows.map(renderRow)}
                    </Fragment>
                  ))}
                </>
              ) : groupOpenClosed ? (
                <>
                  <AddTaskRow onCreate={onCreate} totalCols={totalCols} />
                  <GroupHeaderRow label={t("openTasks")} count={openTasks.length} collapsed={collapsed.has("open")} onToggle={() => toggleGroup("open")} colSpan={totalCols} />
                  {!collapsed.has("open") && openTasks.map(renderRow)}
                  <GroupHeaderRow label={t("closedTasks")} count={closedTasks.length} collapsed={collapsed.has("closed")} onToggle={() => toggleGroup("closed")} colSpan={totalCols} />
                  {!collapsed.has("closed") && closedTasks.map(renderRow)}
                </>
              ) : (
                <>
                  <AddTaskRow onCreate={onCreate} totalCols={totalCols} />
                  {filtered.map(renderRow)}
                </>
              )}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={totalCols} className="px-3 py-10 text-center text-muted-foreground">
                    {search ? tc("noResults") : t("noTasks") || tc("noData")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── Open/Closed group header row (Bordio table view) ────────────
function GroupHeaderRow({ label, count, collapsed, onToggle, colSpan }: {
  label: string; count: number; collapsed: boolean; onToggle: () => void; colSpan: number
}) {
  return (
    <tr className="bg-muted/30 border-b border-zinc-200 dark:border-zinc-700">
      <td colSpan={colSpan} className="px-2 py-2">
        <button type="button" onClick={onToggle} className="flex items-center gap-1.5 text-sm font-semibold text-foreground hover:opacity-80">
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          {label}
          <span className="ml-1 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">{count}</span>
        </button>
      </td>
    </tr>
  )
}

// ─── Sortable Header ─────────────────────────────────────────────
function SortableHeader({
  label, columnKey, currentSort, onSort, className,
}: {
  label: string
  columnKey: string
  currentSort: string
  onSort: (sort: string) => void
  className?: string
}) {
  const keys = COLUMN_SORT_KEYS[columnKey]
  if (!keys) {
    return <th className={cn("px-2 py-2.5", className)}>{label}</th>
  }
  const isAsc = currentSort === keys.asc
  const isDesc = currentSort === keys.desc
  const Icon = isAsc ? ArrowUp : isDesc ? ArrowDown : ArrowUpDown
  return (
    <th className={cn("px-2 py-2.5", className)}>
      <button
        type="button"
        onClick={() => onSort(isAsc ? keys.desc : keys.asc)}
        title={`Sort by ${label.toLowerCase()}`}
        className="inline-flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      >
        {label}
        <Icon className={cn(
          "h-3 w-3 transition-opacity",
          (isAsc || isDesc) ? "opacity-100 text-primary" : "opacity-40"
        )} />
      </button>
    </th>
  )
}

// ─── Task Row ────────────────────────────────────────────────────
interface TaskRowProps {
  task: InlineTask
  isSelected: boolean
  onToggleSelect: () => void
  onUpdate: (taskId: string, patch: Record<string, unknown>) => Promise<void>
  onDelete: () => void
  onEdit: () => void
  onOpenDetail: () => void
  rowClassName?: (task: InlineTask) => string
  statusLabels: Record<string, string>
  priorityLabels: Record<string, string>
  customFieldDefs: CustomFieldDef[]
  users: InlineUser[]
  projects: InlineProject[]
  hiddenColumns: Set<string>
  taskTypeMap: Map<string, TaskTypeInfo>
  eventTypeMap: Map<string, TaskTypeInfo>
  statusOptions?: string[]
}

function TaskRow({
  task, isSelected, onToggleSelect, onUpdate, onDelete, onEdit, onOpenDetail,
  rowClassName, statusLabels, priorityLabels, customFieldDefs, users, projects, hiddenColumns, taskTypeMap, eventTypeMap, statusOptions,
}: TaskRowProps) {
  const isVisible = (key: string) => !hiddenColumns.has(key)
  const tc = useTranslations("common")
  const extraClass = rowClassName?.(task) || ""
  // Status vocabulary: caller-supplied (board → canonical stages) or legacy 4.
  // The todo→pending display-fold only applies when "todo" isn't a real option.
  const statusOpts = statusOptions ?? [...STATUS_OPTIONS]

  return (
    <tr className={cn(
      "border-b border-zinc-200 dark:border-zinc-700 last:border-0 transition-colors hover:bg-muted/40 group",
      // Checkbox-selected rows get a light orange wash so the selection is
      // obvious at a glance (user feedback 2026-06-12). Hover deepens (not
      // greys) it; overdue red tint (rowClassName, !important) wins on overlap.
      isSelected && "bg-orange-50 dark:bg-orange-900/15 hover:bg-orange-100/60 dark:hover:bg-orange-900/25",
      extraClass,
    )}>
      {/* Bulk select */}
      <td className="w-8 px-2 py-2 align-middle" onClick={e => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggleSelect}
          className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-600"
        />
      </td>

      {/* Title (click = open detail, double-click = rename inline) + meta
          counters (comments / checklist) right after the name, Bordio-style.
          w-full + max-w-0 lets this cell absorb the leftover width while the
          inner truncate still works (auto table layout). */}
      <td className="w-full max-w-0 px-2 py-2 align-middle">
        <div className="flex min-w-0 items-center gap-2">
          <InlineTitleCell
            value={task.title}
            status={task.status}
            onSave={(newValue) => onUpdate(task.id, { title: newValue })}
            onOpen={onOpenDetail}
            className="min-w-0 flex-1 max-w-none"
          />
          {(task._count?.comments ?? 0) > 0 && (
            <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground" title={`${task._count!.comments}`}>
              <MessageSquare className="h-3.5 w-3.5" />
              {task._count!.comments}
            </span>
          )}
          {(task._count?.checklist ?? 0) > 0 && (
            <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground">
              <ListChecks className="h-3.5 w-3.5" />
              {task.checklist
                ? `${task.checklist.filter(c => c.completed).length}/${task._count!.checklist}`
                : task._count!.checklist}
            </span>
          )}
        </div>
      </td>

      {/* Category (read-only). Board quarter-axis tasks (category mapped into
          relatedType, values Q1–Q4) render as the compact amber Q-badge from
          the kanban featured cards — no emoji fallback, no missing-i18n-key
          text, no 100px reserve, so the Rüb/Quarter column shrinks to badge
          width. */}
      {isVisible("category") && (
        <td className="whitespace-nowrap px-2 py-2 align-middle text-xs text-muted-foreground">
          {task.relatedType ? (
            QUARTER_RE.test(task.relatedType) ? (
              <span className="inline-block rounded bg-[#FF8B00] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                {task.relatedType}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 whitespace-nowrap">
                <span>{CATEGORY_ICONS[task.relatedType] || "📋"}</span>
                <span className="truncate max-w-[100px]">
                  {task.relatedName || tc(task.relatedType)}
                </span>
              </span>
            )
          ) : "—"}
        </td>
      )}

      {/* Task type (read-only — functional category). Colored rounded square
          + truncated label = the reference's Type chip. */}
      {isVisible("type") && (
        <td className="whitespace-nowrap px-2 py-2 align-middle text-xs">
          {task.type ? (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap" title={taskTypeMap.get(task.type)?.displayName ?? task.type}>
              <span className="h-3.5 w-3.5 shrink-0 rounded-[4px]" style={{ background: taskTypeMap.get(task.type)?.color ?? "#9CA3AF" }} />
              <span className="truncate max-w-[110px]">{taskTypeMap.get(task.type)?.displayName ?? task.type}</span>
            </span>
          ) : <span className="text-muted-foreground">—</span>}
        </td>
      )}

      {/* Event type (read-only — channel/source axis) */}
      {isVisible("eventType") && (
        <td className="whitespace-nowrap px-2 py-2 align-middle text-xs">
          {task.eventType ? (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap" title={eventTypeMap.get(task.eventType)?.displayName ?? task.eventType}>
              <span className="h-3.5 w-3.5 shrink-0 rounded-[4px]" style={{ background: eventTypeMap.get(task.eventType)?.color ?? "#9CA3AF" }} />
              <span className="truncate max-w-[110px]">{eventTypeMap.get(task.eventType)?.displayName ?? task.eventType}</span>
            </span>
          ) : <span className="text-muted-foreground">—</span>}
        </td>
      )}

      {/* Priority (editable) — colored direction icon + plain label */}
      {isVisible("priority") && (
        <td className="whitespace-nowrap px-2 py-2 align-middle">
          <InlineSelectCell
            value={task.priority}
            options={[...PRIORITY_OPTIONS]}
            labels={priorityLabels}
            badgeClasses={PRIORITY_BADGE_CLASSES}
            icons={Object.fromEntries([...PRIORITY_OPTIONS, task.priority].map(p => [p, <PriorityGlyph key={p} priority={p} />]))}
            onSave={(newValue) => onUpdate(task.id, { priority: newValue })}
          />
        </td>
      )}

      {/* Status (editable) — status icon + plain label (reference look) */}
      {isVisible("status") && (
        <td className="whitespace-nowrap px-2 py-2 align-middle">
          <InlineSelectCell
            value={statusOpts.includes(task.status) ? task.status : task.status === "todo" ? "pending" : task.status}
            options={statusOpts}
            labels={statusLabels}
            badgeClasses={STATUS_BADGE_CLASSES}
            icons={statusIconMap([...new Set([...statusOpts, task.status])])}
            onSave={(newValue) => onUpdate(task.id, { status: newValue })}
          />
        </td>
      )}

      {/* Due date (editable) */}
      {isVisible("dueDate") && (
        <td className="whitespace-nowrap px-2 py-2 align-middle">
          <InlineDateCell
            value={task.dueDate}
            status={task.status}
            overdueDays
            onSave={(newValue) => onUpdate(task.id, { dueDate: newValue })}
          />
        </td>
      )}

      {/* Assignee (editable) — co-assignees shown as a "+N" chip (names on hover) */}
      {isVisible("assignee") && (
        <td className="whitespace-nowrap px-2 py-2 align-middle">
          <span className="inline-flex items-center gap-1">
            <InlineAssigneeCell
              value={task.assignedTo}
              assignee={task.assignee}
              users={users}
              collaborators={task.collaborators}
              onSave={(newValue) => {
                // Promoting a current co-assignee to primary also removes them
                // from the collaborator set (server would filter the dup; this
                // keeps the optimistic row consistent too).
                const patch: Record<string, unknown> = { assignedTo: newValue }
                if (newValue && task.collaborators?.some((c) => c.id === newValue)) {
                  patch.collaboratorIds = task.collaborators.filter((c) => c.id !== newValue).map((c) => c.id)
                }
                return onUpdate(task.id, patch)
              }}
              onSaveCollaborators={(ids) => onUpdate(task.id, { collaboratorIds: ids })}
            />
            {(task.collaborators?.length ?? 0) > 0 && (
              <span
                className="rounded-full border bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                title={task.collaborators!.map((c) => c.name).join(", ")}
              >
                +{task.collaborators!.length}
              </span>
            )}
          </span>
        </td>
      )}

      {/* Project (editable; Phase 2 Notion-tasks plan) */}
      {isVisible("project") && (
        <td className="whitespace-nowrap px-2 py-2 align-middle">
          <InlineProjectCell
            value={task.projectId ?? null}
            project={task.project ?? null}
            projects={projects}
            onSave={(newValue) => onUpdate(task.id, { projectId: newValue })}
          />
        </td>
      )}

      {/* Custom fields */}
      {customFieldDefs.map(def => {
        const value = task.customFields?.[def.fieldName]
        return (
          <td key={def.id} className="whitespace-nowrap px-2 py-2 align-middle">
            <InlineCustomFieldCell
              def={def}
              value={value}
              onSave={(newValue) => onUpdate(task.id, { customFields: { [def.fieldName]: newValue } })}
            />
          </td>
        )
      })}

      {/* Actions */}
      <td className="whitespace-nowrap px-2 py-2 align-middle">
        <div className="flex items-center gap-0.5 opacity-50 hover:opacity-100 focus-within:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
          <button type="button" onClick={onEdit} title={tc("edit")} className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={onOpenDetail} title={tc("open")} className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50">
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={onDelete} title={tc("delete")} className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-muted-foreground hover:text-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </td>
    </tr>
  )
}

// ─── Mobile Card (Roadmap #18 — responsive tables) ──────────────
// Stacked-card layout shown below md: breakpoint. Read-only summary
// (tap card → /tasks/[id] for full editing) plus an explicit action
// strip (edit / delete) and a multi-select checkbox so bulk-actions
// still work on touch. The desktop table remains the editing surface;
// mobile users get a tap-friendly browser.
function MobileTaskCard({
  task, isSelected, onToggleSelect, onOpenDetail, onEdit, onDelete,
  rowClassName, statusLabels, priorityLabels,
}: {
  task: InlineTask
  isSelected: boolean
  onToggleSelect: () => void
  onOpenDetail: () => void
  onEdit: () => void
  onDelete: () => void
  rowClassName?: (task: InlineTask) => string
  statusLabels: Record<string, string>
  priorityLabels: Record<string, string>
}) {
  const tc = useTranslations("common")
  const t = useTranslations("tasks")
  const extraClass = rowClassName?.(task) || ""
  const locale = useLocale()
  const completed = task.status === "completed"
  const overdue = isOverdueDate(task.dueDate, task.status)

  return (
    <div
      className={cn(
        "rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card p-3 shadow-[0_1px_3px_rgba(0,0,0,0.05)] transition-colors",
        isSelected && "bg-orange-50 dark:bg-orange-900/15 border-orange-200 dark:border-orange-800",
        extraClass,
      )}
    >
      <div className="flex items-start gap-2">
        {/* Bulk select — 44px touch target via padding so it's easy to hit.
            The label and action strip live OUTSIDE the open-detail button
            (siblings, not nested) so taps on them don't navigate. */}
        <label className="flex h-11 w-6 items-center justify-center -ml-1 cursor-pointer">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onToggleSelect}
            className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-600"
          />
        </label>

        {/* Tappable content area opens detail */}
        <button
          type="button"
          onClick={onOpenDetail}
          className="flex-1 min-w-0 text-left"
        >
          <h3 className={cn(
            "text-base font-medium leading-snug break-words",
            completed && "line-through text-muted-foreground",
          )}>
            {task.title || tc("untitled") || "—"}
          </h3>

          {/* Badges row — status, priority, project */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className={cn(
              "text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide font-semibold",
              STATUS_BADGE_CLASSES[task.status === "todo" ? "pending" : task.status] || "bg-zinc-100 text-zinc-600",
            )}>
              {statusLabels[task.status] || task.status}
            </span>
            <span className={cn(
              "text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide font-semibold",
              PRIORITY_BADGE_CLASSES[task.priority] || "bg-zinc-100 text-zinc-600",
            )}>
              {priorityLabels[task.priority] || task.priority}
            </span>
            {task.project && (
              <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: task.project.color || "#a1a1aa" }}
                />
                {task.project.name}
              </span>
            )}
            {task.relatedType && (
              QUARTER_RE.test(task.relatedType) ? (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#FF8B00] font-semibold text-white">
                  {task.relatedType}
                </span>
              ) : (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  {CATEGORY_ICONS[task.relatedType] || "📋"} {task.relatedName || tc(task.relatedType)}
                </span>
              )
            )}
          </div>

          {/* Meta row — assignee, due date */}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {task.assignee && (
              <span className="inline-flex items-center gap-1">
                <div className="h-4 w-4 rounded-full bg-primary/10 flex items-center justify-center text-[9px] font-medium text-primary">
                  {task.assignee.name?.charAt(0)?.toUpperCase() || "?"}
                </div>
                <span className="truncate max-w-[120px]">{task.assignee.name}</span>
              </span>
            )}
            {task.dueDate && (
              <span className={cn(
                "inline-flex items-center gap-1",
                overdue && "text-red-600 dark:text-red-400 font-medium",
              )}>
                <CalendarIcon className="h-3 w-3" />
                {overdue ? t("dueOverdue", { days: daysOverdueOf(task.dueDate) }) : formatDate(task.dueDate, locale)}
              </span>
            )}
          </div>
        </button>

        {/* Action strip — edit / delete. 44px touch targets per Apple HIG.
            Siblings of the open-detail button (not nested), so no need to
            stopPropagation. */}
        <div className="flex flex-col gap-1 shrink-0">
          <button
            type="button"
            onClick={onEdit}
            aria-label={tc("edit")}
            className="h-11 w-11 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground active:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label={tc("delete")}
            className="h-11 w-11 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500 active:bg-red-100/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Inline Title Cell ───────────────────────────────────────────
// Notion-style behavior:
//   single click → open task detail page (after 200ms; cancellable by doubleclick)
//   double click → start inline rename (cancels the pending navigation)
//   Enter to save, Esc to cancel while editing
//
// The 200ms debounce on single-click is required: without it, a real double-click
// triggers TWO onClick events + onDoubleClick. The router would navigate before
// the second click could be interpreted as a doubleclick, and the rename would
// flash on the unmounting page. The debounce lets us cancel the navigation when
// the second click arrives.
//
// Exported so other entity tables (contacts/deals/leads) can reuse the click=open,
// dblclick=rename pattern. The `status` prop is optional — only used for the
// line-through styling when status === "completed" (tasks-only). For other
// entities, omit it.
export function InlineTitleCell({ value, status, onSave, onOpen, className }: {
  value: string
  status?: string
  onSave: (v: string) => Promise<void>
  onOpen: () => void
  /** Extra classes merged onto the cell root (e.g. `max-w-none flex-1` when the
      column itself bounds the width). Default keeps the legacy 300px cap. */
  className?: string
}) {
  const [editing, setEditing] = useState(false)
  const t = useTranslations("tasks")
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { if (!editing) setDraft(value) }, [value, editing])
  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  // Clean up any pending click timer on unmount
  useEffect(() => () => {
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current)
  }, [])

  const handleClick = () => {
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current)
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null
      onOpen()
    }, 200)
  }

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    // Cancel any pending single-click navigation
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current)
      clickTimerRef.current = null
    }
    setEditing(true)
  }

  const commit = async () => {
    const trimmed = draft.trim()
    if (!trimmed || trimmed === value) { setDraft(value); setEditing(false); return }
    setSaving(true)
    try { await onSave(trimmed) } catch { setDraft(value) } finally { setSaving(false); setEditing(false) }
  }
  const cancel = () => { setDraft(value); setEditing(false) }
  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); commit() }
    else if (e.key === "Escape") { e.preventDefault(); cancel() }
  }

  if (editing) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <input
          ref={inputRef} value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={handleKey} onBlur={commit} disabled={saving}
          className="flex-1 bg-transparent border-b border-primary focus:outline-none text-sm py-0.5 -my-0.5"
        />
        {saving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </div>
    )
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={(e) => {
        // Enter ONLY on focused cell → open inline rename.
        // (Space is intentionally NOT handled: Space-keyup fires a synthetic
        //  click on role="button" divs in Chrome/Firefox, which would race
        //  with our handleClick → navigate. Plus Space is the global scroll
        //  key — overriding it breaks page-scroll UX. Users get Enter
        //  to rename, Space stays as native scroll.)
        if (e.key === "Enter") {
          e.preventDefault()
          setEditing(true)
        }
      }}
      className={cn(
        "block max-w-[300px] cursor-pointer rounded px-1 -mx-1 py-0.5 -my-0.5 hover:bg-muted/60 hover:underline underline-offset-2 truncate focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        status === "completed" && "line-through text-muted-foreground",
        className,
      )}
      title={t("inlineTitleTooltip")}
    >
      {value || <span className="text-muted-foreground italic">{t("inlineUntitledTask")}</span>}
    </div>
  )
}

// ─── Inline Select Cell (Priority + Status + custom select fields) ─
// Exported so other entity tables (contacts/deals/leads) can reuse for
// source/category/stage/etc. — pass option labels and a badge class map.
export function InlineSelectCell({ value, options, labels, badgeClasses, onSave, placeholder, icons }: {
  value: string
  options: string[]
  labels: Record<string, string>
  badgeClasses: Record<string, string>
  /** When called with null, the caller should treat it as "delete/unset" (send null to backend). */
  onSave: (v: string | null) => Promise<void>
  placeholder?: string
  /** Optional value→glyph map. When provided, the cell renders icon + plain
      label (Bordio-style, narrower) instead of a colored badge pill — in both
      the trigger and the dropdown options. Omit for the legacy pill look. */
  icons?: Record<string, ReactNode>
}) {
  const t = useTranslations("tasks")
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  const pick = async (opt: string | null) => {
    setOpen(false)
    if (opt === value || (opt === null && !value)) return
    setSaving(true)
    // Catch swallows the {handled:true} rejection from optimistic-update rollback —
    // parent already showed a toast and reverted the state. Re-throwing here would
    // surface "Uncaught (in promise)" in the browser console on every failed save.
    try { await onSave(opt) } catch { /* handled upstream via toast + rollback */ } finally { setSaving(false) }
  }

  const currentLabel = value ? (labels[value] || value) : (placeholder || "—")
  const currentClass = value
    ? (badgeClasses[value] || "bg-zinc-100 text-zinc-700")
    : "bg-transparent text-muted-foreground border border-dashed border-zinc-300 dark:border-zinc-600"

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
        disabled={saving}
        title={t("inlineSelectTooltip")}
        className={icons ? cn(
          "inline-flex items-center gap-1.5 rounded px-1 -mx-1 py-0.5 text-xs whitespace-nowrap hover:bg-muted transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
          value ? "text-foreground" : "text-muted-foreground",
        ) : cn(
          "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap hover:ring-2 hover:ring-primary/30 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
          currentClass,
        )}
      >
        {icons && value ? icons[value] : null}
        {currentLabel}
        {saving && <Loader2 className="h-3 w-3 animate-spin" />}
      </button>
      {open && (
        <div className="absolute z-50 mt-1 min-w-[160px] rounded-lg border border-zinc-200 dark:border-zinc-700 bg-popover shadow-md py-1">
          {placeholder && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); pick(null) }}
              className="w-full text-left px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted italic"
            >
              {t("inlineClearSelect")}
            </button>
          )}
          {options.map(opt => (
            <button
              key={opt}
              type="button"
              onClick={(e) => { e.stopPropagation(); pick(opt) }}
              className={cn(
                "w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors flex items-center justify-between",
                opt === value && "bg-muted/60 font-medium",
              )}
            >
              {icons ? (
                <span className="inline-flex items-center gap-1.5 text-xs">
                  {icons[opt]}
                  {labels[opt] || opt}
                </span>
              ) : (
                <span className={cn("inline-block px-2 py-0.5 rounded-full text-[10px]", badgeClasses[opt] || "bg-zinc-100 text-zinc-700")}>
                  {labels[opt] || opt}
                </span>
              )}
              {opt === value && <Check className="h-3 w-3 text-primary" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Inline Date Cell ────────────────────────────────────────────
// Exported for reuse across entity tables (deals expectedClose, etc.).
export function InlineDateCell({ value, status, onSave, overdueDays = false }: {
  value: string | null; status: string; onSave: (v: string | null) => Promise<void>
  /** When true, an overdue date shows "{n}d overdue" instead of the date
      (task due-date semantics — user feedback 2026-06-12). Default false
      keeps the plain date for other consumers (deals expectedClose, custom
      date fields), where the actual date is what the user wants to see. */
  overdueDays?: boolean
}) {
  const t = useTranslations("tasks")
  const tcommon = useTranslations("common")
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const overdue = isOverdueDate(value, status)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  useEffect(() => { if (open) inputRef.current?.focus() }, [open])

  const commit = async (newRaw: string) => {
    setOpen(false)
    const next = newRaw || null
    const current = value ? toDateInputValue(value) : ""
    if ((next || "") === current) return
    setSaving(true)
    try { await onSave(next) } catch { /* handled upstream via toast + rollback */ } finally { setSaving(false) }
  }

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
        disabled={saving}
        title={t("inlineDateTooltip")}
        className={cn(
          "inline-flex items-center gap-1.5 rounded px-1 -mx-1 py-0.5 text-xs whitespace-nowrap hover:bg-muted transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
          overdue ? "text-red-600 font-medium" : value ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {/* Calendar glyph always present (reference look); red when overdue. */}
        <CalendarIcon className={cn("h-3.5 w-3.5 shrink-0", overdue ? "text-red-600" : "text-muted-foreground")} />
        {overdue && overdueDays
          ? t("dueOverdue", { days: daysOverdueOf(value) })
          : value && isTodayStr(value) ? tcommon("today") : formatDate(value, locale)}
        {saving && <Loader2 className="h-3 w-3 animate-spin" />}
      </button>
      {open && (
        <div className="absolute z-50 mt-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-popover shadow-md p-2 flex items-center gap-2">
          <input
            ref={inputRef}
            type="date"
            defaultValue={toDateInputValue(value)}
            onChange={(e) => commit(e.target.value)}
            className="bg-transparent text-sm focus:outline-none"
          />
          {value && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); commit("") }}
              className="p-1 rounded hover:bg-muted text-muted-foreground"
              title={t("inlineClearDate")}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Inline Assignee Cell ────────────────────────────────────────
function InlineAssigneeCell({ value, assignee, users, onSave, collaborators = [], onSaveCollaborators }: {
  value: string | null
  assignee?: { id: string; name: string; avatar?: string | null } | null
  users: InlineUser[]
  onSave: (userId: string | null) => Promise<void>
  /** Current co-assignees; rendered as a checkbox section under the primary
      list so a task can be assigned to several people from the table. */
  collaborators?: { id: string; name: string }[]
  onSaveCollaborators?: (ids: string[]) => Promise<void> | void
}) {
  const t = useTranslations("tasks")
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState("")
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false); setSearch("")
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  useEffect(() => { if (open) inputRef.current?.focus() }, [open])

  const filtered = useMemo(() => {
    if (!search) return users
    const q = search.toLowerCase()
    return users.filter(u => u.name.toLowerCase().includes(q) || (u.email || "").toLowerCase().includes(q))
  }, [users, search])

  const pick = async (userId: string | null) => {
    setOpen(false)
    setSearch("")
    if (userId === value) return
    setSaving(true)
    try { await onSave(userId) } catch { /* handled upstream via toast + rollback */ } finally { setSaving(false) }
  }

  // Toggle a co-assignee (replace-set PATCH). The dropdown stays OPEN so
  // several people can be added in one go.
  const collabIds = new Set(collaborators.map((c) => c.id))
  const toggleCollaborator = async (userId: string) => {
    if (!onSaveCollaborators) return
    const next = collabIds.has(userId)
      ? collaborators.filter((c) => c.id !== userId).map((c) => c.id)
      : [...collaborators.map((c) => c.id), userId]
    setSaving(true)
    try { await onSaveCollaborators(next) } catch { /* handled upstream */ } finally { setSaving(false) }
  }

  const displayName = assignee?.name || (value ? "—" : "")

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
        disabled={saving}
        title={t("inlineSelectTooltip")}
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs hover:bg-muted transition max-w-[160px] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      >
        {assignee ? (
          <>
            <div className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-medium text-primary shrink-0">
              {assignee.name?.charAt(0)?.toUpperCase() || "?"}
            </div>
            <span className="truncate">{displayName}</span>
          </>
        ) : (
          <span className="text-muted-foreground italic">{t("inlineUnassigned")}</span>
        )}
        {saving && <Loader2 className="h-3 w-3 animate-spin shrink-0" />}
      </button>
      {open && (
        <div className="absolute z-50 mt-1 min-w-[220px] rounded-lg border border-zinc-200 dark:border-zinc-700 bg-popover shadow-md">
          <div className="p-2 border-b border-zinc-200 dark:border-zinc-700">
            <input
              ref={inputRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t("inlineSearchUsers")}
              className="w-full bg-transparent text-xs focus:outline-none placeholder:text-muted-foreground/60"
            />
          </div>
          <div className="max-h-56 overflow-auto py-1">
            {/* ONE user list, two affordances per row: clicking the NAME sets
                the primary assignee (closes); the trailing CHECKBOX toggles a
                co-assignee (stays open). Column captions disambiguate — no
                duplicated user list (user feedback: two lists were confusing). */}
            {onSaveCollaborators && (
              <div className="flex items-center justify-between px-3 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                <span>{t("assignee")}</span>
                <span>{t("collaborators")}</span>
              </div>
            )}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); pick(null) }}
              className={cn(
                "w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors flex items-center gap-2 italic text-muted-foreground",
                value === null && "bg-muted/60",
              )}
            >
              {t("inlineUnassignedDash")}
              {value === null && <Check className="h-3 w-3 text-primary ml-auto" />}
            </button>
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-xs text-muted-foreground text-center">
                {t("inlineNoUsersFound")}
              </div>
            )}
            {filtered.map(u => {
              const isPrimary = u.id === value
              const on = collabIds.has(u.id)
              return (
                <div
                  key={u.id}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 transition-colors hover:bg-muted",
                    isPrimary && "bg-muted/60 font-medium",
                  )}
                >
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); pick(u.id) }}
                    className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left text-xs"
                  >
                    <div className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-medium text-primary shrink-0">
                      {u.name?.charAt(0)?.toUpperCase() || "?"}
                    </div>
                    <span className="truncate flex-1">{u.name}</span>
                    {isPrimary && <Check className="h-3 w-3 text-primary shrink-0" />}
                  </button>
                  {onSaveCollaborators && !isPrimary && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); toggleCollaborator(u.id) }}
                      disabled={saving}
                      title={t("collaborators")}
                      aria-label={`${t("collaborators")}: ${u.name}`}
                      aria-pressed={on}
                      className="shrink-0 p-1 disabled:opacity-50"
                    >
                      <span className={cn(
                        "flex h-3.5 w-3.5 items-center justify-center rounded border",
                        on ? "border-primary bg-primary text-primary-foreground" : "border-zinc-300 dark:border-zinc-600",
                      )}>
                        {on && <Check className="h-2.5 w-2.5" />}
                      </span>
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Inline Project Cell (Phase 2 Notion-tasks plan) ────────────
// Searchable dropdown over the org's projects. Picking a project sets
// `Task.projectId`, picking "No project" clears it.
//
// Mirrors `InlineAssigneeCell`'s search-and-select pattern so the UX is
// consistent. The colored dot uses `Project.color` when present (set by
// the project record itself) so users can tell projects apart at a glance.
export function InlineProjectCell({ value, project, projects, onSave }: {
  value: string | null
  project?: { id: string; name: string; color?: string | null } | null
  projects: InlineProject[]
  onSave: (projectId: string | null) => Promise<void>
}) {
  const t = useTranslations("tasks")
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState("")
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false); setSearch("")
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  useEffect(() => { if (open) inputRef.current?.focus() }, [open])

  const filtered = useMemo(() => {
    if (!search) return projects
    const q = search.toLowerCase()
    return projects.filter(p => p.name.toLowerCase().includes(q))
  }, [projects, search])

  const pick = async (projectId: string | null) => {
    setOpen(false)
    setSearch("")
    if (projectId === value) return
    setSaving(true)
    try { await onSave(projectId) } catch { /* handled upstream */ } finally { setSaving(false) }
  }

  const displayName = project?.name || (value ? "—" : "")
  const dotColor = project?.color || "#a1a1aa" // zinc-400 fallback

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
        disabled={saving}
        title={t("inlineSelectTooltip")}
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs hover:bg-muted transition max-w-[160px] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      >
        {project ? (
          <>
            <span
              className="h-2.5 w-2.5 rounded-full shrink-0"
              style={{ backgroundColor: dotColor }}
            />
            <span className="truncate">{displayName}</span>
          </>
        ) : (
          <span className="text-muted-foreground italic">{t("inlineNoProject")}</span>
        )}
        {saving && <Loader2 className="h-3 w-3 animate-spin shrink-0" />}
      </button>
      {open && (
        <div className="absolute z-50 mt-1 min-w-[220px] rounded-lg border border-zinc-200 dark:border-zinc-700 bg-popover shadow-md">
          <div className="p-2 border-b border-zinc-200 dark:border-zinc-700">
            <input
              ref={inputRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t("inlineSearchProjects")}
              className="w-full bg-transparent text-xs focus:outline-none placeholder:text-muted-foreground/60"
            />
          </div>
          <div className="max-h-56 overflow-auto py-1">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); pick(null) }}
              className={cn(
                "w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors flex items-center gap-2 italic text-muted-foreground",
                value === null && "bg-muted/60",
              )}
            >
              {t("inlineNoProjectDash")}
              {value === null && <Check className="h-3 w-3 text-primary ml-auto" />}
            </button>
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-xs text-muted-foreground text-center">
                {t("inlineNoProjectsFound")}
              </div>
            )}
            {filtered.map(p => (
              <button
                key={p.id}
                type="button"
                onClick={(e) => { e.stopPropagation(); pick(p.id) }}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors flex items-center gap-2",
                  p.id === value && "bg-muted/60 font-medium",
                )}
              >
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: p.color || "#a1a1aa" }}
                />
                <span className="truncate flex-1">{p.name}</span>
                {p.id === value && <Check className="h-3 w-3 text-primary shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Inline Custom Field Cell (dispatches by fieldType) ──────────
// Exported so detail pages (e.g. /tasks/[id]) can reuse the same renderer.
export function InlineCustomFieldCell({ def, value, onSave }: {
  def: CustomFieldDef
  value: unknown
  onSave: (v: unknown) => Promise<void>
}) {
  const t = useTranslations("tasks")
  switch (def.fieldType) {
    case "select": {
      const options = def.options || []
      const labels = Object.fromEntries(options.map(o => [o, o]))
      const badgeClasses = Object.fromEntries(
        options.map(o => [o, "bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300"])
      )
      return (
        <InlineSelectCell
          value={typeof value === "string" ? value : ""}
          options={options}
          labels={labels}
          badgeClasses={badgeClasses}
          onSave={onSave}
          placeholder={t("inlineSelectPlaceholder")}
        />
      )
    }
    case "boolean":
      return (
        <InlineBooleanCell
          value={Boolean(value)}
          onSave={onSave}
        />
      )
    case "date":
      return (
        <InlineDateCell
          value={typeof value === "string" ? value : null}
          status=""
          onSave={onSave}
        />
      )
    case "number":
      return (
        <InlineTextCell
          value={value === null || value === undefined ? "" : String(value)}
          inputType="number"
          placeholder="0"
          onSave={(v) => onSave(v === "" ? null : Number(v))}
        />
      )
    case "textarea":
    case "text":
    default:
      return (
        <InlineTextCell
          value={typeof value === "string" ? value : ""}
          inputType="text"
          placeholder={def.fieldType === "textarea" ? "…" : t("inlineEmptyText")}
          onSave={onSave}
        />
      )
  }
}

// ─── Inline Text Cell (text/number for custom fields + entity emails/phones) ─
// Exported for reuse across entity tables (contacts/deals/leads/companies).
export function InlineTextCell({ value, inputType, placeholder, onSave }: {
  value: string
  inputType: "text" | "number"
  placeholder: string
  onSave: (v: string) => Promise<void>
}) {
  const t = useTranslations("tasks")
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (!editing) setDraft(value) }, [value, editing])
  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  const commit = async () => {
    if (draft === value) { setEditing(false); return }
    setSaving(true)
    try { await onSave(draft) } catch { setDraft(value) } finally { setSaving(false); setEditing(false) }
  }
  const cancel = () => { setDraft(value); setEditing(false) }
  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); commit() }
    else if (e.key === "Escape") { e.preventDefault(); cancel() }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type={inputType}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={handleKey}
        onBlur={commit}
        disabled={saving}
        className="w-full bg-transparent border-b border-primary focus:outline-none text-sm py-0.5"
      />
    )
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => setEditing(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          setEditing(true)
        }
      }}
      className="cursor-text rounded px-1 -mx-1 py-0.5 -my-0.5 hover:bg-muted/60 text-sm truncate focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      title={value || t("inlineTextTooltip")}
    >
      {value || <span className="text-muted-foreground italic">{placeholder}</span>}
    </div>
  )
}

// ─── Inline Boolean Cell ─────────────────────────────────────────
// Exported for reuse across entity tables (contacts isActive, etc.).
export function InlineBooleanCell({ value, onSave }: {
  value: boolean
  onSave: (v: boolean) => Promise<void>
}) {
  const t = useTranslations("tasks")
  const [saving, setSaving] = useState(false)
  const toggle = async () => {
    setSaving(true)
    try { await onSave(!value) } catch { /* handled upstream via toast + rollback */ } finally { setSaving(false) }
  }
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={saving}
      title={value ? t("inlineUncheckTooltip") : t("inlineCheckTooltip")}
      className={cn(
        "inline-flex h-4 w-4 items-center justify-center rounded border-2 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        value ? "border-primary bg-primary text-primary-foreground" : "border-zinc-300 dark:border-zinc-600 hover:border-primary",
      )}
    >
      {saving ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : (value && <Check className="h-2.5 w-2.5" />)}
    </button>
  )
}

// ─── Inline Add-Task Row ─────────────────────────────────────────
function AddTaskRow({ onCreate, totalCols }: {
  onCreate: (patch: Record<string, unknown>) => Promise<void>
  totalCols: number
}) {
  const t = useTranslations("tasks")
  const tc = useTranslations("common")
  const [active, setActive] = useState(false)
  const [title, setTitle] = useState("")
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (active) inputRef.current?.focus() }, [active])

  const reset = () => { setTitle(""); setActive(false) }

  const commit = async (keepOpen = false) => {
    const trimmed = title.trim()
    if (!trimmed) { reset(); return }
    setSaving(true)
    try {
      await onCreate({ title: trimmed, priority: "medium", status: "pending" })
      setTitle("")
      if (keepOpen) setTimeout(() => inputRef.current?.focus(), 50)
      else setActive(false)
    } finally { setSaving(false) }
  }

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); commit(true) }
    else if (e.key === "Escape") { e.preventDefault(); reset() }
  }

  if (!active) {
    return (
      <tr
        onClick={() => setActive(true)}
        title={t("inlineAddTaskTooltip")}
        className="border-b border-zinc-200 dark:border-zinc-700 cursor-pointer hover:bg-orange-50 dark:hover:bg-orange-900/15 transition-colors"
      >
        {/* Inner <td> takes the focus + keyboard handlers so keyboard users
            can reach Add-Task. (Putting tabIndex on <tr> is technically valid
            but role="button" is semantically meaningless on a row.) */}
        <td colSpan={totalCols} className="px-2 py-2.5">
          <div
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                setActive(true)
              }
            }}
            className="flex items-center gap-2 text-sm text-muted-foreground rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 -m-1 p-1"
          >
            <Plus className="h-4 w-4" />
            {t("inlineAddTask")}
          </div>
        </td>
      </tr>
    )
  }

  return (
    // Active (typing) state: light orange wash, clearly visible — the old
    // bg-primary/5 read as plain white (user feedback 2026-06-12).
    <tr className="border-b border-zinc-200 dark:border-zinc-700 bg-orange-100/70 dark:bg-orange-900/25">
      <td className="px-2 py-2.5"></td>
      <td colSpan={totalCols - 2} className="px-2 py-2.5">
        <div className="flex items-center gap-2">
          <Plus className="h-4 w-4 text-primary shrink-0" />
          <input
            ref={inputRef}
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={handleKey}
            onBlur={() => commit(false)}
            disabled={saving}
            placeholder={t("inlineAddTaskInputPlaceholder")}
            className="flex-1 bg-transparent border-none focus:outline-none text-sm placeholder:text-muted-foreground/60"
          />
          {saving && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
        </div>
      </td>
      <td className="px-2 py-2.5">
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); commit(false) }}
          disabled={saving || !title.trim()}
          className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {tc("save")}
        </button>
      </td>
    </tr>
  )
}

// ─── Column Visibility Menu (Roadmap #12) ────────────────────────
// "Columns" button + popover with a checkbox per hideable column.
// Selection persisted to localStorage in the parent.
function ColumnVisibilityMenu({
  activeCustomFields, hiddenColumns, onChange, labels,
}: {
  activeCustomFields: CustomFieldDef[]
  hiddenColumns: Set<string>
  onChange: (next: Set<string>) => void
  labels: Record<HideableKey, string>
}) {
  const t = useTranslations("tasks")
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  const toggle = (key: string) => {
    const next = new Set(hiddenColumns)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onChange(next)
  }

  const hiddenCount = hiddenColumns.size
  const totalCount = HIDEABLE_COLUMN_KEYS.length + activeCustomFields.length

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title={t("inlineColumnsTooltip")}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border border-zinc-200 dark:border-zinc-700 rounded-md px-2 py-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      >
        <Columns3 className="h-3 w-3" />
        {t("columnsButton")}
        {hiddenCount > 0 && (
          <span className="text-[10px] text-muted-foreground/70">({totalCount - hiddenCount}/{totalCount})</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 min-w-[220px] rounded-lg border border-zinc-200 dark:border-zinc-700 bg-popover shadow-md py-1 max-h-[400px] overflow-y-auto">
          <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("columnsSectionStandard")}
          </div>
          {HIDEABLE_COLUMN_KEYS.map(key => {
            const visible = !hiddenColumns.has(key)
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggle(key)}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors flex items-center gap-2"
              >
                <span className={cn(
                  "inline-flex h-3.5 w-3.5 items-center justify-center rounded border",
                  visible ? "border-primary bg-primary text-primary-foreground" : "border-zinc-300 dark:border-zinc-600",
                )}>
                  {visible && <Check className="h-2.5 w-2.5" />}
                </span>
                {labels[key]}
              </button>
            )
          })}
          {activeCustomFields.length > 0 && (
            <>
              <div className="px-3 pt-2 pb-1 mt-1 border-t border-zinc-200 dark:border-zinc-700 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("columnsSectionCustom")}
              </div>
              {activeCustomFields.map(def => {
                const key = `cf:${def.id}`
                const visible = !hiddenColumns.has(key)
                return (
                  <button
                    key={def.id}
                    type="button"
                    onClick={() => toggle(key)}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors flex items-center gap-2"
                  >
                    <span className={cn(
                      "inline-flex h-3.5 w-3.5 items-center justify-center rounded border",
                      visible ? "border-primary bg-primary text-primary-foreground" : "border-zinc-300 dark:border-zinc-600",
                    )}>
                      {visible && <Check className="h-2.5 w-2.5" />}
                    </span>
                    <span className="truncate">{def.fieldLabel}</span>
                  </button>
                )
              })}
            </>
          )}
        </div>
      )}
    </div>
  )
}
