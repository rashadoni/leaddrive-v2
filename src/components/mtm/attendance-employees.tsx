"use client"

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { History, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { HomeCard, HomePill } from "@/components/mtm/home-parts"
import { createDateFormatter } from "@/lib/format-date"
import { mtmStatusLabel } from "@/lib/mtm/status-labels"
import { AttendanceParticipationInputSchema, AttendanceEmploymentInputSchema, type AttendanceEmployeeDirectory } from "@/lib/mtm/attendance-employee-contract"

const ENDPOINT = "/api/v1/mtm/attendance/employees"
const SELECT = "min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm"
const PAGE_SIZE = 25
const HISTORY_SIZE = 20
type Change = { kind: "HIRE" | "TERMINATION" | "REHIRE"; date: string; reason: string }
type Pending = { url: string; body: ReturnType<typeof AttendanceParticipationInputSchema.parse> | ReturnType<typeof AttendanceEmploymentInputSchema.parse> }
const emptyChange = (): Change => ({ kind: "HIRE", date: "", reason: "" })

export function MtmAttendanceEmployees() {
  const t = useTranslations("mtmAttendance"), statusText = useTranslations("mtmStatus"), locale = useLocale()
  const [directory, setDirectory] = useState<AttendanceEmployeeDirectory | null>(null)
  const [change, setChange] = useState(emptyChange)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [participation, setParticipation] = useState<"ALL" | "INCLUDED" | "EXCLUDED">("ALL")
  const [page, setPage] = useState(0), [historyPage, setHistoryPage] = useState(0)
  const [loading, setLoading] = useState(false), [saving, setSaving] = useState(false)
  const [denied, setDenied] = useState(false), [needsRefresh, setNeedsRefresh] = useState(false)
  const [error, setError] = useState<string | null>(null), [saved, setSaved] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const pendingRef = useRef<Pending | null>(null)
  const read = useRef<AbortController | null>(null), write = useRef<AbortController | null>(null)
  const clearPrivate = useCallback(() => {
    setDirectory(null); setChange(emptyChange()); setSelectedId(null)
    setSearch(""); setParticipation("ALL"); setSaved(false); setPending(null); pendingRef.current = null; setNeedsRefresh(false)
  }, [])
  const load = useCallback(async () => {
    if (pendingRef.current) return
    read.current?.abort()
    const controller = new AbortController(); read.current = controller
    setLoading(true); setDirectory(null); setError(null); setSaved(false)
    try {
      const response = await fetch(ENDPOINT, { cache: "no-store", signal: controller.signal })
      const body = await response.json().catch(() => null)
      if (controller.signal.aborted) return
      if ([401, 403, 404].includes(response.status)) { clearPrivate(); setDenied(true); setError("employeesAccessUnavailable"); return }
      if (!response.ok || body?.success !== true || !Array.isArray(body.data?.users) || !Array.isArray(body.data?.teams) || !Array.isArray(body.data?.employees)
        || !body.data.employees.every((employee: { history?: unknown; included?: unknown; participationVersion?: unknown }) => Array.isArray(employee?.history) && typeof employee.included === "boolean" && (employee.participationVersion === null || typeof employee.participationVersion === "string"))) { setError("employeesLoadError"); return }
      setDirectory(body.data as AttendanceEmployeeDirectory); setChange(emptyChange()); setSelectedId(null)
      setHistoryPage(0); setNeedsRefresh(false)
      return true
    } catch { if (!controller.signal.aborted) setError("employeesLoadError") }
    finally { if (!controller.signal.aborted) setLoading(false) }
  }, [clearPrivate])
  // Locale changes translate the existing state without aborting or duplicating a write.
  useEffect(() => { void load(); return () => { read.current?.abort(); write.current?.abort(); pendingRef.current = null } }, [load])

  async function publish(operation: Pending) {
    if (write.current || loading || denied) return
    const controller = new AbortController(); write.current = controller
    pendingRef.current = operation; setPending(operation); setSaving(true); setSaved(false); setError(null)
    try {
      const response = await fetch(operation.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(operation.body), signal: controller.signal })
      const body = await response.json().catch(() => null)
      if (controller.signal.aborted) return
      if ([401, 403, 404].includes(response.status)) { clearPrivate(); setDenied(true); setError("employeesAccessUnavailable"); return }
      const resultId = body?.data?.eventId
      if (response.ok && body?.success === true && typeof resultId === "string" && typeof body.data.idempotent === "boolean") {
        pendingRef.current = null; setPending(null); if (await load()) setSaved(true); return
      }
      if ([400, 409, 413, 422].includes(response.status)) {
        pendingRef.current = null; setPending(null)
        if (response.status === 400 || response.status === 413) setError(body?.code === "MTM_ATTENDANCE_EMPLOYEE_DATE_INVALID" ? "employeesDateInvalid" : "employeesInvalid")
        else { setNeedsRefresh(true); setError(body?.code === "MTM_ATTENDANCE_EMPLOYEE_TOO_LARGE" ? "employeesTooLarge" : "employeesChanged") }
      } else setError("employeesUnconfirmed")
    } catch { if (!controller.signal.aborted) setError("employeesUnconfirmed") }
    finally { if (write.current === controller) write.current = null; if (!controller.signal.aborted) setSaving(false) }
  }
  const blocked = loading || saving || Boolean(pending) || needsRefresh || denied || !directory
  const selected = directory?.employees.find(employee => employee.id === selectedId)
  const previous = selected?.history.at(-1)
  const employees = directory?.employees.filter(employee => employee.name.toLocaleLowerCase(locale).includes(search.trim().toLocaleLowerCase(locale))
    && (participation === "ALL" || employee.included === (participation === "INCLUDED"))) ?? []
  const currentPage = Math.min(page, Math.max(0, Math.ceil(employees.length / PAGE_SIZE) - 1))
  const includedCount = directory?.employees.filter(employee => employee.included).length ?? 0
  const history = selected ? [...selected.history].reverse() : []
  const dateLabel = (date: string) => createDateFormatter(locale, { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" }).format(new Date(`${date}T00:00:00Z`))
  const kindLabel = (kind: Change["kind"]) => t(`employees${kind === "HIRE" ? "Hire" : kind === "TERMINATION" ? "Termination" : "Rehire"}`)
  function changeParticipation(employee: AttendanceEmployeeDirectory["employees"][number]) {
    if (blocked) return
    const parsed = AttendanceParticipationInputSchema.safeParse({ clientRequestId: crypto.randomUUID(), agentId: employee.id,
      included: !employee.included, previousEventId: employee.participationVersion })
    if (!parsed.success) { setError("employeesChanged"); return }
    void publish({ url: `${ENDPOINT}/participation`, body: parsed.data })
  }
  function submitChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (blocked || !selected) return
    const parsed = AttendanceEmploymentInputSchema.safeParse({ ...change, agentId: selected.id, previousEventId: previous?.id ?? null, clientRequestId: crypto.randomUUID() })
    if (!parsed.success) { setError("employeesInvalid"); return }
    void publish({ url: `${ENDPOINT}/history`, body: parsed.data })
  }
  function selectEmployee(id: string) {
    const employee = directory?.employees.find(item => item.id === id)
    setSelectedId(id); setHistoryPage(0); setSaved(false); setError(null)
    setChange({ kind: !employee?.history.length ? "HIRE" : employee.history.at(-1)?.kind === "TERMINATION" ? "REHIRE" : "TERMINATION", date: "", reason: "" })
  }
  return <div className="space-y-5" data-testid="attendance-employees">
    <Link href="/mtm/attendance" className="inline-flex min-h-11 items-center text-sm text-primary hover:underline">{t("employeesBack")}</Link>
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-bold tracking-tight">{t("employeesTitle")}</h1><p className="mt-2 max-w-prose text-sm text-muted-foreground">{t("employeesIntro")}</p></div>{!denied && <Button variant="outline" className="min-h-11" disabled={loading || saving || Boolean(pending)} onClick={() => void load()}>{t("employeesRefresh")}</Button>}</div>
    {loading && <p role="status" className="text-sm text-muted-foreground">{t("employeesLoading")}</p>}
    {error && <p role="alert" className="max-w-prose text-sm text-destructive">{t(error)}</p>}
    {saved && <p role="status" className="text-sm text-emerald-700">{t("employeesSaved")}</p>}
    {pending && !saving && <Button className="min-h-11" onClick={() => void publish(pending)}>{t("employeesCheckWrite")}</Button>}
    {directory && !denied && <>
      <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{t("employeesAutomaticHint")}</p>
      <HomeCard testId="employees-roster" titleId="attendance-employees-roster-title" title={t("employeesRoster")} icon={<Users className="h-4 w-4" aria-hidden="true" />} tone="orange"><div className="space-y-4 py-4">
        <div className="grid items-end gap-4 md:grid-cols-[1fr_16rem]">
          <div className="space-y-2"><label htmlFor="employee-search" className="text-sm font-medium">{t("employeesSearch")}</label><Input id="employee-search" className="min-h-11" type="search" value={search} disabled={blocked} onChange={event => { setSearch(event.target.value); setPage(0) }} /></div>
          <div className="space-y-2"><label htmlFor="employee-participation" className="text-sm font-medium">{t("employeesParticipationFilter")}</label><select id="employee-participation" className={SELECT} disabled={blocked} value={participation} onChange={event => { setParticipation(event.target.value as typeof participation); setPage(0) }}>
            <option value="ALL">{t("employeesFilterAll")}</option><option value="INCLUDED">{t("employeesFilterIncluded")}</option><option value="EXCLUDED">{t("employeesFilterExcluded")}</option>
          </select></div>
        </div>
        <p className="text-sm text-muted-foreground" role="status">{t("employeesParticipationCounts", { total: directory.employees.length, included: includedCount, excluded: directory.employees.length - includedCount })}</p>
        {employees.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="hidden md:table-header-group"><tr className="border-b text-xs text-muted-foreground">{["employeesEmployee", "employeesRole", "employeesParticipation", "employeesLatest", "employeesActions"].map(key => <th key={key} className="px-3 py-3 font-medium">{t(key)}</th>)}</tr></thead><tbody className="block md:table-row-group">{employees.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map(employee => { const latest = employee.history.at(-1); return <tr key={employee.id} className="block border-b py-3 last:border-0 md:table-row" data-testid="employee-row"><td className="block px-3 py-2 md:table-cell"><strong className="break-words">{employee.name}</strong><span className="mt-1 block break-words text-xs text-muted-foreground">{employee.teamName ?? t("employeesNoTeam")}</span></td><td className="block px-3 py-2 md:table-cell">{mtmStatusLabel(statusText, "role", employee.role)}</td><td className="block px-3 py-2 md:table-cell"><Button type="button" variant="ghost" role="switch" aria-checked={employee.included} aria-label={t("employeesParticipationNamed", { name: employee.name })} disabled={blocked} className="min-h-11 gap-2 px-0 hover:bg-transparent" onClick={() => changeParticipation(employee)}>
            <span aria-hidden="true" className={`flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 ${employee.included ? "justify-end bg-primary" : "justify-start bg-zinc-400 dark:bg-zinc-600"}`}><span className="h-5 w-5 rounded-full bg-white" /></span>{t(employee.included ? "employeesIncluded" : "employeesExcluded")}
          </Button>{employee.status !== "ACTIVE" && <span className="block"><HomePill tone="zinc">{mtmStatusLabel(statusText, "agentStatus", employee.status)}</HomePill></span>}</td><td className="block px-3 py-2 md:table-cell">{latest ? <>{kindLabel(latest.kind)} · {dateLabel(latest.date)}</> : t("employeesNoHistory")}</td><td className="block px-3 py-2 md:table-cell"><Button variant="outline" className="min-h-11" disabled={blocked} aria-label={t("employeesHistoryNamed", { name: employee.name })} onClick={() => selectEmployee(employee.id)}>{t("employeesOpenHistory")}</Button></td></tr> })}</tbody></table></div> : <p className="text-sm text-muted-foreground">{t("employeesEmpty")}</p>}
        {employees.length > PAGE_SIZE && <div className="flex flex-wrap items-center gap-3"><Button variant="outline" className="min-h-11" disabled={blocked || currentPage === 0} onClick={() => setPage(currentPage - 1)}>{t("employeesPrevious")}</Button><span className="text-xs text-muted-foreground">{t("employeesPage", { page: currentPage + 1, pages: Math.ceil(employees.length / PAGE_SIZE), count: employees.length })}</span><Button variant="outline" className="min-h-11" disabled={blocked || (currentPage + 1) * PAGE_SIZE >= employees.length} onClick={() => setPage(currentPage + 1)}>{t("employeesNext")}</Button></div>}
      </div></HomeCard>
      <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{t("employeesAutomaticFooter")}</p>
      {selected && <HomeCard testId="employees-history" titleId="attendance-employees-history-title" title={t("employeesHistoryNamed", { name: selected.name })} icon={<History className="h-4 w-4" aria-hidden="true" />} tone="orange"><div className="space-y-5 py-4">
        {history.length ? <ol className="divide-y" aria-label={t("employeesHistoryList")}>{history.slice(historyPage * HISTORY_SIZE, (historyPage + 1) * HISTORY_SIZE).map(event => <li key={event.id} className="py-3 text-sm" data-testid="employment-event"><strong>{kindLabel(event.kind)} · {dateLabel(event.date)}</strong><p className="mt-1 text-xs text-muted-foreground">{t("employeesAuthor", { name: event.byName ?? t("employeesAuthorUnknown") })}</p></li>)}</ol> : <p className="text-sm text-muted-foreground">{t("employeesNoHistory")}</p>}
        {history.length > HISTORY_SIZE && <div className="flex flex-wrap items-center gap-3"><Button variant="outline" className="min-h-11" disabled={historyPage === 0} onClick={() => setHistoryPage(value => value - 1)}>{t("employeesPrevious")}</Button><span className="text-xs text-muted-foreground">{t("employeesPage", { page: historyPage + 1, pages: Math.ceil(history.length / HISTORY_SIZE), count: history.length })}</span><Button variant="outline" className="min-h-11" disabled={(historyPage + 1) * HISTORY_SIZE >= history.length} onClick={() => setHistoryPage(value => value + 1)}>{t("employeesNext")}</Button></div>}
        <form aria-label={t("employeesRecordChange")} className="space-y-4 border-t pt-5" onSubmit={submitChange}><div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <div className="space-y-2"><label htmlFor="employment-kind" className="text-sm font-medium">{t("employeesChange")}</label><select id="employment-kind" className={SELECT} value={change.kind} disabled={blocked} onChange={event => setChange(current => ({ ...current, kind: event.target.value as Change["kind"] }))}>{(!previous ? ["HIRE"] : previous.kind === "TERMINATION" ? ["REHIRE"] : ["TERMINATION"]).map(kind => <option value={kind} key={kind}>{kindLabel(kind as Change["kind"])}</option>)}</select></div>
          <div className="space-y-2"><label htmlFor="employment-date" className="text-sm font-medium">{t(change.kind === "TERMINATION" ? "employeesLastWorkingDate" : "employeesHireDate")}</label><Input id="employment-date" type="date" className="min-h-11" value={change.date} disabled={blocked} onChange={event => setChange(current => ({ ...current, date: event.target.value }))} /></div>
          <div className="space-y-2 sm:col-span-2"><label htmlFor="employment-reason" className="text-sm font-medium">{t("employeesReason")}</label><Input id="employment-reason" maxLength={1000} className="min-h-11" value={change.reason} disabled={blocked} onChange={event => setChange(current => ({ ...current, reason: event.target.value }))} /></div>
        </div><p className="max-w-prose text-xs text-muted-foreground">{t("employeesHistoryHint")}</p><div className="flex flex-wrap gap-3"><Button type="submit" className="min-h-11" disabled={blocked}>{t(saving ? "employeesSaving" : "employeesSaveChange")}</Button><Button type="button" variant="outline" className="min-h-11" disabled={saving || Boolean(pending)} onClick={() => { setSelectedId(null); setChange(emptyChange()) }}>{t("employeesClose")}</Button></div></form>
      </div></HomeCard>}
    </>}
  </div>
}
