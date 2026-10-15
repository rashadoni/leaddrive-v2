"use client"

import { useTranslations } from "next-intl"
import { Input } from "@/components/ui/input"

export const NEW_DEPARTMENT = "__new"
export type DepartmentValue = { teamId: string; newTeamName: string }
const SELECT = "min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm"

/** A department is an MTM team; HR may type a new one, which the server reuses by name. */
export function departmentPayload(value: DepartmentValue) {
  return value.teamId === NEW_DEPARTMENT ? { teamId: null, newTeamName: value.newTeamName.trim() } : { teamId: value.teamId || null }
}

export function MtmAttendanceDepartmentField({ id, teams, value, disabled, onChange }: {
  id: string; teams: ReadonlyArray<{ id: string; name: string }>; value: DepartmentValue; disabled?: boolean; onChange: (value: DepartmentValue) => void
}) {
  const p = useTranslations("personnel")
  return <div className="space-y-2">
    <label htmlFor={id} className="block text-sm font-medium">{p("employeeCardDepartment")}</label>
    <select id={id} className={SELECT} value={value.teamId} disabled={disabled} onChange={event => onChange({ ...value, teamId: event.target.value })}>
      <option value="">{p("employeeCardNoDepartment")}</option>
      {teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
      <option value={NEW_DEPARTMENT}>{p("employeeCardNewDepartment")}</option>
    </select>
    {value.teamId === NEW_DEPARTMENT ? <Input aria-label={p("employeeCardNewDepartmentName")} placeholder={p("employeeCardNewDepartmentName")} required maxLength={120} className="min-h-11"
      value={value.newTeamName} disabled={disabled} onChange={event => onChange({ ...value, newTeamName: event.target.value })} /> : null}
  </div>
}
