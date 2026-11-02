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
 *
 * The list is one row a doctor — his name, his class (A, B, C, VIP), then where
 * he works (owner, 2026-10-20, in front of the institutions it showed: «агенту
 * задаётся клиент, так что нужно, чтобы в списке было указано название
 * клиента, а потом место, где он находится»). Doctors of one institution stay
 * next to each other: the rows run by institution, then by name.
 */

import { MTM_CONTACT_CLASS_VALUES } from "@/lib/mtm/contact-classes"

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
  /** The class letter the company grades him with (`MtmContact.category`). */
  category: string | null
  /** The primary current workplace first. */
  institution: PickerInstitution | null
  agents: Array<{ agentId: string; role: string; name: string }>
}

/** `classes`: the class letters (A, B, VIP) — the fourth step, after the place. */
export type PickerSelection = { specialties: string[]; cities: string[]; districts: string[]; classes?: string[] }

export type PickerOption = { value: string; label: string | null; count: number }

export type PickerContact = {
  id: string
  name: string
  specialty: string | null
  /** A, B, C, D or VIP. */
  category: string | null
  /** Where he works: the institution, its district (else city) and address. */
  place: { institution: { id: string; name: string } | null; address: string | null; city: string | null; district: string | null }
  /** The other employees the doctor already has. */
  agents: Array<{ id: string; name: string; primary: boolean }>
  /** Already this agent's: listed ticked; unticked, he is taken off. */
  assignedHere: boolean
}

export type AgentClientPicker = {
  specialties: PickerOption[]
  cities: PickerOption[]
  districts: PickerOption[]
  /** Every class the tenant grades with, in reading order, with how many hold it here. */
  classes: PickerOption[]
  contacts: PickerContact[]
  /** How many institutions the listed doctors work at. */
  institutions: number
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

/**
 * The class step offers every class the tenant grades with, «0» included (owner,
 * 2026-10-21: «я не заметил категории клиентов»), in the order the tenant reads
 * them, and any other class a listed doctor still holds after them.
 */
function classFacet(values: Array<string | null>, enabled: readonly string[]): PickerOption[] {
  const counts = new Map<string, number>()
  for (const value of values) {
    const key = value ?? PICKER_NONE
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const reading = (key: string) => {
    const index = (MTM_CONTACT_CLASS_VALUES as readonly string[]).indexOf(key)
    return index === -1 ? MTM_CONTACT_CLASS_VALUES.length : index
  }
  const others = [...counts.keys()].filter(key => !enabled.includes(key)).sort((a, b) => reading(a) - reading(b) || a.localeCompare(b))
  const keys = [...enabled, ...others]
  return keys.map(key => ({ value: key, label: key === PICKER_NONE ? null : key, count: counts.get(key) ?? 0 }))
}

export function buildAgentClientPicker(rows: readonly PickerContactRow[], selection: PickerSelection, agentId: string | null, enabledClasses: readonly string[] = []): AgentClientPicker {
  const select = {
    specialties: selection.specialties.map(value => value === PICKER_NONE ? value : keyOf(clean(value))),
    cities: selection.cities.map(value => value === PICKER_NONE ? value : keyOf(clean(value))),
    districts: selection.districts.map(value => value === PICKER_NONE ? value : keyOf(clean(value))),
  }
  const placed = rows.map(row => ({ row, specialty: clean(row.specialtyName), ...placeOf(row.institution) }))
  const bySpecialty = placed.filter(item => chosen(select.specialties, item.specialty))
  const byCity = bySpecialty.filter(item => chosen(select.cities, item.city))
  const byDistrict = byCity.filter(item => chosen(select.districts, item.district))
  const classes = (selection.classes ?? []).map(value => clean(value) ?? PICKER_NONE)
  const matching = byDistrict.filter(item => classes.length === 0 || classes.includes(clean(item.row.category) ?? PICKER_NONE))

  const contacts: PickerContact[] = matching
    .map(item => {
      const institution = item.row.institution
      return {
        id: item.row.id,
        name: item.row.name,
        specialty: item.specialty,
        category: clean(item.row.category),
        place: { institution: institution ? { id: institution.id, name: institution.name } : null, address: clean(institution?.address), city: item.city, district: item.district },
        agents: item.row.agents.filter(agent => agent.agentId !== agentId).map(agent => ({ id: agent.agentId, name: agent.name, primary: agent.role === "PRIMARY" })),
        assignedHere: agentId !== null && item.row.agents.some(agent => agent.agentId === agentId),
      }
    })
    .sort((a, b) => (a.place.institution ? 0 : 1) - (b.place.institution ? 0 : 1)
      // «2 saylı» before «19 saylı».
      || (a.place.institution?.name ?? "").localeCompare(b.place.institution?.name ?? "", "az", { numeric: true })
      || (a.place.institution?.id ?? "").localeCompare(b.place.institution?.id ?? "")
      || a.name.localeCompare(b.name, "az"))

  return {
    specialties: facet(placed.map(item => item.specialty)),
    cities: facet(bySpecialty.map(item => item.city)),
    districts: facet(byCity.map(item => item.district)),
    classes: classFacet(byDistrict.map(item => clean(item.row.category)), enabledClasses),
    contacts,
    institutions: new Set(contacts.flatMap(contact => (contact.place.institution ? [contact.place.institution.id] : []))).size,
    matching: contacts.length,
    assignedHere: contacts.filter(contact => contact.assignedHere).length,
  }
}
