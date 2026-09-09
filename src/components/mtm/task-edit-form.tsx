"use client"

import { useEffect, useMemo, useState, type FormEvent } from "react"
import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, CalendarClock, MapPin, Repeat2, Save, UserRound, WifiOff } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { type MtmTaskDetail } from "@/components/mtm/task-workspace"
import {
  formatTaskVisitOptionLabel,
  localRecurrencePreview,
  TaskDstBadge,
  TaskScheduleDstNotice,
  type TaskAgentOption,
  type TaskGroupOption,
  type TaskVisitOption,
  taskGroupLabel,
} from "@/components/mtm/task-form"
import { resolveMtmTaskTenantLocalDateTime } from "@/lib/mtm/task-recurrence"
import { COMMON_TIMEZONES, dateInputValueInTimezone, formatInTimezone } from "@/lib/timezone"

type CustomerOption = {
  id: string
  name: string
  locality?: string | null
  city?: string | null
  address?: string | null
}

export type TaskEditDraft = {
  title: string
  description: string
  agentId: string
  customerId: string
  visitId: string
  taskGroupCode: string
  priority: string
  scheduledStartAt: string
  dueDate: string
  recurrenceRule: string
  recurrenceInterval: string
  recurrenceUntil: string
  recurrenceTimezone: string
  editScope: "THIS" | "THIS_AND_FUTURE"
}

type StoredDraft = {
  version: number
  savedAt: string
  form: TaskEditDraft
}

export type TaskEditDetail = MtmTaskDetail & {
  recurrenceCursorScheduledStartAt?: string | null
  recurrenceCursorDueDate?: string | null
}

export function taskEditRecurrencePreview(
  form: TaskEditDraft,
  task: TaskEditDetail,
  timezone: string,
) {
  return localRecurrencePreview(
    form.editScope === "THIS"
      ? dateTimeInputValue(task.recurrenceCursorScheduledStartAt ?? task.scheduledStartAt, "UTC")
      : form.scheduledStartAt,
    form.editScope === "THIS"
      ? dateTimeInputValue(task.recurrenceCursorDueDate ?? task.dueDate, "UTC")
      : form.dueDate,
    form.editScope === "THIS" ? task.recurrenceRule || "" : form.recurrenceRule,
    form.editScope === "THIS" ? String(task.recurrenceInterval || 1) : form.recurrenceInterval,
    form.editScope === "THIS" ? "UTC" : timezone,
    form.editScope === "THIS"
      ? task.recurrenceTimezone || timezone
      : form.recurrenceTimezone || timezone,
    form.editScope === "THIS"
      ? dateTimeInputValue(task.recurrenceUntil, task.recurrenceTimezone || timezone)
      : form.recurrenceUntil,
  )
}

