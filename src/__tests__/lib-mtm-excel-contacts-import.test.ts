/**
 * What the client import says about a spreadsheet, before anything is written.
 *
 * Every case goes through a real .xlsx built from the downloadable template
 * and through the real parser, so a rule that only holds for hand-made row
 * objects cannot pass here. The data is shaped like the files tenants send —
 * one institution spelled three ways, placeholder addresses, rows with a first
 * name only — and every name in it is invented.
 */
import { describe, expect, it } from "vitest"
import { buildMtmExcelTemplate, getMtmExcelContract, parseMtmExcelWorkbook, type MtmExcelLocale } from "@/lib/mtm/excel-contract"
import { validateMtmExcelImport } from "@/lib/mtm/excel-import"
import type { MtmContactImportPolicy } from "@/lib/mtm/excel-contacts-import"
import type { MtmRouteActor } from "@/lib/mtm/route-permissions"

const ADMIN: MtmRouteActor = { agentId: null, role: "ADMIN", canPlanOwnRoutes: true, canSelfPublishRoutes: true, scopedAgentIds: null }

type Row = Partial<Record<
  | "external_code" | "last_name" | "first_name" | "middle_name" | "contact_type" | "specialty"
  | "institution_code" | "institution_name" | "institution_address" | "institution_city"
  | "phone" | "notes" | "agent_code_or_email",
  string | number
>>

/**
 * The template as an administrator fills it: data typed over the example row,
 * from row 2 down (or under it, when the example is left in place).
 */
async function workbook(rows: Row[], options: { keepExample?: boolean } = {}): Promise<Buffer> {
  const book = buildMtmExcelTemplate("CONTACTS", "en")
  const sheet = book.getWorksheet("contacts")!
  const columns = getMtmExcelContract("CONTACTS").columns.map((column) => column.key)
  const first = options.keepExample ? 3 : 2
  rows.forEach((row, index) => {
    sheet.getRow(first + index).values = columns.map((key) => row[key as keyof Row] ?? null)
  })
  return Buffer.from(await book.xlsx.writeBuffer())
}

interface Base {
  contacts?: Array<{
    externalCode: string | null
    firstName: string
    lastName: string
    middleName?: string | null
    status?: string
    deletedAt?: Date | null
    workplaces?: Array<{ customerId: string }>
  }>
  institutions?: Array<{ id: string; code: string | null; name: string; status?: string }>
  agents?: Array<{ id: string; name: string; email?: string | null; externalCode?: string | null; role?: string; status?: string }>
}

/** A base that can be read and nothing else: any write during validation throws. */
function readOnlyBase(base: Base) {
  return {
    mtmContact: {
      findMany: async () => (base.contacts ?? []).map((contact) => ({
        middleName: null,
        status: "ACTIVE",
        deletedAt: null,
        workplaces: [],
        ...contact,
        displayName: [contact.lastName, contact.firstName, contact.middleName].filter(Boolean).join(" "),
      })),
    },
    mtmCustomer: {
      findMany: async () => (base.institutions ?? []).map((institution) => ({ status: "ACTIVE", ...institution })),
    },
    mtmAgent: {
      findMany: async () => (base.agents ?? []).map((agent) => ({ email: null, externalCode: null, role: "AGENT", status: "ACTIVE", ...agent })),
    },
  }
}

async function check(
  rows: Row[],
  base: Base = {},
  options: { actor?: MtmRouteActor; locale?: MtmExcelLocale; policy?: MtmContactImportPolicy; keepExample?: boolean } = {},
) {
  const parsed = await parseMtmExcelWorkbook(await workbook(rows, options), "CONTACTS")
  return validateMtmExcelImport({
    db: readOnlyBase(base) as never,
    organizationId: "org-1",
    parsed,
    checksum: "checksum",
    actor: options.actor ?? ADMIN,
    locale: options.locale,
    contactPolicy: options.policy,
  })
}

function errorsAt(result: Awaited<ReturnType<typeof check>>, rowNumber: number) {
  return result.errors.filter((error) => error.rowNumber === rowNumber).map((error) => `${error.columnName ?? "-"}:${error.errorCode}`)
}

