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
 * Rendered by /boards/[divisionId] when division.isDepartment. A department holds
 * no tasks of its own and has no custom columns, so the aggregate uses the
 * canonical stages (resolveLaneKey folds each section's custom lanes onto them).
 *
 * v1 scope: the combined board is read + click-to-open. Drag-to-move lives on the
 * individual section board (open a section to reorder) — see the parent's notes.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2, Columns3, X } from "lucide-react"
import { CANONICAL_STAGES, STAGE_LABELS, resolveLaneKey, type LaneColumn } from "@/lib/tasks/board-columns"
import { BoardReports } from "@/components/boards/board-reports"
import { TaskDetailView } from "@/components/tasks/task-detail-view"

interface DeptDivision { id: string; key: string; name: string; color: string | null }
interface SectionLite { id: string; key: string; name: string; color: string | null; parentDivisionId?: string | null; _count?: { tasks: number } }
interface DeptTask {
  id: string
  taskKey: string | null
  title: string
  status: string
  boardColumnKey: string | null
  priority?: string | null
  division?: { id: string; name: string; key: string; color: string | null } | null
  assignee?: { id: string; name: string; avatar?: string | null } | null
}

const PRIORITY_DOT: Record<string, string> = {
  urgent: "#DE350B", high: "#FF8B00", medium: "#0065FF", low: "#6B778C",
}

const LANE_COLS: LaneColumn[] = CANONICAL_STAGES.map((s) => ({ key: s, mapsToStatus: s }))

export function DepartmentBoardView({ division }: { division: DeptDivision }) {
  const t = useTranslations("board")
  const [sections, setSections] = useState<SectionLite[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set()) // empty = all sections
  const [tasks, setTasks] = useState<DeptTask[]>([])
  const [total, setTotal] = useState(0) // server-side total (to detect truncation)
  const [loading, setLoading] = useState(true)
  const [sectionsLoading, setSectionsLoading] = useState(true) // distinct from task loading
  const [view, setView] = useState<"board" | "reports">("board")
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)

  const TASK_CAP = 200 // GET /tasks rejects limit > 200; matches the single-board page

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

  const loadTasks = useCallback(async () => {
    // Don't fetch/clear until sections have resolved (avoids an empty-state flash).
    if (sectionsLoading) return
    setLoading(true)
    try {
      const ids = activeSectionIds
      if (!ids.length) { setTasks([]); setTotal(0); return }
      const res = await fetch(`/api/v1/tasks?divisionIds=${encodeURIComponent(ids.join(","))}&limit=${TASK_CAP}`, { credentials: "include" })
      if (res.ok) {
        const j = await res.json()
        setTasks((j?.data?.tasks ?? []) as DeptTask[])
        setTotal(typeof j?.data?.total === "number" ? j.data.total : (j?.data?.tasks?.length ?? 0))
      }
    } catch {
      /* swallow — empty board renders below */
    } finally {
      setLoading(false)
    }
  }, [activeSectionIds, sectionsLoading])
  useEffect(() => { loadTasks() }, [loadTasks])

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
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="rounded px-2 py-0.5 text-xs font-bold tracking-wide text-white" style={{ background: division.color || "#6554C0" }}>
          {division.key}
        </span>
        <h1 className="text-2xl font-bold tracking-tight">{division.name}</h1>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{t("departmentBadge")}</span>
      </div>

      {/* Tabs */}
      <div className="mb-3 inline-flex w-fit overflow-hidden rounded-md border">
        <button onClick={() => setView("board")} className={`px-4 py-1.5 text-sm font-medium ${view === "board" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}>
          {t("boardView")}
        </button>
        <button onClick={() => setView("reports")} className={`px-4 py-1.5 text-sm font-medium ${view === "reports" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}>
          {t("reportsTab")}
        </button>
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

      {view === "reports" ? (
        <div className="flex-1 overflow-hidden rounded-lg border">
          <BoardReports divisionId={division.id} assignees={assignees} onOpenTask={setOpenTaskId} sectionsParam={sectionsParam} />
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

      {/* Task detail modal (shared component; full edit/move happens here) */}
      {openTaskId && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-6" onClick={() => { setOpenTaskId(null); loadTasks() }}>
          <div className="relative my-4 w-full max-w-5xl rounded-lg bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => { setOpenTaskId(null); loadTasks() }} aria-label={t("cancel")} className="absolute right-3 top-3 z-10 rounded p-1.5 text-muted-foreground hover:bg-black/5">
              <X className="h-5 w-5" />
            </button>
            <div className="max-h-[88vh] overflow-y-auto p-5 sm:p-6">
              <TaskDetailView
                taskIdProp={openTaskId}
                modal
                boardColumns={CANONICAL_STAGES.map((s) => ({ key: s, label: STAGE_LABELS[s] }))}
                onClose={() => { setOpenTaskId(null); loadTasks() }}
                onMutated={() => loadTasks()}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
