"use client"

import { useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { CheckCircle2, CircleAlert, Clock } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import {
  hasActivePriorityConflict,
  splitSlaDuration,
  validateSlaTargets,
  type SlaPolicyPriority,
  type SlaPolicySummaryInput,
} from "@/lib/ticketing/sla-policy"

import type { SlaBusinessCalendar } from "@/lib/ticketing/sla-business-calendar"

interface SlaPolicyInitial {
  businessCalendar?: SlaBusinessCalendar | null
  id?: string
  name?: string
  priority?: SlaPolicyPriority
  firstResponseHours?: number
  resolutionHours?: number
  businessHoursOnly?: boolean
  isActive?: boolean
}

interface SlaPolicyFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  initialData?: SlaPolicyInitial
  existingPolicies?: SlaPolicySummaryInput[]
  orgId?: string
}

interface SlaFormState {
  name: string
  priority: SlaPolicyPriority
  responseHours: number
  responseMinutes: number
  resolutionHours: number
  resolutionMinutes: number
  businessHoursOnly: boolean
  isActive: boolean
}

function clampInteger(value: string, max: number): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return 0
  return Math.min(max, Math.max(0, parsed))
}

export function SlaPolicyForm({
  open,
  onOpenChange,
  onSaved,
  initialData,
  existingPolicies = [],
  orgId,
}: SlaPolicyFormProps) {
  const t = useTranslations("slaPolicyUi")
  const locale = useLocale()
  const tc = useTranslations("common")
  const isEdit = Boolean(initialData?.id)
  const [form, setForm] = useState<SlaFormState>({
    name: "",
    priority: "medium",
    responseHours: 4,
    responseMinutes: 0,
    resolutionHours: 24,
    resolutionMinutes: 0,
    businessHoursOnly: true,
    isActive: true,
  })
  const [calendarAction, setCalendarAction] = useState<"preserve" | "capture" | "clear">("preserve")
  const [calendarSource, setCalendarSource] = useState<SlaBusinessCalendar | null>(null)
  const [calendarLoading, setCalendarLoading] = useState(false)
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setCalendarLoading(true)
    setCalendarSource(null)
    fetch("/api/v1/sla-policies/calendar", {
      headers: orgId ? { "x-organization-id": orgId } : {},
      signal: controller.signal,
    }).then(async response => {
      const payload = await response.json()
      if (!controller.signal.aborted && response.ok && payload.success) setCalendarSource(payload.data)
    }).catch(() => {}).finally(() => { if (!controller.signal.aborted) setCalendarLoading(false) })
    return () => controller.abort()
  }, [open, orgId])
  const selectedCalendar = calendarAction === "capture" ? calendarSource
    : calendarAction === "preserve" ? initialData?.businessCalendar : null
  const workingClock = Boolean(form.businessHoursOnly && selectedCalendar)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState("")

  useEffect(() => {
    if (!open) return
    const response = splitSlaDuration(initialData?.firstResponseHours ?? 4)
    const resolution = splitSlaDuration(initialData?.resolutionHours ?? 24)
    setForm({
      name: initialData?.name || "",
      priority: initialData?.priority || "medium",
      responseHours: response.hours,
      responseMinutes: response.minutes,
      resolutionHours: resolution.hours,
      resolutionMinutes: resolution.minutes,
      businessHoursOnly: initialData?.businessHoursOnly ?? true,
      isActive: initialData?.isActive ?? true,
    })
    setSaveError("")
    setCalendarAction("preserve")
  }, [
    initialData?.businessHoursOnly,
    initialData?.businessCalendar,
    initialData?.firstResponseHours,
    initialData?.id,
    initialData?.isActive,
    initialData?.name,
    initialData?.priority,
    initialData?.resolutionHours,
    open,
  ])

  const responseTotalMinutes = form.responseHours * 60 + form.responseMinutes
  const resolutionTotalMinutes = form.resolutionHours * 60 + form.resolutionMinutes
  const responseHoursDecimal = responseTotalMinutes / 60
  const resolutionHoursDecimal = resolutionTotalMinutes / 60
  const targetError = validateSlaTargets(responseHoursDecimal, resolutionHoursDecimal)
  const priorityConflict = form.isActive && hasActivePriorityConflict(existingPolicies, form.priority, initialData?.id)

  const validationMessage = targetError === "minimum"
    ? t("minimumTargetError")
    : targetError === "resolution_before_response"
      ? t("targetOrderError")
      : priorityConflict
        ? t("priorityConflictError", { priority: t(`priority.${form.priority}`) })
        : ""

  const durationLabel = (decimalHours: number) => {
    const { hours, minutes } = splitSlaDuration(decimalHours)
    if (hours > 0 && minutes > 0) return t("durationHoursMinutes", { hours, minutes })
    if (hours > 0) return t("durationHours", { hours })
    return t("durationMinutes", { minutes })
  }

  const previewItems = [
    { text: workingClock ? t("workingResponsePreview", { duration: durationLabel(responseHoursDecimal) }) : t("responsePreview", { duration: durationLabel(responseHoursDecimal) }), warning: false },
    { text: workingClock ? t("workingResolutionPreview", { duration: durationLabel(resolutionHoursDecimal) }) : t("resolutionPreview", { duration: durationLabel(resolutionHoursDecimal) }), warning: false },
    { text: workingClock ? t("workingCalendarHint") : form.businessHoursOnly ? t("businessClockPreview") : t("continuousClockPreview"), warning: form.businessHoursOnly && !workingClock },
    { text: t("escalationPreview"), warning: false },
  ]

  const update = <Key extends keyof SlaFormState>(key: Key, value: SlaFormState[Key]) => {
    setForm((current) => ({ ...current, [key]: value }))
    setSaveError("")
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaveError("")
    if (!form.name.trim()) {
      setSaveError(t("nameRequiredError"))
      return
    }
    if (validationMessage) {
      setSaveError(validationMessage)
      return
    }

    if (calendarAction === "capture" && (!calendarSource || !form.businessHoursOnly)) {
      setSaveError(t("calendarUnavailable"))
      return
    }
    setSaving(true)
    try {
      const response = await fetch(isEdit ? `/api/v1/sla-policies/${initialData!.id}` : "/api/v1/sla-policies", {
        method: isEdit ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": orgId } : {} as Record<string, string>),
        },
        body: JSON.stringify({
          name: form.name.trim(),
          priority: form.priority,
          firstResponseHours: responseHoursDecimal,
          resolutionHours: resolutionHoursDecimal,
          businessHoursOnly: form.businessHoursOnly,
          businessCalendarAction: calendarAction,
          ...(calendarAction === "capture" && calendarSource ? { expectedCalendarUpdatedAt: calendarSource.sourceUpdatedAt } : {}),
          isActive: form.isActive,
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        const message = payload?.code === "SLA_CALENDAR_SOURCE_CHANGED" ? t("calendarSourceChanged")
          : String(payload?.code || "").startsWith("SLA_CALENDAR_") ? t("calendarInvalid")
          : payload?.code === "ACTIVE_PRIORITY_CONFLICT"
          ? t("priorityConflictError", { priority: t(`priority.${form.priority}`) })
          : payload?.code === "RESOLUTION_BEFORE_RESPONSE"
            ? t("targetOrderError")
            : payload?.code === "MINIMUM"
              ? t("minimumTargetError")
              : response.status === 403
                ? t("savePermissionDenied")
                : t("saveFailed")
        throw new Error(message)
      }
      onSaved()
      onOpenChange(false)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : t("saveFailed"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} widthClassName="max-w-2xl" mobileFullscreen>
      <DialogHeader>
        <DialogTitle>{isEdit ? t("editTitle") : t("createTitle")}</DialogTitle>
      </DialogHeader>
      <form data-testid="sla-policy-form" onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <DialogContent>
          {saveError && (
            <div data-testid="sla-policy-save-error" role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />{saveError}
            </div>
          )}
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="sla-policy-name">{t("nameLabel")}</Label>
              <Input id="sla-policy-name" data-dialog-initial-focus value={form.name} onChange={(event) => update("name", event.target.value)} placeholder={t("namePlaceholder")} className="min-h-11" required />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sla-policy-priority">{t("priorityLabel")}</Label>
              <Select id="sla-policy-priority" value={form.priority} onChange={(event) => update("priority", event.target.value as SlaPolicyPriority)} className="min-h-11">
                <option value="critical">{t("priority.critical")}</option>
                <option value="high">{t("priority.high")}</option>
                <option value="medium">{t("priority.medium")}</option>
                <option value="low">{t("priority.low")}</option>
              </Select>
              <p className="text-xs text-muted-foreground">{t("priorityHelp")}</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <TimeTarget
                title={t("firstResponseLabel")}
                help={t(workingClock ? "workingResponseHelp" : "firstResponseHelp")}
                hours={form.responseHours}
                minutes={form.responseMinutes}
                hoursLabel={t("responseHoursInput")}
                minutesLabel={t("responseMinutesInput")}
                hourUnit={t("hourUnit")}
                minuteUnit={t("minuteUnit")}
                testIdPrefix="sla-response"
                onHours={(value) => update("responseHours", value)}
                onMinutes={(value) => update("responseMinutes", value)}
              />
              <TimeTarget
                title={t("resolutionLabel")}
                help={t(workingClock ? "workingResolutionHelp" : "resolutionHelp")}
                hours={form.resolutionHours}
                minutes={form.resolutionMinutes}
                hoursLabel={t("resolutionHoursInput")}
                minutesLabel={t("resolutionMinutesInput")}
                hourUnit={t("hourUnit")}
                minuteUnit={t("minuteUnit")}
                testIdPrefix="sla-resolution"
                onHours={(value) => update("resolutionHours", value)}
                onMinutes={(value) => update("resolutionMinutes", value)}
              />
            </div>

            {validationMessage && (
              <div data-testid="sla-policy-validation-error" role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 p-3 text-sm text-destructive">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />{validationMessage}
              </div>
            )}

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="relative flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border p-3 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
                <input data-testid="sla-policy-business-hours" type="checkbox" checked={form.businessHoursOnly} onChange={(event) => update("businessHoursOnly", event.target.checked)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
                <span aria-hidden="true" className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${form.businessHoursOnly ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background"}`}>{form.businessHoursOnly && <CheckCircle2 className="h-3.5 w-3.5" />}</span>
                <span><span className="block text-sm font-medium">{t("businessHoursOnlyLabel")}</span><span className="mt-0.5 block text-xs text-muted-foreground">{t("businessHoursOnlyHelp")}</span></span>
              </label>
              <label className="relative flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border p-3 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
                <input data-testid="sla-policy-active" type="checkbox" checked={form.isActive} onChange={(event) => update("isActive", event.target.checked)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
                <span aria-hidden="true" className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${form.isActive ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background"}`}>{form.isActive && <CheckCircle2 className="h-3.5 w-3.5" />}</span>
                <span><span className="block text-sm font-medium">{t("activeStatus")}</span><span className="mt-0.5 block text-xs text-muted-foreground">{t("activeHelp")}</span></span>
              </label>
            </div>

            <section className="space-y-2 rounded-lg border p-3" aria-labelledby="sla-calendar-title">
              <Label id="sla-calendar-title" htmlFor="sla-calendar-selection">{t("calendarSelection")}</Label>
              <Select id="sla-calendar-selection" value={calendarAction} onChange={event => {
                const value = event.target.value as "preserve" | "capture" | "clear"
                setCalendarAction(value)
                if (value === "capture") update("businessHoursOnly", true)
              }} className="min-h-11">
                <option value="preserve">{initialData?.businessCalendar ? t("calendarKeep") : t("calendarLegacy")}</option>
                <option value="capture" disabled={!calendarSource || calendarLoading}>{t("calendarCapture")}</option>
                <option value="clear">{t("calendarClear")}</option>
              </Select>
              <p className="text-xs text-muted-foreground">{t("calendarProspective")}</p>
              {!calendarSource && !calendarLoading && <p className="text-xs text-muted-foreground">{t("calendarUnavailable")}</p>}
              {selectedCalendar && <details className="rounded border p-2 text-sm">
                <summary className="min-h-11 cursor-pointer py-2">{t("calendarSummary", { timezone: selectedCalendar.timezone })}</summary>
                <dl className="space-y-1">{(["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const).map((key, index) => {
                  const day = selectedCalendar.schedule[key]
                  return <div key={key} className="flex flex-wrap justify-between gap-2"><dt>{new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 7 + index)))}</dt><dd>{day?.enabled ? day.intervals.map(interval => `${interval.start}–${interval.end}`).join(", ") || t("calendarClosed") : t("calendarClosed")}</dd></div>
                })}</dl>
                <p className="mt-2 text-xs">{t("calendarHolidays", { count: selectedCalendar.holidays.length })}</p>
                <ul className="mt-1 space-y-1 text-xs">{selectedCalendar.holidays.map(holiday => <li key={holiday.date}>{holiday.date}{holiday.name ? ` — ${holiday.name}` : ""}: {holiday.intervals?.length ? holiday.intervals.map(interval => `${interval.start}–${interval.end}`).join(", ") : holiday.closed !== false ? t("calendarClosed") : t("calendarRegularDay")}</li>)}</ul>
              </details>}
            </section>

            <section data-testid="sla-policy-preview" aria-labelledby="sla-preview-title" className="rounded-xl border bg-muted/20 p-3">
              <h3 id="sla-preview-title" className="flex items-center gap-2 text-sm font-semibold"><Clock className="h-4 w-4 text-muted-foreground" />{t("previewTitle")}</h3>
              <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground" aria-live="polite">
                {previewItems.map((item) => {
                  const PreviewIcon = item.warning ? CircleAlert : CheckCircle2
                  return <li key={item.text} className="flex items-start gap-2"><PreviewIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />{item.text}</li>
                })}
              </ul>
            </section>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button type="button" variant="outline" className="min-h-11" onClick={() => onOpenChange(false)} disabled={saving}>{tc("cancel")}</Button>
          <Button data-testid="sla-policy-submit" type="submit" className="min-h-11 bg-orange-700 text-white hover:bg-orange-800" disabled={saving || Boolean(validationMessage) || !form.name.trim()}>
            {saving ? tc("saving") : isEdit ? tc("update") : tc("create")}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}

function TimeTarget({
  title,
  help,
  hours,
  minutes,
  hoursLabel,
  minutesLabel,
  hourUnit,
  minuteUnit,
  testIdPrefix,
  onHours,
  onMinutes,
}: {
  title: string
  help: string
  hours: number
  minutes: number
  hoursLabel: string
  minutesLabel: string
  hourUnit: string
  minuteUnit: string
  testIdPrefix: string
  onHours: (value: number) => void
  onMinutes: (value: number) => void
}) {
  return (
    <fieldset className="rounded-lg border p-3">
      <legend className="px-1 text-sm font-medium">{title}</legend>
      <div className="mt-1 grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">{hourUnit}</span>
          <Input data-testid={`${testIdPrefix}-hours`} aria-label={hoursLabel} type="number" min="0" max="8760" step="1" value={hours} onChange={(event) => onHours(clampInteger(event.target.value, 8760))} className="min-h-11" />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">{minuteUnit}</span>
          <Input data-testid={`${testIdPrefix}-minutes`} aria-label={minutesLabel} type="number" min="0" max="59" step="1" value={minutes} onChange={(event) => onMinutes(clampInteger(event.target.value, 59))} className="min-h-11" />
        </label>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{help}</p>
    </fieldset>
  )
}
