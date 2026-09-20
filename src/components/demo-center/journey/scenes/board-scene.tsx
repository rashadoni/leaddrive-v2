"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { ArrowLeft, BarChart3, Columns3, MoreHorizontal, RefreshCw, Search, Settings, UserCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatDate, formatDateTime } from "@/lib/format-date"
import { cn } from "@/lib/utils"
import type { DemoSceneProps } from "../scene-props"
import { DEMO_JOURNEY_STRINGS as S } from "../strings"

/**
 * CRM → Boards: where the follow-up task the system created lands.
 *
 * `/tasks` is deliberately unlinked from the product's sidebar — boards are
 * the task surface — so the demo shows boards too. Mirrors
 * `src/app/(dashboard)/boards/page.tsx` (the board list) and
 * `boards/[divisionId]/page.tsx` (columns, cards, the board/reports switch),
 * with the task modal from the same shared component's shape.
 */

const COLUMNS = [
  { key: "todo", labelKey: "statusTodo" },
  { key: "inProgress", labelKey: "statusInProgress" },
  { key: "review", labelKey: "statusReview" },
  { key: "completed", labelKey: "statusCompleted" },
] as const

export function BoardScene({ snapshot, step, reviewMode, dispatch, hint }: DemoSceneProps) {
  const t = useTranslations("board")
  const tTask = useTranslations("tasks")
  const tc = useTranslations("common")
  const tReports = useTranslations("boardReports")
  const locale = useLocale()
  const { task } = snapshot.records

  const boardOpened = snapshot.ui["board.opened"] === true || snapshot.state !== "CALL_SKIPPED"
  const [onBoard, setOnBoard] = useState(boardOpened)
  const [tab, setTab] = useState<"board" | "reports">("board")
  const [taskOpen, setTaskOpen] = useState(false)

  const openBoard = () => {
    if (reviewMode) {
      setOnBoard(true)
      return
    }
    if (step?.id !== "task-boards") {
      hint(S.hintFollow(step?.title ?? ""))
      return
    }
    const result = dispatch({ type: "ui", path: "board.opened", value: true })
    if (result.ok) setOnBoard(true)
  }

  const openTask = () => {
    if (reviewMode) {
      setTaskOpen(true)
      return
    }
    if (step?.id !== "task-open") {
      hint(S.hintFollow(step?.title ?? ""))
      return
    }
    const result = dispatch({ type: "transition", stepId: step.id, to: "TASK_CREATED" })
    if (result.ok) setTaskOpen(true)
  }

  if (!onBoard) {
    return (
      <div data-testid="demo-scene-boards-index" className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">{t("boardsTitle")}</h1>
        <div data-tour-id="boards-index" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <button
            type="button"
            onClick={openBoard}
            className="rounded-xl border border-zinc-200 bg-card p-4 text-left transition-all hover:border-foreground/30 hover:shadow-sm dark:border-zinc-700"
          >
            <span className="flex items-center gap-2">
              <Columns3 className="h-4 w-4 text-primary" aria-hidden="true" />
              <span className="text-sm font-semibold">{S.salesBoard}</span>
            </span>
            <span className="mt-2 block text-xs text-muted-foreground">
              {t("taskCount")}: {task ? 1 : 0}
            </span>
          </button>
        </div>
      </div>
    )
  }

  return (
    <div data-testid="demo-scene-board" className="space-y-4">
      <div data-tour-id="board-header" className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => setOnBoard(false)} aria-label={t("boardsTitle")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">{S.salesBoard}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => hint(S.demoButtonHint)}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> {t("refresh")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => hint(S.hintDisabled)}>
            <Settings className="mr-1 h-3.5 w-3.5" /> {t("editBoard")}
          </Button>
        </div>
      </div>

      <div data-tour-id="board-tabs" className="flex items-center gap-1 border-b">
        {([
          { key: "board" as const, label: S.boardBoardTab, Icon: Columns3 },
          { key: "reports" as const, label: t("reportsTab"), Icon: BarChart3 },
        ]).map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-current={tab === key ? "page" : undefined}
            className={cn(
              "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors",
              tab === key ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      {tab === "board" ? (
        <>
          <div data-tour-id="board-toolbar" className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => hint(S.demoButtonHint)} className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground dark:border-zinc-700">
              <UserCheck className="h-3.5 w-3.5" /> {t("assignedToMe")}
            </button>
            <button type="button" onClick={() => hint(S.demoButtonHint)} className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground dark:border-zinc-700">
              {t("createdByMe")}
            </button>
            <div className="relative min-w-40 max-w-xs flex-1">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                readOnly
                placeholder={t("search")}
                onClick={() => hint(S.demoButtonHint)}
                className="w-full rounded-lg border border-zinc-200 bg-background py-1.5 pl-9 pr-3 text-xs dark:border-zinc-700"
              />
            </div>
          </div>

          <div data-tour-id="board-columns" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {COLUMNS.map((column) => {
              const cards = column.key === "todo" && task ? [task] : []
              return (
                <div key={column.key} className="min-w-0">
                  <div className="mb-3 flex items-center justify-between border-b border-zinc-200 pb-2 dark:border-zinc-700">
                    <span className="text-xs font-semibold text-foreground">{tTask(column.labelKey)}</span>
                    <span className="text-xs text-muted-foreground">{cards.length}</span>
                  </div>
                  <div className="min-h-[180px] space-y-2">
                    {cards.map((card) => (
                      <div
                        key={card.id}
                        data-tour-id="board-card"
                        className="rounded-lg border border-zinc-200 bg-card p-3 dark:border-zinc-700"
                      >
                        <button type="button" onClick={openTask} className="block w-full text-left">
                          <span className="block text-xs font-medium leading-snug text-foreground">{card.title}</span>
                          <span className="mt-2 block text-[11px] text-muted-foreground">
                            {tc("assignee")}: {card.assigneeName}
                          </span>
                          <span className="mt-1 block text-[11px] text-muted-foreground">
                            {tTask("createdAt")}: {formatDate(card.createdAt, locale)}
                          </span>
                        </button>
                        <div className="mt-2 flex items-center justify-between border-t border-zinc-200 pt-2 dark:border-zinc-700">
                          <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                            {tTask("priorityHigh")}
                          </span>
                          <button
                            type="button"
                            data-tour-id="board-card-menu"
                            aria-label={t("type")}
                            onClick={() => hint(S.demoButtonHint)}
                            className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                          >
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                    {cards.length === 0 && (
                      <div className="flex h-20 items-center justify-center rounded-lg border border-dashed border-zinc-200 text-xs text-muted-foreground/40 dark:border-zinc-700">—</div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      ) : (
        <div data-tour-id="board-reports" className="space-y-3">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {([
              { label: tReports("kpiWip"), value: task ? 1 : 0 },
              { label: tReports("kpiClosed"), value: 0 },
              { label: tReports("kpiOverdue"), value: 0 },
              { label: tReports("kpiDueSoon"), value: task ? 1 : 0 },
            ]).map((kpi) => (
              <Card key={kpi.label}>
                <CardContent className="pb-4 pt-4">
                  <div className="text-2xl font-bold">{kpi.value}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{kpi.label}</div>
                </CardContent>
              </Card>
            ))}
          </div>
          <p className="rounded-lg border border-dashed border-zinc-200 p-3 text-xs leading-relaxed text-muted-foreground dark:border-zinc-700">
            {S.boardReportsEmpty}
          </p>
        </div>
      )}

      {taskOpen && task && (
        <Card data-tour-id="task-info">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">{task.title}</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setTaskOpen(false)}>{tc("close")}</Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <Row label={tc("assignee")} value={task.assigneeName} />
              <Row label={tTask("createdAt")} value={formatDateTime(task.createdAt, locale)} />
              <Row label={S.taskDueTomorrow} value={formatDateTime(task.dueAt, locale)} />
              <Row label={S.linkedLead} value={snapshot.records.lead?.contactName ?? "—"} />
            </dl>

            <div data-tour-id="task-status" className="flex flex-wrap items-center gap-2">
              {COLUMNS.map((column) => (
                <button
                  key={column.key}
                  type="button"
                  onClick={() => hint(S.hintFollow(step?.title ?? ""))}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs transition-colors",
                    column.key === "todo"
                      ? "border-foreground bg-foreground font-medium text-background"
                      : "border-zinc-200 text-muted-foreground hover:border-foreground/40 hover:text-foreground dark:border-zinc-700",
                  )}
                >
                  {tTask(column.labelKey)}
                </button>
              ))}
            </div>

            <div data-tour-id="task-comments">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{tTask("comments")}</p>
              <ul className="mt-2 space-y-2">
                {task.comments.map((comment) => (
                  <li key={comment.id} className="rounded-lg border border-zinc-200 p-2.5 text-xs dark:border-zinc-700">
                    <span className="font-medium">{comment.author}</span>
                    <p className="mt-0.5 text-muted-foreground">{comment.text}</p>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <dt className="text-muted-foreground">{label}:</dt>
      <dd className="min-w-0 truncate font-medium">{value}</dd>
    </div>
  )
}
