"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import {
  AlertCircle,
  ArrowLeft,
  Pencil,
  Printer,
  RefreshCw,
  Trash2,
} from "lucide-react"

import { Hint, HintValue } from "@/components/hint"
import { MtmTaskActionsPanel } from "@/components/mtm/task-actions-panel"
import { MtmTaskEditForm } from "@/components/mtm/task-edit-form"
import { MtmTaskFilesPanel } from "@/components/mtm/task-files-panel"
import { MtmTaskTimelinePanel } from "@/components/mtm/task-timeline-panel"
import { Badge } from "@/components/mtm/mtm-badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { invalidateOperationalWeekSnapshotsAfterTaskMutation } from "@/lib/mtm/operational-week-cache"
import { formatInTimezone } from "@/lib/timezone"

type TaskStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "OVERDUE" | string
type TaskPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT" | string

type TaskAgent = {
  id: string
  name: string
  team?: { id: string; name: string } | null
}

type TaskCustomer = {
  id: string
  name: string
  locality?: string | null
  city?: string | null
  address?: string | null
}

type TaskVisit = {
  id: string
  status?: string | null
  checkInAt?: string | null
  checkOutAt?: string | null
  contact?: { id: string; displayName?: string | null } | null
  customer?: { id: string; name: string } | null
}

export type MtmTaskDetail = {
  id: string
  title: string
  description?: string | null
  status: TaskStatus
  priority: TaskPriority
  scheduledStartAt?: string | null
  dueDate?: string | null
  completedAt?: string | null
  acceptedAt?: string | null
  startedAt?: string | null
  result?: string | null
  progress?: number | null
  returnReason?: string | null
  version: number
  recurrenceRule?: string | null
  recurrenceInterval?: number | null
  recurrenceUntil?: string | null
  recurrenceTimezone?: string | null
  recurrenceCursorScheduledStartAt?: string | null
  recurrenceCursorDueDate?: string | null
  agentId: string
  agent?: TaskAgent | null
  customerId?: string | null
  customer?: TaskCustomer | null
  visitId?: string | null
  visit?: TaskVisit | null
  taskGroupDictionaryId?: string | null
  taskGroupCode?: string | null
  taskGroup?: {
    code: string
    order: number
    labels: { ru: string; az: string; en: string }
    dictionaryId: string
    dictionaryVersion: number
  } | null
  createdAt?: string | null
  updatedAt?: string | null
}

export type MtmTaskTimelineEvent = {
  id: string
  type: string
  semanticType?: string | null
  occurredAt: string
  comment?: string | null
  fromStatus?: string | null
  toStatus?: string | null
  oldDueDate?: string | null
  newDueDate?: string | null
  actor?: { id?: string; name?: string | null; role?: string | null } | null
  agent?: { id?: string; name?: string | null } | null
  document?: { id: string; fileName: string } | null
}

export type MtmTaskDocument = {
  id: string
  title?: string | null
  fileName: string
  mimeType?: string | null
  sizeBytes?: number | null
  createdAt: string
  uploadedByAgent?: { id: string; name: string } | null
  downloadUrl?: string | null
}

type TaskCapabilities = Record<string, unknown> & {
  actions?: string[]
}

type TaskDetailEnvelope = {
  task: MtmTaskDetail
  timeline: MtmTaskTimelineEvent[]
  documents: MtmTaskDocument[]
  recurrencePreview: MtmTaskRecurrencePreviewItem[]
  timezone: string
  capabilities: TaskCapabilities
}

type MtmTaskRecurrencePreviewItem = {
  dueDate?: string | null
  scheduledStartAt?: string | null
  dstAdjusted?: boolean
  dstKind?: string | null
  dstShiftedMinutes?: number | null
}

type LoadPhase = "loading" | "ready" | "notFound" | "permission" | "error"
type DeletePhase = "idle" | "saving" | "conflict" | "error"

const KNOWN_VISIT_STATUSES = new Set(["CHECKED_IN", "CHECKED_OUT", "CANCELLED"])

