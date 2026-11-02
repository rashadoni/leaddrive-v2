"use client"

import { useTranslations } from "next-intl"
import { Input } from "@/components/ui/input"
import type { AttendanceDepartment, AttendanceSection } from "@/lib/mtm/attendance-employee-contract"

export const NEW_DEPARTMENT = "__new"
export type DepartmentValue = { departmentId: string; newDepartmentName: string; teamId: string; newTeamName: string }
export const emptyDepartmentValue = (departmentId: string | null = null, teamId: string | null = null): DepartmentValue =>
  ({ departmentId: departmentId ?? "", newDepartmentName: "", teamId: teamId ?? "", newTeamName: "" })
const SELECT = "min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm"

/** A department (departament) and a section in it (şöbə, an MTM team); HR may type a new one of each, which the server reuses by name. */
export function departmentPayload(value: DepartmentValue) {
  return {
    ...(value.departmentId === NEW_DEPARTMENT ? { departmentId: null, newDepartmentName: value.newDepartmentName.trim() } : { departmentId: value.departmentId || null }),
    ...(value.teamId === NEW_DEPARTMENT ? { teamId: null, newTeamName: value.newTeamName.trim() } : { teamId: value.teamId || null }),
  }
}

/**
 * Two fields, department then section (owner, 2026-10-22: «тут есть отдел, но
 * нет департамента»). A section belongs to one department: under a department
 * the list offers its sections and those outside any; picking a section of
 * another department moves the department field to it. A department head sits
 * in the department without a section.
 */
export function MtmAttendanceDepartmentField({ id, teams, departments, value, disabled, onChange }: {
  id: string; teams: ReadonlyArray<AttendanceSection>; departments: ReadonlyArray<AttendanceDepartment>; value: DepartmentValue; disabled?: boolean; onChange: (value: DepartmentValue) => void
}) {
  const p = useTranslations("personnel")
  const chosen = value.departmentId && value.departmentId !== NEW_DEPARTMENT ? value.departmentId : null
  const loose = teams.filter(team => !team.departmentId)
  const groups = chosen ? [{ id: chosen, name: null, teams: teams.filter(team => team.departmentId === chosen) }]
    : value.departmentId === NEW_DEPARTMENT ? []
      : departments.map(department => ({ id: department.id, name: department.name, teams: teams.filter(team => team.departmentId === department.id) })).filter(group => group.teams.length)
  const option = (team: AttendanceSection) => <option key={team.id} value={team.id}>{team.name}</option>
  const pickDepartment = (departmentId: string) => {
    const team = teams.find(section => section.id === value.teamId)
    // A section of another department does not follow the person into this one.
    const keepsTeam = !team || !team.departmentId || team.departmentId === departmentId
    onChange({ ...value, departmentId, ...(keepsTeam ? {} : { teamId: "" }) })
  }
  const pickTeam = (teamId: string) => {
    const owner = teams.find(section => section.id === teamId)?.departmentId
    onChange({ ...value, teamId, ...(owner ? { departmentId: owner } : {}) })
  }
  return <>
    <div className="space-y-2">
      <label htmlFor={`${id}-unit`} className="block text-sm font-medium">{p("employeeCardDepartament")}</label>
      <select id={`${id}-unit`} className={SELECT} value={value.departmentId} disabled={disabled} onChange={event => pickDepartment(event.target.value)}>
        <option value="">{p("employeeCardNoDepartament")}</option>
        {departments.map(department => <option key={department.id} value={department.id}>{department.name}</option>)}
        <option value={NEW_DEPARTMENT}>{p("employeeCardNewDepartament")}</option>
      </select>
      {value.departmentId === NEW_DEPARTMENT ? <Input aria-label={p("employeeCardNewDepartamentName")} placeholder={p("employeeCardNewDepartamentName")} required maxLength={120} className="min-h-11"
        value={value.newDepartmentName} disabled={disabled} onChange={event => onChange({ ...value, newDepartmentName: event.target.value })} /> : null}
    </div>
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium">{p("employeeCardDepartment")}</label>
      <select id={id} className={SELECT} value={value.teamId} disabled={disabled} onChange={event => pickTeam(event.target.value)}>
        <option value="">{p("employeeCardNoDepartment")}</option>
        {groups.map(group => group.name ? <optgroup key={group.id} label={group.name}>{group.teams.map(option)}</optgroup> : group.teams.map(option))}
        {chosen || value.departmentId === NEW_DEPARTMENT ? loose.map(option) : loose.length && groups.length ? <optgroup label={p("employeeCardNoDepartament")}>{loose.map(option)}</optgroup> : loose.map(option)}
        <option value={NEW_DEPARTMENT}>{p("employeeCardNewDepartment")}</option>
      </select>
      {value.teamId === NEW_DEPARTMENT ? <Input aria-label={p("employeeCardNewDepartmentName")} placeholder={p("employeeCardNewDepartmentName")} required maxLength={120} className="min-h-11"
        value={value.newTeamName} disabled={disabled} onChange={event => onChange({ ...value, newTeamName: event.target.value })} /> : null}
    </div>
  </>
}
