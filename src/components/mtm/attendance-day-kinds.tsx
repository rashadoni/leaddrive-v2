"use client"

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Tags } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { HomeCard, HomePill } from "@/components/mtm/home-parts"
import { ATTENDANCE_DAY_GROUPS, AttendanceDayKindsSchema, attendanceDayKindLabel, attendanceDayKindPresetCodes, isSystemAttendanceDayKind, type AttendanceDayKind } from "@/lib/mtm/attendance-day-kinds"

const ENDPOINT = "/api/v1/mtm/attendance/day-kinds"
const SELECT = "min-h-11 w-full rounded-lg border border-zinc-200 bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 dark:border-zinc-700"
const PAGE_SIZE = 8
const GROUP_KEYS = { WORK: "kindsGroupWork", PAID_LEAVE: "kindsGroupPaidLeave", UNPAID_LEAVE: "kindsGroupUnpaidLeave", VIOLATION: "kindsGroupViolation", CALENDAR: "kindsGroupCalendar", EMPLOYER: "kindsGroupEmployer" }
type Props = { canManage: boolean; onAccessLost: () => void; onSaved: () => void; accessUnavailable?: boolean }
type Pending = { type: "preset"; value: "AZ" | "RU" } | { type: "archive"; key: string }

/** Company labels only: saving the catalogue never invents attendance or pay. */
export function MtmAttendanceDayKinds({ canManage, onAccessLost, onSaved, accessUnavailable = false }: Props) {
  const t = useTranslations("mtmAttendance")
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<AttendanceDayKind[]>([])
  const [version, setVersion] = useState<string | null>(null)
  const [serverCanManage, setServerCanManage] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [draft, setDraft] = useState<AttendanceDayKind | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [search, setSearch] = useState("")
  const [group, setGroup] = useState("")
  const [archived, setArchived] = useState(false)
  const [page, setPage] = useState(0)
  const [mustReload, setMustReload] = useState(false)
  const readRequest = useRef<AbortController | null>(null)
  const writeRequest = useRef<AbortController | null>(null)
  const interrupted = useRef(false)
  const callbacks = useRef({ onAccessLost, onSaved })
  callbacks.current = { onAccessLost, onSaved }
  const editable = canManage === true && serverCanManage === true
  const busy = loading || saving || mustReload

  const clearPrivate = useCallback(() => {
    setItems([]); setDraft(null); setPending(null); setSearch(""); setGroup(""); setSaved(false); setServerCanManage(false)
  }, [])
  const load = useCallback(async (acknowledgeInterrupted = false) => {
    readRequest.current?.abort()
    const controller = new AbortController()
    readRequest.current = controller
    setLoading(true); setError(null); setSaveError(null); setDraft(null); setPending(null); setSaved(false); setItems([]); setServerCanManage(false)
    if (interrupted.current) setSaving(false)
    try {
      const response = await fetch(ENDPOINT, { cache: "no-store", signal: controller.signal })
      const body = await response.json().catch(() => null)
      if (controller.signal.aborted) return
      const parsed = AttendanceDayKindsSchema.safeParse(body?.data?.items)
      if (!response.ok || body?.success !== true || !parsed.success || !(body.data.version === null || (typeof body.data.version === "string" && Number.isFinite(Date.parse(body.data.version))))) {
        const denied = [401, 403, 404].includes(response.status)
        setError(t(denied ? "kindsAccessUnavailable" : "kindsLoadError"))
        if (denied) { clearPrivate(); callbacks.current.onAccessLost() }
        return
      }
      setItems(parsed.data); setVersion(body.data.version); setServerCanManage(body.data.canManage === true)
      const unresolved = interrupted.current && !acknowledgeInterrupted
      setMustReload(unresolved)
      if (unresolved) setSaveError(t("kindsUnconfirmed"))
      else interrupted.current = false
    } catch { if (!controller.signal.aborted) setError(t("kindsLoadError")) }
    finally { if (!controller.signal.aborted) setLoading(false) }
  }, [t, clearPrivate])

  useEffect(() => {
    if (open && !accessUnavailable) void load()
    return () => {
      readRequest.current?.abort()
      if (writeRequest.current) { interrupted.current = true; writeRequest.current.abort(); writeRequest.current = null }
    }
  }, [open, accessUnavailable, load])
  useEffect(() => {
    if (!canManage || accessUnavailable) {
      if (writeRequest.current) { interrupted.current = true; writeRequest.current.abort(); writeRequest.current = null; setMustReload(true) }
      setDraft(null); setPending(null); setSaving(false)
    }
    if (accessUnavailable) { clearPrivate(); setOpen(false); setLoading(false) }
  }, [canManage, accessUnavailable, clearPrivate])

  async function save(next: AttendanceDayKind[]) {
    if (!editable || accessUnavailable || busy || writeRequest.current) return
    const parsed = AttendanceDayKindsSchema.safeParse(next)
    if (!parsed.success) { setSaveError(t("kindsInvalid")); return }
    const controller = new AbortController()
    writeRequest.current = controller
    setSaving(true); setSaveError(null); setSaved(false)
    try {
      const response = await fetch(ENDPOINT, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ version, items: parsed.data }), signal: controller.signal })
      const body = await response.json().catch(() => null)
      if (controller.signal.aborted) return
      const result = AttendanceDayKindsSchema.safeParse(body?.data?.items)
      if (!response.ok || body?.success !== true || !result.success || !(body.data.version === null || (typeof body.data.version === "string" && Number.isFinite(Date.parse(body.data.version))))) {
        if ([401, 403, 404].includes(response.status)) { clearPrivate(); setError(t("kindsAccessUnavailable")); callbacks.current.onAccessLost() }
        else if (response.status === 400 && ["MTM_ATTENDANCE_DAY_KINDS_INVALID", "MTM_ATTENDANCE_DAY_KINDS_ARCHIVE_REQUIRED"].includes(body?.code)) setSaveError(t(body.code === "MTM_ATTENDANCE_DAY_KINDS_ARCHIVE_REQUIRED" ? "kindsArchiveRequired" : "kindsInvalid"))
        else { interrupted.current = true; setMustReload(true); setSaveError(t(body?.code === "MTM_ATTENDANCE_DAY_KINDS_CHANGED" ? "kindsChanged" : "kindsUnconfirmed")) }
        return
      }
      setItems(result.data); setVersion(body.data.version); setDraft(null); setPending(null); setSaved(true)
      callbacks.current.onSaved()
    } catch { if (!controller.signal.aborted) { interrupted.current = true; setMustReload(true); setSaveError(t("kindsUnconfirmed")) } }
    finally { if (writeRequest.current === controller) writeRequest.current = null; if (!controller.signal.aborted) setSaving(false) }
  }
  function edit(item: AttendanceDayKind) { setDraft({ ...item, names: { ...item.names } }); setPending(null); setSaveError(null); setSaved(false) }
  function add() {
    if (!editable || busy || items.length >= 64) return
    edit({ key: `CUSTOM_${crypto.randomUUID().replaceAll("-", "").toUpperCase()}`, code: "", names: { az: "", ru: "", en: "" }, color: "#047857", group: "WORK", paid: null, unit: "DAYS", countsAsWorked: false, archived: false })
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft) return
    void save(items.some(item => item.key === draft.key) ? items.map(item => item.key === draft.key ? draft : item) : [...items, draft])
  }
  function confirm() {
    if (!pending) return
    void save(pending.type === "preset" ? attendanceDayKindPresetCodes(items, pending.value)
      : items.map(item => item.key === pending.key && !isSystemAttendanceDayKind(item.key) ? { ...item, archived: !item.archived } : item))
  }
  const matches = items.filter(item => (archived || !item.archived) && (!group || item.group === group)
    && (!search.trim() || `${item.code} ${Object.values(item.names).join(" ")}`.toLocaleLowerCase(locale).includes(search.trim().toLocaleLowerCase(locale))))
  const lastPage = Math.max(0, Math.ceil(matches.length / PAGE_SIZE) - 1)
  const selectedPage = Math.min(page, lastPage)
  const pendingItem = pending?.type === "archive" ? items.find(item => item.key === pending.key) : undefined
  if (accessUnavailable) return null

  return <section data-testid="attendance-day-kinds" className="space-y-4">
    <Button type="button" variant="outline" className="min-h-11" aria-expanded={open} aria-controls="attendance-day-kinds-content" disabled={saving} onClick={() => setOpen(!open)}>{t(open ? "kindsClose" : "kindsOpen")}</Button>
    {open ? <div id="attendance-day-kinds-content"><HomeCard titleId="attendance-day-kinds-title" title={t("kindsTitle")} tone="orange" icon={<Tags className="h-4 w-4" aria-hidden="true" />}>
      <div className="space-y-5 py-4">
        <div className="space-y-2 text-sm text-muted-foreground"><p>{t("kindsIntro")}</p><p>{t("kindsPayHint")}</p></div>
        {loading ? <p role="status" className="text-sm text-muted-foreground">{t("kindsLoading")}</p> : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        {saveError ? <p role="alert" className="text-sm text-destructive">{saveError}</p> : null}
        {saved ? <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{t("kindsSaved")}</p> : null}
        <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" className="min-h-11" disabled={saving || loading} onClick={() => void load(true)}>{t("kindsReload")}</Button>
          {editable ? <><Button type="button" className="min-h-11" disabled={busy || items.length >= 64} onClick={add}>{t("kindsAdd")}</Button>
            {(["AZ", "RU"] as const).map(value => <Button key={value} type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => { setPending({ type: "preset", value }); setDraft(null); setSaveError(null) }}>{t(value === "AZ" ? "kindsPresetAz" : "kindsPresetRu")}</Button>)}</> : items.length ? <HomePill tone="zinc">{t("kindsReadOnly")}</HomePill> : null}</div>
        {pending ? <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30" role="group" aria-label={t("kindsConfirmTitle")}>
          <p className="text-sm font-medium">{pending.type === "preset" ? t("kindsPresetConfirm", { preset: pending.value === "AZ" ? "İ / B / E / X / M" : "Я / В / П / Б / ОТ" }) : t(pendingItem?.archived ? "kindsRestoreConfirm" : "kindsArchiveConfirm", { name: pendingItem ? attendanceDayKindLabel(pendingItem, locale) : "" })}</p>
          <p className="text-xs text-muted-foreground">{pending.type === "preset" ? t("kindsPresetHint") : t("kindsArchiveHint")}</p>
          <div className="flex flex-wrap gap-2"><Button type="button" className="min-h-11" disabled={busy} onClick={confirm}>{t("kindsConfirm")}</Button><Button type="button" variant="outline" className="min-h-11" disabled={saving} onClick={() => setPending(null)}>{t("kindsCancel")}</Button></div>
        </div> : null}
        {draft && editable ? <form onSubmit={submit} data-testid="attendance-kind-editor" className="space-y-4 rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
          <div className="flex flex-wrap items-center gap-3"><h4 className="text-sm font-semibold">{t(items.some(item => item.key === draft.key) ? "kindsEditTitle" : "kindsNewTitle")}</h4>{isSystemAttendanceDayKind(draft.key) ? <HomePill tone="blue">{t("kindsSystem")}</HomePill> : null}</div>
          <div className="grid gap-4 sm:grid-cols-3">{(["az", "ru", "en"] as const).map(language => <div key={language} className="space-y-2"><label htmlFor={`attendance-kind-name-${language}`} className="text-sm font-medium">{t(`kindsName${language.toUpperCase()}`)}</label><Input id={`attendance-kind-name-${language}`} value={draft.names[language]} required maxLength={80} className="min-h-11" disabled={busy} onChange={event => setDraft({ ...draft, names: { ...draft.names, [language]: event.target.value } })} /></div>)}</div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <div className="space-y-2"><label htmlFor="attendance-kind-code" className="text-sm font-medium">{t("kindsCode")}</label><Input id="attendance-kind-code" value={draft.code} required maxLength={6} className="min-h-11" disabled={busy} onChange={event => setDraft({ ...draft, code: event.target.value })} /></div>
            <div className="space-y-2"><label htmlFor="attendance-kind-color" className="text-sm font-medium">{t("kindsColor")}</label><Input type="color" id="attendance-kind-color" value={draft.color} className="min-h-11" disabled={busy} onChange={event => setDraft({ ...draft, color: event.target.value })} /></div>
            <div className="space-y-2"><label htmlFor="attendance-kind-group" className="text-sm font-medium">{t("kindsGroup")}</label><select id="attendance-kind-group" className={SELECT} value={draft.group} disabled={busy} onChange={event => setDraft({ ...draft, group: event.target.value as AttendanceDayKind["group"] })}>{ATTENDANCE_DAY_GROUPS.map(value => <option key={value} value={value}>{t(GROUP_KEYS[value])}</option>)}</select></div>
            <div className="space-y-2"><label htmlFor="attendance-kind-unit" className="text-sm font-medium">{t("kindsUnit")}</label><select id="attendance-kind-unit" className={SELECT} value={draft.unit} disabled={busy} onChange={event => setDraft({ ...draft, unit: event.target.value as AttendanceDayKind["unit"] })}><option value="DAYS">{t("kindsDays")}</option><option value="HOURS">{t("kindsHours")}</option></select></div>
            <div className="space-y-2"><label htmlFor="attendance-kind-paid" className="text-sm font-medium">{t("kindsPay")}</label><select id="attendance-kind-paid" className={SELECT} value={draft.paid === null ? "unspecified" : String(draft.paid)} disabled={busy} onChange={event => setDraft({ ...draft, paid: event.target.value === "unspecified" ? null : event.target.value === "true" })}><option value="unspecified">{t("kindsPayUnspecified")}</option><option value="true">{t("kindsPayYes")}</option><option value="false">{t("kindsPayNo")}</option></select></div>
          </div>
          <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={draft.countsAsWorked} disabled={busy} onChange={event => setDraft({ ...draft, countsAsWorked: event.target.checked })} className="h-4 w-4 accent-primary" />{t("kindsCountsAsWorked")}</label>
          <p className="text-xs text-muted-foreground">{t("kindsFactsHint")}</p>
          <div className="flex flex-wrap gap-2"><Button type="submit" className="min-h-11" disabled={busy}>{t(saving ? "kindsSaving" : "kindsSave")}</Button><Button type="button" variant="outline" className="min-h-11" disabled={saving} onClick={() => { setDraft(null); setSaveError(null) }}>{t("kindsCancel")}</Button></div>
        </form> : null}
        {items.length ? <>
          <div className="grid items-end gap-4 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_auto]">
            <div className="space-y-2"><label htmlFor="attendance-kinds-search" className="text-sm font-medium">{t("kindsSearch")}</label><Input id="attendance-kinds-search" value={search} className="min-h-11" onChange={event => { setSearch(event.target.value); setPage(0) }} /></div>
            <div className="space-y-2"><label htmlFor="attendance-kinds-group" className="text-sm font-medium">{t("kindsGroup")}</label><select id="attendance-kinds-group" className={SELECT} value={group} onChange={event => { setGroup(event.target.value); setPage(0) }}><option value="">{t("kindsAllGroups")}</option>{ATTENDANCE_DAY_GROUPS.map(value => <option key={value} value={value}>{t(GROUP_KEYS[value])}</option>)}</select></div>
            <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={archived} onChange={event => { setArchived(event.target.checked); setPage(0) }} className="h-4 w-4 accent-primary" />{t("kindsShowArchived")}</label>
          </div>
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">{matches.slice(selectedPage * PAGE_SIZE, (selectedPage + 1) * PAGE_SIZE).map(item => <li key={item.key} data-testid="attendance-kind-row" data-kind={item.key} className="grid items-center gap-3 py-4 sm:grid-cols-[1fr_auto] xl:grid-cols-[minmax(0,1fr)_7rem_10rem_auto]">
            <div className="flex min-w-0 items-center gap-3"><span className="inline-flex min-h-9 min-w-12 shrink-0 items-center justify-center rounded-lg border border-zinc-200 px-2 text-sm font-semibold dark:border-zinc-700"><span aria-hidden="true" className="mr-1.5 h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />{item.code}</span><div className="min-w-0"><p className="break-words text-sm font-semibold">{attendanceDayKindLabel(item, locale)}</p><p className="mt-1 text-xs text-muted-foreground">{t(GROUP_KEYS[item.group])}{isSystemAttendanceDayKind(item.key) ? ` · ${t("kindsSystem")}` : ""}{item.archived ? ` · ${t("kindsArchived")}` : ""}</p></div></div>
            <p className="text-xs text-muted-foreground sm:hidden xl:block">{t(item.unit === "DAYS" ? "kindsDays" : "kindsHours")}{item.countsAsWorked ? ` · ${t("kindsWorkedShort")}` : ""}</p>
            <p className="text-xs text-muted-foreground sm:hidden xl:block">{t(item.paid === null ? "kindsPayUnspecified" : item.paid ? "kindsPayYes" : "kindsPayNo")}</p>
            {editable ? <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => edit(item)}>{t("kindsEdit")}</Button>{!isSystemAttendanceDayKind(item.key) ? <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => { setPending({ type: "archive", key: item.key }); setDraft(null); setSaveError(null) }}>{t(item.archived ? "kindsRestore" : "kindsArchive")}</Button> : <span className="inline-flex min-h-11 items-center text-xs text-muted-foreground">{t("kindsRequired")}</span>}</div> : null}
          </li>)}</ul>
          {!matches.length ? <p className="text-sm text-muted-foreground">{t("kindsEmpty")}</p> : null}
          <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">{t("kindsShown", { count: Math.min(PAGE_SIZE, Math.max(0, matches.length - selectedPage * PAGE_SIZE)), total: matches.length })}</p>{lastPage > 0 ? <div className="flex flex-wrap items-center gap-2"><Button type="button" variant="outline" className="min-h-11" disabled={selectedPage === 0} onClick={() => setPage(selectedPage - 1)}>{t("reportPrevious")}</Button><span className="text-xs text-muted-foreground">{t("reportPage", { current: selectedPage + 1, total: lastPage + 1 })}</span><Button type="button" variant="outline" className="min-h-11" disabled={selectedPage === lastPage} onClick={() => setPage(selectedPage + 1)}>{t("reportNext")}</Button></div> : null}</div>
          <p className="text-xs text-muted-foreground">{t("kindsSystemHint")}</p>
        </> : null}
      </div>
    </HomeCard></div> : null}
  </section>
}
