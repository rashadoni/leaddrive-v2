/**
 * Doctors from Excel (Zeytun, 2026-11-13): how file rows become doctors and
 * clinics before anything is written. What is written is asked of a real
 * Postgres in `mtm-excel-doctors-postgres.test.ts`; here, the grouping rules on
 * their own. Fictional names only — the repository is public.
 */
import { describe, expect, it } from "vitest"
import { foldName, personNameKey, splitDoctorName, validateDoctorImport } from "@/lib/mtm/excel-doctors"
import type { ParsedMtmWorkbook } from "@/lib/mtm/excel-contract"

const AT = new Date("2026-11-14T08:00:00.000Z")

function db(input: {
  agents?: Array<{ id: string; name: string; externalCode: string | null }>
  places?: Array<{ id: string; name: string; city: string | null }>
  doctors?: Array<{ id: string; displayName: string; externalCode: string | null; agentAssignments: Array<{ agentId: string; role: string }>; workplaces: Array<{ customerId: string }> }>
}) {
  return {
    mtmAgent: { findMany: async () => input.agents ?? [] },
    mtmCustomer: { findMany: async () => input.places ?? [] },
    mtmContact: { findMany: async () => input.doctors ?? [] },
  } as never
}

function file(rows: Array<Record<string, string>>): ParsedMtmWorkbook {
  return {
    type: "DOCTORS",
    templateVersion: "1.0",
    sheetName: "doctors",
    headers: ["agent", "doctor_name", "doctor_code", "specialty", "clinic_name", "clinic_city", "clinic_district", "clinic_address"],
    rows: rows.map((values, index) => ({ rowNumber: index + 2, values })),
    errors: [],
  }
}

const AGENTS = [
  { id: "a1", name: "First Agent", externalCode: "AG-1" },
  { id: "a2", name: "Second Agent", externalCode: null },
]

describe("names as the file and MTM both spell them", () => {
  it("compares without case, spaces, punctuation and Azerbaijani letters", () => {
    expect(foldName("12 Saylı Şəhər Poliklinikası")).toBe(foldName("12 sayli seher poliklinikasi"))
    expect(foldName("Doctor  Name.")).toBe(foldName("doctor name"))
    expect(foldName("İsmayılova")).toBe(foldName("Ismayilova"))
    expect(foldName("Klinika 3")).not.toBe(foldName("Klinika 13"))
  })

  it("finds a person whatever order the words of the name come in", () => {
    expect(personNameKey("Abbaszadə Nərmin")).toBe(personNameKey("nermin  ABBASZADE"))
    expect(personNameKey("Quliyev, Tural Rauf")).toBe(personNameKey("Rauf Tural Quliyev"))
    expect(personNameKey("Tural Quliyev")).not.toBe(personNameKey("Tural Quliyeva"))
  })

  it("keeps the first word apart from the rest", () => {
    expect(splitDoctorName("Doctor Two Words")).toEqual({ firstName: "Doctor", lastName: "Two Words" })
    expect(splitDoctorName("Mononym")).toEqual({ firstName: "Mononym", lastName: "" })
  })
})

