"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Power } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * The organization switch "Workday attendance", in Personnel → Settings only
 * (owner: one setting in one place). On: a status row; an administrator may
 * switch it off after an in-place confirmation — data is kept. Off: the whole
 * section shows this panel to an administrator (the layout hides it from
 * everyone else). Saved through the MTM settings endpoint, which refuses a
 * non-administrator and writes the audit row.
 */
export function MtmAttendanceFeatureSwitch({ enabled, canChange }: { enabled: boolean; canChange: boolean }) {
  const p = useTranslations("personnel")
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)

  async function save(next: boolean) {
    setSaving(true)
    setFailed(false)
    try {
      const response = await fetch("/api/v1/mtm/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ attendanceEnabled: next }) })
      const body = await response.json().catch(() => null)
      if (!response.ok || body?.success !== true || body.data?.ignoredKeys?.includes?.("attendanceEnabled")) throw new Error("NOT_SAVED")
      // The menu, the section guard and every open screen read the switch: start over.
      window.location.assign("/mtm/attendance/settings")
    } catch {
      setFailed(true)
      setSaving(false)
    }
  }

  if (!enabled) return <section className="mx-auto max-w-xl space-y-4 rounded-2xl border bg-card p-6 text-center" data-testid="attendance-feature-off">
    <span className="mx-auto flex h-12 w-12 items-center justify-center text-muted-foreground" aria-hidden="true"><Power className="h-6 w-6" /></span>
    <h1 className="text-xl font-bold">{p("featureOff")}</h1>
    <p className="text-sm leading-relaxed text-muted-foreground">{p("featureOffHint")}</p>
    {canChange ? <Button type="button" className="min-h-11 rounded-full px-6" disabled={saving} onClick={() => void save(true)}>{p("featureEnable")}</Button> : null}
    {failed ? <p role="alert" className="text-sm text-destructive">{p("featureSaveError")}</p> : null}
  </section>

  return <section className="space-y-3 rounded-2xl border bg-card p-4" data-testid="attendance-feature-on">
    <div className="flex flex-wrap items-center gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-emerald-700 dark:text-emerald-300" aria-hidden="true"><Power className="h-5 w-5" /></span>
      <p className="min-w-0 flex-1 font-semibold">{p("featureOn")}</p>
      {canChange && !confirming ? <Button type="button" variant="outline" className="min-h-10 rounded-full" onClick={() => setConfirming(true)}>{p("featureDisable")}</Button> : null}
    </div>
    {confirming ? <div className="space-y-3 rounded-xl bg-muted/50 p-4" role="group" aria-label={p("featureDisable")}>
      <p className="text-sm leading-relaxed">{p("featureDisableConfirm")}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="destructive" className="min-h-10 rounded-full" disabled={saving} onClick={() => void save(false)}>{p("featureDisableAction")}</Button>
        <Button type="button" variant="outline" className="min-h-10 rounded-full" disabled={saving} onClick={() => { setConfirming(false); setFailed(false) }}>{p("cancel")}</Button>
      </div>
    </div> : null}
    {failed ? <p role="alert" className="text-sm text-destructive">{p("featureSaveError")}</p> : null}
  </section>
}