const STATUS_VARIANT: Record<string, "outline" | "info" | "success" | "warning" | "destructive"> = {
  PENDING: "outline",
  IN_PROGRESS: "info",
  COMPLETED: "success",
  CANCELLED: "destructive",
  OVERDUE: "warning",
}

const STATUS_HINT = {
  PENDING: "hint.wsStatusPending",
  IN_PROGRESS: "hint.wsStatusInProgress",
  COMPLETED: "hint.wsStatusCompleted",
  CANCELLED: "hint.wsStatusCancelled",
  OVERDUE: "hint.wsStatusOverdue",
} as const

const PRIORITY_VARIANT: Record<string, "outline" | "info" | "warning" | "destructive"> = {
  LOW: "outline",
  MEDIUM: "info",
  HIGH: "warning",
  URGENT: "destructive",
}

export function safeTaskReturnHref(value: string | null): string {
  if (!value) return "/mtm/tasks"
  if (value === "/mtm/tasks" || value.startsWith("/mtm/tasks?")) return value
  if (value === "/mtm" || value.startsWith("/mtm?")) return value
  if (value.startsWith("/mtm/") && !value.startsWith("//")) return value
  return "/mtm/tasks"
}

function capability(capabilities: TaskCapabilities, ...names: string[]): boolean {
  const actions = Array.isArray(capabilities.actions)
    ? capabilities.actions.map((action) => String(action).toUpperCase())
    : []
  return names.some((name) => capabilities[name] === true || actions.includes(name.toUpperCase()))
}

export function normalizeTaskRecurrencePreview(value: unknown): MtmTaskRecurrencePreviewItem[] {
  const raw = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { occurrences?: unknown[] }).occurrences)
      ? (value as { occurrences: unknown[] }).occurrences
      : []
  return raw.flatMap((item) => {
    if (typeof item === "string") return [{ dueDate: item }]
    if (!item || typeof item !== "object") return []
    const record = item as Record<string, unknown>
    const dst = record.dst && typeof record.dst === "object" ? record.dst as Record<string, unknown> : null
    const dueDst = dst?.dueDate && typeof dst.dueDate === "object" ? dst.dueDate as Record<string, unknown> : null
    const startDst = dst?.scheduledStartAt && typeof dst.scheduledStartAt === "object" ? dst.scheduledStartAt as Record<string, unknown> : null
    const selectedDst = [dueDst, startDst].find((resolution) => (
      typeof resolution?.kind === "string" && resolution.kind !== "EXACT"
    )) ?? dueDst ?? startDst
    const dstKind = typeof selectedDst?.kind === "string" ? selectedDst.kind : null
    const shiftedMinutes = typeof selectedDst?.shiftedMinutes === "number" ? selectedDst.shiftedMinutes : null
    return [{
      dueDate: typeof record.dueDate === "string" ? record.dueDate : null,
      scheduledStartAt: typeof record.scheduledStartAt === "string" ? record.scheduledStartAt : null,
      dstAdjusted: typeof record.dst === "boolean" ? record.dst : Boolean(dstKind && dstKind !== "EXACT"),
      dstKind,
      dstShiftedMinutes: shiftedMinutes,
    }]
  })
}

function validDate(value?: string | null): boolean {
  return Boolean(value && !Number.isNaN(new Date(value).getTime()))
}

function Definition({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-medium text-foreground">{children || "—"}</dd>
    </div>
  )
}