function dataAt(result: Awaited<ReturnType<typeof check>>, rowNumber: number) {
  return result.snapshot.rows.find((row) => row.rowNumber === rowNumber)?.data
}

function warningsAt(result: Awaited<ReturnType<typeof check>>, rowNumber: number) {
  return (result.snapshot.rows.find((row) => row.rowNumber === rowNumber)?.warnings ?? []).map((warning) => warning.code)
}

const CLINIC = { id: "inst-clinic", code: "KL-001", name: "Mərkəzi Klinika" }
const FIELD_AGENT = { id: "agent-elvin", name: "Elvin Sahə", externalCode: "AG-07", email: "elvin@example.com" }

describe("client import: a clean file", () => {
  it("resolves the institution by code or by name, the owner by code or e-mail, and the tenant's spelling of a specialty", async () => {
    const result = await check([
      { external_code: "TRP.001", last_name: "Qurbanlı", first_name: "Aynur", specialty: "terapevt", institution_code: "KL-001", agent_code_or_email: "AG-07" },
      { external_code: "TRP.002", last_name: "Səfərov", first_name: "Tural", middle_name: "Kamil oğlu", specialty: "Qastroenteroloq", institution_name: "  MƏRKƏZİ   klinika ", agent_code_or_email: "Elvin@Example.com", phone: 994500000001 },
      { external_code: "TRP.003", last_name: "Nağıyeva", first_name: "Lalə", contact_type: "pharmacist", institution_name: "Şəfa Aptek", institution_address: "Nümunə küçəsi 12", institution_city: "Gəncə" },
    ], { institutions: [CLINIC], agents: [FIELD_AGENT] }, { policy: { specialties: ["Terapevt", "Qastroenteroloq"] } })

    expect(result.errors).toEqual([])
    expect(result.snapshot.summary).toMatchObject({ totalRows: 3, createRows: 3, updateRows: 0, errorRows: 0, createInstitutions: 1, assignRows: 2 })
    expect(dataAt(result, 2)).toMatchObject({
      externalCode: "TRP.001", displayName: "Qurbanlı Aynur", type: "DOCTOR", specialtyName: "Terapevt",
      institutionId: "inst-clinic", newInstitution: null, agentId: "agent-elvin",
    })
    // The name differs from the stored one only by case and spacing: same institution, nothing created.
    expect(dataAt(result, 3)).toMatchObject({ institutionId: "inst-clinic", newInstitution: null, agentId: "agent-elvin", middleName: "Kamil oğlu", phone: "994500000001" })
    expect(dataAt(result, 4)).toMatchObject({
      type: "PHARMACIST", institutionId: null, agentId: null,
      newInstitution: { name: "Şəfa Aptek", address: "Nümunə küçəsi 12", city: "Gəncə", objectType: "PHARMACY" },
    })
    expect(result.preview[2]).toEqual({ rowNumber: 4, externalCode: "TRP.003", displayName: "Nağıyeva Lalə", specialty: "", institution: "Şəfa Aptek (new)", agent: "" })
  })

  it("creates one institution for rows that spell its name in different case, with the first address given", async () => {
    const result = await check([
      { external_code: "D1", last_name: "Əhmədov", first_name: "Samir", institution_name: "Sağlam Ailə Klinikası" },
      { external_code: "D2", last_name: "Vəliyeva", first_name: "Günay", institution_name: "SAĞLAM AİLƏ KLİNİKASI", institution_address: "Bağ küçəsi 3", institution_city: "Bakı" },
      { external_code: "D3", last_name: "İsmayılov", first_name: "Rauf", institution_name: "sağlam ailə klinikası", institution_address: "Dəniz prospekti 40" },
    ])

    expect(result.errors).toEqual([])
    expect(result.snapshot.summary.createInstitutions).toBe(1)
    for (const rowNumber of [2, 3, 4]) {
      expect(dataAt(result, rowNumber)).toMatchObject({ newInstitution: { name: "Sağlam Ailə Klinikası", address: "Bağ küçəsi 3", city: "Bakı", objectType: "CLINIC" } })
    }
    // The third row's address disagrees with the one already taken.
    expect(warningsAt(result, 4)).toEqual(["INSTITUTION_ADDRESS_DIFFERS"])
  })
})

