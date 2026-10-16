/**
 * «Клиенты агента»: picking the doctors an agent will work with, on the agent's
 * own card (owner, 2026-10-16: «при создании агента нужно, чтоб была
 * возможность выбора группы клиентов… специальность, дальше город, дальше
 * регион (район), и дальше список с отмеченными галочками, чтоб при желании
 * можно было оттуда кого-то изъять»; and «не только при создании, и при
 * редактировании»).
 *
 * Each step offers only what the previous ones left: the cities are those of
 * the chosen specialties, the districts those of the chosen cities. A doctor's
 * place is the institution he works at (his primary current workplace). The
 * city is the institution's `city`, else its `locality`; the district its
 * `district`, else `administrativeDistrict`, else `cityDistrict`. Nothing is
 * guessed from the address: on 2026-10-16 38 of 64 Baku institutions of the
 * first client named no district there, and one named a street «Nərimanov».
 * An empty value is a choice of its own («not stated»), never dropped.
 */

export const PICKER_NONE = "__none__"

export type PickerInstitution = {
  id: string
  name: string
  address: string | null
  city: string | null
  locality: string | null
  district: string | null
  administrativeDistrict: string | null
  cityDistrict: string | null
}

export type PickerContactRow = {
  id: string
  name: string
  specialtyName: string | null
  /** The primary current workplace first. */
  institution: PickerInstitution | null
  agents: Array<{ agentId: string; role: string; name: string }>
}

export type PickerSelection = { specialties: string[]; cities: string[]; districts: string[] }

export type PickerOption = { value: string; label: string | null; count: number }

export type PickerGroup = {
  institution: { id: string; name: string; address: string | null; city: string | null; district: string | null } | null
  contacts: Array<{
    id: string
    name: string
    specialty: string | null
    /** The other employees the doctor already has. */
    agents: Array<{ id: string; name: string; primary: boolean }>
    /** Already this agent's: shown ticked and greyed, never sent again. */
    assignedHere: boolean
  }>
}

export type AgentClientPicker = {
  specialties: PickerOption[]
  cities: PickerOption[]
  districts: PickerOption[]
  groups: PickerGroup[]
  matching: number
  assignedHere: number
}

const clean = (value: string | null | undefined) => value?.replace(/\s+/g, " ").trim() || null
const keyOf = (value: string | null) => (value ? value.toLocaleLowerCase("az") : PICKER_NONE)

export function placeOf(institution: PickerInstitution | null): { city: string | null; district: string | null } {
  if (!institution) return { city: null, district: null }
  return {
    city: clean(institution.city) ?? clean(institution.locality),
    district: clean(institution.district) ?? clean(institution.administrativeDistrict) ?? clean(institution.cityDistrict),
  }
}

/** Options with counts, the most common spelling as the label, «not stated» last. */
function facet(values: Array<string | null>): PickerOption[] {
  const byKey = new Map<string, { count: number; spellings: Map<string, number> }>()
  for (const value of values) {
    const key = keyOf(value)
    const entry = byKey.get(key) ?? { count: 0, spellings: new Map() }
    entry.count++
    if (value) entry.spellings.set(value, (entry.spellings.get(value) ?? 0) + 1)
    byKey.set(key, entry)
  }
  return [...byKey.entries()]
    .map(([value, entry]) => ({
      value,
      label: value === PICKER_NONE ? null : [...entry.spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
      count: entry.count,
    }))
    .sort((a, b) => (a.value === PICKER_NONE ? 1 : 0) - (b.value === PICKER_NONE ? 1 : 0) || b.count - a.count || (a.label ?? "").localeCompare(b.label ?? "", "az"))
}

const chosen = (selected: string[], value: string | null) => selected.length === 0 || selected.includes(keyOf(value))

export function buildAgentClientPicker(rows: readonly PickerContactRow[], selection: PickerSelection, agentId: string | null): AgentClientPicker {
  const select = {
    specialties: selection.specialties.map(value => value === PICKER_NONE ? value : keyOf(clean(value))),
    cities: selection.cities.map(value => value === PICKER_NONE ? value : keyOf(clean(value))),
    districts: selection.districts.map(value => value === PICKER_NONE ? value : keyOf(clean(value))),
  }
  const placed = rows.map(row => ({ row, specialty: clean(row.specialtyName), ...placeOf(row.institution) }))
  const bySpecialty = placed.filter(item => chosen(select.specialties, item.specialty))
  const byCity = bySpecialty.filter(item => chosen(select.cities, item.city))
  const matching = byCity.filter(item => chosen(select.districts, item.district))

  const groups = new Map<string, PickerGroup>()
  for (const item of matching) {
    const institution = item.row.institution
    const key = institution?.id ?? PICKER_NONE
    const group = groups.get(key) ?? {
      institution: institution ? { id: institution.id, name: institution.name, address: clean(institution.address), city: item.city, district: item.district } : null,
      contacts: [],
    }
    group.contacts.push({
      id: item.row.id,
      name: item.row.name,
      specialty: item.specialty,
      agents: item.row.agents.filter(agent => agent.agentId !== agentId).map(agent => ({ id: agent.agentId, name: agent.name, primary: agent.role === "PRIMARY" })),
      assignedHere: agentId !== null && item.row.agents.some(agent => agent.agentId === agentId),
    })
    groups.set(key, group)
  }
  const ordered = [...groups.values()]
    .map(group => ({ ...group, contacts: group.contacts.sort((a, b) => a.name.localeCompare(b.name, "az")) }))
    .sort((a, b) => (a.institution ? 0 : 1) - (b.institution ? 0 : 1) || (a.institution?.name ?? "").localeCompare(b.institution?.name ?? "", "az"))

  return {
    specialties: facet(placed.map(item => item.specialty)),
    cities: facet(bySpecialty.map(item => item.city)),
    districts: facet(byCity.map(item => item.district)),
    groups: ordered,
    matching: matching.length,
    assignedHere: matching.filter(item => agentId !== null && item.row.agents.some(agent => agent.agentId === agentId)).length,
  }
}
