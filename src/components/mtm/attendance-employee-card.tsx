"use client"

import { useState, type FormEvent } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MtmAttendanceDepartmentField, departmentPayload, type DepartmentValue } from "@/components/mtm/attendance-department-field"
import { ATTENDANCE_EMPLOYEE_POSITION_MAX, type AttendanceEmployeeDirectory } from "@/lib/mtm/attendance-employee-contract"

type Employee = AttendanceEmployeeDirectory["employees"][number]
export type EmployeeCardBody = { agentId: string; position: string | null; teamId: string | null; newTeamName?: string; managerId: string | null }
const SELECT = "min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm"

/** The latest hire (or rehire) and, after it, a termination: what HR reads as "hired on". */
export function employeeHire(history: Employee["history"]) {
  const hire = [...history].reverse().find(event => event.kind !== "TERMINATION") ?? null
  const latest = history.at(-1) ?? null
  return { hire, terminated: latest?.kind === "TERMINATION" ? latest : null }
}

/**
 * Personnel → Employees → card (owner, 2026-10-15): job title, department,
 * manager and hire date — what «Forma N-1t» and every HR list need. The hire
 * date is read from the employment history below the card, never typed twice.
 */
export function MtmAttendanceEmployeeCard({ employee, teams, managers, disabled, saving, saved, dateLabel, onSave }: {
  employee: Employee; teams: AttendanceEmployeeDirectory["teams"]; managers: AttendanceEmployeeDirectory["managers"]
  disabled: boolean; saving: boolean; saved: boolean; dateLabel: (date: string) => string; onSave: (body: EmployeeCardBody) => void
}) {
  const p = useTranslations("personnel")
  const [position, setPosition] = useState(employee.position ?? "")
  const [department, setDepartment] = useState<DepartmentValue>({ teamId: employee.teamId ?? "", newTeamName: "" })
  const [managerId, setManagerId] = useState(employee.managerId ?? "")
  const { hire, terminated } = employeeHire(employee.history)
  const choices = managers.filter(manager => manager.id !== employee.id)
  // A manager chosen before the list changed stays visible instead of silently reading "not assigned".
  const unknownManager = managerId && !choices.some(manager => manager.id === managerId)
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (disabled) return
    onSave({ agentId: employee.id, position: position.trim() || null, ...departmentPayload(department), managerId: managerId || null })
  }
  return <form aria-label={p("employeeCardTitle", { name: employee.name })} className="space-y-4" onSubmit={submit} data-testid="employee-card">
    <div className="grid min-w-0 gap-4 sm:grid-cols-2">
      <div className="space-y-2"><label htmlFor="employee-card-position" className="block text-sm font-medium">{p("employeeCardPosition")}</label>
        <Input id="employee-card-position" maxLength={ATTENDANCE_EMPLOYEE_POSITION_MAX} className="min-h-11" placeholder={p("employeeCardPositionPlaceholder")} value={position} disabled={disabled} onChange={event => setPosition(event.target.value)} /></div>
      <MtmAttendanceDepartmentField id="employee-card-department" teams={teams} value={department} disabled={disabled} onChange={setDepartment} />
      <div className="space-y-2"><label htmlFor="employee-card-manager" className="block text-sm font-medium">{p("employeeCardManager")}</label>
        <select id="employee-card-manager" className={SELECT} value={managerId} disabled={disabled} onChange={event => setManagerId(event.target.value)}>
          <option value="">{p("employeeCardNoManager")}</option>
          {unknownManager ? <option value={managerId}>{p("employeeCardManagerUnavailable")}</option> : null}
          {choices.map(manager => <option key={manager.id} value={manager.id}>{manager.position ? `${manager.name} · ${manager.position}` : manager.name}</option>)}
        </select>
        <p className="text-xs text-muted-foreground">{p("employeeCardManagerHint")}</p></div>
      <div className="space-y-2" data-testid="employee-card-hire"><span className="block text-sm font-medium">{p("employeeCardHired")}</span>
        <p className="flex min-h-11 items-center rounded-md bg-muted/50 px-3 text-sm">{hire ? dateLabel(hire.date) : p("employeeCardHireMissing")}</p>
        {terminated ? <p className="text-xs font-medium text-destructive">{p("employeeCardTerminated", { date: dateLabel(terminated.date) })}</p>
          : <p className="text-xs text-muted-foreground">{p("employeeCardHireHint")}</p>}</div>
    </div>
    <div className="flex flex-wrap items-center gap-3"><Button type="submit" className="min-h-11 rounded-full" disabled={disabled}>{p(saving ? "employeeCardSaving" : "employeeCardSave")}</Button>
      {saved ? <span role="status" className="text-sm font-medium text-emerald-700 dark:text-emerald-400">{p("employeeCardSaved")}</span> : null}</div>
  </form>
}