describe("rows become doctors", () => {
  it("joins one name under one agent into one doctor with two clinics, and keeps another agent's namesake apart", async () => {
    const result = await validateDoctorImport(db({ agents: AGENTS }), "org", file([
      { agent: "AG-1", doctor_name: "Doctor One", clinic_name: "Clinic A", clinic_city: "Bakı" },
      { agent: "first agent", doctor_name: "doctor one", clinic_name: "Clinic B", clinic_city: "Bakı" },
      { agent: "AG-1", doctor_name: "Doctor One", clinic_name: "Clinic A", clinic_city: "Bakı" },
      { agent: "Second Agent", doctor_name: "Doctor One", clinic_name: "Clinic A", clinic_city: "Baki" },
    ]), AT)
    expect(result.errors).toEqual([])
    expect(result.rows).toHaveLength(2)
    const [first, second] = result.rows
    expect(first).toMatchObject({ operation: "CREATE", sourceRows: [2, 3, 4], data: { agentId: "a1", assignAgent: true } })
    expect(first.data.clinics.map((clinic) => clinic.name)).toEqual(["Clinic A", "Clinic B"])
    expect(first.warnings?.map((warning) => warning.code)).toEqual(["TWO_CLINICS", "NAMESAKE_OTHER_AGENT"])
    expect(second.data.agentId).toBe("a2")
    // «Bakı» and «Baki» are one city: one new clinic A, plus B.
    expect(result.newClinics).toBe(2)
  })

  it("reuses a place MTM knows and never puts doctors in a pharmacy", async () => {
    const result = await validateDoctorImport(db({
      agents: AGENTS,
      places: [{ id: "known", name: "Clinic A", city: "Bakı" }],
    }), "org", file([{ agent: "AG-1", doctor_name: "Doctor One", clinic_name: "clinic a", clinic_city: "BAKI" }]), AT)
    expect(result.rows[0].data.clinics[0].customerId).toBe("known")
    expect(result.newClinics).toBe(0)
  })

  it("finds the agent's own doctor again, and adds only what is missing", async () => {
    const doctors = [{ id: "d1", displayName: "Doctor One", externalCode: null, agentAssignments: [{ agentId: "a1", role: "PRIMARY" }], workplaces: [{ customerId: "known" }] }]
    const places = [{ id: "known", name: "Clinic A", city: "Bakı" }]
    const same = await validateDoctorImport(db({ agents: AGENTS, places, doctors }), "org", file([{ agent: "AG-1", doctor_name: "Doctor One", clinic_name: "Clinic A", clinic_city: "Bakı" }]), AT)
    expect(same.rows[0]).toMatchObject({ operation: "UNCHANGED", existingId: "d1" })
    const more = await validateDoctorImport(db({ agents: AGENTS, places, doctors }), "org", file([{ agent: "AG-1", doctor_name: "Doctor One", clinic_name: "Clinic Z", clinic_city: "Bakı" }]), AT)
    expect(more.rows[0]).toMatchObject({ operation: "UPDATE", existingId: "d1", data: { assignAgent: false } })
  })

  it("finds the doctor MTM already has under the surname first, instead of creating him again", async () => {
    // Zeytun, 2026-11-14: MTM held «Surname Name» from an earlier import, the
    // file said «Name Surname», and every doctor was created a second time.
    const doctors = [{ id: "d1", displayName: "Abbaszadə Nərmin", externalCode: "DOC.0001", agentAssignments: [{ agentId: "a1", role: "PRIMARY" }], workplaces: [{ customerId: "known" }] }]
    const places = [{ id: "known", name: "Clinic A", city: "Bakı" }]
    const result = await validateDoctorImport(db({ agents: AGENTS, places, doctors }), "org", file([
      { agent: "Agent First", doctor_name: "Nərmin Abbaszadə", clinic_name: "Clinic A", clinic_city: "Bakı" },
    ]), AT)
    expect(result.errors).toEqual([])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({ operation: "UNCHANGED", existingId: "d1", data: { agentId: "a1" } })
  })

  it("refuses a row without a clinic, an unknown agent and an agent name two employees share", async () => {
    const result = await validateDoctorImport(db({ agents: [...AGENTS, { id: "a3", name: "Second Agent", externalCode: "AG-3" }] }), "org", file([
      { agent: "AG-1", doctor_name: "Doctor One" },
      { agent: "Nobody", doctor_name: "Doctor Two", clinic_name: "Clinic A" },
      { agent: "Second Agent", doctor_name: "Doctor Three", clinic_name: "Clinic A" },
    ]), AT)
    expect(result.errors.map((error) => [error.rowNumber, error.errorCode])).toEqual([[2, "REQUIRED"], [3, "AGENT_NOT_FOUND"], [4, "AGENT_AMBIGUOUS"]])
    expect(result.rows).toEqual([])
  })
})
