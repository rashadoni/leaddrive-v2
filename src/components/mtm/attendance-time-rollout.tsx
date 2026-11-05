"use client"

import { useTranslations } from "next-intl"
import { Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { AttendanceEmployeeDirectory } from "@/lib/mtm/attendance-employee-contract"

export type TimeFilter = "ALL" | "IN" | "OUT"
type Employee = AttendanceEmployeeDirectory["employees"][number]
/** The list's department filter value for a unit (see attendance-employees.tsx). */
const unitOf = (employee: Employee) => employee.departmentId ? `dep:${employee.departmentId}` : employee.teamId ?? "none"

/**
 * Personnel → Employees → «Кто уже в Time» (owner, 2026-11-05; mockup board 4):
 * Time goes out a department at a time, so HR sees per department how many of
 * its people have got into the app, opens the ones who have not, and prints a
 * leaflet with the QR and the steps.
 */
export function MtmAttendanceTimeRollout({ employees, onShowMissing }: { employees: ReadonlyArray<Employee>; onShowMissing: (unit: string) => void }) {
  const p = useTranslations("personnel"), t = useTranslations("mtmAttendance")
  const tracked = employees.filter(employee => employee.status === "ACTIVE" && employee.included)
  if (!tracked.length) return null
  const units = new Map<string, { label: string; total: number; signed: number }>()
  for (const employee of tracked) {
    const key = unitOf(employee), unit = units.get(key) ?? { label: employee.departmentName ?? employee.teamName ?? t("employeesNoTeam"), total: 0, signed: 0 }
    unit.total += 1; if (employee.timeSince) unit.signed += 1
    units.set(key, unit)
  }
  const rows = [...units.entries()].sort(([, a], [, b]) => (a.signed / a.total) - (b.signed / b.total) || a.label.localeCompare(b.label))
  const signed = tracked.filter(employee => employee.timeSince).length
  return <section className="space-y-3 rounded-2xl border bg-card p-5" aria-label={p("timeRolloutTitle")} data-testid="attendance-time-rollout">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-base font-semibold">{p("timeRolloutTitle")}</h2>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">{p("timeRolloutSummary", { signed, total: tracked.length })}</p></div>
      <Button asChild variant="outline" className="min-h-11 rounded-full"><a href="/api/v1/mtm/attendance/employees/leaflet" download data-testid="attendance-time-leaflet">
        <Download className="mr-2 h-4 w-4" aria-hidden="true" />{p("timeLeaflet")}</a></Button></div>
    <ul className="divide-y text-sm">{rows.map(([key, unit]) => <li key={key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2 md:grid-cols-[minmax(0,1fr)_7rem_10rem_auto]" data-testid="attendance-time-unit">
      <span className="truncate">{unit.label}</span>
      <span className="text-right tabular-nums text-muted-foreground md:text-left">{p("timeUnitCount", { signed: unit.signed, total: unit.total })}</span>
      <span className="col-span-2 h-2 overflow-hidden rounded-full bg-muted md:col-span-1" aria-hidden="true"><span className="block h-full bg-emerald-600" style={{ width: `${(100 * unit.signed) / unit.total}%` }} /></span>
      {unit.signed < unit.total ? <Button type="button" variant="link" className="h-auto justify-start p-0 md:justify-end" onClick={() => onShowMissing(key)} data-testid="attendance-time-missing">{p("timeUnitMissing", { count: unit.total - unit.signed })}</Button> : <span />}
    </li>)}</ul>
  </section>
}
