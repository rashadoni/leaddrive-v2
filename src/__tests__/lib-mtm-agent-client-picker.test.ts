/**
 * «Клиенты агента» (owner, 2026-10-16): specialty → city → district, each step
 * offering only what the previous ones left, then the doctors grouped by
 * institution. Fictional doctors and institutions only.
 */
import { describe, expect, it } from "vitest"
import { PICKER_NONE, buildAgentClientPicker, placeOf, type PickerContactRow, type PickerInstitution } from "@/lib/mtm/agent-client-picker"

const place = (id: string, name: string, extra: Partial<PickerInstitution> = {}): PickerInstitution => ({
  id, name, address: null, city: null, locality: null, district: null, administrativeDistrict: null, cityDistrict: null, ...extra,
})
const CLINIC = place("c1", "Fictional Clinic", { city: "Bakı", district: "Nəsimi", address: "Fictional st. 1" })
const POLY = place("c2", "Fictional Polyclinic", { city: " bakı ", administrativeDistrict: "Yasamal" })
const SUBURB = place("c3", "Fictional Suburb Clinic", { locality: "Xırdalan" })
const doctor = (id: string, name: string, specialtyName: string | null, institution: PickerInstitution | null, agents: PickerContactRow["agents"] = []): PickerContactRow =>
  ({ id, name, specialtyName, institution, agents })

const ROWS: PickerContactRow[] = [
  doctor("d1", "Fictional Aliyeva", "Terapevt", CLINIC),
  doctor("d2", "Fictional Babayev", "Terapevt", CLINIC, [{ agentId: "other", role: "PRIMARY", name: "Fictional Other Agent" }]),
  doctor("d3", "Fictional Cavadova", "Terapevt", POLY, [{ agentId: "me", role: "SECONDARY", name: "Fictional Me" }]),
  doctor("d4", "Fictional Dadaşov", "Qastroenteroloq", POLY),
  doctor("d5", "Fictional Eldarova", "Terapevt", SUBURB),
  doctor("d6", "Fictional Fərzəliyev", "Terapevt", null),
  doctor("d7", "Fictional Qasımova", null, CLINIC),
]
const none = { specialties: [], cities: [], districts: [] }

describe("the agent's client picker", () => {
  it("reads a city from city, else locality, and a district from district, else the administrative or city district", () => {
    expect(placeOf(CLINIC)).toEqual({ city: "Bakı", district: "Nəsimi" })
    expect(placeOf(POLY)).toEqual({ city: "bakı", district: "Yasamal" })
    expect(placeOf(SUBURB)).toEqual({ city: "Xırdalan", district: null })
    expect(placeOf(null)).toEqual({ city: null, district: null })
  })

  it("counts every specialty, with «not stated» last", () => {
    expect(buildAgentClientPicker(ROWS, none, null).specialties).toEqual([
      { value: "terapevt", label: "Terapevt", count: 5 },
      { value: "qastroenteroloq", label: "Qastroenteroloq", count: 1 },
      { value: PICKER_NONE, label: null, count: 1 },
    ])
  })

  it("offers the cities of the chosen specialty only, one city however it is spelt, and then its districts", () => {
    const bySpecialty = buildAgentClientPicker(ROWS, { ...none, specialties: ["Terapevt"] }, null)
    expect(bySpecialty.cities).toEqual([
      { value: "bakı", label: "Bakı", count: 3 },
      { value: "xırdalan", label: "Xırdalan", count: 1 },
      { value: PICKER_NONE, label: null, count: 1 },
    ])
    const byCity = buildAgentClientPicker(ROWS, { specialties: ["terapevt"], cities: ["bakı"], districts: [] }, null)
    expect(byCity.districts.map(option => [option.label, option.count])).toEqual([["Nəsimi", 2], ["Yasamal", 1]])
    expect(byCity.matching).toBe(3)
  })

  it("lets a district that is not stated be chosen like any other", () => {
    const picker = buildAgentClientPicker(ROWS, { specialties: ["terapevt"], cities: [], districts: [PICKER_NONE] }, null)
    expect(picker.groups.flatMap(group => group.contacts.map(contact => contact.id))).toEqual(["d5", "d6"])
  })

  it("groups the doctors by institution, the doctors without one last, and names their other agents", () => {
    const picker = buildAgentClientPicker(ROWS, { ...none, specialties: ["terapevt"] }, "me")
    expect(picker.groups.map(group => group.institution?.name ?? null)).toEqual(["Fictional Clinic", "Fictional Polyclinic", "Fictional Suburb Clinic", null])
    expect(picker.groups[0]).toMatchObject({ institution: { city: "Bakı", district: "Nəsimi", address: "Fictional st. 1" } })
    expect(picker.groups[0].contacts[1]).toEqual({ id: "d2", name: "Fictional Babayev", specialty: "Terapevt", agents: [{ id: "other", name: "Fictional Other Agent", primary: true }], assignedHere: false })
  })

  it("marks the doctors already this agent's and counts them, without listing the agent among their others", () => {
    const picker = buildAgentClientPicker(ROWS, { ...none, specialties: ["terapevt"] }, "me")
    const cavadova = picker.groups[1].contacts[0]
    expect(cavadova).toMatchObject({ id: "d3", assignedHere: true, agents: [] })
    expect(picker.assignedHere).toBe(1)
    expect(buildAgentClientPicker(ROWS, { ...none, specialties: ["terapevt"] }, null).assignedHere).toBe(0)
  })
})
