/**
 * «Клиенты агента» (owner, 2026-10-16): specialty → city → district, each step
 * offering only what the previous ones left, then the doctors — one row each,
 * with his class and his institution (owner, 2026-10-20). Fictional doctors and
 * institutions only.
 */
import { describe, expect, it } from "vitest"
import { PICKER_NONE, buildAgentClientPicker, placeOf, type PickerContactRow, type PickerInstitution } from "@/lib/mtm/agent-client-picker"

const place = (id: string, name: string, extra: Partial<PickerInstitution> = {}): PickerInstitution => ({
  id, name, address: null, city: null, locality: null, district: null, administrativeDistrict: null, cityDistrict: null, ...extra,
})
const CLINIC = place("c1", "Fictional Clinic", { city: "Bakı", district: "Nəsimi", address: "Fictional st. 1" })
const POLY = place("c2", "Fictional Polyclinic", { city: " bakı ", administrativeDistrict: "Yasamal" })
const SUBURB = place("c3", "Fictional Suburb Clinic", { locality: "Xırdalan" })
const doctor = (id: string, name: string, specialtyName: string | null, institution: PickerInstitution | null, agents: PickerContactRow["agents"] = [], category = "B"): PickerContactRow =>
  ({ id, name, specialtyName, category, institution, agents })

const ROWS: PickerContactRow[] = [
  doctor("d1", "Fictional Aliyeva", "Terapevt", CLINIC),
  doctor("d2", "Fictional Babayev", "Terapevt", CLINIC, [{ agentId: "other", role: "PRIMARY", name: "Fictional Other Agent" }], "VIP"),
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
    expect(picker.contacts.map(contact => contact.id)).toEqual(["d5", "d6"])
  })

  it("lists each doctor with his class and where he works, those of one institution together, the doctors without one last", () => {
    const picker = buildAgentClientPicker(ROWS, { ...none, specialties: ["terapevt"] }, "me")
    expect(picker.contacts.map(contact => [contact.name, contact.place.institution?.name ?? null])).toEqual([
      ["Fictional Aliyeva", "Fictional Clinic"],
      ["Fictional Babayev", "Fictional Clinic"],
      ["Fictional Cavadova", "Fictional Polyclinic"],
      ["Fictional Eldarova", "Fictional Suburb Clinic"],
      ["Fictional Fərzəliyev", null],
    ])
    expect(picker.contacts[1]).toEqual({
      id: "d2",
      name: "Fictional Babayev",
      specialty: "Terapevt",
      category: "VIP",
      place: { institution: { id: "c1", name: "Fictional Clinic" }, address: "Fictional st. 1", city: "Bakı", district: "Nəsimi" },
      agents: [{ id: "other", name: "Fictional Other Agent", primary: true }],
      assignedHere: false,
    })
    // Three institutions: a doctor without one is not counted as a fourth.
    expect(picker.institutions).toBe(3)
    expect(picker.matching).toBe(5)
  })

  it("puts «2 saylı» before «19 saylı», as people count, not as letters sort", () => {
    const second = place("p2", "2 saylı Fictional Poliklinika", { city: "Bakı" })
    const nineteenth = place("p19", "19 saylı Fictional Poliklinika", { city: "Bakı" })
    const picker = buildAgentClientPicker([doctor("x1", "Fictional Zeynalova", "Terapevt", nineteenth), doctor("x2", "Fictional Abbasova", "Terapevt", second)], none, null)
    expect(picker.contacts.map(contact => contact.place.institution?.name)).toEqual(["2 saylı Fictional Poliklinika", "19 saylı Fictional Poliklinika"])
  })

  it("marks the doctors already this agent's and counts them, without listing the agent among their others", () => {
    const picker = buildAgentClientPicker(ROWS, { ...none, specialties: ["terapevt"] }, "me")
    const cavadova = picker.contacts.find(contact => contact.id === "d3")
    expect(cavadova).toMatchObject({ id: "d3", assignedHere: true, agents: [] })
    expect(picker.assignedHere).toBe(1)
    expect(buildAgentClientPicker(ROWS, { ...none, specialties: ["terapevt"] }, null).assignedHere).toBe(0)
  })

  // Owner, 2026-10-21: «я не заметил категории клиентов… нужно добавить в фильтр».
  it("offers every class the tenant grades with as a fourth step, «0» included, and narrows the doctors by it", () => {
    const terapevt = { ...none, specialties: ["Terapevt"] }
    // Of the five therapists, one is VIP and four are B; the tenant grades A, B, C, VIP.
    expect(buildAgentClientPicker(ROWS, terapevt, null, ["A", "B", "C", "VIP"]).classes).toEqual([
      { value: "A", label: "A", count: 0 },
      { value: "B", label: "B", count: 4 },
      { value: "C", label: "C", count: 0 },
      { value: "VIP", label: "VIP", count: 1 },
    ])
    const vip = buildAgentClientPicker(ROWS, { ...terapevt, classes: ["VIP"] }, null, ["A", "B", "C", "VIP"])
    expect(vip.contacts.map(contact => contact.name)).toEqual(["Fictional Babayev"])
    expect(vip.matching).toBe(1)
    // The class step counts what the place left, not what the class itself leaves.
    expect(vip.classes.find(option => option.value === "B")?.count).toBe(4)
    // A class a doctor still holds though the tenant no longer offers it comes after the tenant's own.
    expect(buildAgentClientPicker(ROWS, terapevt, null, ["A", "B"]).classes.map(option => option.value)).toEqual(["A", "B", "VIP"])
  })
})
