"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Hint } from "@/components/hint"
import { Input } from "@/components/ui/input"
import type { AttendanceDepartment, AttendanceSection } from "@/lib/mtm/attendance-employee-contract"
import { ATTENDANCE_UNIT_NAME_MAX } from "@/lib/mtm/attendance-unit-rename-contract"

export type AttendanceUnitRenamed = { kind: "DEPARTMENT" | "SECTION"; id: string; name: string }
/** The lists after a rename: the unit keeps its id, only its name changes. */
export function applyAttendanceUnitRename<T extends { teams: ReadonlyArray<AttendanceSection>; departments?: ReadonlyArray<AttendanceDepartment> }>(lists: T, unit: AttendanceUnitRenamed): T {
  return unit.kind === "DEPARTMENT"
    ? { ...lists, departments: (lists.departments ?? []).map(department => department.id === unit.id ? { ...department, name: unit.name } : department) }
    : { ...lists, teams: lists.teams.map(team => team.id === unit.id ? { ...team, name: unit.name } : team) }
}

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
export function MtmAttendanceDepartmentField({ id, teams, departments, value, disabled, onChange, onRenamed }: {
  id: string; teams: ReadonlyArray<AttendanceSection>; departments: ReadonlyArray<AttendanceDepartment>; value: DepartmentValue; disabled?: boolean; onChange: (value: DepartmentValue) => void
  /** Given on the administrators' forms: a chosen department or section can be renamed in place. */
  onRenamed?: (unit: AttendanceUnitRenamed) => void
}) {
  const p = useTranslations("personnel")
  const chosen = value.departmentId && value.departmentId !== NEW_DEPARTMENT ? value.departmentId : null
  const chosenTeam = value.teamId && value.teamId !== NEW_DEPARTMENT ? teams.find(team => team.id === value.teamId) ?? null : null
  const chosenDepartment = chosen ? departments.find(department => department.id === chosen) ?? null : null
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
  // Which of the two names is being edited; its editor stands in place of its list.
  const [renaming, setRenaming] = useState<AttendanceUnitRenamed["kind"] | null>(null)
  const unitFor = (kind: AttendanceUnitRenamed["kind"]) => kind === "DEPARTMENT" ? chosenDepartment : chosenTeam
  const editing = (kind: AttendanceUnitRenamed["kind"]) => {
    const unit = unitFor(kind)
    return onRenamed && unit && renaming === kind
      ? <UnitRenameEditor key={unit.id} kind={kind} unit={unit} onDone={renamed => { setRenaming(null); if (renamed) onRenamed(renamed) }} />
      : null
  }
  const label = (htmlFor: string, text: string, kind: AttendanceUnitRenamed["kind"]) => {
    const unit = unitFor(kind)
    return <div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
      {renaming === kind && unit ? <span className="block text-sm font-medium">{text}</span> : <label htmlFor={htmlFor} className="block text-sm font-medium">{text}</label>}
      {onRenamed && unit && renaming !== kind ? <Hint text={p(kind === "DEPARTMENT" ? "unitRenameDepartamentHint" : "unitRenameSectionHint")}>
        <Button type="button" variant="outline" size="sm" className="min-h-8 gap-1.5 rounded-full px-3 text-xs" disabled={disabled} onClick={() => setRenaming(kind)}
          data-testid={`unit-rename-${kind.toLowerCase()}`}><Pencil className="h-3.5 w-3.5" aria-hidden="true" />{p("unitRename")}</Button>
      </Hint> : null}
    </div>
  }
  const departmentEditor = editing("DEPARTMENT"), sectionEditor = editing("SECTION")
  return <>
    <div className="space-y-2">
      {label(`${id}-unit`, p("employeeCardDepartament"), "DEPARTMENT")}
      {departmentEditor ?? <select id={`${id}-unit`} className={SELECT} value={value.departmentId} disabled={disabled} onChange={event => pickDepartment(event.target.value)}>
        <option value="">{p("employeeCardNoDepartament")}</option>
        {departments.map(department => <option key={department.id} value={department.id}>{department.name}</option>)}
        <option value={NEW_DEPARTMENT}>{p("employeeCardNewDepartament")}</option>
      </select>}
      {value.departmentId === NEW_DEPARTMENT ? <Input aria-label={p("employeeCardNewDepartamentName")} placeholder={p("employeeCardNewDepartamentName")} required maxLength={120} className="min-h-11"
        value={value.newDepartmentName} disabled={disabled} onChange={event => onChange({ ...value, newDepartmentName: event.target.value })} /> : null}
    </div>
    <div className="space-y-2">
      {label(id, p("employeeCardDepartment"), "SECTION")}
      {sectionEditor ?? <select id={id} className={SELECT} value={value.teamId} disabled={disabled} onChange={event => pickTeam(event.target.value)}>
        <option value="">{p("employeeCardNoDepartment")}</option>
        {groups.map(group => group.name ? <optgroup key={group.id} label={group.name}>{group.teams.map(option)}</optgroup> : group.teams.map(option))}
        {chosen || value.departmentId === NEW_DEPARTMENT ? loose.map(option) : loose.length && groups.length ? <optgroup label={p("employeeCardNoDepartament")}>{loose.map(option)}</optgroup> : loose.map(option)}
        <option value={NEW_DEPARTMENT}>{p("employeeCardNewDepartment")}</option>
      </select>}
      {value.teamId === NEW_DEPARTMENT ? <Input aria-label={p("employeeCardNewDepartmentName")} placeholder={p("employeeCardNewDepartmentName")} required maxLength={120} className="min-h-11"
        value={value.newTeamName} disabled={disabled} onChange={event => onChange({ ...value, newTeamName: event.target.value })} /> : null}
    </div>
  </>
}

