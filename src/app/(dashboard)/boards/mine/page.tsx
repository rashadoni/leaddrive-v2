"use client"

/**
 * «Mənim işlərim» — /boards/mine. The person's own tasks (assignee or
 * co-assignee) from every board, grouped by due day (owner, 2026-11-10: «Давай,
 * по макету»). A row's tick moves the task into its board's «done» column, as
 * a drag there would; a row opens the same task panel as the board. Tasks are
 * made on the boards, not here — this is a list of one's own work.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { AlertCircle, Check, Loader2, RotateCcw } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatDate } from "@/lib/format-date"
import { TaskPanel } from "@/components/tasks/task-panel/task-panel"
import {
  MY_WORK_GROUPS, boardLabel, columnOfTask, doneColumnOf, myWorkGroup,
  type MyWorkColumn, type MyWorkGroup,
} from "@/lib/tasks/my-work"
import { rememberBoardNames } from "@/lib/tasks/board-names-cache"
import { BOARD_TASKS_PAGE } from "@/lib/tasks/fetch-board-tasks"

interface Board {
  id: string
  name: string
  color: string | null
  isDepartment?: boolean
  parentDivisionId?: string | null
  boardColumns?: MyWorkColumn[]
}

interface MyTask {
  id: string
  title: string
  status: string
  boardColumnKey?: string | null
  dueDate: string | null
  completedAt?: string | null
  divisionId: string | null
}

/** A ticked row stays on screen, struck through, until the page is read again — so it can be taken back. */
interface Ticked { status: string; boardColumnKey: string | null }

const DONE_WINDOW_DAYS = 14

async function readTasks(query: string): Promise<{ tasks: MyTask[]; total: number }> {
  const res = await fetch(`/api/v1/tasks?mine=1&${query}&limit=${BOARD_TASKS_PAGE}`, { credentials: "include" })
  if (!res.ok) throw new Error(String(res.status))
  const json = await res.json()
  return { tasks: json?.data?.tasks ?? [], total: json?.data?.total ?? 0 }
}

