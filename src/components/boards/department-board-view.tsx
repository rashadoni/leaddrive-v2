"use client"

/**
 * DepartmentBoardView — the screen you get when you open a board that is a
 * DEPARTMENT (a container grouping section boards). It shows, across the
 * department's sections:
 *   • a section filter (one / several / all — default all)
 *   • a COMBINED board folded onto the 6 canonical stages, each card badged with
 *     its section; clicking a card opens the full task detail (edit/move there)
 *   • a Reports tab aggregating analytics over the selected sections
 *
 * It opens as the LIST of every task of its sections, grouped by stage, each row
 * naming its board (owner, 2026-11-11: «по умолчанию чтоб были показаны не как
 * канбан а как список»); the combined board is the second tab.
 *
 * Rendered by /boards/[divisionId] when division.isDepartment. A department holds
 * no tasks of its own and has no custom columns, so the aggregate uses the
 * canonical stages (resolveLaneKey folds each section's custom lanes onto them).
 *
 * v1 scope: the combined board is read + click-to-open. Drag-to-move lives on the
 * individual section board (open a section to reorder) — see the parent's notes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2, Columns3 } from "lucide-react"
import { CANONICAL_STAGES, STAGE_LABELS, resolveLaneKey, type LaneColumn } from "@/lib/tasks/board-columns"
import { BoardReports } from "@/components/boards/board-reports"
import { BoardProjectTabs } from "@/components/boards/board-project-tabs"
import { TaskPanel } from "@/components/tasks/task-panel/task-panel"
import { InlineTasksTable, type InlineTask, type InlineUser } from "@/components/tasks/inline-tasks-table"
import { fetchAllFolderTasks } from "@/lib/tasks/fetch-board-tasks"

interface DeptDivision { id: string; key: string; name: string; color: string | null }
interface SectionLite { id: string; key: string; name: string; color: string | null; parentDivisionId?: string | null; _count?: { tasks: number } }
interface DeptTask {
  id: string
  taskKey: string | null
  title: string
  status: string
  boardColumnKey: string | null
  priority?: string | null
  type?: string | null
  eventType?: string | null
  category?: string | null
  dueDate?: string | null
  division?: { id: string; name: string; key: string; color: string | null } | null
  assignee?: { id: string; name: string; avatar?: string | null } | null
  collaborators?: { user: { id: string; name: string } }[]
  _count?: { comments?: number; checklist?: number }
}

type DeptView = "list" | "board" | "reports"

const PRIORITY_DOT: Record<string, string> = {
  urgent: "#DE350B", high: "#FF8B00", medium: "#0065FF", low: "#6B778C",
}

const LANE_COLS: LaneColumn[] = CANONICAL_STAGES.map((s) => ({ key: s, mapsToStatus: s }))

export function DepartmentBoardView({ division }: { division: DeptDivision }) {
  const t = useTranslations("board")
  const tc = useTranslations("common")
  const tTask = useTranslations("tasks")
  const [sections, setSections] = useState<SectionLite[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set()) // empty = all sections
  const [tasks, setTasks] = useState<DeptTask[]>([])
  const [total, setTotal] = useState(0) // server-side total (to detect truncation)
  const [loading, setLoading] = useState(true)
  const [sectionsLoading, setSectionsLoading] = useState(true) // distinct from task loading
  const [view, setView] = useState<DeptView>("list")
  // The «Hesabatlar» tab is per person (lib/tasks/board-reports-access.ts).
  const [reportsOpen, setReportsOpen] = useState(true)
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)

  const TASK_CAP = 200 // GET /tasks rejects limit > 200 unless the request names one board

  // The department's child sections (the divisions list already filters to what
  // the user can see, so a section-scoped member only gets their own sections).
  useEffect(() => {
    let alive = true
    setSectionsLoading(true)
    fetch("/api/v1/divisions", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive) return
        const all = (j?.data?.divisions ?? []) as SectionLite[]
        setReportsOpen(j?.data?.me?.boardReports !== false)
        setSections(all.filter((d) => d.parentDivisionId === division.id))
      })
      .catch(() => {})
      .finally(() => { if (alive) setSectionsLoading(false) })
    return () => { alive = false }
  }, [division.id])

  const activeSectionIds = useMemo(
    () => (selected.size ? sections.filter((s) => selected.has(s.id)).map((s) => s.id) : sections.map((s) => s.id)),
    [sections, selected],
  )
  const sectionsParam = selected.size ? activeSectionIds.join(",") : ""

  // The combined board draws at most TASK_CAP cards; the list (and the reports'
  // assignee filter) reads every task of the sections.
  const capped = view === "board"
  // Only the newest read is applied: an older answer arriving late must not
  // undo an edit made after it began (CLAUDE.md, «Чтение списка отвечает за
  // момент своего НАЧАЛА»).
  const reads = useRef(0)
  const loadTasks = useCallback(async (quiet = false) => {
    // Don't fetch/clear until sections have resolved (avoids an empty-state flash).
    if (sectionsLoading) return
    const read = ++reads.current
    if (!quiet) setLoading(true)
    try {
      const ids = activeSectionIds
      if (!ids.length) { setTasks([]); setTotal(0); return }
      if (!capped) {
        const all = await fetchAllFolderTasks<DeptTask>(ids)
        if (read !== reads.current) return
        setTasks(all)
        setTotal(all.length)
        return
      }
      const res = await fetch(`/api/v1/tasks?divisionIds=${encodeURIComponent(ids.join(","))}&limit=${TASK_CAP}`, { credentials: "include" })
      if (res.ok && read === reads.current) {
        const j = await res.json()
        if (read !== reads.current) return
        setTasks((j?.data?.tasks ?? []) as DeptTask[])
        setTotal(typeof j?.data?.total === "number" ? j.data.total : (j?.data?.tasks?.length ?? 0))
      }
    } catch {
      /* swallow — empty board renders below */
    } finally {
      if (read === reads.current) setLoading(false)
    }
  }, [activeSectionIds, sectionsLoading, capped])
  useEffect(() => { loadTasks() }, [loadTasks])

  // ── The list: the same table as a board's «Siyahı», across the sections ──
  const [listSelected, setListSelected] = useState<Set<string>>(new Set())
  const [listSort, setListSort] = useState("")
  const [users, setUsers] = useState<InlineUser[]>([])
  useEffect(() => {
    let alive = true
    fetch("/api/v1/users/assignable", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive) setUsers(((j?.data ?? []) as { id: string; name: string }[]).map((u) => ({ id: u.id, name: u.name }))) })
      .catch(() => {})
    return () => { alive = false }
  }, [])
  const statusLabels: Record<string, string> = {
    backlog: tTask("statusBacklog"), pending: tTask("statusTodo"), todo: tTask("statusTodo"),
    in_progress: tTask("statusInProgress"), testing: tTask("statusTesting"), review: tTask("statusReview"),
    done: tTask("statusCompleted"), completed: tTask("statusCompleted"), cancelled: tTask("statusCancelled"),
  }
  const priorityLabels: Record<string, string> = {
    urgent: tTask("priorityUrgent"), high: tTask("priorityHigh"), medium: tTask("priorityMedium"), low: tTask("priorityLow"),
  }
  // Each section has its own lanes; the folder folds them onto the canonical
  // stages, as its combined board does. A stage nobody uses stays hidden.
  const listGroups = useMemo(() => [
    ...CANONICAL_STAGES.map((stage) => ({ key: stage as string, label: statusLabels[stage] ?? stage, optional: true })),
    { key: "__cancelled__", label: statusLabels.cancelled, optional: true },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [tTask])
  const listGroupKeyOf = useCallback((tk: InlineTask) => {
    if (tk.status === "cancelled") return "__cancelled__"
    return resolveLaneKey({ status: tk.status, boardColumnKey: tk.boardColumnKey }, LANE_COLS) ?? "backlog"
  }, [])
  const listTasks: InlineTask[] = useMemo(() => tasks.map((x) => ({
    id: x.id, title: x.title, status: x.status, boardColumnKey: x.boardColumnKey ?? null, priority: x.priority ?? "medium",
    type: x.type ?? null, eventType: x.eventType ?? null, dueDate: x.dueDate ?? null,
    assignedTo: x.assignee?.id ?? null, assignee: x.assignee ?? null,
    collaborators: x.collaborators?.map((c) => c.user),
    relatedType: x.category ?? null, relatedName: null,
    _count: x._count,
    board: x.division ? { key: x.division.key, name: x.division.name, color: x.division.color } : null,
  })), [tasks])
  // A status picked in the list moves the card to that stage: the section's
  // own lane is dropped, so the stage is read from the status.
  const listUpdate = useCallback(async (taskId: string, patch: Record<string, unknown>) => {
    if (typeof patch.status === "string") patch = { ...patch, boardColumnKey: null }
    const local: Partial<DeptTask> = {}
    for (const key of ["title", "status", "boardColumnKey", "priority", "dueDate"] as const) {
      if (key in patch) (local as Record<string, unknown>)[key] = patch[key]
    }
    reads.current++ // a read under way answers for before this edit
    setTasks((ts) => ts.map((x) => (x.id === taskId ? { ...x, ...local } : x)))
    try {
      await fetch(`/api/v1/tasks/${taskId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify(patch),
      })
    } finally {
      loadTasks(true)
    }
  }, [loadTasks])
  const listDelete = useCallback(async (taskId: string) => {
    reads.current++
    setTasks((ts) => ts.filter((x) => x.id !== taskId))
    try {
      await fetch(`/api/v1/tasks/${taskId}`, { method: "DELETE", credentials: "include" })
    } finally {
      loadTasks(true)
    }
  }, [loadTasks])
  const toggleListSelect = (id: string) => setListSelected((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const toggleListSelectAll = () => setListSelected((p) => (p.size === listTasks.length ? new Set<string>() : new Set(listTasks.map((x) => x.id))))

  const tasksByStage = useMemo(() => {
    const m = new Map<string, DeptTask[]>()
    for (const s of CANONICAL_STAGES) m.set(s, [])
    for (const tk of tasks) {
      const lane = resolveLaneKey({ status: tk.status, boardColumnKey: tk.boardColumnKey }, LANE_COLS) ?? "backlog"
      ;(m.get(lane) ?? m.get("backlog"))!.push(tk)
    }
    return m
  }, [tasks])

  const assignees = useMemo(() => {
    const seen = new Map<string, string>()
    for (const tk of tasks) if (tk.assignee) seen.set(tk.assignee.id, tk.assignee.name)
    return [...seen].map(([id, name]) => ({ id, name }))
  }, [tasks])

  const toggleSection = (id: string) =>
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })

  return (
    <div className="flex h-full flex-col p-6">
      <div className="-mx-5"><BoardProjectTabs currentId={division.id} /></div>
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="rounded px-2 py-0.5 text-xs font-bold tracking-wide text-white" style={{ background: division.color || "#6554C0" }}>
          {division.key}
        </span>
        <h1 className="text-2xl font-bold tracking-tight">{division.name}</h1>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{t("departmentBadge")}</span>
      </div>

      {/* Tabs — the list first: it is what the folder opens in. */}
      <div data-crm-tabs="" className="mb-3 inline-flex w-fit overflow-hidden rounded-md border">
        {(["list", "board", "reports"] as const).filter((v) => v !== "reports" || reportsOpen).map((v) => (
          <button key={v} type="button" data-crm-tab="" data-state={view === v ? "active" : "inactive"} onClick={() => setView(v)} className={`px-4 py-1.5 text-sm font-medium ${view === v ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}>
            {v === "list" ? tc("list") : v === "board" ? t("boardView") : t("reportsTab")}
          </button>
        ))}
      </div>

      {/* Section filter (one / several / all) */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => setSelected(new Set())}
          className={`rounded-full border px-3 py-1 text-xs font-medium ${selected.size === 0 ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"}`}
        >
          {t("allSections")}
        </button>
        {sections.map((s) => (
          <button
            key={s.id}
            onClick={() => toggleSection(s.id)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${selected.has(s.id) ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"}`}
          >
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color || "#6554C0" }} />
            {s.name}
            <span className="text-[10px] opacity-70">{s._count?.tasks ?? 0}</span>
          </button>
        ))}
      </div>

      {view === "reports" && reportsOpen ? (
        <div className="flex-1 overflow-hidden rounded-lg border">
          <BoardReports divisionId={division.id} assignees={assignees} onOpenTask={setOpenTaskId} sectionsParam={sectionsParam} />
        </div>
      ) : view === "list" && sections.length > 0 ? (
        <div className="-mx-1">
          <InlineTasksTable
            tasks={listTasks}
            loading={loading || sectionsLoading}
            customGroups={listGroups}
            groupKeyOf={listGroupKeyOf}
            selectedIds={listSelected}
            onToggleSelect={toggleListSelect}
            onToggleSelectAll={toggleListSelectAll}
            onUpdate={listUpdate}
            onDelete={listDelete}
            onEdit={(task) => setOpenTaskId(task.id)}
            onOpenDetail={(id) => setOpenTaskId(id)}
            statusOptions={[...CANONICAL_STAGES, "cancelled"]}
            statusLabels={statusLabels}
            priorityLabels={priorityLabels}
            customFieldDefs={[]}
            users={users}
            categoryColumnLabel={tc("quarter")}
            sortBy={listSort}
            onSortChange={setListSort}
          />
        </div>
      ) : loading || sectionsLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("loading")}
        </div>
      ) : sections.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <Columns3 className="mb-3 h-10 w-10 text-muted-foreground/50" />
          <p className="font-medium">{t("departmentEmpty")}</p>
        </div>
      ) : (
        <>
          {/* Honest truncation notice — the combined board caps at TASK_CAP tasks;
              the Reports tab aggregates the full set, so they can disagree. */}
          {total > tasks.length && (
            <div className="mb-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
              {t("boardTruncated", { shown: tasks.length, total })}
            </div>
          )}
        {/* Combined board: 6 canonical stages, cards badged by section. */}
        <div className="flex flex-1 gap-3 overflow-x-auto pb-2">
          {CANONICAL_STAGES.map((stage) => {
            const items = tasksByStage.get(stage) ?? []
            return (
              <div key={stage} className="flex w-72 flex-shrink-0 flex-col rounded-lg border bg-muted/30">
                <div className="flex items-center justify-between border-b px-3 py-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{STAGE_LABELS[stage]}</span>
                  <span className="rounded-full bg-background px-1.5 text-[11px] text-muted-foreground">{items.length}</span>
                </div>
                <div className="flex-1 space-y-2 overflow-y-auto p-2">
                  {items.map((tk) => (
                    <button
                      key={tk.id}
                      onClick={() => setOpenTaskId(tk.id)}
                      className="block w-full rounded-md border bg-card p-2.5 text-left shadow-sm transition-shadow hover:shadow-md"
                    >
                      <div className="flex items-start gap-1.5">
                        <span className="mt-1 inline-block h-2 w-2 flex-shrink-0 rounded-full" style={{ background: PRIORITY_DOT[tk.priority ?? "medium"] ?? "#6B778C" }} />
                        <span className="text-sm leading-snug">{tk.title}</span>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        {tk.division && (
                          <span className="truncate rounded px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{ background: tk.division.color || "#6554C0" }}>
                            {tk.division.key}
                          </span>
                        )}
                        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          {tk.taskKey && <span className="font-mono">{tk.taskKey}</span>}
                          {tk.assignee && <span className="truncate" title={tk.assignee.name}>{tk.assignee.name}</span>}
                        </span>
                      </div>
                    </button>
                  ))}
                  {items.length === 0 && <p className="px-1 py-3 text-center text-xs text-muted-foreground/60">—</p>}
                </div>
              </div>
            )
          })}
        </div>
        </>
      )}

      {/* The task card — Bordio-style panel on the right; it reads the task's own board stages. */}
      {openTaskId && (
        <TaskPanel
          taskId={openTaskId}
          canEdit
          onClose={() => { setOpenTaskId(null); loadTasks(true) }}
          onMutated={() => loadTasks(true)}
        />
      )}
    </div>
  )
}
