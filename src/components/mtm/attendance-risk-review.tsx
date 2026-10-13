"use client"
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { ClipboardList, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { HomeCard, HomePill } from "@/components/mtm/home-parts"
import { ATTENDANCE_RISK_KINDS, ATTENDANCE_RISK_MESSAGES, ATTENDANCE_RISK_LIMIT, AttendanceRiskQuerySchema, AttendanceRiskSnapshotSchema,
  type AttendanceRiskReport, type AttendanceRiskQuery } from "@/lib/mtm/attendance-risk-contract"
import { buildAttendanceRiskTable } from "@/lib/mtm/attendance-risk-table"
const ENDPOINT = "/api/v1/mtm/attendance/review", PAGE_SIZE = 50
const INITIAL: AttendanceRiskQuery = { from: "", to: "", status: "OPEN", kind: "ALL", teamId: "", employeeId: "" }
type Pending = { caseId: string; requestId: string; reason: string }
export function MtmAttendanceRiskReview() {
  const t = useTranslations("mtmAttendance"), rawLocale = useLocale(), locale = rawLocale === "az" || rawLocale === "ru" ? rawLocale : "en"
  const [draft, setDraft] = useState<AttendanceRiskQuery>(INITIAL), [report, setReport] = useState<AttendanceRiskReport | null>(null)
  const [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null), [denied, setDenied] = useState(false)
  const [page, setPage] = useState(0), [selected, setSelected] = useState<string | null>(null), [reason, setReason] = useState("")
  const [pending, setPending] = useState<Pending | null>(null), [saving, setSaving] = useState(false), [saved, setSaved] = useState(false)
  const [exporting, setExporting] = useState<"pdf" | "xlsx" | null>(null), [stale, setStale] = useState(false)
  const readRequest = useRef<AbortController | null>(null), exportRequest = useRef<AbortController | null>(null), writeRequest = useRef<AbortController | null>(null)
  const pendingRef = useRef<Pending | null>(null), mounted = useRef(true)
  const clearPrivate = useCallback(() => {
    readRequest.current?.abort(); exportRequest.current?.abort(); writeRequest.current?.abort()
    setReport(null); setSelected(null); setReason(""); setPending(null); pendingRef.current = null
    setLoading(false); setSaving(false); setExporting(null); setDenied(true); setError("reportAccessUnavailable")
  }, [])
  const load = useCallback(async (query?: AttendanceRiskQuery) => {
    if (pendingRef.current) return
    readRequest.current?.abort(); exportRequest.current?.abort()
    const controller = new AbortController(); readRequest.current = controller
    setLoading(true); setReport(null); setPage(0); setSelected(null); setReason(""); setError(null); setExporting(null)
    try {
      const response = await fetch(query ? `${ENDPOINT}?${new URLSearchParams(query)}` : ENDPOINT, { cache: "no-store", signal: controller.signal })
      const body = await response.json().catch(() => null)
      if (controller.signal.aborted) return
      if ([401, 403, 404].includes(response.status)) { clearPrivate(); return }
      const data = body?.data
      if (!response.ok || body?.success !== true || !Array.isArray(data?.items) || !Array.isArray(data?.directory) || data.items.length > ATTENDANCE_RISK_LIMIT || !AttendanceRiskSnapshotSchema.safeParse(data?.snapshot).success) {
        setError(body?.code === "MTM_ATTENDANCE_RISK_TOO_LARGE" ? "riskTooLarge" : "riskLoadError"); return
      }
      setReport(data); setDraft(data.snapshot.query); setDenied(false); setStale(false)
    } catch { if (!controller.signal.aborted) setError("riskLoadError") }
    finally { if (!controller.signal.aborted) { setLoading(false); readRequest.current = null } }
  }, [clearPrivate])
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; readRequest.current?.abort(); exportRequest.current?.abort(); writeRequest.current?.abort() } }, [load])
  useEffect(() => { exportRequest.current?.abort(); exportRequest.current = null; setExporting(null) }, [locale])
  const table = useMemo(() => report ? buildAttendanceRiskTable(report, locale, t) : null, [report, locale, t])
  const dirty = !report || JSON.stringify(draft) !== JSON.stringify(report.snapshot.query)
  const locked = loading || saving || Boolean(pending), selectedItem = report?.items.find(item => item.id === selected)
  const teams = [...new Map((report?.directory ?? []).flatMap(employee => employee.teamId ? [[employee.teamId, employee.teamName ?? "—"] as const] : [])).entries()]
  function change(next: AttendanceRiskQuery) { exportRequest.current?.abort(); setExporting(null); setDraft(next); setSaved(false) }
  function apply(event: FormEvent) { event.preventDefault(); if (locked) return; const parsed = AttendanceRiskQuerySchema.safeParse(draft); if (!parsed.success) { setError("journalInvalidPeriod"); return }; void load(parsed.data) }
  async function dismiss(event?: FormEvent) {
    event?.preventDefault()
    if (saving || (!pending && (!selectedItem?.canDismiss || reason.trim().length < 3))) return
    const payload = pendingRef.current ?? { caseId: selectedItem!.id, requestId: crypto.randomUUID(), reason: reason.trim() }
    pendingRef.current = payload; setPending(payload); setSaving(true); setError(null); setSaved(false)
    const controller = new AbortController(); writeRequest.current = controller
    try {
      const response = await fetch(`${ENDPOINT}/${payload.caseId}`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: payload.requestId, reason: payload.reason }), signal: controller.signal })
      const body = await response.json().catch(() => null)
      if (!mounted.current || controller.signal.aborted) return
      if ([401, 403, 404].includes(response.status)) { clearPrivate(); return }
      if (response.ok && body?.success === true) {
        pendingRef.current = null; setPending(null); setSaved(true); setReason(""); setSelected(null); await load(report!.snapshot.query)
      } else if (response.status === 400 || response.status === 409 || response.status === 413) {
        pendingRef.current = null; setPending(null); setStale(true); setError("riskChanged")
      } else setError("riskUnknown")
    } catch { if (mounted.current && !controller.signal.aborted) setError("riskUnknown") }
    finally { if (mounted.current && !controller.signal.aborted) { setSaving(false); writeRequest.current = null } }
  }
  async function download(format: "xlsx" | "pdf") {
    if (!report || dirty || stale || locked || exporting) return
    const controller = new AbortController(); exportRequest.current = controller; setExporting(format); setError(null)
    let url: string | null = null, anchor: HTMLAnchorElement | null = null
    try {
      const response = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ snapshot: report.snapshot, format, locale }), signal: controller.signal })
      if (controller.signal.aborted) return
      if ([401, 403, 404].includes(response.status)) { clearPrivate(); return }
      if (!response.ok) { setError(response.status === 409 ? "riskChanged" : "exportFailed"); if (response.status === 409) setStale(true); return }
      const mime = format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      if (!response.headers.get("content-type")?.includes(mime)) { setError("exportFailed"); return }
      const blob = await response.blob(); if (controller.signal.aborted) return
      if (!blob.size) { setError("exportFailed"); return }
      url = URL.createObjectURL(blob); anchor = document.createElement("a"); anchor.href = url; anchor.download = `attendance-review-${report.snapshot.query.from}.${format}`; anchor.hidden = true; document.body.append(anchor); anchor.click()
    } catch { if (!controller.signal.aborted) setError("exportFailed") }
    finally { anchor?.remove(); if (url) URL.revokeObjectURL(url); if (exportRequest.current === controller) exportRequest.current = null; if (!controller.signal.aborted) setExporting(null) }
  }
  return <section className="space-y-5" data-testid="attendance-risk-review" aria-label={t("riskTitle")} aria-busy={loading}>
    <Link href="/mtm/attendance" className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline">{t("requestsBack")}</Link>
    <HomeCard title={t("riskTitle")} tone="amber" icon={<ClipboardList className="h-5 w-5" aria-hidden="true" />}><div className="space-y-4 py-4">
      <p className="text-sm text-muted-foreground">{t("riskDescription")}</p>
      {!denied && <form onSubmit={apply} className="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label={t("journalFilters")}>
        {(["from", "to"] as const).map(key => <div key={key} className="space-y-2"><label htmlFor={`risk-${key}`} className="text-sm font-medium">{t(key === "from" ? "reportFrom" : "reportTo")}</label><Input id={`risk-${key}`} type="date" required className="min-h-11" disabled={locked} value={draft[key]} onChange={e => change({ ...draft, [key]: e.target.value })} /></div>)}
        <div className="space-y-2"><label htmlFor="risk-team" className="text-sm font-medium">{t("riskSelectTeam")}</label><select id="risk-team" className="min-h-11 w-full rounded-lg border bg-background px-3 text-sm" disabled={locked} value={draft.teamId} onChange={e => change({ ...draft, teamId: e.target.value, employeeId: "" })}><option value="">{t("riskAll")}</option>{teams.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></div>
        <div className="space-y-2"><label htmlFor="risk-employee" className="text-sm font-medium">{t("riskSelectEmployee")}</label><select id="risk-employee" className="min-h-11 w-full rounded-lg border bg-background px-3 text-sm" disabled={locked} value={draft.employeeId} onChange={e => change({ ...draft, employeeId: e.target.value })}><option value="">{t("riskAll")}</option>{report?.directory.filter(e => !draft.teamId || e.teamId === draft.teamId).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></div>
        <div className="space-y-2"><label htmlFor="risk-status" className="text-sm font-medium">{t("journalStatus")}</label><select id="risk-status" className="min-h-11 w-full rounded-lg border bg-background px-3 text-sm" disabled={locked} value={draft.status} onChange={e => change({ ...draft, status: e.target.value as AttendanceRiskQuery["status"] })}>{(["ALL", "OPEN", "DISMISSED"] as const).map(status => <option key={status} value={status}>{t(status === "ALL" ? "riskAll" : status === "OPEN" ? "riskOpen" : "riskDismissed")}</option>)}</select></div>
        <div className="space-y-2 sm:col-span-2"><label htmlFor="risk-kind" className="text-sm font-medium">{t("riskFinding")}</label><select id="risk-kind" className="min-h-11 w-full rounded-lg border bg-background px-3 text-sm" disabled={locked} value={draft.kind} onChange={e => change({ ...draft, kind: e.target.value as AttendanceRiskQuery["kind"] })}><option value="ALL">{t("riskAllKinds")}</option>{ATTENDANCE_RISK_KINDS.map(kind => <option key={kind} value={kind}>{t(ATTENDANCE_RISK_MESSAGES[kind])}</option>)}</select></div>
        <Button type="submit" className="min-h-11" disabled={locked}>{t("journalApply")}</Button>
      </form>}
      {loading && <p role="status">{t("journalLoading")}</p>}
      {error && <div className="space-y-2"><p role="alert" className="text-sm text-destructive">{t(error)}</p>{pending ? <Button type="button" className="min-h-11" disabled={saving} onClick={() => void dismiss()}>{t("riskRetry")}</Button> : !denied && <Button type="button" variant="outline" className="min-h-11" disabled={loading} onClick={() => void load(report?.snapshot.query)}>{t("reportReload")}</Button>}</div>}
      {saved && <p role="status" className="text-sm">{t("riskSaved")}</p>}
      {report && table && <><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm font-semibold">{table.totals[0]}</p><div className="flex flex-wrap gap-2">{(["xlsx", "pdf"] as const).map(format => <Button key={format} type="button" variant="outline" className="min-h-11" disabled={dirty || stale || locked || Boolean(exporting)} onClick={() => void download(format)}><Download className="mr-2 h-4 w-4" aria-hidden="true" />{t(exporting === format ? "exportPreparing" : format === "xlsx" ? "exportExcel" : "exportPdf")}</Button>)}</div></div>
        <p className="text-xs text-muted-foreground">{t("riskEvidenceHint")}</p>{dirty && <p role="status" className="text-sm text-amber-700">{t("journalDraftHint")}</p>}
        {!table.rows.length ? <p className="py-5 text-sm">{t("riskEmpty")}</p> : <><div className="overflow-x-auto"><table className="block w-full text-sm lg:table"><caption className="sr-only">{t("riskTitle")}</caption><thead className="hidden lg:table-header-group"><tr>{table.columns.map(c => <th key={c.key} className="border-b px-3 py-3 text-left text-xs font-semibold text-muted-foreground" scope="col">{c.label}</th>)}<th scope="col" className="sr-only">{t("riskReview")}</th></tr></thead><tbody className="block lg:table-row-group">{table.rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(row => <tr key={row.key} data-testid="risk-row" className="block border-b py-4 lg:table-row lg:py-0">{row.cells.map((cell, i) => <td key={i} className="grid grid-cols-[6rem_1fr] gap-3 px-1 py-2 align-top lg:table-cell lg:px-3 lg:py-4"><span className="text-xs text-muted-foreground lg:hidden">{table.columns[i].label}</span><span className="min-w-0 whitespace-pre-line break-words">{cell}</span></td>)}<td className="block px-1 py-2 lg:table-cell lg:px-3 lg:py-4"><Button type="button" variant="outline" className="min-h-11" disabled={locked || stale} onClick={() => { setSelected(row.key); setReason(""); setSaved(false) }}>{t("riskReview")}</Button></td></tr>)}</tbody></table></div>
          <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs">{t("journalPage", { page: page + 1, pages: Math.max(1, Math.ceil(table.rows.length / PAGE_SIZE)), count: table.rows.length })}</p><div className="flex gap-2"><Button type="button" variant="outline" className="min-h-11" disabled={locked || page === 0} onClick={() => setPage(p => p - 1)}>{t("journalPrevious")}</Button><Button type="button" variant="outline" className="min-h-11" disabled={locked || (page + 1) * PAGE_SIZE >= table.rows.length} onClick={() => setPage(p => p + 1)}>{t("journalNext")}</Button></div></div></>}
      </>}
    </div></HomeCard>
    {selectedItem && <HomeCard title={`${t("riskReview")}: ${selectedItem.employeeName}`} tone="amber"><div className="space-y-4 py-4" data-testid="risk-decision"><HomePill tone={selectedItem.dismissal ? "zinc" : "amber"}>{t(selectedItem.dismissal ? "riskDismissed" : "riskOpen")}</HomePill><p className="whitespace-pre-line text-sm">{table?.rows.find(row => row.key === selectedItem.id)?.cells[3]}</p>{selectedItem.dismissal ? <p className="whitespace-pre-line text-sm">{table?.rows.find(row => row.key === selectedItem.id)?.cells[5]}</p> : selectedItem.canDismiss ? <form className="space-y-3" onSubmit={dismiss}><label htmlFor="risk-reason" className="block text-sm font-medium">{t("riskReason")}</label><textarea id="risk-reason" className="min-h-28 w-full rounded-lg border bg-background p-3 text-sm" required minLength={3} maxLength={1000} value={reason} disabled={saving || Boolean(pending) || stale} onChange={e => setReason(e.target.value)} /><p className="text-sm text-muted-foreground">{t("riskReasonHint")}</p><Button type="submit" className="min-h-11" disabled={saving || Boolean(pending) || stale || reason.trim().length < 3}>{t("riskDismiss")}</Button></form> : <p className="text-sm text-muted-foreground">{t("riskReadOnly")}</p>}</div></HomeCard>}
  </section>
}