export function MtmTaskWorkspace({ taskId }: { taskId: string }) {
  const t = useTranslations("mtmTaskWorkspace")
  const tc = useTranslations("common")
  const locale = useLocale()
  const router = useRouter()
  const searchParams = useSearchParams()
  const returnHref = useMemo(() => safeTaskReturnHref(searchParams.get("returnTo")), [searchParams])
  const [phase, setPhase] = useState<LoadPhase>("loading")
  const [data, setData] = useState<TaskDetailEnvelope | null>(null)
  const [error, setError] = useState("")
  const [editing, setEditing] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deletePhase, setDeletePhase] = useState<DeletePhase>("idle")
  const [deleteMessage, setDeleteMessage] = useState("")
  const requestRef = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    setPhase("loading")
    setError("")
    try {
      const response = await fetch(`/api/v1/mtm/tasks/${encodeURIComponent(taskId)}`, {
        cache: "no-store",
        signal: controller.signal,
      })
      const body = await response.json().catch(() => null)
      if (response.status === 404) {
        setPhase("notFound")
        return
      }
      if (response.status === 401 || response.status === 403) {
        setPhase("permission")
        return
      }
      if (!response.ok || !body?.success || !body?.data?.task) {
        throw new Error(t("loadFailed"))
      }
      setData({
        task: body.data.task,
        timeline: Array.isArray(body.data.timeline) ? body.data.timeline : [],
        documents: Array.isArray(body.data.documents) ? body.data.documents : [],
        recurrencePreview: normalizeTaskRecurrencePreview(body.data.recurrencePreview),
        timezone: body.data.timezone || "UTC",
        capabilities: body.data.capabilities || {},
      })
      setPhase("ready")
    } catch (loadError) {
      if ((loadError as Error).name === "AbortError") return
      setError(t("loadFailed"))
      setPhase("error")
    }
  }, [taskId, t])

  useEffect(() => {
    load()
    return () => requestRef.current?.abort()
  }, [load])

  if (phase === "loading") {
    return (
      <div className="space-y-6" role="status" aria-live="polite">
        <div className="h-24 animate-pulse rounded-xl bg-muted/60 motion-reduce:animate-none" />
        <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(17rem,1fr)]">
          <div className="h-[34rem] animate-pulse rounded-xl bg-muted/45 motion-reduce:animate-none" />
          <div className="h-80 animate-pulse rounded-xl bg-muted/45 motion-reduce:animate-none" />
        </div>
        <span className="sr-only">{t("loading")}</span>
      </div>
    )
  }

  if (phase !== "ready" || !data) {
    const permission = phase === "permission"
    const notFound = phase === "notFound"
    return (
      <section className="flex min-h-[22rem] flex-col items-center justify-center gap-4 border-y border-border px-4 py-12 text-center" role="alert">
        <AlertCircle className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <div className="max-w-lg space-y-2">
          <h1 className="text-xl font-semibold tracking-tight">
            {permission ? t("permissionTitle") : notFound ? t("notFoundTitle") : t("errorTitle")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {permission ? t("permissionHint") : notFound ? t("notFoundHint") : error || t("loadFailed")}
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button asChild variant="outline" className="min-h-11">
            <Link href={returnHref}><ArrowLeft className="h-4 w-4" />{t("backToTasks")}</Link>
          </Button>
          {!permission && !notFound ? (
            <Button type="button" className="min-h-11" onClick={load}>
              <RefreshCw className="h-4 w-4" />{t("retry")}
            </Button>
          ) : null}
        </div>
      </section>
    )
  }

  const { task, timeline, documents, recurrencePreview, timezone, capabilities } = data
  const canEdit = capability(capabilities, "canEditMetadata", "canEdit", "EDIT")
  const canExecute = capability(capabilities, "canExecute", "EXECUTE")
  const canReview = capability(capabilities, "canReview", "REVIEW")
  const canDuplicate = capability(capabilities, "canDuplicate", "DUPLICATE")
  const canDelete = capabilities.canDelete === true
  const canComment = capability(capabilities, "canComment", "COMMENT")
  const canUpload = capability(capabilities, "canUploadEvidence", "UPLOAD_EVIDENCE")
  const hasMobileExecutionPrimary = canExecute && ["PENDING", "OVERDUE", "IN_PROGRESS"].includes(task.status)
  const hasMobilePrimary = hasMobileExecutionPrimary || canReview
  const formatDateTime = (value?: string | null) => validDate(value)
    ? formatInTimezone(value!, timezone, { dateStyle: "medium", timeStyle: "short" }, locale)
    : "—"
  const recurrenceTimezone = task.recurrenceTimezone || timezone
  const formatRecurrenceDateTime = (value?: string | null) => validDate(value)
    ? formatInTimezone(value!, recurrenceTimezone, { dateStyle: "medium", timeStyle: "short" }, locale)
    : "—"
  const place = [task.customer?.locality || task.customer?.city, task.customer?.address]
    .filter(Boolean)
    .join(", ")
  const visitStatus = task.visit?.status && KNOWN_VISIT_STATUSES.has(task.visit.status)
    ? t(`visitStatuses.${task.visit.status}` as never)
    : task.visit?.status
      ? t("visitStatuses.OTHER")
      : null
  const openDeleteDialog = () => {
    setDeletePhase("idle")
    setDeleteMessage("")
    setDeleteOpen(true)
  }

  const recoverDeleteConflict = async () => {
    setDeleteOpen(false)
    setDeletePhase("idle")
    setDeleteMessage("")
    await load()
  }

  const deleteTask = async () => {
    if (deletePhase === "saving") return
    setDeletePhase("saving")
    setDeleteMessage("")
    try {
      const response = await fetch(
        `/api/v1/mtm/tasks/${encodeURIComponent(task.id)}?expectedVersion=${encodeURIComponent(String(task.version))}`,
        { method: "DELETE" },
      )
      if (response.status === 409) {
        setDeletePhase("conflict")
        setDeleteMessage(t("deleteConflict"))
        return
      }
      if (response.status === 401 || response.status === 403) {
        setDeletePhase("error")
        setDeleteMessage(t("deletePermission"))
        return
      }
      if (response.status === 404) {
        setDeletePhase("conflict")
        setDeleteMessage(t("notFoundHint"))
        return
      }
      if (!response.ok) {
        setDeletePhase("error")
        setDeleteMessage(t("deleteFailed"))
        return
      }
      invalidateOperationalWeekSnapshotsAfterTaskMutation()
      setDeleteOpen(false)
      router.push(returnHref)
    } catch {
      // The response may have been lost after a successful commit. Do not
      // repeat a destructive write under uncertain facts; reload explicitly.
      setDeletePhase("error")
      setDeleteMessage(t("deleteFailed"))
    }
  }

  if (editing) {
    return (
      <MtmTaskEditForm
        task={task}
        timezone={timezone}
        onCancel={() => setEditing(false)}
        onSaved={async (exit) => {
          invalidateOperationalWeekSnapshotsAfterTaskMutation()
          if (exit) {
            router.push(returnHref)
            return
          }
          await load()
        }}
        onReload={load}
      />
    )
  }

  return (
    <div data-testid="mtm-task-workspace" className="space-y-4 pb-24 print:pb-0 print:[&_a]:hidden print:[&_button]:hidden print:[&_form]:hidden print:[&_input]:hidden lg:pb-6">
      <header className="border-b border-border pb-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 flex-1 space-y-2">
            <Button asChild variant="ghost" className="-ml-4 min-h-10 w-fit print:hidden">
              <Link href={returnHref}><ArrowLeft className="h-4 w-4" />{t("backToTasks")}</Link>
            </Button>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <HintValue text={task.status in STATUS_HINT ? t(STATUS_HINT[task.status as keyof typeof STATUS_HINT]) : null}><Badge variant={STATUS_VARIANT[task.status] || "outline"}>{t(`statuses.${task.status}` as never)}</Badge></HintValue>
                <HintValue text={t("hint.wsPriority")}><Badge variant={PRIORITY_VARIANT[task.priority] || "outline"}>{t(`priorities.${task.priority}` as never)}</Badge></HintValue>
                <HintValue text={t("hint.wsVersion")} className="text-xs text-muted-foreground">{t("version", { version: task.version })}</HintValue>
              </div>
              <h1 className="max-w-[34ch] break-words text-2xl font-semibold tracking-tight">{task.title}</h1>
              <p className="text-sm text-muted-foreground">
                {task.agent?.name || t("unassigned")} · {t("updatedAt", { date: formatDateTime(task.updatedAt) })}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 print:hidden xl:shrink-0 xl:justify-end">
            <Hint text={t("hint.wsPrint")}>
              <Button type="button" variant="outline" className="min-h-11" onClick={() => window.print()}>
                <Printer className="h-4 w-4" />{t("print")}
              </Button>
            </Hint>
            {canEdit ? (
              <Hint text={t("hint.wsEdit")}>
                <Button type="button" className="min-h-11" onClick={() => setEditing(true)}>
                  <Pencil className="h-4 w-4" />{t("edit")}
                </Button>
              </Hint>
            ) : null}
          </div>
        </div>
      </header>

      {/* Two columns from xl, not lg. At 1024–1279 px with the sidebar open
          the content area is 704–960 px: the side column was pinned to its
          17rem minimum and its forms, date-time inputs and nowrap buttons
          were laid out against the right edge of <main>, which clips instead
          of scrolling. Below xl the actions come first, as on a phone. */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(17rem,1fr)] xl:items-start">
        <main className="order-2 min-w-0 divide-y divide-border print:order-1 print:[&_button]:hidden print:[&_form]:hidden print:[&_input]:hidden xl:order-1">
          {/* One block of facts, not four sections of two rows each: the
              owner (2026-10-31) scrolled a whole screen past headings,
              hints and dashes to reach the timeline. Empty optional facts
              are left out instead of printed as "—". */}
          <section className="space-y-4 pb-5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 className="text-base font-semibold tracking-tight">{t("overview")}</h2>
              <p className="text-xs text-muted-foreground">{t("timezone", { timezone })}</p>
            </div>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 2xl:grid-cols-3">
              <Definition label={t("assignee")}>{task.agent?.name}</Definition>
              <Definition label={t("dueAt")}>{formatDateTime(task.dueDate)}</Definition>
              {task.scheduledStartAt ? <Definition label={t("scheduledStart")}>{formatDateTime(task.scheduledStartAt)}</Definition> : null}
              {task.startedAt ? <Definition label={t("actualStart")}>{formatDateTime(task.startedAt)}</Definition> : null}
              {task.completedAt ? <Definition label={t("completedAt")}>{formatDateTime(task.completedAt)}</Definition> : null}
              {task.agent?.team?.name ? <Definition label={t("team")}>{task.agent.team.name}</Definition> : null}
              {task.taskGroup ? (
                <Definition label={<HintValue text={t("hint.formGroup")}>{t("taskGroup")}</HintValue>}>
                  {locale.toLowerCase().startsWith("az")
                    ? task.taskGroup.labels.az
                    : locale.toLowerCase().startsWith("ru")
                      ? task.taskGroup.labels.ru
                      : task.taskGroup.labels.en}
                </Definition>
              ) : null}
              {task.customer ? <Definition label={t("organization")}>{task.customer.name}</Definition> : null}
              {place ? <Definition label={t("place")}>{place}</Definition> : null}
              {task.visit ? (
                <Definition label={<HintValue text={t("hint.formEvent")}>{t("event")}</HintValue>}>
                  <span className="block space-y-0.5">
                    <span className="block">{task.visit.contact?.displayName || t("visitEvent", { id: task.visit.id })}</span>
                    <span className="block text-xs font-normal text-muted-foreground">{t("visitIdentifier", { id: task.visit.id })}</span>
                    {visitStatus ? <span className="block text-xs font-normal text-muted-foreground">{t("visitStatus", { status: visitStatus })}</span> : null}
                    {task.visit.checkInAt ? <span className="block text-xs font-normal text-muted-foreground">{t("visitCheckIn", { date: formatDateTime(task.visit.checkInAt) })}</span> : null}
                    {task.visit.checkOutAt ? <span className="block text-xs font-normal text-muted-foreground">{t("visitCheckOut", { date: formatDateTime(task.visit.checkOutAt) })}</span> : null}
                  </span>
                </Definition>
              ) : null}
              {!task.recurrenceRule ? (
                <div data-testid="mtm-task-recurrence" className="min-w-0">
                  <dt className="text-xs font-medium text-muted-foreground">{t("recurrence")}</dt>
                  <dd className="mt-0.5 text-sm font-medium text-foreground">{t("recurrenceOneOff")}</dd>
                </div>
              ) : null}
            </dl>
            {task.description ? (
              <div className="space-y-0.5">
                <h3 className="text-xs font-medium text-muted-foreground">{t("description")}</h3>
                <p className="max-w-[72ch] whitespace-pre-wrap text-sm leading-6">{task.description}</p>
              </div>
            ) : null}
          </section>

          {task.recurrenceRule ? (
            <section data-testid="mtm-task-recurrence" className="space-y-3 py-5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 className="text-base font-semibold tracking-tight">{t("recurrence")}</h2>
                <p className="text-xs text-muted-foreground">{t("recurrenceTimezonePinned", { timezone: recurrenceTimezone })}</p>
              </div>
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
                <Definition label={<HintValue text={t("hint.formRule")}>{t("rule")}</HintValue>}>{t(`recurrenceRules.${task.recurrenceRule}` as never)}</Definition>
                <Definition label={<HintValue text={t("hint.formInterval")}>{t("interval")}</HintValue>}>{task.recurrenceInterval || 1}</Definition>
                <Definition label={<HintValue text={t("hint.formRecurrenceEnd")}>{t("recurrenceEnd")}</HintValue>}>{formatRecurrenceDateTime(task.recurrenceUntil)}</Definition>
              </dl>
              <div className="space-y-2">
                <h3 className="text-xs font-medium text-muted-foreground">{t("nextOccurrences")}</h3>
                {recurrencePreview.length ? (
                  <ol className="grid gap-2 sm:grid-cols-2">
                    {recurrencePreview.map((occurrence, index) => (
                      <li key={`${occurrence.dueDate || occurrence.scheduledStartAt}-${index}`} className="flex min-h-11 min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border px-3 py-1.5 text-sm">
                        <span className="tabular-nums text-muted-foreground">{index + 1}</span>
                        <span>{formatRecurrenceDateTime(occurrence.dueDate || occurrence.scheduledStartAt)}</span>
                        {occurrence.dstAdjusted ? (
                          <HintValue
                            text={occurrence.dstKind?.startsWith("AMBIGUOUS")
                              ? t("dstAmbiguousHint", { kind: occurrence.dstKind })
                              : t("dstShiftHint", { minutes: occurrence.dstShiftedMinutes ?? 0 })}
                          >
                            <Badge variant="warning">
                              {occurrence.dstKind?.startsWith("AMBIGUOUS") ? t("dstAmbiguous") : t("dstShift")}
                            </Badge>
                          </HintValue>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                ) : <p className="text-sm text-muted-foreground">{t("previewUnavailable")}</p>}
              </div>
            </section>
          ) : null}

          <MtmTaskTimelinePanel
            taskId={task.id}
            timeline={timeline}
            timezone={timezone}
            canComment={canComment}
            onChanged={load}
          />

          <MtmTaskFilesPanel
            taskId={task.id}
            documents={documents}
            timezone={timezone}
            canUpload={canUpload}
            onChanged={load}
          />
        </main>

        <aside className="order-1 min-w-0 space-y-4 print:hidden xl:order-2">
          <div id="task-primary-actions" className="scroll-mt-24 print:hidden">
            <MtmTaskActionsPanel
              task={task}
              timezone={timezone}
              canExecute={canExecute}
              canReview={canReview}
              canDuplicate={canDuplicate}
              onChanged={load}
              onOpenTask={(createdTaskId) => router.push(`/mtm/tasks/${encodeURIComponent(createdTaskId)}?returnTo=${encodeURIComponent(returnHref)}`)}
            />
          </div>

          <section className="space-y-3 border-b border-border pb-4">
            <div className="flex items-center justify-between gap-3 text-sm">
              <HintValue text={t("hint.progress")} className="font-semibold">{t("progress")}</HintValue>
              <span className="font-semibold tabular-nums">{task.progress ?? 0}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={t("progress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={task.progress ?? 0}>
              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, task.progress ?? 0))}%` }} />
            </div>
            {task.result ? <Definition label={t("result")}>{task.result}</Definition> : null}
            {task.returnReason ? (
              <div className="rounded-lg border border-l-4 border-border border-l-amber-500 bg-card text-foreground dark:border-l-amber-500 p-3 text-sm">
                <p className="font-semibold">{t("returnedForRework")}</p>
                <p className="mt-1 leading-5">{task.returnReason}</p>
              </div>
            ) : null}
          </section>

          {/* The timeline and the files are listed once, in the main column:
              a five-event copy here doubled the page's length. Delete is a
              quiet outlined button — the page keeps one filled action. */}
          {canDelete ? (
            <Hint text={t("hint.wsDelete")}>
              <Button
                type="button"
                variant="outline"
                className="min-h-11 w-full border-red-300 text-red-700 hover:bg-red-50 hover:text-red-800 print:hidden dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
                onClick={openDeleteDialog}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />{t("deleteTask")}
              </Button>
            </Hint>
          ) : null}
        </aside>
      </div>

      {!hasMobilePrimary ? <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-sm print:hidden lg:hidden">
        <div className="mx-auto flex max-w-xl gap-2">
          <Button asChild variant="outline" className="min-h-12 flex-1">
            <Link href={returnHref}><ArrowLeft className="h-4 w-4" />{t("back")}</Link>
          </Button>
          {canEdit ? (
            <Hint text={t("hint.wsEdit")} side="top">
              <Button type="button" className="min-h-12 flex-[1.4]" onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" />{t("edit")}
              </Button>
            </Hint>
          ) : null}
        </div>
      </div> : null}

      <div className="print:hidden">
        <Dialog
          open={deleteOpen}
          onOpenChange={(open) => {
            if (deletePhase !== "saving") setDeleteOpen(open)
          }}
          hideClose
        >
          <div aria-busy={deletePhase === "saving"} className="flex min-h-0 flex-1 flex-col">
            <DialogHeader>
              <DialogTitle>
                <span className="flex items-center gap-2">
                  <Trash2 className="h-5 w-5 text-destructive" aria-hidden="true" />
                  {t("deleteConfirmTitle")}
                </span>
              </DialogTitle>
            </DialogHeader>
            <DialogContent>
              <div className="space-y-3">
                <DialogDescription className="mt-0 leading-6">
                  {t("deleteConfirmDescription", { title: task.title })}
                </DialogDescription>
                {deleteMessage ? (
                  <p className="rounded-lg border border-l-4 border-border border-l-red-500 bg-card text-foreground dark:border-l-red-500 p-3 text-sm" role="alert">
                    {deleteMessage}
                  </p>
                ) : null}
              </div>
            </DialogContent>
            <DialogFooter className="flex-col-reverse sm:flex-row">
              <Button
                type="button"
                variant="outline"
                className="min-h-11 w-full sm:w-auto"
                disabled={deletePhase === "saving"}
                onClick={() => setDeleteOpen(false)}
              >
                {tc("cancel")}
              </Button>
              {deletePhase === "conflict" || deletePhase === "error" ? (
                <Hint text={t("hint.wsReloadAndReview")} side="top">
                  <Button type="button" className="min-h-11 w-full sm:w-auto" onClick={() => void recoverDeleteConflict()}>
                    <RefreshCw className="h-4 w-4" aria-hidden="true" />{t("reloadAndReview")}
                  </Button>
                </Hint>
              ) : (
                <Button
                  type="button"
                  variant="destructive"
                  className="min-h-11 w-full sm:w-auto"
                  disabled={deletePhase === "saving"}
                  onClick={() => void deleteTask()}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  {deletePhase === "saving" ? tc("deleting") : tc("delete")}
                </Button>
              )}
            </DialogFooter>
          </div>
        </Dialog>
      </div>
    </div>
  )
}
