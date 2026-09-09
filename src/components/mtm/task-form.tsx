"use client"

import { useEffect, useMemo, useState, type FormEvent } from "react"
import { useLocale, useTranslations } from "next-intl"
import { CalendarClock, MapPin, Repeat2, UserRound } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { invalidateOperationalWeekSnapshotsAfterTaskMutation } from "@/lib/mtm/operational-week-cache"
import {
  previewMtmTaskRecurrence,
  resolveMtmTaskTenantLocalDateTime,
  type MtmTaskRecurrenceDstResolution,
  type MtmTaskRecurrenceRule,
} from "@/lib/mtm/task-recurrence"
import { COMMON_TIMEZONES, dateInputValueInTimezone, formatInTimezone } from "@/lib/timezone"

export type TaskAgentOption = {
  id: string
  name: string
  teamId?: string | null
  team?: { id: string; name: string } | null
}

export type TaskGroupOption = {
  code: string
  order: number
  labels: { ru: string; az: string; en: string }
  dictionaryId: string
  dictionaryVersion: number
}

export function taskGroupLabel(option: TaskGroupOption, locale: string): string {
  return locale.toLowerCase().startsWith("az")
    ? option.labels.az
    : locale.toLowerCase().startsWith("ru")
      ? option.labels.ru
      : option.labels.en
}

type CustomerOption = {
  id: string
  name: string
  locality?: string | null
  city?: string | null
  address?: string | null
}

export type TaskVisitOption = {
  id: string
  customerId?: string | null
  status?: string | null
  checkInAt?: string | null
  checkOutAt?: string | null
  customer?: { name?: string | null } | null
  contact?: { displayName?: string | null } | null
}

export function formatTaskVisitOptionLabel(
  visit: TaskVisitOption,
  {
    fallback,
    locale,
    timezone,
    statusLabel,
  }: {
    fallback: string
    locale: string
    timezone: string
    statusLabel?: string | null
  },
): string {
  const subject = [visit.contact?.displayName, visit.customer?.name]
    .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
    .join(" — ") || fallback
  const formatMoment = (value: string | null | undefined) => {
    if (!value || Number.isNaN(new Date(value).getTime())) return null
    return formatInTimezone(value, timezone, { dateStyle: "short", timeStyle: "short" }, locale)
  }
  const checkIn = formatMoment(visit.checkInAt)
  const checkOut = formatMoment(visit.checkOutAt)
  const timeRange = checkIn && checkOut ? `${checkIn} – ${checkOut}` : checkIn || checkOut
  return [subject, statusLabel, timeRange].filter(Boolean).join(" · ")
}

interface TaskFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  initialData?: Record<string, unknown>
  orgId?: string
  agentOptions?: TaskAgentOption[]
  taskGroupOptions?: TaskGroupOption[]
  taskGroupCatalogAvailable?: boolean
  timezone?: string
  canCreateRecurring?: boolean
}

type TaskCreateDraft = {
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
}

const EMPTY_DRAFT: TaskCreateDraft = {
  title: "",
  description: "",
  agentId: "",
  customerId: "",
  visitId: "",
  taskGroupCode: "",
  priority: "MEDIUM",
  scheduledStartAt: "",
  dueDate: "",
  recurrenceRule: "",
  recurrenceInterval: "1",
  recurrenceUntil: "",
  recurrenceTimezone: "UTC",
}

function SectionLabel({ icon: Icon, title }: { icon: typeof CalendarClock; title: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-zinc-200 pb-2 dark:border-zinc-700">
      <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      <h3 className="text-sm font-semibold">{title}</h3>
    </div>
  )
}

export type LocalTaskScheduleDstAdjustment = {
  field: "scheduledStart" | "dueAt"
  resolution: MtmTaskRecurrenceDstResolution
}

export type LocalTaskRecurrencePreviewItem = {
  scheduledStartAt: string | null
  dueDate: string | null
  dst: MtmTaskRecurrenceDstResolution | null
}

export type LocalTaskRecurrencePreview = {
  occurrences: LocalTaskRecurrencePreviewItem[]
  authoringDst: LocalTaskScheduleDstAdjustment[]
}

const EMPTY_RECURRENCE_PREVIEW: LocalTaskRecurrencePreview = { occurrences: [], authoringDst: [] }

