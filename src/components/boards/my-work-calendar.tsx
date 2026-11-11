"use client"

/**
 * «Təqvim» of «Mənim işlərim» — Bordio's My work → Calendar: days as columns
 * stepping one at a time, the waiting list on the right, a task dragged onto
 * a day is planned for it — by this person only, as in Bordio — dragged back it
 * has no day. The deadline is never touched. See src/lib/tasks/my-work-calendar.ts.
 *
 * Laid out as Bordio's (owner, 2026-11-11: «Как в Bordio»): the calendar fills
 * the window down to its bottom edge, the days are lanes split by a hairline,
 * and the waiting list scrolls inside its own column — a long waiting list no
 * longer stretches the page and leaves the empty days as a hole in the middle.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react"
import { useLocale, useTranslations } from "next-intl"
import {
  DndContext, DragOverlay, MouseSensor, TouchSensor, KeyboardSensor, pointerWithin, useDraggable, useDroppable,
  useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core"
import { CalendarDays, ChevronLeft, ChevronRight, MessageSquare, Paperclip } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatDate, formatWeekday } from "@/lib/format-date"
import { boardLabel } from "@/lib/tasks/my-work"
import {
  dayKeys, dueNote, firstDayFor, isClosedStatus, localDayKey, planForDay, planTasks, plannedDay, rankBefore, rankBetween,
  shiftDayKey, visibleDayCount, type PlannedTask,
} from "@/lib/tasks/my-work-calendar"
import { BOARD_TASKS_PAGE } from "@/lib/tasks/fetch-board-tasks"

export interface CalendarBoard { id: string; name: string; color: string | null; isDepartment?: boolean; parentDivisionId?: string | null }

export interface CalendarTask extends PlannedTask {
  divisionId: string | null
  _count?: { comments?: number; attachments?: number } | null
}

const WAITING_ID = "__waiting__"
// Under the pointer, a card wins over the day around it: dropped on a card, the
// task goes just above it; elsewhere in the day, under the last card.
const cardFirst: CollisionDetection = (args) => {
  const hits = pointerWithin(args)
  const card = hits.find((hit) => String(hit.id).startsWith("card:"))
  return card ? [card] : hits
}
const priorityKey = (p: string) => `priority${p[0].toUpperCase()}${p.slice(1)}`
const HOT = new Set(["critical", "urgent"])

export function MyWorkCalendar<T extends CalendarTask>({ openTasks, setOpenTasks, boards, onOpenTask, flash }: {
  openTasks: T[]
  setOpenTasks: Dispatch<SetStateAction<T[] | null>>
  boards: CalendarBoard[]
  onOpenTask: (id: string) => void
  flash: (message: string) => void
}) {
  const t = useTranslations("myWork")
  const tc = useTranslations("common")
  const locale = useLocale()
  const today = localDayKey(new Date())

  // As many days as the width holds (Bordio: 3 on a laptop window, 1 on a phone).
  const box = useRef<HTMLDivElement | null>(null)
  const [count, setCount] = useState(3)
  // The lanes run to the bottom of the window (Bordio): the height left under
  // the calendar's top, less the page's own bottom padding. Never below a
  // usable minimum — on a short window the page scrolls as a whole instead.
  const lanes = useRef<HTMLDivElement | null>(null)
  const [height, setHeight] = useState<number | null>(null)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => {
      setCount(visibleDayCount(el.clientWidth))
      const target = lanes.current
      if (!target || typeof window === "undefined") return
      const scroller = target.closest("main")
      const top = target.getBoundingClientRect().top + (scroller?.scrollTop ?? 0)
      const bottom = scroller ? parseFloat(getComputedStyle(scroller).paddingBottom) || 0 : 0
      setHeight(Math.max(420, Math.floor(window.innerHeight - top - bottom)))
    }
    measure()
    window.addEventListener("resize", measure)
    if (typeof ResizeObserver === "undefined") return () => window.removeEventListener("resize", measure)
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    // What sits above the calendar (the video-lesson card, a closed notice)
    // moves its top without resizing it: watch the page's content too.
    const page = el.closest("main")?.firstElementChild
    if (page) observer.observe(page)
    return () => { observer.disconnect(); window.removeEventListener("resize", measure) }
  }, [])
  const [first, setFirst] = useState<string | null>(null)
  const start = first ?? firstDayFor(today, count)
  const days = useMemo(() => dayKeys(start, count), [start, count])

  // Finished tasks are read only for the days in view (open ones are all here already).
  // Finished tasks: the ones planned for the days in view, and — as in Bordio —
  // the ones without a day, which wait in the waiting list too.
  const CLOSED = "status=done,completed,cancelled"
  const [closedOnDays, setClosedOnDays] = useState<CalendarTask[]>([])
  const [closedWaiting, setClosedWaiting] = useState<CalendarTask[]>([])
  const range = `${days[0]}|${days[days.length - 1]}`
  useEffect(() => {
    let cancelled = false
    const [firstDay, lastDay] = range.split("|")
    fetch(`/api/v1/tasks?mine=1&${CLOSED}&planFrom=${firstDay}&planTo=${lastDay}&limit=${BOARD_TASKS_PAGE}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled) setClosedOnDays(j?.data?.tasks ?? []) })
      .catch(() => { if (!cancelled) setClosedOnDays([]) })
    return () => { cancelled = true }
  }, [range])
  useEffect(() => {
    let cancelled = false
    fetch(`/api/v1/tasks?mine=1&${CLOSED}&unplanned=1&limit=${BOARD_TASKS_PAGE}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled) setClosedWaiting(j?.data?.tasks ?? []) })
      .catch(() => { if (!cancelled) setClosedWaiting([]) })
    return () => { cancelled = true }
  }, [])
  const finished = useMemo(() => {
    const byId = new Map<string, CalendarTask>(closedWaiting.map((x) => [x.id, x]))
    for (const x of closedOnDays) byId.set(x.id, x)
    return [...byId.values()]
  }, [closedOnDays, closedWaiting])

  const { waiting, byDay } = useMemo(() => planTasks<CalendarTask>(openTasks, finished, days), [openTasks, finished, days])
  const byDayRef = useRef(byDay)
  byDayRef.current = byDay
  const boardById = useMemo(() => new Map(boards.map((b) => [b.id, b])), [boards])

  /** Plan a task for a day (or take its day away) — for me only: shown at once, taken back if refused. */
  const plan = useCallback(async (task: CalendarTask, day: string | null, rank?: number) => {
    if ((plannedDay(task) ?? null) === day && rank === undefined) return
    const apply = (plans: { day: string }[] | null | undefined) => {
      if (isClosedStatus(task.status)) {
        const swap = (list: CalendarTask[]) => list.map((x) => (x.id === task.id ? { ...x, plans } : x))
        setClosedOnDays(swap)
        setClosedWaiting(swap)
      } else setOpenTasks((list) => (list ? list.map((x) => (x.id === task.id ? { ...x, plans } : x)) : list))
    }
    // Dropped on the day itself: under its last card (the server decides the same way).
    const place = rank ?? (day ? rankBetween(Math.max(-Infinity, ...(byDayRef.current.get(day) ?? []).filter((x) => x.id !== task.id).map((x) => x.plans?.[0]?.rank ?? -Infinity)), null) : null)
    apply(day ? [planForDay(day, Number.isFinite(place) ? place : Date.now())] : [])
    try {
      const res = await fetch(`/api/v1/tasks/${task.id}/plan`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(rank === undefined ? { day } : { day, rank }),
      })
      if (!res.ok) { apply(task.plans); flash(t("changeFailed")) }
    } catch {
      apply(task.plans)
      flash(t("changeFailed"))
    }
  }, [flash, setOpenTasks, t])

  // A click opens the card; a drag needs 8 px of mouse travel, or a held touch.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    // Space picks a card up and puts it down; Enter stays «open the card».
    useSensor(KeyboardSensor, { keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] } }),
  )
  const [dragging, setDragging] = useState<CalendarTask | null>(null)
  const all = useMemo(() => new Map<string, CalendarTask>([...openTasks, ...finished].map((x) => [x.id, x])), [openTasks, finished])
  const onDragStart = (e: DragStartEvent) => setDragging(all.get(String(e.active.id)) ?? null)
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null)
    const task = all.get(String(e.active.id))
    const target = e.over ? String(e.over.id) : null
    if (!task || !target) return
    // On a card: just above it, in its day — Bordio keeps each person's order.
    if (target.startsWith("card:")) {
      const targetId = target.slice(5)
      if (targetId === task.id) return
      for (const [day, list] of byDay) {
        if (list.some((x) => x.id === targetId)) { void plan(task, day, rankBefore(list, targetId, task.id)); return }
      }
      return
    }
    void plan(task, target === WAITING_ID ? null : target)
  }

  const card = (task: CalendarTask, place: "day" | "waiting") => (
    <TaskCard
      key={task.id}
      task={task}
      board={task.divisionId ? boardById.get(task.divisionId) : undefined}
      boards={boards}
      place={place}
      onOpen={() => onOpenTask(task.id)}
      priorityLabel={task.priority ? tc(priorityKey(task.priority)) : ""}
      dueText={dueText(task.dueDate, place)}
    />
  )
  function dueText(due: string | null, place: "day" | "waiting"): { text: string; late: boolean } | null {
    const note = dueNote(due)
    if (note.kind === "none") return place === "waiting" ? { text: t("calendar.noDate"), late: false } : null
    if (note.kind === "late") return { text: t("calendar.late", { days: note.days }), late: true }
    if (note.kind === "today") return { text: t("calendar.dueToday"), late: true }
    if (note.kind === "tomorrow") return { text: t("calendar.dueTomorrow"), late: false }
    return place === "waiting" ? { text: formatDate(note.date, locale, { day: "numeric", month: "short" }), late: false } : null
  }

  const monthTitle = formatDate(new Date(`${days[0]}T12:00:00`), locale, { month: "long", year: "numeric" })

  return (
    <div ref={box} data-testid="my-work-calendar">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium capitalize text-gray-900 dark:text-gray-100" data-testid="my-work-calendar-month">{monthTitle}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" onClick={() => setFirst(null)} className="h-8 rounded-lg border px-2.5 text-[13px] border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200" data-testid="my-work-calendar-today">
            {t("calendar.today")}
          </button>
          <label className="relative inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300" title={t("calendar.pickDate")}>
            <CalendarDays className="h-4 w-4" aria-hidden="true" />
            <input
              type="date"
              aria-label={t("calendar.pickDate")}
              value={start}
              onChange={(e) => { if (e.target.value) setFirst(e.target.value) }}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
          <button type="button" onClick={() => setFirst(shiftDayKey(start, -1))} aria-label={t("calendar.prevDay")} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300" data-testid="my-work-calendar-prev">
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <button type="button" onClick={() => setFirst(shiftDayKey(start, 1))} aria-label={t("calendar.nextDay")} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300" data-testid="my-work-calendar-next">
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <DndContext sensors={sensors} collisionDetection={cardFirst} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
        <div
          ref={lanes}
          data-testid="my-work-lanes"
          className="grid overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950"
          style={{
            gridTemplateColumns: count === 1 ? "minmax(0,1fr)" : `repeat(${count}, minmax(0,1fr)) 18rem`,
            // One day on a phone: the waiting list goes under it and the page scrolls as usual.
            height: count > 1 ? height ?? undefined : undefined,
          }}
        >
          {days.map((day) => {
            const list = byDay.get(day) ?? []
            const date = new Date(`${day}T12:00:00`)
            const isToday = day === today
            return (
              <DayColumn key={day} id={day}>
                <div className={cn("flex shrink-0 items-baseline justify-between gap-2 border-b px-3 py-2", isToday ? "border-b-2 border-b-[#EA580C]" : "border-gray-100 dark:border-gray-800")}>
                  <span className={cn("text-[13px] font-medium text-gray-700 dark:text-gray-300", isToday && "text-[#EA580C] dark:text-[#FB923C]")}>
                    {date.getDate()} {formatWeekday(date, locale)}{isToday ? ` · ${t("calendar.todayMark")}` : ""}
                  </span>
                  <span className="text-xs text-gray-400" data-testid="my-work-day-count">{t("calendar.tasksCount", { count: list.length })}</span>
                </div>
                <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
                  {list.map((task) => card(task, "day"))}
                  {dragging && <div className="rounded-lg border border-dashed border-[#EA580C]/50 py-2 text-center text-xs text-[#C2410C]">{t("calendar.dropHere")}</div>}
                </div>
              </DayColumn>
            )
          })}
          <WaitingList title={t("calendar.waiting")} count={waiting.length}>
            {waiting.map((task) => card(task, "waiting"))}
            {waiting.length === 0 && <p className="py-4 text-center text-xs text-gray-400">{t("calendar.waitingEmpty")}</p>}
          </WaitingList>
        </div>
        <DragOverlay dropAnimation={null}>
          {dragging ? <div className="w-56 rounded-lg border border-gray-200 bg-white p-2.5 text-[13px] font-medium text-gray-900 shadow-lg">{dragging.title}</div> : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
}

function DayColumn({ id, children }: { id: string; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <section
      ref={setNodeRef}
      data-testid="my-work-day"
      data-day={id}
      // A lane, not a box: the whole column takes a drop, down to the window's edge.
      className={cn("flex min-h-0 flex-col border-r border-gray-100 dark:border-gray-800", isOver && "bg-orange-50/60 dark:bg-orange-950/20")}
    >
      {children}
    </section>
  )
}

function WaitingList({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: WAITING_ID })
  return (
    <section
      ref={setNodeRef}
      data-testid="my-work-waiting"
      // Scrolls on its own, as in Bordio: 150 waiting tasks stay in their column.
      className={cn("flex min-h-0 flex-col bg-gray-50 dark:bg-gray-900/60", isOver && "bg-orange-50 dark:bg-orange-950/30")}
    >
      <h2 className="flex shrink-0 items-baseline gap-1.5 border-b border-gray-100 px-3 py-2 text-[13px] font-medium text-gray-700 dark:border-gray-800 dark:text-gray-300">
        {title} <span className="font-normal text-gray-400">{count}</span>
      </h2>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2" data-testid="my-work-waiting-scroll">{children}</div>
    </section>
  )
}

