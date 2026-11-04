"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { Coffee, Plus, Trash2 } from "lucide-react"
import { HomeCard, HomePill } from "@/components/mtm/home-parts"
import { Button } from "@/components/ui/button"
import { ATTENDANCE_BREAK_KINDS_MAX, ATTENDANCE_BUILT_IN_BREAK_KINDS, type AttendanceBreakKind } from "@/lib/mtm/attendance-break-kinds-names"

const ENDPOINT = "/api/v1/mtm/attendance/break-kinds"
type Row = { key: string; id: string | null; name: string; limit: string }
type Loaded = { enabled: boolean; kinds: AttendanceBreakKind[]; canConfigure: boolean }
const isBuiltIn = (id: string | null) => !!id && (ATTENDANCE_BUILT_IN_BREAK_KINDS as readonly string[]).includes(id)

/**
 * Personnel → Settings → Kinds of breaks (owner, 2026-11-04; mockup
 * `docs/mtm-attendance/mockups/desk-and-breaks/3-crm-settings.png`). The whole
 * list is saved at once; a limit is per day, for all breaks of that kind, and
 * only raises a remark for HR.
 */
export function MtmAttendanceBreakKindsSettings() {
  const t = useTranslations("mtmAttendance")
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [enabled, setEnabled] = useState(false), [rows, setRows] = useState<Row[]>([])
  const [busy, setBusy] = useState(false), [state, setState] = useState<"idle" | "saved" | "error" | "denied">("idle")
  const mounted = useRef(false), counter = useRef(0)
  const builtInName = useCallback((id: string) => t(`breakKind_${id}`), [t])
  const fill = useCallback((data: Loaded) => {
    setLoaded(data); setEnabled(data.enabled)
    setRows(data.kinds.map(kind => ({ key: kind.id, id: kind.id, name: kind.name ?? builtInName(kind.id), limit: kind.limitMinutes === null ? "" : String(kind.limitMinutes) })))
  }, [builtInName])
  useEffect(() => {
    mounted.current = true
    void (async () => {
      try {
        const response = await fetch(ENDPOINT, { cache: "no-store" })
        const body = await response.json().catch(() => null)
        if (!mounted.current) return
        if ([401, 403, 404].includes(response.status)) { setState("denied"); return }
        if (!response.ok || body?.success !== true || !Array.isArray(body.data?.kinds)) throw new Error("INVALID")
        fill(body.data)
      } catch { if (mounted.current) setState("error") }
    })()
    return () => { mounted.current = false }
  }, [fill])
  const canConfigure = loaded?.canConfigure === true
  const limitValid = (value: string) => value.trim() === "" || (/^\d{1,3}$/.test(value.trim()) && Number(value) >= 1 && Number(value) <= 720)
  const valid = rows.every(row => row.name.trim().length > 0 && row.name.trim().length <= 40 && limitValid(row.limit)) && (!enabled || rows.length > 0)
  const change = (key: string, patch: Partial<Row>) => { setState("idle"); setRows(current => current.map(row => row.key === key ? { ...row, ...patch } : row)) }
  async function save() {
    if (!canConfigure || busy || !valid) return
    setBusy(true); setState("idle")
    try {
      const kinds = rows.map(row => ({ id: row.id,
        // A built-in kind left as each screen names it stays nameless: it keeps following the language.
        name: isBuiltIn(row.id) && row.name.trim() === builtInName(row.id!) ? null : row.name.trim(),
        limitMinutes: row.limit.trim() === "" ? null : Number(row.limit) }))
      const response = await fetch(ENDPOINT, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled, kinds }) })
      const body = await response.json().catch(() => null)
      if (!mounted.current) return
      if (!response.ok || body?.success !== true) { setState("error"); return }
      fill(body.data); setState("saved")
    } catch { if (mounted.current) setState("error") }
    finally { if (mounted.current) setBusy(false) }
  }
  if (state === "denied") return <p role="status">{t("reportAccessUnavailable")}</p>
  return <main className="min-w-0 max-w-3xl space-y-5" data-testid="attendance-break-kinds">
    <p className="text-sm leading-relaxed text-muted-foreground">{t("breakKindsIntro")}</p>
    {loaded && <HomeCard testId="attendance-break-kinds-card" titleId="attendance-break-kinds-title" title={t("breakKindsAsk")} icon={<Coffee className="h-5 w-5" aria-hidden="true" />} tone="green">
      <div className="space-y-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="max-w-xl text-sm text-muted-foreground">{t("breakKindsAskHint")}</p>
          <div className="flex items-center gap-3"><HomePill tone={enabled ? "green" : "zinc"}>{t(enabled ? "installationOn" : "installationOff")}</HomePill>
            {canConfigure && <Button type="button" variant={enabled ? "outline" : "default"} role="switch" aria-checked={enabled} aria-label={t("breakKindsAsk")} className="min-h-11" disabled={busy}
              data-testid="attendance-break-kinds-switch" onClick={() => { setState("idle"); setEnabled(!enabled) }}>{t(enabled ? "breakKindsTurnOff" : "breakKindsTurnOn")}</Button>}</div></div>
        <div className="divide-y rounded-xl border">
          <div className="grid grid-cols-[minmax(0,1fr)_9rem_auto] gap-3 bg-muted/40 px-3 py-2 text-xs font-semibold text-muted-foreground"><span>{t("breakKindName")}</span><span>{t("breakKindLimit")}</span><span className="sr-only">{t("breakKindRemove")}</span></div>
          {rows.map(row => <div key={row.key} className="grid grid-cols-[minmax(0,1fr)_9rem_auto] items-center gap-3 px-3 py-2" data-testid="attendance-break-kind">
            <input aria-label={t("breakKindName")} value={row.name} maxLength={40} disabled={!canConfigure || busy} onChange={event => change(row.key, { name: event.target.value })}
              className="min-h-11 w-full rounded-lg border bg-background px-3 text-sm" data-testid="attendance-break-kind-name" />
            <label className="flex items-center gap-2 text-sm"><input aria-label={t("breakKindLimit")} inputMode="numeric" value={row.limit} placeholder={t("breakKindNoLimit")} disabled={!canConfigure || busy}
              onChange={event => change(row.key, { limit: event.target.value.replace(/[^\d]/g, "").slice(0, 3) })}
              className={`min-h-11 w-24 rounded-lg border bg-background px-3 text-right text-sm ${limitValid(row.limit) ? "" : "border-destructive"}`} data-testid="attendance-break-kind-limit" /><span className="text-muted-foreground">{t("breakKindMinutes")}</span></label>
            {canConfigure ? <Button type="button" variant="ghost" className="min-h-11 text-destructive" disabled={busy} aria-label={t("breakKindRemoveNamed", { name: row.name || "—" })}
              onClick={() => { setState("idle"); setRows(current => current.filter(item => item.key !== row.key)) }}><Trash2 className="h-4 w-4" aria-hidden="true" /><span className="ml-1 hidden sm:inline">{t("breakKindRemove")}</span></Button> : <span />}
          </div>)}
        </div>
        {canConfigure && rows.length < ATTENDANCE_BREAK_KINDS_MAX && <Button type="button" variant="outline" className="min-h-11" disabled={busy} data-testid="attendance-break-kind-add"
          onClick={() => { setState("idle"); counter.current += 1; setRows(current => [...current, { key: `new-${counter.current}`, id: null, name: "", limit: "" }]) }}><Plus className="mr-1 h-4 w-4" aria-hidden="true" />{t("breakKindAdd")}</Button>}
        {enabled && !rows.length && <p role="alert" className="text-sm text-destructive">{t("breakKindsEmpty")}</p>}
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{t("breakKindsNote")}</p>
        {canConfigure ? <div className="flex flex-wrap items-center gap-3"><Button type="button" className="min-h-11" disabled={busy || !valid} onClick={() => void save()} data-testid="attendance-break-kinds-save">{t("breakKindsSave")}</Button>
          {state === "saved" && <span role="status" className="text-sm text-emerald-700">{t("breakKindsSaved")}</span>}</div>
          : <p className="text-sm text-muted-foreground">{t("breakKindsReadOnly")}</p>}
      </div>
    </HomeCard>}
    {state === "error" && <p role="alert" className="text-sm text-destructive">{t("breakKindsError")}</p>}
    <p className="text-sm text-muted-foreground">{t("breakKindsPrivacy")}</p>
  </main>
}
