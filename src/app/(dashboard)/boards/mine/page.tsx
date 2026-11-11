"use client"

/**
 * «Mənim işlərim» — /boards/mine. The person's own tasks (assignee or
 * co-assignee) from every board, grouped by due day (owner, 2026-11-10: «Давай,
 * по макету»). A row's tick moves the task into its board's «done» column, as
 * a drag there would; a row opens the same task panel as the board. Tasks are
 * made on the boards, not here — this is a list of one's own work.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react"
import { useLocale, useTranslations } from "next-intl"
import { AlertCircle, Check, Loader2, MessageSquare, Paperclip, RotateCcw } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatDate } from "@/lib/format-date"
import { TaskPanel } from "@/components/tasks/task-panel/task-panel"
import {
  MY_WORK_GROUPS, boardLabel, columnOfTask, doneColumnOf, myWorkGroup, stockColumnStage,
  type MyWorkColumn, type MyWorkGroup,
} from "@/lib/tasks/my-work"
import { dueNote } from "@/lib/tasks/my-work-calendar"
import { rememberBoardNames } from "@/lib/tasks/board-names-cache"
import { BOARD_TASKS_PAGE } from "@/lib/tasks/fetch-board-tasks"
import { MyWorkCalendar, type CalendarTask } from "@/components/boards/my-work-calendar"
import { keepOwnDays } from "@/lib/tasks/my-work-calendar"

interface Board {
  id: string
  name: string
  color: string | null
  isDepartment?: boolean
  parentDivisionId?: string | null
  boardColumns?: MyWorkColumn[]
}

interface MyTask extends CalendarTask {
  boardColumnKey?: string | null
  completedAt?: string | null
}

type View = "list" | "calendar"
const readView = (): View => {
  try { return new URLSearchParams(window.location.search).get("view") === "calendar" ? "calendar" : "list" } catch { return "list" }
}

/** A ticked row stays on screen, struck through, until the page is read again — so it can be taken back. */
interface Ticked { status: string; boardColumnKey: string | null }

const DONE_WINDOW_DAYS = 14
const priorityKey = (p: string) => `priority${p[0].toUpperCase()}${p.slice(1)}`

async function readTasks(query: string): Promise<{ tasks: MyTask[]; total: number }> {
  const res = await fetch(`/api/v1/tasks?mine=1&${query}&limit=${BOARD_TASKS_PAGE}`, { credentials: "include" })
  if (!res.ok) throw new Error(String(res.status))
  const json = await res.json()
  return { tasks: json?.data?.tasks ?? [], total: json?.data?.total ?? 0 }
}