function TaskCard({ task, board, boards, place, onOpen, priorityLabel, dueText }: {
  task: CalendarTask
  board: CalendarBoard | undefined
  boards: CalendarBoard[]
  place: "day" | "waiting"
  onOpen: () => void
  priorityLabel: string
  dueText: { text: string; late: boolean } | null
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id })
  // A card in a day is also a drop target: what lands on it goes just above it.
  const drop = useDroppable({ id: `card:${task.id}`, disabled: place !== "day" })
  const setRefs = (node: HTMLDivElement | null) => { setNodeRef(node); drop.setNodeRef(node) }
  // Greyed on a day, as in Bordio — priority still shown, nothing struck through;
  // in the waiting list a finished task looks like any other.
  const closed = isClosedStatus(task.status) && place === "day"
  const comments = task._count?.comments ?? 0
  const files = task._count?.attachments ?? 0
  return (
    <div
      ref={setRefs}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen() }}
      data-testid="my-work-card"
      data-task-id={task.id}
      data-place={place}
      className={cn(
        "cursor-grab touch-manipulation rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-left transition-colors hover:border-gray-300 active:cursor-grabbing dark:border-gray-700 dark:bg-gray-900 dark:hover:border-gray-500",
        closed && "bg-gray-50 shadow-none dark:bg-gray-900/60",
        drop.isOver && !isDragging && "border-t-2 border-t-[#EA580C]",
        isDragging && "opacity-40",
      )}
    >
      <div className={cn("text-[13px] font-medium leading-snug text-gray-900 dark:text-gray-100", closed && "text-gray-400 dark:text-gray-500")}>{task.title}</div>
      {priorityLabel && (
        HOT.has(task.priority ?? "") && !closed
          ? <span className="mt-1 inline-block rounded bg-red-50 px-1.5 py-px text-[11px] font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300">{priorityLabel}</span>
          : <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{priorityLabel}</div>
      )}
      <div className={cn("mt-1.5 flex items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400", closed && "text-gray-400 dark:text-gray-500")}>
        <span className="inline-flex min-w-0 items-center gap-1 truncate">
          {board && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: board.color || "#94a3b8" }} aria-hidden="true" />}
          <span className="truncate">{board ? boardLabel(board, boards) : ""}</span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-2">
          {comments > 0 && <span className="inline-flex items-center gap-0.5"><MessageSquare className="h-3 w-3" aria-hidden="true" />{comments}</span>}
          {files > 0 && <span className="inline-flex items-center gap-0.5"><Paperclip className="h-3 w-3" aria-hidden="true" />{files}</span>}
          {dueText && !closed && <span className={cn("tabular-nums", dueText.late && "text-[#C2410C] dark:text-orange-400")} data-testid="my-work-card-due">{dueText.text}</span>}
        </span>
      </div>
    </div>
  )
}