describe("client import: what a real file gets wrong", () => {
  it("reports a repeated code, a code the base already has, and a code held by a deleted client", async () => {
    const result = await check([
      { external_code: "GST.0100", last_name: "Həsənov", first_name: "Orxan" },
      { external_code: "gst.0100", last_name: "Kərimova", first_name: "Sevda" },
      { external_code: "GST.0101", last_name: "Rzayev", first_name: "Emin" },
      { external_code: "GST.0102", last_name: "Abbasova", first_name: "Nigar" },
    ], {
      contacts: [
        { externalCode: "GST.0101", lastName: "Rzayev", firstName: "Emin" },
        { externalCode: "GST.0102", lastName: "Köhnə", firstName: "Qeyd", deletedAt: new Date("2026-09-01T00:00:00.000Z") },
      ],
    })

    expect(errorsAt(result, 2)).toEqual([])
    expect(errorsAt(result, 3)).toEqual(["external_code:DUPLICATE_IN_FILE"])
    expect(errorsAt(result, 4)).toEqual(["external_code:ALREADY_EXISTS"])
    expect(errorsAt(result, 5)).toEqual(["external_code:ALREADY_EXISTS"])
    expect(result.errors.find((error) => error.rowNumber === 4)?.message).toContain("Rzayev Emin")
    expect(result.errors.find((error) => error.rowNumber === 5)?.message).toContain("deleted client")
    expect(result.snapshot.summary).toMatchObject({ createRows: 1, errorRows: 3 })
  })

  it("refuses a row that has a first name only, in the uploader's language", async () => {
    const rows: Row[] = [{ external_code: "TRP.229", first_name: "Rəna", institution_name: "Mərkəzi Klinika" }]
    const base = { institutions: [CLINIC] }

    const english = await check(rows, base)
    expect(errorsAt(english, 2)).toEqual(["last_name:REQUIRED"])
    expect(english.errors[0].message).toMatch(/^Only a first name is given \(«Rəna»\)\. A client needs a last name\./)
    expect((await check(rows, base, { locale: "ru" })).errors[0].message).toMatch(/^Указано только имя \(«Rəna»\)\. Клиенту нужна фамилия\./)
    expect((await check(rows, base, { locale: "az" })).errors[0].message).toMatch(/^Yalnız ad yazılıb \(«Rəna»\)\. Müştəri üçün soyad lazımdır\./)
  })

  it("takes a dash typed as the last name: the client is listed under the first name, with a warning", async () => {
    // The owner's own answer for surname-less rows of the first real base: load
    // them and correct the card later, rather than leave the doctor out.
    const result = await check([
      { external_code: "TRP.235", last_name: "—", first_name: "Rəna", institution_code: "KL-001" },
      { external_code: "TRP.268", last_name: "-", first_name: "Fidan", middle_name: "Elxan qızı", institution_code: "KL-001" },
      // The same nameless person at the same place is still a repeat.
      { external_code: "TRP.269", last_name: "–", first_name: "Rəna", institution_code: "KL-001" },
    ], { institutions: [CLINIC] })

    expect(dataAt(result, 2)).toMatchObject({ lastName: "—", firstName: "Rəna", displayName: "Rəna" })
    expect(dataAt(result, 3)).toMatchObject({ lastName: "—", displayName: "Fidan Elxan qızı" })
    expect(warningsAt(result, 2)).toEqual(["LAST_NAME_UNKNOWN"])
    expect(errorsAt(result, 4)).toEqual(["last_name:DUPLICATE_PERSON"])
  })

  it("reports the same person at the same institution once more, however the row is typed", async () => {
    const result = await check([
      { external_code: "A1", last_name: "Hüseynov", first_name: "Fərid", institution_code: "KL-001" },
      // Another code, capitals, no diacritics on the surname, the name by its stored spelling.
      { external_code: "A2", last_name: "HUSEYNOV", first_name: "fərid", institution_name: "mərkəzi klinika" },
      // The two name columns swapped.
      { external_code: "A3", last_name: "Fərid", first_name: "Hüseynov", middle_name: "Adil oğlu", institution_code: "KL-001" },
      // Same name at another institution: a different doctor as far as the file can tell.
      { external_code: "A4", last_name: "Hüseynov", first_name: "Fərid", institution_name: "Şimal Poliklinikası" },
      // Same name, same institution, but two different patronymics: two people.
      { external_code: "A5", last_name: "Məmmədova", first_name: "Aysel", middle_name: "Rafiq qızı", institution_code: "KL-001" },
      { external_code: "A6", last_name: "Məmmədova", first_name: "Aysel", middle_name: "Tofiq qızı", institution_code: "KL-001" },
      // Already in the base at this institution under another code.
      { external_code: "A7", last_name: "Cəfərov", first_name: "Nicat", institution_code: "KL-001" },
    ], {
      institutions: [CLINIC],
      contacts: [{ externalCode: "OLD-9", lastName: "Cəfərov", firstName: "Nicat", workplaces: [{ customerId: "inst-clinic" }] }],
    })

    expect(errorsAt(result, 2)).toEqual([])
    expect(errorsAt(result, 3)).toEqual(["last_name:DUPLICATE_PERSON"])
    expect(errorsAt(result, 4)).toEqual(["last_name:DUPLICATE_PERSON"])
    expect(errorsAt(result, 5)).toEqual([])
    expect(errorsAt(result, 6)).toEqual([])
    expect(errorsAt(result, 7)).toEqual([])
    expect(errorsAt(result, 8)).toEqual(["last_name:DUPLICATE_PERSON"])
    expect(result.errors.find((error) => error.rowNumber === 3)?.message).toBe("The same person at the same institution is already on row 2.")
    expect(result.errors.find((error) => error.rowNumber === 8)?.message).toBe("This person already exists at this institution: Cəfərov Nicat.")
  })

  it("reports an unknown institution code, an inactive institution and a name two institutions share", async () => {
    const result = await check([
      { external_code: "B1", last_name: "Quliyev", first_name: "Anar", institution_code: "KL-999", institution_name: "Mərkəzi Klinika" },
      { external_code: "B2", last_name: "Hacıyeva", first_name: "Leyla", institution_name: "Köhnə Xəstəxana" },
      { external_code: "B3", last_name: "Sultanov", first_name: "Elçin", institution_name: "Ailə Həkimi Mərkəzi" },
      { external_code: "B4", last_name: "Bağırova", first_name: "Ülviyyə", institution_code: "AH-2" },
    ], {
      institutions: [
        CLINIC,
        { id: "inst-old", code: null, name: "Köhnə Xəstəxana", status: "INACTIVE" },
        { id: "inst-ah-1", code: "AH-1", name: "Ailə Həkimi Mərkəzi" },
        { id: "inst-ah-2", code: "AH-2", name: "Ailə həkimi mərkəzi" },
      ],
    })

    // A code never creates an institution, even with a name beside it.
    expect(errorsAt(result, 2)).toEqual(["institution_code:REFERENCE_NOT_FOUND"])
    expect(errorsAt(result, 3)).toEqual(["institution_name:INSTITUTION_INACTIVE"])
    expect(errorsAt(result, 4)).toEqual(["institution_name:AMBIGUOUS_REFERENCE"])
    expect(dataAt(result, 5)).toMatchObject({ institutionId: "inst-ah-2", newInstitution: null })
    expect(result.snapshot.summary.createInstitutions).toBe(0)
  })

  it("reports an owner who does not exist, is switched off, is not a field agent, or is outside a manager's team", async () => {
    const rows: Row[] = [
      { external_code: "C1", last_name: "Tağıyev", first_name: "Ramil", agent_code_or_email: "kamran.x" },
      { external_code: "C2", last_name: "Əsgərova", first_name: "Könül", agent_code_or_email: "AG-OFF" },
      { external_code: "C3", last_name: "Novruzov", first_name: "Tahir", agent_code_or_email: "boss@example.com" },
      { external_code: "C4", last_name: "Şirinova", first_name: "Mehriban", agent_code_or_email: "AG-OTHER" },
      { external_code: "C5", last_name: "Babayev", first_name: "Zaur", agent_code_or_email: "AG-07" },
    ]
    const base: Base = {
      agents: [
        FIELD_AGENT,
        { id: "agent-off", name: "Kənan Keçmiş", externalCode: "AG-OFF", status: "INACTIVE" },
        { id: "agent-boss", name: "Rəhbər Nümunə", email: "boss@example.com", role: "MANAGER" },
        { id: "agent-other", name: "Başqa Komanda", externalCode: "AG-OTHER" },
      ],
    }
    const manager: MtmRouteActor = { agentId: "agent-boss", role: "MANAGER", canPlanOwnRoutes: true, canSelfPublishRoutes: true, scopedAgentIds: ["agent-boss", "agent-elvin"] }

    const result = await check(rows, base, { actor: manager })

    expect(errorsAt(result, 2)).toEqual(["agent_code_or_email:REFERENCE_NOT_FOUND"])
    expect(errorsAt(result, 3)).toEqual(["agent_code_or_email:AGENT_NOT_ASSIGNABLE"])
    expect(errorsAt(result, 4)).toEqual(["agent_code_or_email:AGENT_NOT_ASSIGNABLE"])
    expect(errorsAt(result, 5)).toEqual(["agent_code_or_email:OUTSIDE_SCOPE"])
    expect(dataAt(result, 6)).toMatchObject({ agentId: "agent-elvin", agentName: "Elvin Sahə" })
    expect(result.snapshot.summary).toMatchObject({ createRows: 1, errorRows: 4, assignRows: 1 })
    // The administrator sees every team, so the same file loses only that error.
    expect(errorsAt(await check(rows, base), 5)).toEqual([])
  })

  it("refuses the template's own example row, so a template uploaded as downloaded adds nobody", async () => {
    const result = await check([{ external_code: "E1", last_name: "Rüstəmov", first_name: "Vüsal" }], {}, { keepExample: true })

    expect(errorsAt(result, 2)).toEqual(["-:TEMPLATE_EXAMPLE_ROW"])
    expect(result.snapshot.rows.map((row) => row.rowNumber)).toEqual([3])
    expect(result.snapshot.summary.createInstitutions).toBe(0)
  })
})