export function localRecurrencePreview(
  scheduledStartValue: string,
  dueValue: string,
  rule: string,
  intervalValue: string,
  sourceTimezone: string,
  recurrenceTimezone: string,
  recurrenceUntilValue = "",
): LocalTaskRecurrencePreview {
  const interval = Number(intervalValue)
  try {
    const scheduledStart = scheduledStartValue
      ? resolveMtmTaskTenantLocalDateTime(scheduledStartValue, sourceTimezone)
      : null
    const due = dueValue
      ? resolveMtmTaskTenantLocalDateTime(dueValue, sourceTimezone)
      : null
    const authoringDst = [
      scheduledStart && scheduledStart.resolution.kind !== "EXACT"
        ? { field: "scheduledStart" as const, resolution: scheduledStart.resolution }
        : null,
      due && due.resolution.kind !== "EXACT"
        ? { field: "dueAt" as const, resolution: due.resolution }
        : null,
    ].filter((value): value is LocalTaskScheduleDstAdjustment => value !== null)

    if (
      !rule
      || !["DAILY", "WEEKLY", "MONTHLY"].includes(rule)
      || (!scheduledStart && !due)
      || !Number.isInteger(interval)
      || interval < 1
      || interval > 365
    ) return { occurrences: [], authoringDst }

    const recurrenceUntil = recurrenceUntilValue
      ? resolveMtmTaskTenantLocalDateTime(recurrenceUntilValue, recurrenceTimezone).instant
      : null
    const preview = previewMtmTaskRecurrence({
      scheduledStartAt: scheduledStart?.instant ?? null,
      dueDate: due?.instant ?? null,
      recurrenceRule: rule as MtmTaskRecurrenceRule,
      recurrenceInterval: interval,
      recurrenceUntil,
      recurrenceTimezone,
    }, { limit: 4 })

    return {
      authoringDst,
      occurrences: preview.occurrences.map((occurrence) => ({
        scheduledStartAt: occurrence.scheduledStartAt?.toISOString() ?? null,
        dueDate: occurrence.dueDate?.toISOString() ?? null,
        dst: [occurrence.dst.dueDate, occurrence.dst.scheduledStartAt]
          .find((resolution) => resolution && resolution.kind !== "EXACT")
          ?? occurrence.dst.dueDate
          ?? occurrence.dst.scheduledStartAt,
      })),
    }
  } catch {
    return EMPTY_RECURRENCE_PREVIEW
  }
}

export function TaskDstBadge({ resolution }: { resolution: MtmTaskRecurrenceDstResolution | null }) {
  const t = useTranslations("mtmTaskWorkspace")
  if (!resolution || resolution.kind === "EXACT") return null
  const ambiguous = resolution.kind === "AMBIGUOUS_EARLIER"
  return (
    <Badge
      variant="warning"
      title={ambiguous
        ? t("dstAmbiguousHint", { kind: resolution.kind })
        : t("dstShiftHint", { minutes: resolution.shiftedMinutes })}
    >
      {ambiguous ? t("dstAmbiguous") : t("dstShift")}
    </Badge>
  )
}

export function TaskScheduleDstNotice({ adjustments }: { adjustments: LocalTaskScheduleDstAdjustment[] }) {
  const t = useTranslations("mtmTaskWorkspace")
  if (!adjustments.length) return null
  return (
    <div className="space-y-2" role="status" aria-live="polite">
      {adjustments.map(({ field, resolution }) => (
        <div key={field} className="flex flex-wrap items-center gap-2 text-xs leading-5 text-muted-foreground">
          <TaskDstBadge resolution={resolution} />
          <span>
            {t(field)}: {resolution.kind === "AMBIGUOUS_EARLIER"
              ? t("dstAmbiguousHint", { kind: resolution.kind })
              : t("dstShiftHint", { minutes: resolution.shiftedMinutes })}
          </span>
        </div>
      ))}
    </div>
  )
}