const RENAME_ERRORS: Record<string, string> = { MTM_ATTENDANCE_EMPLOYEE_ADMIN_REQUIRED: "unitRenameForbidden", MTM_ATTENDANCE_DECISION_FORBIDDEN: "unitRenameForbidden",
  MTM_ATTENDANCE_UNIT_NOT_FOUND: "unitRenameGone", MTM_ATTENDANCE_UNIT_INVALID: "unitRenameEmpty" }

/**
 * «Изменить название» next to a chosen department or section (owner,
 * 2026-11-02, approved mockup): the name is saved by its own button, apart from
 * the card's «Сохранить», and changes for everyone in that unit. The editor
 * sits inside the card's form, so Enter saves the name instead of the card.
 */
function UnitRenameEditor({ kind, unit, onDone }: { kind: AttendanceUnitRenamed["kind"]; unit: { id: string; name: string }; onDone: (renamed: AttendanceUnitRenamed | null) => void }) {
  const p = useTranslations("personnel")
  const [name, setName] = useState(unit.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const department = kind === "DEPARTMENT"
  async function save() {
    const next = name.trim()
    if (busy) return
    if (!next) { setError(p("unitRenameEmpty")); return }
    setBusy(true); setError(null)
    try {
      const response = await fetch("/api/v1/mtm/attendance/units", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, id: unit.id, name: next }) })
      const body = await response.json().catch(() => null)
      if (response.ok && body?.success === true) { setBusy(false); onDone({ kind, id: unit.id, name: typeof body.data?.name === "string" ? body.data.name : next }); return }
      const code = typeof body?.code === "string" ? body.code : ""
      setError(code === "MTM_ATTENDANCE_UNIT_NAME_TAKEN" ? p(department ? "unitRenameTakenDepartament" : "unitRenameTakenSection", { name: next }) : p(RENAME_ERRORS[code] ?? "unitRenameFailed"))
    } catch { setError(p("unitRenameFailed")) }
    setBusy(false)
  }
  const inputId = `unit-rename-${kind.toLowerCase()}-${unit.id}`
  return <div className="w-full space-y-2 rounded-xl border border-foreground/30 p-3" data-testid={`unit-rename-${kind.toLowerCase()}-editor`}>
    <label htmlFor={inputId} className="block text-xs text-muted-foreground">{p(department ? "unitRenameDepartamentLabel" : "unitRenameSectionLabel")}</label>
    <Input id={inputId} autoFocus required maxLength={ATTENDANCE_UNIT_NAME_MAX} className={`min-h-11 ${error ? "border-rose-600 dark:border-rose-500" : ""}`} value={name} disabled={busy}
      aria-invalid={error ? true : undefined} aria-describedby={`${inputId}-note`}
      onChange={event => { setName(event.target.value); setError(null) }}
      onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void save() } else if (event.key === "Escape") { event.preventDefault(); onDone(null) } }} />
    <p id={`${inputId}-note`} role={error ? "alert" : undefined} className={`text-xs ${error ? "font-medium text-rose-700 dark:text-rose-300" : "text-muted-foreground"}`}>
      {error ?? p(department ? "unitRenameDepartamentHint" : "unitRenameSectionHint")}</p>
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" className="min-h-10 rounded-full border-foreground px-4 font-semibold" disabled={busy} onClick={() => void save()}>{p(busy ? "unitRenameSaving" : "unitRenameSave")}</Button>
      <Button type="button" variant="outline" className="min-h-10 rounded-full px-4" disabled={busy} onClick={() => onDone(null)}>{p("unitRenameCancel")}</Button>
    </div>
  </div>
}
