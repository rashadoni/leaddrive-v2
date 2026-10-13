"use client"

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { useTranslations } from "next-intl"
import { ArrowDown, ArrowUp, Columns3 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { HomeCard } from "@/components/mtm/home-parts"
import { ATTENDANCE_VIEW_COLUMNS, DEFAULT_ATTENDANCE_VIEW_COLUMNS, AttendanceViewConfigSchema, type AttendanceView, type AttendanceViewColumn, type AttendanceViewConfig } from "@/lib/mtm/attendance-view-contract"

const ENDPOINT = "/api/v1/mtm/attendance/views"
const COLUMN_MESSAGES: Record<AttendanceViewColumn, string> = { employee: "reportEmployee", team: "reportTeam", date: "reportDate", status: "reportStatus",
  startedAt: "reportStarted", completedAt: "reportFinished", worked: "reportWorked", paused: "reportPaused", late: "reportLate", early: "reportEarly",
  event: "reportEvent", phoneAt: "reportPhoneTime", serverAt: "reportServerTime", days: "viewsDays", absent: "reportAbsentCount", notes: "reportNotes", arrivalBranch: "reportArrivalBranch", departureBranch: "reportDepartureBranch", markLocation: "reportMarkLocation",
  branch: "branchReportBranch", arrivals: "branchReportArrivals", departures: "branchReportDepartures", employees: "branchReportEmployees", outside: "branchReportOutside", uncertain: "branchReportUncertain", noLocation: "locationReportUnavailable", noConsent: "locationReportNoConsent" }
const MODE_MESSAGES = { DAY: "viewsModeDay", MONTH: "viewsModeMonth", JOURNAL: "viewsModeJournal", BRANCH: "branchReportTitle" } as const
const SELECT_CLASS = "min-h-11 w-full rounded-lg border border-zinc-200 bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-zinc-700"

function filtersFor(mode: AttendanceViewConfig["mode"], filters: AttendanceViewConfig["filters"]) {
  const result = { ...filters, form: mode === "BRANCH" ? "ALL" as const : mode === "JOURNAL" ? "JOURNAL" as const : filters.form === "JOURNAL" ? "ALL" as const : filters.form }
  if (mode === "MONTH") {
    result.from = `${filters.from.slice(0, 7)}-01`
    const end = new Date(`${result.from}T12:00:00Z`)
    end.setUTCMonth(end.getUTCMonth() + 1)
    end.setUTCDate(0)
    result.to = end.toISOString().slice(0, 10)
  }
  return result
}

export interface MtmAttendancePersonalViewsProps {
  currentConfig: AttendanceViewConfig | null
  onApply: (config: AttendanceViewConfig, name: string) => void
  onAccessLost: () => void
  accessUnavailable?: boolean
}

/** Personal configuration only; applying a form rechecks scope through the report API. */
export function MtmAttendancePersonalViews({ currentConfig, onApply, onAccessLost, accessUnavailable = false }: MtmAttendancePersonalViewsProps) {
  const t = useTranslations("mtmAttendance")
  const [views, setViews] = useState<AttendanceView[]>([])
  const [draft, setDraft] = useState<AttendanceViewConfig | null>(currentConfig)
  const [editing, setEditing] = useState<AttendanceView | null>(null)
  const [name, setName] = useState("")
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [mustReload, setMustReload] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const readRequest = useRef<AbortController | null>(null)
  const writeRequest = useRef<AbortController | null>(null)
  const interruptedSave = useRef(false)
  const pendingCreate = useRef<{ fingerprint: string; requestId: string } | null>(null)
  const nameInput = useRef<HTMLInputElement | null>(null)
  const editingRef = useRef<AttendanceView | null>(null)
  editingRef.current = editing
  const accessLost = useRef(onAccessLost)
  accessLost.current = onAccessLost

  const clearPrivate = useCallback(() => {
    setViews([])
    setDraft(null)
    setEditing(null)
    setName("")
    setRemoving(null)
    setSaved(null)
    setSaveError(null)
    pendingCreate.current = null
  }, [])

  const load = useCallback(async (acknowledgeInterrupted = false) => {
    readRequest.current?.abort()
    const controller = new AbortController()
    readRequest.current = controller
    setLoading(true)
    setLoadError(null)
    setSaveError(null)
    setSaved(null)
    setRemoving(null)
    setViews([])
    if (interruptedSave.current) setSaving(false)
    try {
      const response = await fetch(ENDPOINT, { cache: "no-store", signal: controller.signal })
      const body = await response.json().catch(() => null)
      if (controller.signal.aborted) return
      if (!response.ok || body?.success !== true || !Array.isArray(body.data)) {
        const denied = [401, 403, 404].includes(response.status)
        setLoadError(t(denied ? "viewsAccessUnavailable" : "viewsLoadError"))
        if (denied) { clearPrivate(); accessLost.current() }
        return
      }
      const loaded = body.data as AttendanceView[]
      setViews(loaded)
      const unresolved = interruptedSave.current && !acknowledgeInterrupted
      setMustReload(unresolved)
      if (unresolved) setSaveError(t("viewsSaveUnconfirmed"))
      else interruptedSave.current = false
      if (editingRef.current) {
        const latest = loaded.find((view) => view.id === editingRef.current!.id)
        setEditing(latest ?? null)
        if (latest) { setName(latest.name); setDraft(latest.config) }
        else { setName(""); setDraft(null) }
      }
    } catch {
      if (!controller.signal.aborted) setLoadError(t("viewsLoadError"))
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [t, clearPrivate])

  useEffect(() => {
    void load()
    return () => {
      readRequest.current?.abort()
      if (writeRequest.current) {
        interruptedSave.current = true
        writeRequest.current.abort()
        writeRequest.current = null
      }
    }
  }, [load])
  useEffect(() => {
    if (!currentConfig || accessUnavailable) return
    setDraft((previous) => previous ? { ...previous, filters: filtersFor(previous.mode, currentConfig.filters) } : currentConfig)
  }, [currentConfig, accessUnavailable])
  useEffect(() => {
    if (!accessUnavailable) return
    readRequest.current?.abort()
    writeRequest.current?.abort()
    clearPrivate()
    setLoading(false)
    setSaving(false)
    setLoadError(t("viewsAccessUnavailable"))
  }, [accessUnavailable, clearPrivate, t])

  function change(value: Partial<AttendanceViewConfig>) {
    setDraft((previous) => previous ? { ...previous, ...value } : previous)
    setSaved(null)
    if (!mustReload) setSaveError(null)
  }
  function chooseMode(mode: AttendanceViewConfig["mode"]) {
    if (!draft) return
    change({ mode, columns: [...DEFAULT_ATTENDANCE_VIEW_COLUMNS[mode]], filters: filtersFor(mode, draft.filters) })
  }
  function move(column: AttendanceViewColumn, offset: number) {
    if (!draft) return
    const index = draft.columns.indexOf(column)
    const next = index + offset
    if (index < 0 || next < 0 || next >= draft.columns.length) return
    const columns = [...draft.columns]
    ;[columns[index], columns[next]] = [columns[next], columns[index]]
    change({ columns })
  }
  function choose(view: AttendanceView, open: boolean) {
    if (saving || mustReload) return
    setEditing(view)
    setName(view.name)
    setDraft(view.config)
    setRemoving(null)
    setSaveError(null)
    setSaved(null)
    if (open) onApply(view.config, view.name)
    else nameInput.current?.focus()
  }
  function preview() {
    if (!draft || !AttendanceViewConfigSchema.safeParse(draft).success) { setSaveError(t("viewsInvalid")); return }
    onApply(draft, name.trim() || t("viewsUntitled"))
  }

  async function mutate(remove?: AttendanceView) {
    if (saving || writeRequest.current || mustReload || accessUnavailable || (remove && removing !== remove.id)) return
    if (!remove && (!draft || !name.trim() || name.trim().length > 80 || !AttendanceViewConfigSchema.safeParse(draft).success)) {
      setSaveError(t("viewsInvalid"))
      return
    }
    const controller = new AbortController()
    writeRequest.current = controller
    setSaving(true)
    setSaveError(null)
    setSaved(null)
    try {
      const target = remove ?? editing
      let body: object
      if (remove) body = { version: remove.version }
      else if (editing) body = { name: name.trim(), config: draft, version: editing.version }
      else {
        const fingerprint = JSON.stringify({ name: name.trim(), config: draft })
        if (pendingCreate.current?.fingerprint !== fingerprint) pendingCreate.current = { fingerprint, requestId: crypto.randomUUID() }
        body = { name: name.trim(), config: draft, requestId: pendingCreate.current.requestId }
      }
      const response = await fetch(target ? `${ENDPOINT}/${encodeURIComponent(target.id)}` : ENDPOINT,
        { method: remove ? "DELETE" : editing ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: controller.signal })
      const result = await response.json().catch(() => null)
      if (controller.signal.aborted) return
      if (!response.ok || result?.success !== true || (!remove && !result.data?.id)) {
        if ([401, 403, 404].includes(response.status)) { clearPrivate(); setLoadError(t("viewsAccessUnavailable")); accessLost.current() }
        else {
          const keys: Record<string, string> = { MTM_ATTENDANCE_VIEW_INVALID: "viewsInvalid", MTM_ATTENDANCE_VIEW_CHANGED: "viewsChanged", MTM_ATTENDANCE_VIEW_LIMIT: "viewsLimit" }
          setSaveError(t(keys[result?.code] ?? "viewsSaveUnconfirmed"))
          if (result?.code !== "MTM_ATTENDANCE_VIEW_INVALID") setMustReload(true)
        }
        return
      }
      if (remove) {
        setViews((previous) => previous.filter((view) => view.id !== remove.id))
        if (editing?.id === remove.id) { setEditing(null); setName(""); setDraft(currentConfig) }
        setSaved(t("viewsDeleted"))
      } else {
        const view = result.data as AttendanceView
        setViews((previous) => [...previous.filter((item) => item.id !== view.id), view])
        setEditing(view)
        setDraft(view.config)
        setName(view.name)
        setSaved(t("viewsSaved"))
        pendingCreate.current = null
        onApply(view.config, view.name)
      }
      setRemoving(null)
    } catch {
      if (!controller.signal.aborted) { setSaveError(t("viewsSaveUnconfirmed")); setMustReload(true) }
    } finally {
      if (writeRequest.current === controller) writeRequest.current = null
      if (!controller.signal.aborted) setSaving(false)
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void mutate() }
  const disabled = saving || mustReload || loading || Boolean(loadError) || accessUnavailable
  const columns = draft ? [...draft.columns, ...ATTENDANCE_VIEW_COLUMNS[draft.mode].filter((column) => !draft.columns.includes(column))] : []

  return <HomeCard testId="attendance-personal-views" titleId="attendance-personal-views-title" icon={<Columns3 className="h-4 w-4" aria-hidden="true" />} tone="blue" title={t("viewsTitle")}>
    <div className="space-y-5 py-4">
      <p className="max-w-prose text-sm text-muted-foreground">{t("viewsIntro")}</p>
      {loading ? <p role="status" className="text-sm text-muted-foreground">{t("viewsLoading")}</p> : null}
      {loadError ? <div className="space-y-3"><p role="alert" className="text-sm text-destructive">{loadError}</p><Button type="button" variant="outline" className="min-h-11" onClick={() => void load(true)}>{t("viewsReload")}</Button></div> : null}
      {!loading && !loadError && !accessUnavailable ? <>
        {views.length ? <ul className="divide-y divide-zinc-100 dark:divide-zinc-800" aria-label={t("viewsSavedList")}>{views.map((view) => <li key={view.id} className="flex flex-wrap items-center justify-between gap-3 py-3" data-testid="attendance-personal-view">
          <div className="min-w-0"><p className="break-words text-sm font-medium">{view.name}</p><p className="text-xs text-muted-foreground">{t(MODE_MESSAGES[view.config.mode])} · {view.config.filters.from} — {view.config.filters.to}</p></div>
          {removing === view.id ? <div className="space-y-2"><p className="text-sm">{t("viewsDeleteConfirm", { name: view.name })}</p><div className="flex flex-wrap gap-2">
            <Button type="button" variant="destructive" className="min-h-11" disabled={disabled} onClick={() => void mutate(view)}>{t("viewsConfirmDelete")}</Button>
            <Button type="button" variant="outline" className="min-h-11" disabled={saving} onClick={() => setRemoving(null)}>{t("viewsCancel")}</Button></div></div>
            : <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" className="min-h-11" disabled={disabled} onClick={() => choose(view, true)} aria-label={t("viewsOpenNamed", { name: view.name })}>{t("viewsOpen")}</Button>
              <Button type="button" variant="ghost" className="min-h-11" disabled={disabled} onClick={() => choose(view, false)} aria-label={t("viewsEditNamed", { name: view.name })}>{t("viewsRename")}</Button>
              <Button type="button" variant="ghost" className="min-h-11 text-destructive" disabled={disabled} onClick={() => setRemoving(view.id)} aria-label={t("viewsDeleteNamed", { name: view.name })}>{t("viewsDelete")}</Button></div>}
        </li>)}</ul> : <p className="rounded-xl bg-muted/50 px-4 py-3 text-sm text-muted-foreground">{t("viewsEmpty")}</p>}
        {draft ? <form onSubmit={submit} aria-label={t("viewsEditor")} className="space-y-4 border-t border-zinc-200 pt-5 dark:border-zinc-700"><fieldset disabled={disabled} className="space-y-4">
          <legend className="mb-3 text-sm font-semibold">{t(editing ? "viewsEditForm" : "viewsNewForm")}</legend>
          <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><label htmlFor="attendance-view-name" className="text-sm font-medium">{t("viewsName")}</label>
            <Input ref={nameInput} id="attendance-view-name" className="min-h-11" required maxLength={80} value={name} onChange={(event) => { setName(event.target.value); setSaved(null); if (!mustReload) setSaveError(null) }} /></div>
            <div className="space-y-2"><label htmlFor="attendance-view-mode" className="text-sm font-medium">{t("viewsRowType")}</label><select id="attendance-view-mode" className={SELECT_CLASS} value={draft.mode} onChange={(event) => chooseMode(event.target.value as AttendanceViewConfig["mode"])}>
              {(["DAY", "MONTH", "JOURNAL", "BRANCH"] as const).map((mode) => <option key={mode} value={mode}>{t(MODE_MESSAGES[mode])}</option>)}</select></div></div>
          <fieldset className="space-y-2"><legend className="text-sm font-medium">{t("viewsColumns")}</legend><p className="text-xs text-muted-foreground">{t("viewsColumnHint")}</p>
            <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{columns.map((column) => { const index = draft.columns.indexOf(column); return <li key={column} className="flex min-h-12 items-center justify-between gap-2 rounded-lg border border-zinc-200 px-3 dark:border-zinc-700">
              <label className="flex min-h-11 min-w-0 cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={index >= 0} className="h-4 w-4 accent-primary" data-column={column}
                onChange={(event) => change({ columns: event.target.checked ? [...draft.columns, column] : draft.columns.filter((item) => item !== column) })} />{t(COLUMN_MESSAGES[column])}</label>
              {index >= 0 ? <div className="flex shrink-0 items-center"><span className="mr-1 text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11" disabled={disabled || index === 0} onClick={() => move(column, -1)} aria-label={t("viewsMoveUp", { column: t(COLUMN_MESSAGES[column]) })}><ArrowUp className="h-4 w-4" aria-hidden="true" /></Button>
                <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11" disabled={disabled || index === draft.columns.length - 1} onClick={() => move(column, 1)} aria-label={t("viewsMoveDown", { column: t(COLUMN_MESSAGES[column]) })}><ArrowDown className="h-4 w-4" aria-hidden="true" /></Button></div> : null}
            </li> })}</ul>
          </fieldset>
          <label className="inline-flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" id="attendance-view-totals" checked={draft.showTotals} className="h-4 w-4 accent-primary" onChange={(event) => change({ showTotals: event.target.checked })} />{t("viewsShowTotals")}</label>
          <p className="max-w-prose text-xs text-muted-foreground">{t("viewsFiltersHint")} {draft.filters.from} — {draft.filters.to}{draft.mode === "MONTH" ? ` · ${t("viewsMonthHint")}` : ""}</p>
          <div className="flex flex-wrap gap-2"><Button type="submit" className="min-h-11" disabled={disabled}>{t(saving ? "viewsSaving" : editing ? "viewsSaveChanges" : "viewsSave")}</Button>
            <Button type="button" variant="outline" className="min-h-11" disabled={disabled} onClick={preview}>{t("viewsPreview")}</Button>
            {editing ? <Button type="button" variant="ghost" className="min-h-11" disabled={disabled || !currentConfig} onClick={() => { setEditing(null); setName(""); setDraft(currentConfig); setSaved(null); setSaveError(null); pendingCreate.current = null }}>{t("viewsCreateNew")}</Button> : null}</div>
        </fieldset></form> : <p className="text-sm text-muted-foreground">{t("viewsLoadReportFirst")}</p>}
      </> : null}
      {saveError ? <div className="space-y-3"><p role="alert" className="text-sm text-destructive">{saveError}</p>{mustReload ? <Button type="button" variant="outline" className="min-h-11" onClick={() => void load(true)}>{t("viewsReload")}</Button> : null}</div> : null}
      {saved ? <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{saved}</p> : null}
    </div>
  </HomeCard>
}