describe("client import: placeholders and look-alike institutions", () => {
  it("reads placeholder cells as empty, in every column", async () => {
    const result = await check([
      { external_code: "P1", last_name: "Orucov", first_name: "Kamran", institution_name: "Yeni Tibb Mərkəzi", institution_address: "[Адрес ожидает обработки]", institution_city: "Təyin edilməyib", phone: "-", specialty: "TƏYİN EDİLMƏYİB" },
      { external_code: "P2", last_name: "Zeynalova", first_name: "Aidə", institution_name: "Təyin edilməyib", notes: "n/a" },
      { external_code: "P3", last_name: "Təyin edilməyib", first_name: "Solmaz" },
    ], {}, { policy: { specialties: ["Terapevt"] } })

    expect(dataAt(result, 2)).toMatchObject({
      specialtyName: null, phone: null,
      newInstitution: { name: "Yeni Tibb Mərkəzi", address: null, city: null },
    })
    // «Not assigned» is not an institution called that.
    expect(dataAt(result, 3)).toMatchObject({ institutionId: null, newInstitution: null, notes: null })
    expect(warningsAt(result, 3)).toEqual(["NO_INSTITUTION"])
    expect(errorsAt(result, 4)).toEqual(["last_name:REQUIRED"])
    expect(result.snapshot.summary.createInstitutions).toBe(1)
  })

  it("warns when a new institution looks like another spelling in the file or in the base, and still imports", async () => {
    const result = await check([
      { external_code: "N1", last_name: "Əliyeva", first_name: "Xədicə", institution_name: "5 saylı Şəhər Poliklinikası" },
      { external_code: "N2", last_name: "Mustafayev", first_name: "İlqar", institution_name: "5 nömrəli şəhər poliklinikası" },
      { external_code: "N3", last_name: "Rəhimova", first_name: "Zəhra", institution_name: "5 SAYLI ŞƏHƏR POLİKLİNİKASI" },
      { external_code: "N4", last_name: "Qasımov", first_name: "Elşən", institution_name: "7 saylı Şəhər Poliklinikası" },
      { external_code: "N5", last_name: "Vahabova", first_name: "Samirə", institution_name: "Uşaq xəstəxanası 2" },
    ], { institutions: [{ id: "inst-child", code: null, name: "2 nömrəli Uşaq Xəstəxanası" }] })

    expect(result.errors).toEqual([])
    // Case alone is the same institution; «saylı» / «nömrəli» is a warning, not a merge.
    expect(result.snapshot.summary).toMatchObject({ createRows: 5, createInstitutions: 4, warningRows: 3 })
    expect(warningsAt(result, 2)).toEqual(["INSTITUTION_NEAR_DUPLICATE"])
    expect(warningsAt(result, 3)).toEqual(["INSTITUTION_NEAR_DUPLICATE"])
    expect(warningsAt(result, 4)).toEqual([])
    // Another number is another institution, not a look-alike.
    expect(warningsAt(result, 5)).toEqual([])
    expect(warningsAt(result, 6)).toEqual(["INSTITUTION_NEAR_DUPLICATE"])
    expect(result.snapshot.rows.find((row) => row.rowNumber === 6)?.warnings?.[0].message).toContain("«2 nömrəli Uşaq Xəstəxanası»")
  })

  it("says once that a specialty is not on the tenant's list, and keeps it as written", async () => {
    const result = await check([
      { external_code: "S1", last_name: "Kazımov", first_name: "Rəşad", specialty: "Terapvet" },
      { external_code: "S2", last_name: "Əzizova", first_name: "Türkan", specialty: "terapvet" },
      { external_code: "S3", last_name: "Hümbətov", first_name: "Cavid", specialty: "PEDİATR" },
    ], {}, { policy: { specialties: ["Terapevt", "Pediatr"] } })

    expect(result.errors).toEqual([])
    expect(dataAt(result, 2)).toMatchObject({ specialtyName: "Terapvet" })
    expect(dataAt(result, 4)).toMatchObject({ specialtyName: "Pediatr" })
    expect(warningsAt(result, 2)).toEqual(["NO_INSTITUTION", "SPECIALTY_NOT_IN_LIST"])
    expect(warningsAt(result, 3)).toEqual(["NO_INSTITUTION"])
    expect(result.snapshot.rows[0].warnings?.[1].message).toBe("«Terapvet» is not in your specialty list (2 rows). It is saved as written.")
  })
})