export default function MyWorkPage() {
  const t = useTranslations("myWork")
  const locale = useLocale()
  const [boards, setBoards] = useState<Board[]>([])
  const [tasks, setTasks] = useState<MyTask[] | null>(null)
  const [total, setTotal] = useState(0)
  const [failed, setFailed] = useState(false)
  const [boardFilter, setBoardFilter] = useState("")
  const [showDone, setShowDone] = useState(false)
  const [doneTasks, setDoneTasks] = useState<MyTask[] | null>(null)
  const [ticked, setTicked] = useState<Map<string, Ticked>>(new Map())
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flash = useCallback((message: string) => {
    setToast(message)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 3500)
  }, [])

  const load = useCallback(async () => {
    setFailed(false)
    try {
      const [divisionsRes, open] = await Promise.all([
        fetch("/api/v1/divisions", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)),
        readTasks("open=1"),
      ])
      const list: Board[] = divisionsRes?.data?.divisions ?? []
      rememberBoardNames(list)
      setBoards(list)
      setTasks(open.tasks)
      setTotal(open.total)
      setTicked(new Map())
    } catch {
      setFailed(true)
    }
  }, [])
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
    const before = ticked.get(task.id)
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
    setTicked((m) => {
      const next = new Map(m)
      if (before) next.delete(task.id)
      else next.set(task.id, { status: task.status, boardColumnKey: task.boardColumnKey ?? null })
      return next
    })
    const undo = () => setTicked((m) => {
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

  const row = (task: MyTask, finished: boolean) => {
    const board = task.divisionId ? boardById.get(task.divisionId) : undefined
    const isTicked = finished || ticked.has(task.id)
    const columns = board?.boardColumns ?? []
    const column = isTicked && !finished ? doneColumnOf(columns) : columnOfTask(task, columns)
    const group = myWorkGroup(task.dueDate)
    return (
      <li key={task.id} data-testid="my-work-row" data-task-id={task.id} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t px-2 py-2 sm:grid-cols-[1.5rem_minmax(0,1fr)_auto_auto_4.5rem]">
        {finished ? (
          <span className="flex h-4 w-4 items-center justify-center rounded border border-emerald-600 bg-emerald-600 text-white" aria-hidden="true"><Check className="h-3 w-3" /></span>
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
              "flex h-4 w-4 items-center justify-center rounded border transition-colors",
              isTicked ? "border-emerald-600 bg-emerald-600 text-white" : "border-muted-foreground/50 hover:border-foreground",
            )}
          >
            {busy.has(task.id) ? <Loader2 className="h-3 w-3 animate-spin" /> : isTicked ? <Check className="h-3 w-3" /> : null}
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpenTaskId(task.id)}
          className={cn("min-w-0 truncate text-left text-sm hover:underline", isTicked && "text-muted-foreground line-through")}
        >
          {task.title}
        </button>
        {board ? (
          <span className="col-start-2 inline-flex max-w-[14rem] items-center gap-1.5 justify-self-start truncate rounded px-1.5 py-0.5 text-[11px] text-muted-foreground sm:col-start-auto sm:justify-self-end bg-muted">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: board.color || "#94a3b8" }} aria-hidden="true" />
            <span className="truncate" data-testid="my-work-board">{boardLabel(board, boards)}</span>
          </span>
        ) : <span />}
        <span className="hidden truncate text-right text-[11px] text-muted-foreground sm:inline" data-testid="my-work-column">{column?.label ?? ""}</span>
        <span className={cn("row-start-1 text-right text-xs tabular-nums text-muted-foreground sm:row-start-auto", group === "overdue" && !isTicked && "text-red-600")}>
          {task.dueDate ? formatDate(task.dueDate, locale, { day: "numeric", month: "short" }) : "—"}
        </span>
      </li>
    )
  }

  const shownDone = doneTasks ? visible(doneTasks).filter((x) => !(tasks ?? []).some((open) => open.id === x.id)) : []

  return (
    <div className="mx-auto max-w-5xl space-y-4 pb-16">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        {tasks && (
          <span className="text-sm text-muted-foreground" data-testid="my-work-counts">
            {t("openCount", { count: openCount })}
            {overdueCount > 0 && <> · <span className="text-red-600">{t("overdueCount", { count: overdueCount })}</span></>}
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select
            value={boardFilter}
            onChange={(e) => setBoardFilter(e.target.value)}
            aria-label={t("allBoards")}
            data-testid="my-work-board-filter"
            className="h-8 max-w-[16rem] truncate rounded-md border bg-background px-2 text-sm"
          >
            <option value="">{t("allBoards")}</option>
            {filterBoards.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            aria-pressed={showDone}
            data-testid="my-work-show-done"
            className={cn("h-8 rounded-md border px-3 text-sm", showDone ? "bg-muted font-medium" : "bg-background hover:bg-muted")}
          >
            {t(showDone ? "hideDone" : "showDone")}
          </button>
        </div>
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

      {tasks && total > tasks.length && <p className="text-xs text-muted-foreground">{t("tooMany", { count: tasks.length })}</p>}

      {tasks && visible(tasks).length === 0 && (
        <div className="rounded-lg border px-6 py-10 text-center" data-testid="my-work-empty">
          <p className="font-medium">{t("empty")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("emptyHint")}</p>
        </div>
      )}

      {tasks && MY_WORK_GROUPS.map((g) => {
        const list = groups.get(g) ?? []
        if (!list.length) return null
        return (
          <section key={g} data-testid="my-work-group" data-group={g}>
            <h2 className={cn("mb-1 flex items-center gap-2 text-sm font-semibold", g === "overdue" && "text-red-600")}>
              {g === "overdue" && <AlertCircle className="h-4 w-4" aria-hidden="true" />}
              {t(`groups.${g}`)}
              <span className="font-normal text-muted-foreground">{list.length}</span>
            </h2>
            <ul className="border-b">{list.map((task) => row(task, false))}</ul>
          </section>
        )
      })}

      {showDone && (
        <section data-testid="my-work-group" data-group="done">
          <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
            {t("groups.done")}
            {doneTasks ? <span className="font-normal text-muted-foreground">{shownDone.length}</span> : <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden="true" />}
          </h2>
          {doneTasks && shownDone.length > 0 && <ul className="border-b">{shownDone.map((task) => row(task, true))}</ul>}
        </section>
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