function dateTimeInputValue(value: string | null | undefined, timezone: string): string {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  try {
    // eslint-disable-next-line no-restricted-syntax -- reads wall-clock parts for an <input type="datetime-local"> value, not display text
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date)
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
    return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`
  } catch {
    return ""
  }
}

function taskToDraft(task: MtmTaskDetail, timezone: string): TaskEditDraft {
  const recurrenceTimezone = task.recurrenceTimezone || timezone
  return {
    title: task.title,
    description: task.description || "",
    agentId: task.agentId,
    customerId: task.customerId || "",
    visitId: task.visitId || "",
    taskGroupCode: task.taskGroupCode || "",
    priority: task.priority,
    scheduledStartAt: dateTimeInputValue(task.scheduledStartAt, timezone),
    dueDate: dateTimeInputValue(task.dueDate, timezone),
    recurrenceRule: task.recurrenceRule || "",
    recurrenceInterval: String(task.recurrenceInterval || 1),
    recurrenceUntil: dateTimeInputValue(task.recurrenceUntil, recurrenceTimezone),
    recurrenceTimezone,
    editScope: "THIS",
  }
}

function taskDraftIso(value: string, timezone: string): string | null {
  return value
    ? resolveMtmTaskTenantLocalDateTime(value, timezone).instant.toISOString()
    : null
}

/** Build a sparse mutation so THIS_AND_FUTURE only propagates fields the user changed. */
export function buildMtmTaskEditChanges(
  form: TaskEditDraft,
  task: MtmTaskDetail,
  timezone: string,
): Record<string, unknown> {
  const baseline = taskToDraft(task, timezone)
  const changes: Record<string, unknown> = {}
  if (form.title.trim() !== baseline.title.trim()) changes.title = form.title.trim()
  if ((form.description.trim() || null) !== (baseline.description.trim() || null)) {
    changes.description = form.description.trim() || null
  }
  if (form.agentId !== baseline.agentId) changes.agentId = form.agentId
  if (form.customerId !== baseline.customerId) changes.customerId = form.customerId || null
  if (form.visitId !== baseline.visitId) changes.visitId = form.visitId || null
  if (form.taskGroupCode !== baseline.taskGroupCode) changes.taskGroupCode = form.taskGroupCode || null
  if (form.priority !== baseline.priority) changes.priority = form.priority
  if (form.scheduledStartAt !== baseline.scheduledStartAt) {
    changes.scheduledStartAt = taskDraftIso(form.scheduledStartAt, timezone)
  }
  if (form.dueDate !== baseline.dueDate) changes.dueDate = taskDraftIso(form.dueDate, timezone)

  if (form.recurrenceRule !== baseline.recurrenceRule) {
    changes.recurrenceRule = form.recurrenceRule || null
  }
  if (form.recurrenceRule) {
    if (Number(form.recurrenceInterval) !== Number(baseline.recurrenceInterval)) {
      changes.recurrenceInterval = Number(form.recurrenceInterval)
    }
    if (
      form.recurrenceUntil !== baseline.recurrenceUntil
      || form.recurrenceTimezone !== baseline.recurrenceTimezone
    ) {
      changes.recurrenceUntil = taskDraftIso(form.recurrenceUntil, form.recurrenceTimezone || timezone)
    }
    if (form.recurrenceTimezone !== baseline.recurrenceTimezone) {
      changes.recurrenceTimezone = form.recurrenceTimezone || timezone
    }
  }
  return changes
}

function SectionLabel({ icon: Icon, title, hint }: { icon: typeof CalendarClock; title: string; hint?: string }) {
  return (
    <div className="flex items-start gap-3 border-b border-zinc-200 pb-3 dark:border-zinc-700">
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-muted/35 text-muted-foreground dark:border-zinc-700"><Icon className="h-4 w-4" aria-hidden="true" /></span>
      <div><h2 className="text-base font-semibold tracking-tight">{title}</h2>{hint ? <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p> : null}</div>
    </div>
  )
}

export function MtmTaskEditForm({
  task,
  timezone,
  onCancel,
  onSaved,
  onReload,
}: {
  task: TaskEditDetail
  timezone: string
  onCancel: () => void
  onSaved: (exit: boolean) => Promise<void> | void
  onReload: () => Promise<void> | void
}) {
  const t = useTranslations("mtmTaskWorkspace")
  const tf = useTranslations("mtmForms")
  const locale = useLocale()
  const storageKey = `mtm-task-edit-draft:${task.id}`
  const [form, setForm] = useState<TaskEditDraft>(() => taskToDraft(task, timezone))
  const [agents, setAgents] = useState<TaskAgentOption[]>(task.agent ? [task.agent] : [])
  const [customers, setCustomers] = useState<CustomerOption[]>(task.customer ? [task.customer] : [])
  const [visits, setVisits] = useState<TaskVisitOption[]>(task.visit ? [task.visit] : [])
  const [taskGroups, setTaskGroups] = useState<TaskGroupOption[]>(task.taskGroup ? [task.taskGroup] : [])
  const [taskGroupCatalogAvailable, setTaskGroupCatalogAvailable] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadingOptions, setLoadingOptions] = useState(true)
  const [loadingVisits, setLoadingVisits] = useState(false)
  const [online, setOnline] = useState(true)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [conflict, setConflict] = useState(false)
  const [recoveredAt, setRecoveredAt] = useState<string | null>(null)
  const [staleDraft, setStaleDraft] = useState<StoredDraft | null>(null)
  const [draftReady, setDraftReady] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [draftStorageFailed, setDraftStorageFailed] = useState(false)

  useEffect(() => {
    setOnline(navigator.onLine)
    const onlineListener = () => setOnline(true)
    const offlineListener = () => setOnline(false)
    window.addEventListener("online", onlineListener)
    window.addEventListener("offline", offlineListener)
    return () => {
      window.removeEventListener("online", onlineListener)
      window.removeEventListener("offline", offlineListener)
    }
  }, [])

  useEffect(() => {
    setDraftReady(false)
    setStaleDraft(null)
    setRecoveredAt(null)
    setDraftStorageFailed(false)
    setNotice("")
    const serverDraft = taskToDraft(task, timezone)
    try {
      const raw = window.localStorage.getItem(storageKey)
      if (raw) {
        const saved = JSON.parse(raw) as StoredDraft
        if (saved?.form && typeof saved.form.title === "string") {
          if (saved.version === task.version) {
            setForm({ ...serverDraft, ...saved.form })
            setRecoveredAt(saved.savedAt || new Date().toISOString())
            setStaleDraft(null)
            setDirty(true)
          } else {
            setForm(serverDraft)
            setRecoveredAt(null)
            setStaleDraft(saved)
            setDirty(false)
          }
        } else {
          setForm(serverDraft)
          setDirty(false)
        }
      } else {
        setForm(serverDraft)
        setDirty(false)
      }
    } catch {
      setForm(serverDraft)
      setDirty(false)
    }
    setDraftReady(true)
  }, [storageKey, task, timezone])

  useEffect(() => {
    if (!draftReady || staleDraft || !dirty) return
    const timer = window.setTimeout(() => {
      try {
        const value: StoredDraft = { version: task.version, savedAt: new Date().toISOString(), form }
        window.localStorage.setItem(storageKey, JSON.stringify(value))
        setDraftStorageFailed(false)
      } catch {
        setDraftStorageFailed(true)
      }
    }, 250)
    return () => window.clearTimeout(timer)
  }, [dirty, draftReady, form, staleDraft, storageKey, task.version])

  useEffect(() => {
    setLoadingOptions(true)
    Promise.all([
      fetch("/api/v1/mtm/tasks?limit=1", { cache: "no-store" }).then((response) => response.json()),
      fetch("/api/v1/mtm/customers?limit=200", { cache: "no-store" }).then((response) => response.json()),
    ]).then(([taskBody, customerBody]) => {
      if (taskBody?.success && Array.isArray(taskBody.data?.filters?.agents)) setAgents(taskBody.data.filters.agents)
      if (taskBody?.success) {
        const activeGroups = Array.isArray(taskBody.data?.filters?.taskGroups) ? taskBody.data.filters.taskGroups as TaskGroupOption[] : []
        setTaskGroups([
          ...(task.taskGroup && !activeGroups.some((group) => group.code === task.taskGroup?.code) ? [task.taskGroup] : []),
          ...activeGroups,
        ])
        setTaskGroupCatalogAvailable(Boolean(taskBody.data?.filters?.taskGroupCatalogAvailable))
      }
      if (customerBody?.success && Array.isArray(customerBody.data?.customers)) setCustomers(customerBody.data.customers)
    }).catch(() => setError(t("optionLoadFailed"))).finally(() => setLoadingOptions(false))
  }, [task.agentId, task.taskGroup, t])

  useEffect(() => {
    if (!form.agentId) {
      setVisits([])
      setLoadingVisits(false)
      return
    }
    const controller = new AbortController()
    setVisits([])
    setLoadingVisits(true)
    fetch(`/api/v1/mtm/visits?limit=200&agentId=${encodeURIComponent(form.agentId)}`, { cache: "no-store", signal: controller.signal })
      .then((response) => response.json())
      .then((body) => {
        if (body?.success && Array.isArray(body.data?.visits)) setVisits(body.data.visits)
      })
      .catch((visitError) => {
        if ((visitError as Error).name !== "AbortError") setError(t("optionLoadFailed"))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingVisits(false)
      })
    return () => controller.abort()
  }, [form.agentId, t])

  const selectedAgent = useMemo(() => agents.find((agent) => agent.id === form.agentId), [agents, form.agentId])
  const selectedCustomer = useMemo(() => customers.find((customer) => customer.id === form.customerId), [customers, form.customerId])
  const visibleVisits = useMemo(() => visits.filter((visit) => !form.customerId || !visit.customerId || visit.customerId === form.customerId), [form.customerId, visits])
  const scheduleDstPreview = useMemo(
    () => localRecurrencePreview(
      form.scheduledStartAt,
      form.dueDate,
      "",
      "1",
      timezone,
      timezone,
    ),
    [form.dueDate, form.scheduledStartAt, timezone],
  )
  const recurrencePreview = useMemo(
    () => taskEditRecurrencePreview(form, task, timezone),
    [
      form.dueDate,
      form.editScope,
      form.recurrenceInterval,
      form.recurrenceRule,
      form.recurrenceTimezone,
      form.recurrenceUntil,
      form.scheduledStartAt,
      task.dueDate,
      task.recurrenceCursorDueDate,
      task.recurrenceCursorScheduledStartAt,
      task.recurrenceInterval,
      task.recurrenceRule,
      task.recurrenceTimezone,
      task.recurrenceUntil,
      task.scheduledStartAt,
      timezone,
    ],
  )

  const update = <Key extends keyof TaskEditDraft>(key: Key, value: TaskEditDraft[Key]) => {
    setForm((current) => ({ ...current, [key]: value }))
    setDirty(true)
    setError("")
    setNotice("")
    setConflict(false)
  }

  const validate = (): string | null => {
    if (!form.title.trim()) return t("validation.titleRequired")
    if (!form.agentId) return t("validation.assigneeRequired")
    if (form.scheduledStartAt && form.dueDate && form.scheduledStartAt > form.dueDate) return t("validation.dueBeforeStart")
    const recurrenceAnchor = form.dueDate || form.scheduledStartAt
    if (form.recurrenceRule && !recurrenceAnchor) return t("validation.recurrenceNeedsDue")
    if (form.recurrenceRule && (
      !Number.isInteger(Number(form.recurrenceInterval))
      || Number(form.recurrenceInterval) < 1
      || Number(form.recurrenceInterval) > 365
    )) return t("validation.intervalInvalid")
    const baseline = taskToDraft(task, timezone)
    const recurrenceSettingsChanged = form.recurrenceRule !== baseline.recurrenceRule
      || Number(form.recurrenceInterval) !== Number(baseline.recurrenceInterval)
      || form.recurrenceUntil !== baseline.recurrenceUntil
      || form.recurrenceTimezone !== baseline.recurrenceTimezone
    if (recurrenceSettingsChanged && form.editScope === "THIS") {
      return t("validation.recurrenceScopeRequired")
    }
    if (form.recurrenceUntil && recurrenceAnchor) {
      try {
        const recurrenceZone = form.recurrenceTimezone || timezone
        const immutableIdentity = task.recurrenceCursorDueDate
          ?? task.recurrenceCursorScheduledStartAt
          ?? task.dueDate
          ?? task.scheduledStartAt
        const isolatedException = form.editScope === "THIS" && task.recurrenceRule && immutableIdentity
        const identityInstant = isolatedException
          ? new Date(immutableIdentity)
          : resolveMtmTaskTenantLocalDateTime(recurrenceAnchor, timezone).instant
        const untilInstant = resolveMtmTaskTenantLocalDateTime(form.recurrenceUntil, recurrenceZone).instant
        if (
          dateInputValueInTimezone(untilInstant, recurrenceZone)
          < dateInputValueInTimezone(identityInstant, recurrenceZone)
        ) return t("validation.recurrenceEndBeforeDue")
      } catch {
        return t("validation.dateTimeInvalid")
      }
    }
    return null
  }

  const save = async (exit: boolean) => {
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }
    if (!online) {
      const savedAt = new Date().toISOString()
      try {
        const value: StoredDraft = { version: task.version, savedAt, form }
        window.localStorage.setItem(storageKey, JSON.stringify(value))
        setDraftStorageFailed(false)
        setRecoveredAt(savedAt)
        setNotice(t("offlineDraftSaved"))
        setError("")
      } catch {
        setDraftStorageFailed(true)
        setError(t("offlineDraftSaveFailed"))
      }
      return
    }
    setSaving(true)
    setError("")
    try {
      const changes = buildMtmTaskEditChanges(form, task, timezone)

      if (Object.keys(changes).length === 0) {
        window.localStorage.removeItem(storageKey)
        setRecoveredAt(null)
        setDirty(false)
        await onSaved(exit)
        return
      }
      const response = await fetch(`/api/v1/mtm/tasks/${encodeURIComponent(task.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedVersion: task.version,
          editScope: form.editScope,
          ...changes,
        }),
      })
      const body = await response.json().catch(() => null)
      if (response.status === 409) {
        setConflict(true)
        setError(t("versionConflictHint"))
        return
      }
      if (!response.ok || !body?.success) throw new Error(t("saveFailed"))
      window.localStorage.removeItem(storageKey)
      setRecoveredAt(null)
      setDirty(false)
      await onSaved(exit)
    } catch {
      setError(t("saveFailed"))
    } finally {
      setSaving(false)
    }
  }

  const discardDraft = () => {
    window.localStorage.removeItem(storageKey)
    setForm(taskToDraft(task, timezone))
    setRecoveredAt(null)
    setStaleDraft(null)
    setDirty(false)
    setDraftStorageFailed(false)
    setConflict(false)
    setError("")
    setNotice("")
  }

  const recoverStaleDraft = () => {
    if (!staleDraft) return
    setForm({ ...taskToDraft(task, timezone), ...staleDraft.form })
    setRecoveredAt(staleDraft.savedAt)
    setStaleDraft(null)
    setDirty(true)
    setConflict(false)
    setError("")
  }

  const useServerVersion = async () => {
    window.localStorage.removeItem(storageKey)
    setRecoveredAt(null)
    setStaleDraft(null)
    setDirty(false)
    setConflict(false)
    setError("")
    setNotice("")
    await onReload()
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void save(false)
  }

  return (
    <form id="edit" className="space-y-8 pb-36 lg:pb-4" onSubmit={submit}>
      <div className="flex flex-col gap-3 border-y border-zinc-200 py-5 dark:border-zinc-700 sm:flex-row sm:items-start sm:justify-between">
        <div><h1 className="text-2xl font-semibold tracking-tight">{t("editTask")}</h1><p className="mt-1 text-sm text-muted-foreground">{t("editHint", { version: task.version })}</p></div>
        <div className="hidden flex-wrap gap-2 lg:flex">
          <Button type="button" variant="outline" className="min-h-11" onClick={onCancel} disabled={saving}>{t("cancelEditing")}</Button>
          <Button type="submit" variant="outline" className="min-h-11" disabled={saving}><Save className="h-4 w-4" />{saving ? t("saving") : t("save")}</Button>
          <Button type="button" className="min-h-11" onClick={() => void save(true)} disabled={saving}>{t("saveAndExit")}</Button>
        </div>
      </div>

      {!online ? <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50/60 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/25 dark:text-amber-100" role="status"><WifiOff className="mt-0.5 h-4 w-4 shrink-0" /><span>{t("offlineEditingHint")}</span></div> : null}
      {draftStorageFailed ? <div className="rounded-lg border border-red-300 bg-red-50/70 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/25 dark:text-red-200" role="alert">{t("offlineDraftSaveFailed")}</div> : null}
      {notice ? <div className="rounded-lg border border-sky-300 bg-sky-50/60 p-4 text-sm text-sky-950 dark:border-sky-800 dark:bg-sky-950/25 dark:text-sky-100" role="status">{notice}</div> : null}
      {recoveredAt ? <div className="flex flex-col gap-3 rounded-lg border border-sky-300 bg-sky-50/60 p-4 text-sm text-sky-950 dark:border-sky-800 dark:bg-sky-950/25 dark:text-sky-100" role="status"><div><p className="font-semibold">{t("draftRecovered")}</p><p className="mt-1">{t("draftRecoveredHint", { date: formatInTimezone(recoveredAt, timezone, { dateStyle: "medium", timeStyle: "short" }, locale) })}</p></div><Button type="button" variant="outline" className="min-h-11 w-fit" onClick={discardDraft}>{t("discardDraft")}</Button></div> : null}
      {staleDraft ? <div className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50/60 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/25 dark:text-amber-100" role="alert"><div><p className="font-semibold">{t("staleDraftTitle")}</p><p className="mt-1">{t("staleDraftHint", { draftVersion: staleDraft.version, serverVersion: task.version })}</p></div><div className="flex flex-wrap gap-2"><Button type="button" className="min-h-11" onClick={recoverStaleDraft}>{t("reviewStaleDraft")}</Button><Button type="button" variant="outline" className="min-h-11" onClick={discardDraft}>{t("discardDraft")}</Button></div></div> : null}
      {error ? <div className="rounded-lg border border-red-300 bg-red-50/70 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/25 dark:text-red-200" role="alert">{error}</div> : null}
      {conflict ? <div className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50/60 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/25 dark:text-amber-100" role="alert"><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><div><p className="font-semibold">{t("versionConflictTitle")}</p><p className="mt-1">{t("versionConflictHint")}</p></div></div><div className="flex flex-wrap gap-2"><Button type="button" className="min-h-11" onClick={() => void onReload()}>{t("reloadAndReview")}</Button><Button type="button" variant="outline" className="min-h-11" onClick={() => void useServerVersion()}>{t("useServerVersion")}</Button></div></div> : null}

      <section className="space-y-5">
        <SectionLabel icon={UserRound} title={t("overview")} hint={t("overviewHint")} />
        <div className="space-y-1.5"><Label htmlFor="edit-task-title">{t("titleField")} *</Label><Input id="edit-task-title" value={form.title} onChange={(event) => update("title", event.target.value)} maxLength={200} required autoFocus /></div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5"><Label htmlFor="edit-task-agent">{t("assignee")} *</Label><Select id="edit-task-agent" value={form.agentId} onChange={(event) => { update("agentId", event.target.value); update("visitId", "") }} disabled={loadingOptions} required><option value="">{tf("selectAgent")}</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</Select>{selectedAgent?.team?.name ? <p className="text-xs text-muted-foreground">{t("team")}: {selectedAgent.team.name}</p> : null}</div>
          <div className="space-y-1.5"><Label htmlFor="edit-task-priority">{t("priority")}</Label><Select id="edit-task-priority" value={form.priority} onChange={(event) => update("priority", event.target.value)}>{(["LOW", "MEDIUM", "HIGH", "URGENT"] as const).map((priority) => <option key={priority} value={priority}>{t(`priorities.${priority}`)}</option>)}</Select></div>
          <div className="space-y-1.5"><Label htmlFor="edit-task-group">{t("taskGroup")}</Label><Select id="edit-task-group" value={form.taskGroupCode} onChange={(event) => update("taskGroupCode", event.target.value)} disabled={!taskGroupCatalogAvailable && !task.taskGroup}><option value="">{t("taskGroupNone")}</option>{taskGroups.map((group) => <option key={`${group.dictionaryId}:${group.code}`} value={group.code}>{taskGroupLabel(group, locale)}</option>)}</Select>{!taskGroupCatalogAvailable ? <p className="text-xs text-muted-foreground">{task.taskGroup ? t("taskGroupRetiredHint") : t("taskGroupUnavailable")}</p> : null}</div>
          <div className="space-y-1.5"><Label>{t("status")}</Label><div className="flex min-h-10 items-center rounded-lg border border-zinc-200 bg-muted/25 px-3 text-sm dark:border-zinc-700">{t(`statuses.${task.status}` as never)}</div><p className="text-xs text-muted-foreground">{t("statusActionHint")}</p></div>
        </div>
        <div className="space-y-1.5"><Label htmlFor="edit-task-description">{t("description")}</Label><Textarea id="edit-task-description" value={form.description} onChange={(event) => update("description", event.target.value)} rows={5} maxLength={5000} /></div>
      </section>

      <section className="space-y-5">
        <SectionLabel icon={CalendarClock} title={t("schedule")} hint={t("timezone", { timezone })} />
        <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="edit-task-start">{t("scheduledStart")}</Label><Input id="edit-task-start" type="datetime-local" value={form.scheduledStartAt} onChange={(event) => update("scheduledStartAt", event.target.value)} /></div><div className="space-y-1.5"><Label htmlFor="edit-task-due">{t("dueAt")}</Label><Input id="edit-task-due" type="datetime-local" value={form.dueDate} onChange={(event) => update("dueDate", event.target.value)} /></div></div>
        <TaskScheduleDstNotice adjustments={scheduleDstPreview.authoringDst} />
      </section>

      <section className="space-y-5">
        <SectionLabel icon={MapPin} title={t("placeAndEvent")} hint={t("placeDerivedHint")} />
        <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="edit-task-customer">{t("organization")}</Label><Select id="edit-task-customer" value={form.customerId} onChange={(event) => { update("customerId", event.target.value); update("visitId", "") }} disabled={loadingOptions}><option value="">{tf("none")}</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</Select>{selectedCustomer ? <p className="text-xs text-muted-foreground">{[selectedCustomer.locality || selectedCustomer.city, selectedCustomer.address].filter(Boolean).join(", ") || t("placeUnavailable")}</p> : null}</div><div className="space-y-1.5"><Label htmlFor="edit-task-visit">{t("event")}</Label><Select id="edit-task-visit" value={form.visitId} onChange={(event) => update("visitId", event.target.value)} disabled={loadingOptions || loadingVisits || !form.agentId} aria-busy={loadingVisits}><option value="">{tf("none")}</option>{visibleVisits.map((visit) => <option key={visit.id} value={visit.id}>{formatTaskVisitOptionLabel(visit, { fallback: t("visitEvent", { id: visit.id }), locale, timezone, statusLabel: visit.status === "CHECKED_IN" ? tf("checkedIn") : visit.status === "CHECKED_OUT" ? tf("checkedOut") : visit.status === "CANCELLED" ? tf("cancelled") : visit.status })}</option>)}</Select></div></div>
      </section>

      <section className="space-y-5">
        <SectionLabel icon={Repeat2} title={t("recurrence")} hint={t("recurrenceEditHint")} />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5"><div className="space-y-1.5"><Label htmlFor="edit-task-rule">{t("rule")}</Label><Select id="edit-task-rule" value={form.recurrenceRule} onChange={(event) => update("recurrenceRule", event.target.value)}><option value="">{t("recurrenceOneOff")}</option>{(["DAILY", "WEEKLY", "MONTHLY"] as const).map((rule) => <option key={rule} value={rule}>{t(`recurrenceRules.${rule}`)}</option>)}</Select></div><div className="space-y-1.5"><Label htmlFor="edit-task-interval">{t("interval")}</Label><Input id="edit-task-interval" type="number" min={1} max={365} value={form.recurrenceInterval} onChange={(event) => update("recurrenceInterval", event.target.value)} disabled={!form.recurrenceRule} /></div><div className="space-y-1.5"><Label htmlFor="edit-task-until">{t("recurrenceEnd")}</Label><Input id="edit-task-until" type="datetime-local" value={form.recurrenceUntil} onChange={(event) => update("recurrenceUntil", event.target.value)} disabled={!form.recurrenceRule} /></div><div className="space-y-1.5"><Label htmlFor="edit-task-timezone">{t("recurrenceTimezone")}</Label><Select id="edit-task-timezone" value={form.recurrenceTimezone} onChange={(event) => update("recurrenceTimezone", event.target.value)} disabled={!form.recurrenceRule}>{[...new Set([form.recurrenceTimezone, timezone, ...COMMON_TIMEZONES].filter(Boolean))].map((zone) => <option key={zone} value={zone}>{zone}</option>)}</Select></div><div className="space-y-1.5"><Label htmlFor="edit-task-scope">{t("editScope")}</Label><Select id="edit-task-scope" value={form.editScope} onChange={(event) => update("editScope", event.target.value as TaskEditDraft["editScope"])} disabled={!task.recurrenceRule && !form.recurrenceRule}><option value="THIS">{t("editThis")}</option><option value="THIS_AND_FUTURE">{t("editThisAndFuture")}</option></Select></div></div>
        {form.recurrenceRule ? <div className="space-y-2" aria-live="polite"><h3 className="text-xs font-medium text-muted-foreground">{t("nextOccurrences")}</h3>{recurrencePreview.occurrences.length ? <ol className="grid gap-2 sm:grid-cols-2">{recurrencePreview.occurrences.map((occurrence, index) => <li key={`${occurrence.dueDate || occurrence.scheduledStartAt}-${index}`} className="flex min-h-11 items-center gap-3 rounded-lg border border-zinc-200 px-3 text-sm dark:border-zinc-700"><span className="tabular-nums text-muted-foreground">{index + 1}</span><span>{formatInTimezone((occurrence.dueDate ?? occurrence.scheduledStartAt)!, form.editScope === "THIS" ? task.recurrenceTimezone || timezone : form.recurrenceTimezone || timezone, { dateStyle: "medium", timeStyle: "short" }, locale)}</span><TaskDstBadge resolution={occurrence.dst} /></li>)}</ol> : <p className="text-sm text-muted-foreground">{t("previewNeedsSchedule")}</p>}</div> : null}
      </section>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-background/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-sm lg:hidden">
        <div className="mx-auto grid max-w-xl grid-cols-2 gap-2 sm:grid-cols-3"><Button type="button" variant="outline" className="col-span-2 min-h-12 whitespace-normal px-3 py-2 leading-tight sm:col-span-1" onClick={onCancel} disabled={saving}>{t("cancelEditing")}</Button><Button type="submit" variant="outline" className="min-h-12 whitespace-normal px-3 py-2 leading-tight" disabled={saving}>{saving ? t("saving") : t("save")}</Button><Button type="button" className="min-h-12 whitespace-normal px-3 py-2 leading-tight" onClick={() => void save(true)} disabled={saving}>{t("saveAndExit")}</Button></div>
      </div>
    </form>
  )
}