export default function MyWorkPage() {
  const t = useTranslations("myWork")
  const tCommon = useTranslations("common")
  const locale = useLocale()
  const [boards, setBoards] = useState<Board[]>([])
  const [tasks, setTasks] = useState<MyTask[] | null>(null)
  // Beside the state, for the same reason as the ticks below: a read that
  // began earlier has to see what the list holds now, not one render ago.
  const tasksRef = useRef<MyTask[] | null>(null)
  const changeTasks = useCallback<Dispatch<SetStateAction<MyTask[] | null>>>((next) => {
    tasksRef.current = typeof next === "function" ? next(tasksRef.current) : next
    setTasks(tasksRef.current)
  }, [])
  // «Siyahı» or «Təqvim» (Bordio's My work → Tasks / Calendar), kept in the URL.
  const [view, setViewState] = useState<View>("list")
  useEffect(() => { setViewState(readView()) }, [])
  const setView = (next: View) => {
    setViewState(next)
    try {
      const url = new URL(window.location.href)
      if (next === "calendar") url.searchParams.set("view", "calendar")
      else url.searchParams.delete("view")
      window.history.replaceState(window.history.state, "", url)
    } catch { /* the view still changes */ }
  }
  const [total, setTotal] = useState(0)
  const [failed, setFailed] = useState(false)
  const [boardFilter, setBoardFilter] = useState("")
  const [showDone, setShowDone] = useState(false)
  const [doneTasks, setDoneTasks] = useState<MyTask[] | null>(null)
  const [ticked, setTicked] = useState<Map<string, Ticked>>(new Map())
  // Beside the state: a read of the list that began earlier has to tell which
  // ticks it may forget without waiting for a render first.
  const tickedRef = useRef(ticked)
  const changeTicked = useCallback((change: (current: Map<string, Ticked>) => Map<string, Ticked>) => {
    tickedRef.current = change(tickedRef.current)
    setTicked(tickedRef.current)
  }, [])
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flash = useCallback((message: string) => {
    setToast(message)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 3500)
  }, [])

  /**
   * A read of the list answers for the moment it BEGAN, and two reads overlap
   * easily: React mounts a page twice in development, and closing the task
   * panel reads the list again. So the answer that comes back last is not
   * always the newest word, and two rules keep it from undoing the person:
   *  · only the newest read is applied — an older answer cannot overwrite it;
   *  · a read forgets only the ticks that were already there when it began;
   *  · the own day of a card moved since it began stays (`keepOwnDays`).
   * A row ticked while a read was under way used to come back open on screen
   * although the server had the task finished, and nothing ticks it again — it
   * stayed wrong until the page was read anew. The boards browser run failed
   * on exactly that, every other time (2026-11-10).
   */
  const reads = useRef(0)
  const load = useCallback(async () => {
    const seq = (reads.current += 1)
    const knownTicks = [...tickedRef.current.keys()]
    const tasksAtStart = tasksRef.current ?? []
    setFailed(false)
    try {
      const [divisionsRes, open] = await Promise.all([
        fetch("/api/v1/divisions", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)),
        readTasks("open=1"),
      ])
      if (seq !== reads.current) return
      const list: Board[] = divisionsRes?.data?.divisions ?? []
      rememberBoardNames(list)
      setBoards(list)
      changeTasks((current) => keepOwnDays(open.tasks, current ?? [], tasksAtStart))
      setTotal(open.total)
      changeTicked((current) => {
        const next = new Map(current)
        for (const id of knownTicks) next.delete(id)
        return next
      })
    } catch {
      if (seq === reads.current) setFailed(true)
    }
  }, [changeTasks, changeTicked])
  useEffect(() => { load() }, [load])

  const loadDone = useCallback(async () => {
    const since = new Date(Date.now() - DONE_WINDOW_DAYS * 86_400_000).toISOString()
    try {
      const done = await readTasks(`status=done,completed,cancelled&completedAfter=${encodeURIComponent(since)}`)
      setDoneTasks(done.tasks)
    } catch {
      setDoneTasks([])
      flash(t("failed"))
    }
  }, [flash, t])
  useEffect(() => { if (showDone && doneTasks === null) loadDone() }, [showDone, doneTasks, loadDone])

  const boardById = useMemo(() => new Map(boards.map((b) => [b.id, b])), [boards])
  // Only boards the person has a task on are offered in the filter.
  const filterBoards = useMemo(() => {
    const ids = new Set((tasks ?? []).map((x) => x.divisionId).filter(Boolean) as string[])
    return boards.filter((b) => ids.has(b.id)).map((b) => ({ id: b.id, label: boardLabel(b, boards) }))
      .sort((a, b) => a.label.localeCompare(b.label, locale))
  }, [boards, tasks, locale])

  const visible = useCallback((list: MyTask[]) => (boardFilter ? list.filter((x) => x.divisionId === boardFilter) : list), [boardFilter])

  const groups = useMemo(() => {
    const now = new Date()
    const byGroup = new Map<MyWorkGroup, MyTask[]>(MY_WORK_GROUPS.map((g) => [g, []]))
    for (const task of visible(tasks ?? [])) byGroup.get(myWorkGroup(task.dueDate, now))!.push(task)
    for (const list of byGroup.values()) {
      list.sort((a, b) => (a.dueDate ? new Date(a.dueDate).getTime() : Infinity) - (b.dueDate ? new Date(b.dueDate).getTime() : Infinity)
        || a.title.localeCompare(b.title, locale))
    }
    return byGroup
  }, [tasks, visible, locale])

  const openCount = (tasks ? visible(tasks) : []).filter((x) => !ticked.has(x.id)).length
  const overdueCount = (groups.get("overdue") ?? []).filter((x) => !ticked.has(x.id)).length

  /** Tick: into the board's «done» column. Untick: back where it stood. */
  async function toggle(task: MyTask) {
    if (busy.has(task.id)) return
    const board = task.divisionId ? boardById.get(task.divisionId) : undefined
    const before = tickedRef.current.get(task.id)
    let patch: { status: string; boardColumnKey: string | null }
    if (before) {
      // Back where it stood. The server takes a column only together with
      // its own stage; a task whose saved column and status disagree (an
      // older status-only edit) gets its status back and no column — the
      // board then places it by that status.
      const stood = board?.boardColumns?.find((c) => c.key === before.boardColumnKey)
      patch = stood && stood.mapsToStatus === before.status ? before : { status: before.status, boardColumnKey: null }
    } else {
      const done = doneColumnOf(board?.boardColumns ?? [])
      patch = { status: done?.mapsToStatus ?? "done", boardColumnKey: done?.key ?? null }
    }
    setBusy((s) => new Set(s).add(task.id))
    changeTicked((m) => {
      const next = new Map(m)
      if (before) next.delete(task.id)
      else next.set(task.id, { status: task.status, boardColumnKey: task.boardColumnKey ?? null })
      return next
    })
    const undo = () => changeTicked((m) => {
      const next = new Map(m)
      if (before) next.set(task.id, before)
      else next.delete(task.id)
      return next
    })
    try {
      const res = await fetch(`/api/v1/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(patch),
      })
      if (!res.ok) { undo(); flash(t("changeFailed")) }
    } catch {
      undo()
      flash(t("changeFailed"))
    } finally {
      setBusy((s) => { const next = new Set(s); next.delete(task.id); return next })
    }
  }

  // Look (owner, 2026-11-10: «отвратительно ничего не видно… серое на сером»;
  // 2026-11-11: «слишком всё грубовато»): white cards, near-black titles in a
  // medium weight, one compact line per task, small grey details, colour only
  // for what is late (orange-red text) or critical (a small chip).
  const row = (task: MyTask, finished: boolean) => {
    const board = task.divisionId ? boardById.get(task.divisionId) : undefined
    const isTicked = finished || ticked.has(task.id)
    const columns = board?.boardColumns ?? []
    const column = isTicked && !finished ? doneColumnOf(columns) : columnOfTask(task, columns)
    const stage = stockColumnStage(column)
    const columnName = stage ? t(`stage.${stage}`) : column?.label ?? ""
    const note = dueNote(task.dueDate)
    const late = note.kind === "late" && !isTicked
    const hot = task.priority === "critical" || task.priority === "urgent"
    const comments = task._count?.comments ?? 0
    const files = task._count?.attachments ?? 0
    return (
      <li key={task.id} data-testid="my-work-row" data-task-id={task.id} className="flex items-center gap-3 border-t border-gray-100 px-4 py-2 dark:border-gray-800">
        {finished ? (
          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-gray-700 text-white dark:bg-gray-300 dark:text-gray-900" aria-hidden="true"><Check className="h-2.5 w-2.5" /></span>
        ) : (
          <button
            type="button"
            onClick={() => toggle(task)}
            disabled={busy.has(task.id)}
            aria-pressed={isTicked}
            aria-label={t(isTicked ? "markOpen" : "markDone", { title: task.title })}
            data-testid="my-work-tick"
            data-crm-color-role="status"
            className={cn(
              "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors",
              isTicked ? "border-gray-700 bg-gray-700 text-white dark:border-gray-300 dark:bg-gray-300 dark:text-gray-900" : "border-gray-300 hover:border-gray-700 dark:border-gray-600 dark:hover:border-gray-300",
            )}
          >
            {busy.has(task.id) ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : isTicked ? <Check className="h-2.5 w-2.5" /> : null}
          </button>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 lg:flex-row lg:items-center lg:gap-4">
          <button
            type="button"
            onClick={() => setOpenTaskId(task.id)}
            className={cn("block min-w-0 max-w-full truncate text-left text-sm font-medium leading-6 text-gray-900 hover:underline lg:flex-1 dark:text-gray-100", isTicked && "text-gray-400 line-through dark:text-gray-500")}
          >
            {task.title}
          </button>
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400">
            {hot && <span className="rounded bg-red-50 px-1.5 py-px text-[11px] font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300">{tCommon(priorityKey(task.priority!))}</span>}
            {task.priority === "high" && <span>{tCommon("priorityHigh")}</span>}
            {board && (
              <span className="inline-flex min-w-0 max-w-[14rem] items-center gap-1.5">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: board.color || "#94a3b8" }} aria-hidden="true" />
                <span className="truncate" data-testid="my-work-board">{boardLabel(board, boards)}</span>
              </span>
            )}
            {columnName && <span data-testid="my-work-column">{columnName}</span>}
            {task.dueDate && (
              <span className={cn("tabular-nums", late && "text-[#C2410C] dark:text-orange-400")} data-testid="my-work-due">
                {formatDate(task.dueDate, locale, { day: "numeric", month: "short" })}
                {late && note.kind === "late" ? ` · ${t("lateDays", { days: note.days })}` : ""}
              </span>
            )}
            {comments > 0 && <span className="inline-flex items-center gap-0.5" title={t("messages", { count: comments })}><MessageSquare className="h-3 w-3" aria-hidden="true" />{comments}</span>}
            {files > 0 && <span className="inline-flex items-center gap-0.5" title={t("files", { count: files })}><Paperclip className="h-3 w-3" aria-hidden="true" />{files}</span>}
          </div>
        </div>
      </li>
    )
  }

  const shownDone = doneTasks ? visible(doneTasks).filter((x) => !(tasks ?? []).some((open) => open.id === x.id)) : []

  return (
    <div className={cn("mx-auto space-y-4", view === "list" && "max-w-5xl pb-16")}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">{t("title")}</h1>
        <div className="inline-flex rounded-lg bg-gray-200/70 p-0.5 dark:bg-gray-800" role="group" aria-label={t("title")}>
          {(["list", "calendar"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              data-testid={`my-work-view-${v}`}
              data-crm-color-role="toggle"
              className={cn("h-7 rounded-md px-3 text-[13px] font-medium transition-colors", view === v ? "bg-white text-gray-900 shadow-sm dark:bg-gray-950 dark:text-gray-100" : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100")}
            >
              {t(v === "list" ? "views.list" : "views.calendar")}
            </button>
          ))}
        </div>
        {tasks && (
          <span className="text-[13px] text-gray-500 dark:text-gray-400" data-testid="my-work-counts">
            {t("openCount", { count: openCount })}
            {overdueCount > 0 && <> · <span className="text-[#C2410C] dark:text-orange-400">{t("overdueCount", { count: overdueCount })}</span></>}
          </span>
        )}
        {view === "list" && <div className="ml-auto flex flex-wrap items-center gap-2">
          <select
            value={boardFilter}
            onChange={(e) => setBoardFilter(e.target.value)}
            aria-label={t("allBoards")}
            data-testid="my-work-board-filter"
            className="h-8 max-w-[16rem] truncate rounded-lg border border-gray-200 bg-white px-2.5 text-[13px] text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
          >
            <option value="">{t("allBoards")}</option>
            {filterBoards.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            aria-pressed={showDone}
            data-testid="my-work-show-done"
            className={cn("h-8 rounded-lg border px-2.5 text-[13px] text-gray-700 dark:text-gray-200", showDone ? "border-gray-400 bg-gray-100 dark:border-gray-500 dark:bg-gray-800" : "border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900")}
          >
            {t(showDone ? "hideDone" : "showDone")}
          </button>
        </div>}
      </div>

      {failed && (
        <div className="flex items-center gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          <AlertCircle className="h-4 w-4" aria-hidden="true" /> {t("failed")}
          <button type="button" onClick={() => load()} className="ml-auto inline-flex items-center gap-1 font-medium underline">
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> {t("retry")}
          </button>
        </div>
      )}

      {!tasks && !failed && (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground" data-testid="my-work-loading">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        </div>
      )}

      {tasks && view === "calendar" && (
        <MyWorkCalendar openTasks={tasks} setOpenTasks={changeTasks} boards={boards} onOpenTask={setOpenTaskId} flash={flash} />
      )}

      {tasks && total > tasks.length && <p className="text-xs text-muted-foreground">{t("tooMany", { count: tasks.length })}</p>}

      {tasks && view === "list" && visible(tasks).length === 0 && (
        <div className="rounded-lg border px-6 py-10 text-center" data-testid="my-work-empty">
          <p className="font-medium">{t("empty")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("emptyHint")}</p>
        </div>
      )}

      {tasks && view === "list" && (groups.size > 0 || showDone) && (
        <div className="space-y-3">
          {MY_WORK_GROUPS.map((g) => {
            const list = groups.get(g) ?? []
            if (!list.length) return null
            return (
              <section key={g} data-testid="my-work-group" data-group={g} className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
                <h2 className="flex items-baseline gap-1.5 px-4 py-2 text-[13px] font-medium text-gray-700 dark:text-gray-300">
                  <span className={cn(g === "overdue" && "text-[#C2410C] dark:text-orange-400")}>{t(`groups.${g}`)}</span>
                  <span className="text-gray-400">{list.length}</span>
                </h2>
                <ul>{list.map((task) => row(task, false))}</ul>
              </section>
            )
          })}
          {showDone && (
            <section data-testid="my-work-group" data-group="done" className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
              <h2 className="flex items-baseline gap-1.5 px-4 py-2 text-[13px] font-medium text-gray-700 dark:text-gray-300">
                {t("groups.done")}
                {doneTasks ? <span className="text-gray-400">{shownDone.length}</span> : <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-500" aria-hidden="true" />}
              </h2>
              {doneTasks && shownDone.length > 0 && <ul>{shownDone.map((task) => row(task, true))}</ul>}
            </section>
          )}
        </div>
      )}

      {toast && (
        <div role="status" className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md bg-foreground px-4 py-2 text-sm text-background shadow-lg">{toast}</div>
      )}

      {openTaskId && (
        <TaskPanel
          taskId={openTaskId}
          canEdit
          onClose={() => { setOpenTaskId(null); load(); if (showDone) setDoneTasks(null) }}
          onMutated={() => {}}
        />
      )}
    </div>
  )
}
