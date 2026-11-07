"use client"

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { localDayKey, monthWeeks, tasksByDueDay } from "@/lib/tasks/board-calendar"
import { formatDate, formatWeekday } from "@/lib/format-date"

export interface CalendarTask {
  id: string
  title: string
  status: string
  dueDate: string | null
  assignee?: { name: string } | null
}

const DAY_PREVIEW = 3
const isClosed = (status: string) => status === "done" || status === "cancelled" || status === "completed"

/**
 * «Təqvim» — the board's tasks by due date over a month (Bordio's Calendar).
 * The list it gets is the board's filtered list, so the toolbar filters apply.
 * A busy day shows three tasks and opens the rest in place; there is no inner
 * scroll (owner's rule for every CRM screen).
 */
export function BoardCalendar({ tasks, onOpenTask }: { tasks: readonly CalendarTask[]; onOpenTask: (id: string) => void }) {
  const t = useTranslations("board")
  const locale = useLocale()
  const today = localDayKey(new Date())
  const [cursor, setCursor] = useState(() => { const now = new Date(); return { year: now.getFullYear(), month: now.getMonth() } })
  const [openDays, setOpenDays] = useState<Set<string>>(new Set())

  const weeks = useMemo(() => monthWeeks(cursor.year, cursor.month), [cursor])
  const { byDay, undated } = useMemo(() => tasksByDueDay(tasks), [tasks])
  // format-date, not Intl: browsers without Azerbaijani ICU data print «2026 M11» and English weekdays.
  const title = formatDate(new Date(cursor.year, cursor.month, 1), locale, { month: "long", year: "numeric" })
  const weekdays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => formatWeekday(new Date(2026, 10, 2 + i), locale)), // 2 Nov 2026 is a Monday
    [locale],
  )

  const shift = (delta: number) => setCursor(({ year, month }) => {
    const at = new Date(year, month + delta, 1)
    return { year: at.getFullYear(), month: at.getMonth() }
  })

  return (
    <div className="px-5 pb-8 pt-3" data-testid="board-calendar">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button type="button" data-crm-button="" onClick={() => shift(-1)} aria-label={t("prevMonth")} className="rounded-md border p-1.5">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button type="button" data-crm-button="" onClick={() => shift(1)} aria-label={t("nextMonth")} className="rounded-md border p-1.5">
          <ChevronRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          data-crm-button=""
          onClick={() => { const now = new Date(); setCursor({ year: now.getFullYear(), month: now.getMonth() }) }}
          className="rounded-md border px-3 py-1 text-sm"
        >
          {t("today")}
        </button>
        <h2 className="ml-1 text-lg font-semibold capitalize">{title}</h2>
        {undated > 0 && <span className="ml-auto text-xs text-muted-foreground">{t("noDueDate", { count: undated })}</span>}
      </div>

      <div className="grid grid-cols-7 overflow-hidden rounded-lg border">
        {weekdays.map((name) => (
          <div key={name} className="border-b bg-muted/40 px-2 py-1.5 text-xs font-medium capitalize text-muted-foreground">{name}</div>
        ))}
        {weeks.flat().map((day) => {
          const list = byDay.get(day.key) ?? []
          const expanded = openDays.has(day.key)
          const shown = expanded ? list : list.slice(0, DAY_PREVIEW)
          return (
            <div key={day.key} className={`min-h-24 border-b border-r p-1.5 ${day.inMonth ? "" : "bg-muted/20"}`} data-day={day.key}>
              <div className={`mb-1 text-xs ${day.key === today ? "inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary font-semibold text-white" : day.inMonth ? "text-foreground" : "text-muted-foreground"}`}>
                {day.day}
              </div>
              <div className="flex flex-col gap-1">
                {shown.map((task) => {
                  const overdue = !isClosed(task.status) && day.key < today
                  return (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => onOpenTask(task.id)}
                      title={task.assignee?.name ? `${task.title} — ${task.assignee.name}` : task.title}
                      className={`truncate rounded border px-1.5 py-0.5 text-left text-[11px] ${isClosed(task.status) ? "text-muted-foreground line-through" : overdue ? "border-red-300 text-red-700" : "text-foreground"}`}
                    >
                      {task.title}
                    </button>
                  )
                })}
                {list.length > DAY_PREVIEW && (
                  <button
                    type="button"
                    onClick={() => setOpenDays((prev) => { const next = new Set(prev); if (next.has(day.key)) next.delete(day.key); else next.add(day.key); return next })}
                    className="text-left text-[11px] font-medium text-muted-foreground hover:underline"
                  >
                    {expanded ? t("showLess") : t("moreTasks", { count: list.length - DAY_PREVIEW })}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
