"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { MTM_SETTING_NUMBER_RANGES } from "@/lib/mtm/settings-validation"

/**
 * Personnel → Settings: the attendance switches that used to sit in MTM →
 * Settings → Company (owner, 2026-10-18: «настройки, которые относятся к учёту
 * времени, перемести в настройки соответствующего модуля»). The same keys, the
 * same endpoint (`/api/v1/mtm/settings`, administrators only), the same words
 * (`mtmSettingsPage`): only where they live has changed.
 *
 * One card opens one of three editors. Saving sends only the keys this editor
 * changed, so it never overwrites what another page saved meanwhile.
 */
export type AttendancePolicyCard = "reminders" | "approval" | "checks"

type Item = { key: string; labelKey: string; hintKey: string } & ({ type: "boolean" } | { type: "number"; unitKey: string })

export const ATTENDANCE_POLICY_ITEMS: Record<AttendancePolicyCard, readonly Item[]> = {
  reminders: [
    { key: "attendanceEmployeeRemindersEnabled", labelKey: "lblAttendanceEmployeeReminders", hintKey: "hintAttendanceEmployeeReminders", type: "boolean" },
    { key: "attendanceManagerAlertsEnabled", labelKey: "lblAttendanceManagerAlerts", hintKey: "hintAttendanceManagerAlerts", type: "boolean" },
  ],
  approval: [
    { key: "attendanceTwoStepApproval", labelKey: "lblAttendanceTwoStepApproval", hintKey: "hintAttendanceTwoStepApproval", type: "boolean" },
    { key: "attendanceAutoCloseForgottenDay", labelKey: "lblAttendanceAutoCloseForgottenDay", hintKey: "hintAttendanceAutoCloseForgottenDay", type: "boolean" },
  ],
  checks: [
    { key: "attendanceRejectOutsideBranch", labelKey: "lblAttendanceRejectOutsideBranch", hintKey: "hintAttendanceRejectOutsideBranch", type: "boolean" },
    { key: "attendanceAllowSharedInstallations", labelKey: "lblAttendanceAllowSharedInstallations", hintKey: "hintAttendanceAllowSharedInstallations", type: "boolean" },
    { key: "attendanceRejectMockLocations", labelKey: "lblAttendanceRejectMockLocations", hintKey: "hintAttendanceRejectMockLocations", type: "boolean" },
    { key: "attendanceClockDifferenceSeconds", labelKey: "lblAttendanceClockDifferenceSeconds", hintKey: "hintAttendanceClockDifferenceSeconds", type: "number", unitKey: "unitSeconds" },
  ],
}

type Values = Record<string, unknown>

