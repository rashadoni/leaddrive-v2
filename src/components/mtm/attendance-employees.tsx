"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { Pencil, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { HomePill, type HomeTone } from "@/components/mtm/home-parts"
import { createDateFormatter, formatTime } from "@/lib/format-date"
import { MtmAttendanceAddEmployee } from "@/components/mtm/attendance-add-employee"
import type { AttendanceEmployeeDirectory } from "@/lib/mtm/attendance-employee-contract"

const ENDPOINT = "/api/v1/mtm/attendance/employees"
const SELECT = "min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm"
const PAGE_SIZE = 50
type Employee = AttendanceEmployeeDirectory["employees"][number]
type Participation = "ALL" | "INCLUDED" | "EXCLUDED"
const NO_DEPARTMENT = "none"

/**
 * Personnel → Employees (owner, 2026-10-16: «просил редактируемыми сделать
 * сотрудников… будет неудобно использовать, когда список будет больше 200»).
 * The list finds a person — by name, position, department or phone — and says
 * where they are today; «Edit» opens their own page. Search, filters and page
 * live in the address, so «back» from the employee returns to the same list.
 */
export function MtmAttendanceEmployees() {
  const t = useTranslations("mtmAttendance"), p = useTranslations("personnel"), locale = useLocale()
  const router = useRouter(), pathname = usePathname(), params = useSearchParams()
  const [added, setAdded] = useState<{ name: string; phone: string } | null>(null)
  const [directory, setDirectory] = useState<AttendanceEmployeeDirectory | null>(null)
  const [search, setSearch] = useState(() => params.get("q") ?? "")
  const [department, setDepartment] = useState(() => params.get("team") ?? "")
  const [participation, setParticipation] = useState<Participation>(() => (["INCLUDED", "EXCLUDED"].includes(params.get("show") ?? "") ? params.get("show") : "ALL") as Participation)
  const [page, setPage] = useState(() => Math.max(0, Number(params.get("page") ?? 1) - 1) || 0)
  const [loading, setLoading] = useState(false), [denied, setDenied] = useState(false), [error, setError] = useState<string | null>(null)
  const read = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    read.current?.abort()
    const controller = new AbortController(); read.current = controller
    setLoading(true); setError(null)
    try {
      const response = await fetch(ENDPOINT, { cache: "no-store", signal: controller.signal })
      const body = await response.json().catch(() => null)
      if (controller.signal.aborted) return
      if ([401, 403, 404].includes(response.status)) { setDirectory(null); setDenied(true); setError("employeesAccessUnavailable"); return }
      if (!response.ok || body?.success !== true || !Array.isArray(body.data?.teams) || !Array.isArray(body.data?.employees)) { setError("employeesLoadError"); return }
      setDirectory(body.data as AttendanceEmployeeDirectory)
    } catch { if (!controller.signal.aborted) setError("employeesLoadError") }
    finally { if (!controller.signal.aborted) setLoading(false) }
  }, [])
  useEffect(() => { void load(); return () => read.current?.abort() }, [load])

  // The list's state is the address: «back» from an employee lands on the same view.
  const query = useMemo(() => {
    const next = new URLSearchParams({ tab: "employees" })
    if (search.trim()) next.set("q", search.trim())
    if (department) next.set("team", department)
    if (participation !== "ALL") next.set("show", participation)
    if (page) next.set("page", String(page + 1))
    return next.toString()
  }, [search, department, participation, page])
  useEffect(() => { if (`?${query}` !== `?${params.toString()}`) router.replace(`${pathname}?${query}`, { scroll: false }) }, [query, params, pathname, router])

  const needle = search.trim().toLocaleLowerCase(locale), digits = search.replace(/\D/g, "")
  const matches = (employee: Employee) => !needle || [employee.name, employee.position, employee.teamName].some(value => value?.toLocaleLowerCase(locale).includes(needle))
    || (digits.length >= 3 && (employee.phone ?? "").replace(/\D/g, "").includes(digits))
  const employees = (directory?.employees ?? []).filter(employee => matches(employee)
    && (!department || (department === NO_DEPARTMENT ? !employee.teamId : employee.teamId === department))
    && (participation === "ALL" || employee.included === (participation === "INCLUDED")))
  const pages = Math.max(1, Math.ceil(employees.length / PAGE_SIZE)), currentPage = Math.min(page, pages - 1)
  const includedCount = directory?.employees.filter(employee => employee.included).length ?? 0
  const date = (value: string) => createDateFormatter(locale, { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${value}T00:00:00Z`))
  const time = (value: string | null) => value && directory ? formatTime(value, locale, { hour: "2-digit", minute: "2-digit", timeZone: directory.timezone }) : ""
  function today(employee: Employee): [string, HomeTone] {
    const mark = employee.todayMark
    if (!employee.included) return [p("todayExcluded"), "zinc"]
    if (!mark) return [p("todayNone"), "zinc"]
    if (mark.status === "PAUSED") return [p("todayPaused"), "amber"]
    if (mark.status === "COMPLETED") return [p("todayLeft", { time: time(mark.completedAt) }), "blue"]
    return [p("todayAt", { time: time(mark.startedAt) }), "green"]
  }
  function detailLine(employee: Employee) {
    const hire = [...employee.history].reverse().find(event => event.kind !== "TERMINATION")
    const missing = [!employee.position && p("employeeMissingPosition"), !hire && p("employeeMissingHire")].filter(Boolean) as string[]
    if (missing.length) return <span className="text-amber-700 dark:text-amber-400" data-testid="employee-missing">{p("employeeMissing", { fields: missing.join(", ") })}</span>
    return [employee.position, hire && p("employeeSince", { date: date(hire.date) })].filter(Boolean).join(" · ")
  }
  const reset = () => setPage(0)
  const back = encodeURIComponent(`/mtm/attendance/people?${query}`)

  return <div className="space-y-5" data-testid="attendance-employees">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight">{t("employeesTitle")}</h1><p className="mt-2 max-w-prose text-sm text-muted-foreground">{t("employeesIntro")}</p></div>{!denied && <div className="flex flex-wrap items-start gap-2">
      <MtmAttendanceAddEmployee disabled={loading || !directory} teams={directory?.teams ?? []} onAdded={(name, phone) => { void load().then(() => setAdded({ name, phone })) }} />
      <Button variant="outline" className="min-h-11 rounded-full" disabled={loading} onClick={() => void load()}>{t("employeesRefresh")}</Button></div>}</div>
    {added && <p role="status" className="max-w-prose rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100" data-testid="attendance-employee-added">{p("addEmployeeDone", added)}</p>}
    {loading && !directory && <p role="status" className="text-sm text-muted-foreground">{t("employeesLoading")}</p>}
    {error && <p role="alert" className="max-w-prose text-sm text-destructive">{t(error)}</p>}
    {directory && !denied && <section className="space-y-4 rounded-2xl border bg-card p-5" data-testid="employees-roster" aria-label={t("employeesRoster")}>
      <div className="grid items-end gap-3 md:grid-cols-[minmax(0,1fr)_14rem_14rem]">
        <div className="space-y-1.5"><label htmlFor="employee-search" className="text-sm font-medium">{p("employeesSearchLabel")}</label>
          <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input id="employee-search" className="min-h-11 pl-9" type="search" placeholder={p("employeesSearchPlaceholder")} value={search} onChange={event => { setSearch(event.target.value); reset() }} /></div></div>
        <div className="space-y-1.5"><label htmlFor="employee-department" className="text-sm font-medium">{p("employeeCardDepartment")}</label>
          <select id="employee-department" className={SELECT} value={department} onChange={event => { setDepartment(event.target.value); reset() }}>
            <option value="">{t("reportAllTeams")}</option>{directory.teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}<option value={NO_DEPARTMENT}>{t("employeesNoTeam")}</option></select></div>
        <div className="space-y-1.5"><label htmlFor="employee-participation" className="text-sm font-medium">{t("employeesParticipationFilter")}</label>
          <select id="employee-participation" className={SELECT} value={participation} onChange={event => { setParticipation(event.target.value as Participation); reset() }}>
            <option value="ALL">{t("employeesFilterAll")}</option><option value="INCLUDED">{t("employeesFilterIncluded")}</option><option value="EXCLUDED">{t("employeesFilterExcluded")}</option></select></div>
      </div>
      <p className="text-sm text-muted-foreground" role="status">{t("employeesParticipationCounts", { total: directory.employees.length, included: includedCount, excluded: directory.employees.length - includedCount })}</p>
      {employees.length ? <div className="overflow-x-auto"><table className="w-full table-fixed text-left text-sm">
        <thead className="hidden md:table-header-group"><tr className="border-b text-xs text-muted-foreground"><th className="w-[46%] px-3 py-2 font-medium">{p("employeesColEmployee")}</th><th className="px-3 py-2 font-medium">{p("employeeCardDepartment")}</th><th className="px-3 py-2 font-medium">{p("employeesColToday")}</th><th className="w-36 px-3 py-2"><span className="sr-only">{p("employeeEdit")}</span></th></tr></thead>
        <tbody className="block md:table-row-group">{employees.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map(employee => {
          const href = `/mtm/attendance/people/${encodeURIComponent(employee.id)}?back=${back}`, [todayText, tone] = today(employee)
          const initials = employee.name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]!.toUpperCase()).join("")
          return <tr key={employee.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b py-3 last:border-0 md:table-row" data-testid="employee-row">
            <td className="md:px-3 md:py-3"><Link href={href} prefetch={false} className="group flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange-100 text-xs font-semibold text-orange-800 dark:bg-orange-950 dark:text-orange-200" aria-hidden="true">{initials}</span>
              <span className="min-w-0"><strong className="block truncate group-hover:underline">{employee.name}</strong><span className="block truncate text-xs text-muted-foreground">{detailLine(employee)}</span></span></Link></td>
            <td className="col-span-2 text-muted-foreground md:px-3 md:py-3">{employee.teamName ?? t("employeesNoTeam")}</td>
            <td className="md:px-3 md:py-3"><HomePill tone={tone}>{todayText}</HomePill></td>
            <td className="row-start-1 col-start-2 text-right md:px-3 md:py-3"><Button asChild variant="outline" className="min-h-10 rounded-full">
              <Link href={href} prefetch={false} aria-label={p("employeeEditNamed", { name: employee.name })}><Pencil className="mr-2 h-4 w-4" aria-hidden="true" />{p("employeeEdit")}</Link></Button></td>
          </tr>
        })}</tbody></table></div> : <p className="text-sm text-muted-foreground">{t("employeesEmpty")}</p>}
      {employees.length > PAGE_SIZE && <div className="flex flex-wrap items-center gap-3"><Button variant="outline" className="min-h-11" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{t("employeesPrevious")}</Button><span className="text-xs text-muted-foreground">{t("employeesPage", { page: currentPage + 1, pages, count: employees.length })}</span><Button variant="outline" className="min-h-11" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>{t("employeesNext")}</Button></div>}
    </section>}
  </div>
}