describe("client import: the tenant's required fields", () => {
  const rows: Row[] = [
    { external_code: "R1", last_name: "Dadaşov", first_name: "Murad", specialty: "Terapevt", phone: "+994500000002" },
    { external_code: "R2", last_name: "Fətəliyeva", first_name: "Nərmin" },
  ]

  it("applies the same policy as adding one client by hand", async () => {
    const result = await check(rows, {}, { policy: { requiredFields: ["specialtyName", "phone"] } })

    expect(errorsAt(result, 2)).toEqual([])
    expect(errorsAt(result, 3)).toEqual(["specialty:REQUIRED_BY_SETTINGS", "phone:REQUIRED_BY_SETTINGS"])
  })

  it("does not demand a field the tenant has hidden from the card", async () => {
    const result = await check(rows, {}, { policy: { requiredFields: ["specialtyName", "phone"], hiddenFields: ["phone"] } })

    expect(errorsAt(result, 3)).toEqual(["specialty:REQUIRED_BY_SETTINGS"])
  })

  it("says once, at the top, when the tenant requires something the file has no column for", async () => {
    const result = await check(rows, {}, { policy: { requiredFields: ["birthDate", "email"] }, locale: "ru" })

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatchObject({ rowNumber: 1, columnName: null, errorCode: "REQUIRED_FIELD_NOT_IN_TEMPLATE" })
    expect(result.errors[0].message).toContain("Дата рождения, E-mail")
    // The rows are sound, but the file as a whole cannot be applied.
    expect(result.snapshot.summary).toMatchObject({ createRows: 2, errorRows: 1 })
  })
})