export function MtmAttendancePolicySettings({ card, canChange }: { card: AttendancePolicyCard; canChange: boolean }) {
  const ts = useTranslations("mtmSettingsPage")
  const items = ATTENDANCE_POLICY_ITEMS[card]
  const [loaded, setLoaded] = useState<Values | null>(null)
  const [draft, setDraft] = useState<Values>({})
  const [numbers, setNumbers] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const tsRef = useRef(ts)
  tsRef.current = ts

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/mtm/settings", { cache: "no-store" })
      const body = await response.json().catch(() => null)
      if (!response.ok || body?.success !== true) { toast.error(tsRef.current("loadFailed")); return }
      setLoaded(body.data); setDraft(body.data); setNumbers({})
    } catch { toast.error(tsRef.current("loadFailed")) }
  }, [])
  useEffect(() => { void load() }, [load])

  const numberError = (key: string): string | null => {
    if (!(key in numbers)) return null
    const range = MTM_SETTING_NUMBER_RANGES[key as keyof typeof MTM_SETTING_NUMBER_RANGES]
    const text = numbers[key]
    const value = Number(text)
    if (text.trim() === "") return ts("errRequired")
    if (!Number.isInteger(value)) return ts("errNotInteger")
    if (range && (value < range.min || value > range.max)) return ts("errOutOfRange", { min: range.min, max: range.max })
    return null
  }
  const changed = loaded ? items.map((item) => item.key).filter((key) => draft[key] !== loaded[key]) : []
  const invalid = items.some((item) => item.type === "number" && numberError(item.key) !== null)

  const save = async () => {
    if (!loaded || invalid || changed.length === 0 || saving) return
    const changes = Object.fromEntries(changed.map((key) => [key, draft[key]]))
    setSaving(true)
    try {
      const response = await fetch("/api/v1/mtm/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes) })
      if (!response.ok) { toast.error(ts("saveFailed")); return }
      toast.success(ts("savedToast"))
      setLoaded((previous) => ({ ...previous, ...changes }))
      setNumbers({})
    } catch {
      toast.error(ts("saveFailed"))
    } finally {
      setSaving(false)
    }
  }

  if (!loaded) return <div className="h-24 animate-pulse rounded-2xl border bg-card" aria-busy="true" />
  return <section className="space-y-4" data-testid={`attendance-policy-${card}`}>
    <div className="divide-y rounded-2xl border bg-card">
      {items.map((item) => {
        const on = draft[item.key] === true
        const error = item.type === "number" ? numberError(item.key) : null
        return <div key={item.key} data-setting-row={item.key} className="flex items-start justify-between gap-4 p-4">
          <div className="min-w-0">
            <div className="font-medium">{ts(item.labelKey)}</div>
            <div className="mt-0.5 text-sm text-muted-foreground">{ts(item.hintKey)}</div>
            {!canChange ? <div className="mt-1 text-xs text-muted-foreground">{ts("adminOnlyNote")}</div> : null}
          </div>
          {item.type === "boolean"
            ? <button type="button" role="switch" aria-checked={on} aria-label={ts(item.labelKey)} disabled={!canChange || saving}
                onClick={() => setDraft((previous) => ({ ...previous, [item.key]: !on }))}
                className="relative inline-flex h-11 w-11 shrink-0 items-center rounded-full disabled:cursor-not-allowed disabled:opacity-50">
                <span aria-hidden="true" className={`absolute inset-x-0 h-6 rounded-full transition-colors ${on ? "bg-primary" : "bg-muted"}`} />
                <span className={`relative inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${on ? "translate-x-6" : "translate-x-1"}`} />
              </button>
            : <div className="flex shrink-0 flex-col items-end gap-1">
                <div className="flex items-center gap-1.5">
                  <input type="number" inputMode="numeric" step={1}
                    min={MTM_SETTING_NUMBER_RANGES[item.key as keyof typeof MTM_SETTING_NUMBER_RANGES]?.min}
                    max={MTM_SETTING_NUMBER_RANGES[item.key as keyof typeof MTM_SETTING_NUMBER_RANGES]?.max}
                    value={item.key in numbers ? numbers[item.key] : typeof draft[item.key] === "number" ? String(draft[item.key]) : ""}
                    disabled={!canChange || saving}
                    aria-label={ts("ariaNumber", { label: ts(item.labelKey), unit: ts(item.unitKey) })}
                    aria-invalid={error ? true : undefined}
                    onChange={(event) => {
                      const text = event.target.value
                      setNumbers((previous) => ({ ...previous, [item.key]: text }))
                      const value = Number(text)
                      if (text.trim() !== "" && Number.isInteger(value)) setDraft((previous) => ({ ...previous, [item.key]: value }))
                    }}
                    className={`h-11 w-28 rounded-md border bg-background px-2 text-right text-sm disabled:cursor-not-allowed disabled:opacity-50 ${error ? "border-destructive" : "border-zinc-200 dark:border-zinc-700"}`} />
                  <span aria-hidden="true" className="min-w-8 text-xs text-muted-foreground">{ts(`${item.unitKey}Short`)}</span>
                </div>
                {error ? <span role="alert" className="max-w-[14rem] text-right text-xs text-destructive">{error}</span> : null}
              </div>}
        </div>
      })}
    </div>
    {canChange
      ? <div className="flex justify-end">
          <Button type="button" data-testid="attendance-policy-save" disabled={saving || invalid || changed.length === 0} onClick={() => { void save() }}>{ts("save")}</Button>
        </div>
      : null}
  </section>
}
