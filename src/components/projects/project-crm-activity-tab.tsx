"use client"

/**
 * CRM Activity tab on the Project detail page.
 *
 * Shows the SECOND side of the Phase 2 Task→Project bridge: CRM tasks
 * (`Task.where({projectId})`) that were linked to this project from the
 * /tasks side. Visually grouped by status so a PM opening a project
 * sees both "what's left to do" (active) and "what's been wrapped up"
 * (completed) at a glance.
 *
 * Distinct from the Tasks tab which shows `ProjectTask` (the project's
 * own task list — etapes / milestones). Both contribute to
 * Project.completionPercentage via `recalcProjectCompletion()`.
 */

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations, useLocale } from "next-intl"
import { Inbox, ExternalLink, User, Calendar, Loader2, ClipboardList, AlertCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatDate as formatDateLocale } from "@/lib/format-date"

// API-side hard limit on `/api/v1/tasks?limit=200` matches the GET handler
// validation. Surface a banner when the project hits this ceiling so PMs
// don't silently miss tasks beyond #200.
const FETCH_LIMIT = 200

interface LinkedTask {
  id: string
  title: string
  status: string
  priority: string
  dueDate: string | null
  assignedTo: string | null
  assignee?: { id: string; name: string; avatar?: string | null } | null
  createdAt: string
}

interface Props {
  projectId: string
  headers: Record<string, string>
  /** Refresh trigger — bump to re-fetch (e.g. after a parent edit) */
  refreshKey?: number
}

const STATUS_BADGE: Record<string, string> = {
  pending:     "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  todo:        "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  in_progress: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  completed:   "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  cancelled:   "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500 line-through",
}

const PRIORITY_BORDER: Record<string, string> = {
  urgent: "border-l-red-500",
  high:   "border-l-orange-500",
  medium: "border-l-yellow-500",
  low:    "border-l-blue-400",
}

// Active = surfaces work that still needs attention. Completed/cancelled
// are collapsed below — useful as history but not what the PM is checking.
const ACTIVE_STATUSES = new Set(["pending", "todo", "in_progress"])

function formatDate(iso: string | null, locale: string): string {
  if (!iso) return "—"
  return formatDateLocale(iso, locale, { day: "2-digit", month: "short", year: "numeric" })
}

function isOverdue(iso: string | null, status: string): boolean {
  if (!iso) return false
  if (status === "completed" || status === "cancelled") return false
  return new Date(iso) < new Date()
}

export function ProjectCrmActivityTab({ projectId, headers, refreshKey = 0 }: Props) {
  const router = useRouter()
  const t = useTranslations("projects")
  const tt = useTranslations("tasks")
  const locale = useLocale()
  const [tasks, setTasks] = useState<LinkedTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Translated status label — falls back to the raw key when the key is
  // missing (defensive — Task.status is free-form text in DB).
  const statusLabel = (status: string): string => {
    const map: Record<string, string> = {
      pending: tt("statusTodo"),
      todo: tt("statusTodo"),
      in_progress: tt("statusInProgress"),
      completed: tt("statusCompleted"),
      cancelled: tt("statusCancelled"),
    }
    return map[status] ?? status
  }

  // The parent re-creates `headers` on every render (plain object literal),
  // so we deliberately exclude it from the dep array — re-fetching the
  // linked-tasks list on every parent re-render would burn requests. The
  // object's contents (Content-Type + x-organization-id) are stable for
  // the session; refreshKey gives the parent a clean way to opt-in to a
  // re-fetch when it knows the data changed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/v1/tasks?projectId=${encodeURIComponent(projectId)}&limit=${FETCH_LIMIT}`, { headers })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return
        if (j.success) setTasks(j.data?.tasks ?? [])
        else setError(j.error || "Failed to load CRM tasks")
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : "Network error")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, refreshKey])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 p-4 text-sm text-red-700 dark:text-red-300">
        {error}
      </div>
    )
  }

  if (tasks.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-200 dark:border-zinc-700 p-8 text-center">
        <Inbox className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground mb-1">{t("crmActivityEmpty")}</p>
        <p className="text-xs text-muted-foreground/70">{t("crmActivityEmptyHint")}</p>
      </div>
    )
  }

  const active = tasks.filter((task) => ACTIVE_STATUSES.has(task.status))
  const done = tasks.filter((task) => !ACTIVE_STATUSES.has(task.status))

  const renderSection = (label: string, items: LinkedTask[]) => {
    if (items.length === 0) return null
    return (
      <div>
        <div className="flex items-center gap-2 mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <ClipboardList className="h-3.5 w-3.5" />
          {label}
          <span className="text-muted-foreground/60">({items.length})</span>
        </div>
        <div className="space-y-1.5">
          {items.map((task) => {
            const overdue = isOverdue(task.dueDate, task.status)
            return (
              <button
                key={task.id}
                type="button"
                onClick={() => router.push(`/tasks/${task.id}`)}
                className={cn(
                  "w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg border-l-4 border border-zinc-200 dark:border-zinc-700 bg-card hover:bg-muted/40 transition-colors group",
                  PRIORITY_BORDER[task.priority] || "border-l-zinc-300",
                  overdue && "ring-1 ring-red-300/50 dark:ring-red-700/40",
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate">{task.title}</span>
                    <span className={cn(
                      "text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide font-semibold",
                      STATUS_BADGE[task.status] || "bg-zinc-100 text-zinc-600",
                    )}>
                      {statusLabel(task.status)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    {task.assignee && (
                      <span className="inline-flex items-center gap-1">
                        <User className="h-3 w-3" />
                        {task.assignee.name}
                      </span>
                    )}
                    {task.dueDate && (
                      <span className={cn(
                        "inline-flex items-center gap-1",
                        overdue && "text-red-600 dark:text-red-400 font-medium",
                      )}>
                        <Calendar className="h-3 w-3" />
                        {formatDate(task.dueDate, locale)}
                      </span>
                    )}
                  </div>
                </div>
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors shrink-0" />
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  // TODO: false-positive when the project has EXACTLY FETCH_LIMIT tasks.
  // Proper fix: have /api/v1/tasks return `total` in the response and
  // compare `total > FETCH_LIMIT` here. Acceptable until rollup grows
  // past ~200 tasks/project (rare).
  const truncated = tasks.length === FETCH_LIMIT

  return (
    <div className="space-y-6">
      {truncated && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{t("crmActivityTruncated", { limit: FETCH_LIMIT })}</span>
        </div>
      )}
      {renderSection(t("crmActivityActive"), active)}
      {renderSection(t("crmActivityDone"), done)}
    </div>
  )
}