export function MtmTaskForm({
  open,
  onOpenChange,
  onSaved,
  initialData,
  orgId,
  agentOptions = [],
  taskGroupOptions = [],
  taskGroupCatalogAvailable = false,
  timezone = "UTC",
  canCreateRecurring = true,
}: TaskFormProps) {
  const t = useTranslations("mtmTaskWorkspace")
  const tf = useTranslations("mtmForms")
  const locale = useLocale()
  const [form, setForm] = useState<TaskCreateDraft>({ ...EMPTY_DRAFT, recurrenceTimezone: timezone })
  const [agents, setAgents] = useState<TaskAgentOption[]>(agentOptions)
  const [customers, setCustomers] = useState<CustomerOption[]>([])
  const [visits, setVisits] = useState<TaskVisitOption[]>([])
  const [saving, setSaving] = useState(false)
  const [loadingOptions, setLoadingOptions] = useState(false)
  const [loadingVisits, setLoadingVisits] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!open) return
    setForm({
      ...EMPTY_DRAFT,
      title: typeof initialData?.title === "string" ? initialData.title : "",
      description: typeof initialData?.description === "string" ? initialData.description : "",
      agentId: typeof initialData?.agentId === "string" ? initialData.agentId : "",
      customerId: typeof initialData?.customerId === "string" ? initialData.customerId : "",
      visitId: typeof initialData?.visitId === "string" ? initialData.visitId : "",
      taskGroupCode: typeof initialData?.taskGroupCode === "string" ? initialData.taskGroupCode : "",
      priority: typeof initialData?.priority === "string" ? initialData.priority : "MEDIUM",
      recurrenceTimezone: timezone,
    })
    setAgents(agentOptions)
    setError("")
    setLoadingOptions(true)
    const headers = orgId ? { "x-organization-id": orgId } : {} as Record<string, string>
    Promise.all([
      agentOptions.length
        ? Promise.resolve({ success: true, data: { agents: agentOptions } })
        : fetch("/api/v1/mtm/agents?limit=200", { headers }).then((response) => response.json()),
      fetch("/api/v1/mtm/customers?limit=200", { headers }).then((response) => response.json()),
    ]).then(([agentBody, customerBody]) => {
      if (agentBody?.success) setAgents(agentBody.data?.agents || [])
      if (customerBody?.success) setCustomers(customerBody.data?.customers || [])
    }).catch(() => {
      setError(t("optionLoadFailed"))
    }).finally(() => setLoadingOptions(false))
  }, [agentOptions, initialData, open, orgId, t, timezone])

  useEffect(() => {
    if (!open || !form.agentId) {
      setVisits([])
      setLoadingVisits(false)
      return
    }
    const controller = new AbortController()
    const headers = orgId ? { "x-organization-id": orgId } : undefined
    setVisits([])
    setLoadingVisits(true)
    fetch(`/api/v1/mtm/visits?limit=200&agentId=${encodeURIComponent(form.agentId)}`, {
      cache: "no-store",
      headers,
      signal: controller.signal,
    })
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
  }, [form.agentId, open, orgId, t])

  const selectedAgent = useMemo(() => agents.find((agent) => agent.id === form.agentId), [agents, form.agentId])
  const selectedCustomer = useMemo(() => customers.find((customer) => customer.id === form.customerId), [customers, form.customerId])
  const visibleVisits = useMemo(() => visits.filter((visit) => !form.customerId || !visit.customerId || visit.customerId === form.customerId), [form.customerId, visits])
  const recurrencePreview = useMemo(
    () => localRecurrencePreview(
      form.scheduledStartAt,
      form.dueDate,
      form.recurrenceRule,
      form.recurrenceInterval,
      timezone,
      form.recurrenceTimezone || timezone,
      form.recurrenceUntil,
    ),
    [form.dueDate, form.recurrenceInterval, form.recurrenceRule, form.recurrenceTimezone, form.recurrenceUntil, form.scheduledStartAt, timezone],
  )

  const update = (key: keyof TaskCreateDraft, value: string) => {
    setForm((current) => ({ ...current, [key]: value }))
    setError("")
  }

  const validate = (): string | null => {
    if (!form.title.trim()) return t("validation.titleRequired")
    if (!form.agentId) return t("validation.assigneeRequired")
    if (form.scheduledStartAt && form.dueDate && form.scheduledStartAt > form.dueDate) {
      return t("validation.dueBeforeStart")
    }
    const recurrenceAnchor = form.dueDate || form.scheduledStartAt
    if (form.recurrenceRule && !recurrenceAnchor) return t("validation.recurrenceNeedsDue")
    if (form.recurrenceRule && (
      !Number.isInteger(Number(form.recurrenceInterval))
      || Number(form.recurrenceInterval) < 1
      || Number(form.recurrenceInterval) > 365
    )) {
      return t("validation.intervalInvalid")
    }
    if (form.recurrenceUntil && recurrenceAnchor) {
      try {
        const recurrenceZone = form.recurrenceTimezone || timezone
        const identityInstant = resolveMtmTaskTenantLocalDateTime(recurrenceAnchor, timezone).instant
        const untilInstant = resolveMtmTaskTenantLocalDateTime(form.recurrenceUntil, recurrenceZone).instant
        const identityDate = dateInputValueInTimezone(identityInstant, recurrenceZone)
        const untilDate = dateInputValueInTimezone(untilInstant, recurrenceZone)
        if (untilDate < identityDate) return t("validation.recurrenceEndBeforeDue")
      } catch {
        return t("validation.dateTimeInvalid")
      }
    }
    return null
  }

  const iso = (value: string, valueTimezone = timezone) => value
    ? resolveMtmTaskTenantLocalDateTime(value, valueTimezone).instant.toISOString()
    : null

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setError(t("offlineCreateUnavailable"))
      return
    }

    setSaving(true)
    setError("")
    try {
      const response = await fetch("/api/v1/mtm/tasks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": orgId } : {}),
        },
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description.trim() || null,
          agentId: form.agentId,
          customerId: form.customerId || null,
          visitId: form.visitId || null,
          taskGroupCode: form.taskGroupCode || null,
          priority: form.priority,
          scheduledStartAt: iso(form.scheduledStartAt),
          dueDate: iso(form.dueDate),
          recurrenceRule: form.recurrenceRule || null,
          recurrenceInterval: form.recurrenceRule ? Number(form.recurrenceInterval) : null,
          recurrenceUntil: form.recurrenceRule ? iso(form.recurrenceUntil, form.recurrenceTimezone || timezone) : null,
          recurrenceTimezone: form.recurrenceRule ? form.recurrenceTimezone || timezone : null,
        }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok || !body?.success) throw new Error(t("createFailed"))
      invalidateOperationalWeekSnapshotsAfterTaskMutation()
      onSaved()
      onOpenChange(false)
    } catch {
      setError(t("createFailed"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !saving && onOpenChange(nextOpen)} widthClassName="max-w-3xl" maxHeightClassName="max-h-[92vh]">
      <DialogHeader>
        <DialogTitle>{tf("addTask")}</DialogTitle>
        <DialogDescription className="max-w-2xl">{t("createHint")}</DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <DialogContent className="space-y-8">
          {error ? <div className="rounded-lg border border-red-300 bg-red-50/70 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/25 dark:text-red-200" role="alert">{error}</div> : null}

          <section className="space-y-4">
            <SectionLabel icon={UserRound} title={t("overview")} />
            <div className="space-y-1.5">
              <Label htmlFor="task-title">{t("titleField")} *</Label>
              <Input id="task-title" value={form.title} onChange={(event) => update("title", event.target.value)} maxLength={200} required autoFocus />
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="task-agent">{t("assignee")} *</Label>
                <Select id="task-agent" value={form.agentId} onChange={(event) => { update("agentId", event.target.value); update("visitId", "") }} required disabled={loadingOptions}>
                  <option value="">{tf("selectAgent")}</option>
                  {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                </Select>
                {selectedAgent?.team?.name ? <p className="text-xs text-muted-foreground">{t("team")}: {selectedAgent.team.name}</p> : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="task-priority">{t("priority")}</Label>
                <Select id="task-priority" value={form.priority} onChange={(event) => update("priority", event.target.value)}>
                  {(["LOW", "MEDIUM", "HIGH", "URGENT"] as const).map((priority) => (
                    <option key={priority} value={priority}>{t(`priorities.${priority}`)}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="task-group">{t("taskGroup")}</Label>
                <Select
                  id="task-group"
                  value={form.taskGroupCode}
                  onChange={(event) => update("taskGroupCode", event.target.value)}
                  disabled={!taskGroupCatalogAvailable}
                >
                  <option value="">{t("taskGroupNone")}</option>
                  {taskGroupOptions.map((group) => (
                    <option key={`${group.dictionaryId}:${group.code}`} value={group.code}>
                      {taskGroupLabel(group, locale)}
                    </option>
                  ))}
                </Select>
                {!taskGroupCatalogAvailable ? <p className="text-xs text-muted-foreground">{t("taskGroupUnavailable")}</p> : null}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-description">{t("description")}</Label>
              <Textarea id="task-description" value={form.description} onChange={(event) => update("description", event.target.value)} rows={4} maxLength={5000} />
            </div>
          </section>

          <section className="space-y-4">
            <SectionLabel icon={CalendarClock} title={t("schedule")} />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="task-start">{t("scheduledStart")}</Label>
                <Input id="task-start" type="datetime-local" value={form.scheduledStartAt} onChange={(event) => update("scheduledStartAt", event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="task-due">{t("dueAt")}</Label>
                <Input id="task-due" type="datetime-local" value={form.dueDate} onChange={(event) => update("dueDate", event.target.value)} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t("timezone", { timezone })}</p>
            <TaskScheduleDstNotice adjustments={recurrencePreview.authoringDst} />
          </section>

          <section className="space-y-4">
            <SectionLabel icon={MapPin} title={t("placeAndEvent")} />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="task-customer">{t("organization")}</Label>
                <Select id="task-customer" value={form.customerId} onChange={(event) => { update("customerId", event.target.value); update("visitId", "") }} disabled={loadingOptions}>
                  <option value="">{tf("none")}</option>
                  {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
                </Select>
                {selectedCustomer ? <p className="text-xs text-muted-foreground">{[selectedCustomer.locality || selectedCustomer.city, selectedCustomer.address].filter(Boolean).join(", ") || t("placeUnavailable")}</p> : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="task-visit">{t("event")}</Label>
                <Select id="task-visit" value={form.visitId} onChange={(event) => update("visitId", event.target.value)} disabled={loadingOptions || loadingVisits || !form.agentId}>
                  <option value="">{tf("none")}</option>
                  {visibleVisits.map((visit) => (
                    <option key={visit.id} value={visit.id}>
                      {formatTaskVisitOptionLabel(visit, {
                        fallback: t("visitEvent", { id: visit.id }),
                        locale,
                        timezone,
                        statusLabel: visit.status === "CHECKED_IN"
                          ? tf("checkedIn")
                          : visit.status === "CHECKED_OUT"
                            ? tf("checkedOut")
                            : visit.status === "CANCELLED"
                              ? tf("cancelled")
                              : visit.status,
                      })}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <SectionLabel icon={Repeat2} title={t("recurrence")} />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="task-recurrence">{t("rule")}</Label>
                <Select id="task-recurrence" value={form.recurrenceRule} onChange={(event) => update("recurrenceRule", event.target.value)} disabled={!canCreateRecurring}>
                  <option value="">{t("recurrenceOneOff")}</option>
                  {(["DAILY", "WEEKLY", "MONTHLY"] as const).map((rule) => <option key={rule} value={rule}>{t(`recurrenceRules.${rule}`)}</option>)}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="task-interval">{t("interval")}</Label>
                <Input id="task-interval" type="number" min={1} max={365} value={form.recurrenceInterval} onChange={(event) => update("recurrenceInterval", event.target.value)} disabled={!form.recurrenceRule} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="task-until">{t("recurrenceEnd")}</Label>
                <Input id="task-until" type="datetime-local" value={form.recurrenceUntil} onChange={(event) => update("recurrenceUntil", event.target.value)} disabled={!form.recurrenceRule} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="task-recurrence-timezone">{t("recurrenceTimezone")}</Label>
                <Select id="task-recurrence-timezone" value={form.recurrenceTimezone} onChange={(event) => update("recurrenceTimezone", event.target.value)} disabled={!form.recurrenceRule}>
                  {[...new Set([timezone, ...COMMON_TIMEZONES])].map((zone) => <option key={zone} value={zone}>{zone}</option>)}
                </Select>
              </div>
            </div>
            {!canCreateRecurring ? <p className="text-xs text-muted-foreground">{t("recurrenceUnavailable")}</p> : null}
            <p className="text-xs leading-5 text-muted-foreground">{t("recurrenceCreateHint")}</p>
            {form.recurrenceRule ? (
              <div className="space-y-2" aria-live="polite">
                <h4 className="text-xs font-medium text-muted-foreground">{t("nextOccurrences")}</h4>
                {recurrencePreview.occurrences.length ? (
                  <ol className="grid gap-2 sm:grid-cols-2">
                    {recurrencePreview.occurrences.map((occurrence, index) => (
                      <li key={`${occurrence.dueDate || occurrence.scheduledStartAt}-${index}`} className="flex min-h-11 items-center gap-3 rounded-lg border border-zinc-200 px-3 text-sm dark:border-zinc-700">
                        <span className="tabular-nums text-muted-foreground">{index + 1}</span>
                        <span>{formatInTimezone((occurrence.dueDate ?? occurrence.scheduledStartAt)!, form.recurrenceTimezone || timezone, { dateStyle: "medium", timeStyle: "short" }, locale)}</span>
                        <TaskDstBadge resolution={occurrence.dst} />
                      </li>
                    ))}
                  </ol>
                ) : <p className="text-sm text-muted-foreground">{t("previewNeedsSchedule")}</p>}
              </div>
            ) : null}
          </section>
        </DialogContent>
        <DialogFooter className="flex-col-reverse sm:flex-row">
          <Button type="button" variant="outline" className="min-h-11 w-full sm:w-auto" onClick={() => onOpenChange(false)} disabled={saving}>{t("keepList")}</Button>
          <Button type="submit" className="min-h-11 w-full sm:w-auto" disabled={saving || loadingOptions}>{saving ? t("creating") : t("createTask")}</Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
