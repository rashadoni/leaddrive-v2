"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
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

interface SlaPolicyInitial {
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
  }, [
    initialData?.businessHoursOnly,
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
    { text: t("responsePreview", { duration: durationLabel(responseHoursDecimal) }), warning: false },
    { text: t("resolutionPreview", { duration: durationLabel(resolutionHoursDecimal) }), warning: false },
    { text: form.businessHoursOnly ? t("businessClockPreview") : t("continuousClockPreview"), warning: form.businessHoursOnly },
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
          isActive: form.isActive,
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        const message = payload?.code === "ACTIVE_PRIORITY_CONFLICT"
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
      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <DialogContent>
          {saveError && (
            <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
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
                help={t("firstResponseHelp")}
                hours={form.responseHours}
                minutes={form.responseMinutes}
                hoursLabel={t("responseHoursInput")}
                minutesLabel={t("responseMinutesInput")}
                hourUnit={t("hourUnit")}
                minuteUnit={t("minuteUnit")}
                onHours={(value) => update("responseHours", value)}
                onMinutes={(value) => update("responseMinutes", value)}
              />
              <TimeTarget
                title={t("resolutionLabel")}
                help={t("resolutionHelp")}
                hours={form.resolutionHours}
                minutes={form.resolutionMinutes}
                hoursLabel={t("resolutionHoursInput")}
                minutesLabel={t("resolutionMinutesInput")}
                hourUnit={t("hourUnit")}
                minuteUnit={t("minuteUnit")}
                onHours={(value) => update("resolutionHours", value)}
                onMinutes={(value) => update("resolutionMinutes", value)}
              />
            </div>

            {validationMessage && (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 p-3 text-sm text-destructive">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />{validationMessage}
              </div>
            )}

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex min-h-12 items-start gap-3 rounded-lg border p-3">
                <input type="checkbox" checked={form.businessHoursOnly} onChange={(event) => update("businessHoursOnly", event.target.checked)} className="mt-1 h-4 w-4" />
                <span><span className="block text-sm font-medium">{t("businessHoursOnlyLabel")}</span><span className="mt-0.5 block text-xs text-muted-foreground">{t("businessHoursOnlyHelp")}</span></span>
              </label>
              <label className="flex min-h-12 items-start gap-3 rounded-lg border p-3">
                <input type="checkbox" checked={form.isActive} onChange={(event) => update("isActive", event.target.checked)} className="mt-1 h-4 w-4" />
                <span><span className="block text-sm font-medium">{t("activeStatus")}</span><span className="mt-0.5 block text-xs text-muted-foreground">{t("activeHelp")}</span></span>
              </label>
            </div>

            <section aria-labelledby="sla-preview-title" className="rounded-xl border bg-muted/20 p-3">
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
          <Button type="submit" className="min-h-11" disabled={saving || Boolean(validationMessage) || !form.name.trim()}>
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
  onHours: (value: number) => void
  onMinutes: (value: number) => void
}) {
  return (
    <fieldset className="rounded-lg border p-3">
      <legend className="px-1 text-sm font-medium">{title}</legend>
      <div className="mt-1 grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">{hourUnit}</span>
          <Input aria-label={hoursLabel} type="number" min="0" max="8760" step="1" value={hours} onChange={(event) => onHours(clampInteger(event.target.value, 8760))} className="min-h-11" />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">{minuteUnit}</span>
          <Input aria-label={minutesLabel} type="number" min="0" max="59" step="1" value={minutes} onChange={(event) => onMinutes(clampInteger(event.target.value, 59))} className="min-h-11" />
        </label>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{help}</p>
    </fieldset>
  )
}
