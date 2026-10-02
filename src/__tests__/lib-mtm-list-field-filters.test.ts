import { describe, expect, it } from "vitest"
import {
  contactFieldFilters,
  listFilterWords,
  MTM_LIST_FILTER_WORD_LIMIT,
  organizationAddressFilter,
  organizationAreaFilter,
  organizationNameFilter,
  type ContactFieldFilterInput,
} from "@/lib/mtm/list-field-filters"
import { matchesPrismaWhere } from "./mocks/prisma-where"

/**
 * The typed fields of the «Клиенты» and «Учреждения» filters, checked by what
 * they find in a small set of clients rather than by the query they build.
 */
const clinic = { name: "Mərkəzi Klinika", code: "MK-01", address: "Nizami küçəsi 76", city: "Bakı", district: "Yasamal", region: null, administrativeDistrict: null, locality: null, cityDistrict: null }
const hospital = { name: "Respublika Xəstəxanası", code: "RX-02", address: "Tbilisi prospekti 12", city: "Bakı", district: "Nəsimi", region: null, administrativeDistrict: null, locality: null, cityDistrict: null }
const pharmacy = { name: "Zeytun Aptek", code: "ZA-07", address: "Atatürk 5", city: "Gəncə", district: "Kəpəz", region: "Gəncə-Qazax", administrativeDistrict: null, locality: null, cityDistrict: null }

const workplace = (customer: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  customerId: String(customer.code), deletedAt: null, endedOn: null, customer, ...extra,
})
const own = { addressStreet: null, addressLocality: null, addressDistrict: null, addressRegion: null }

const clients = [
  { ...own, displayName: "Aysel Məmmədova", externalCode: "D-001", specialtyName: "Pediatr", specialtyCode: null, workplaces: [workplace(clinic)] },
  { ...own, displayName: "Rəşad Əliyev", externalCode: "D-002", specialtyName: "Kardioloq", specialtyCode: "CARD", workplaces: [workplace(clinic), workplace(hospital)] },
  { ...own, displayName: "Nigar Hüseynova", externalCode: "D-003", specialtyName: "kardioloq", specialtyCode: null, workplaces: [workplace(hospital)] },
  { ...own, displayName: "Elvin Quliyev", externalCode: "P-004", specialtyName: null, specialtyCode: null, workplaces: [workplace(pharmacy)] },
  // Left the clinic last year; kept with a home address and no institution.
  { ...own, addressStreet: "Nizami küçəsi 10", addressDistrict: "Yasamal", displayName: "Lalə Səfərova", externalCode: "D-005", specialtyName: "Lor", specialtyCode: null, workplaces: [workplace(clinic, { endedOn: new Date("2025-12-31") })] },
]

function found(input: ContactFieldFilterInput): string[] {
  const where = { AND: contactFieldFilters(input) }
  return clients.filter((client) => matchesPrismaWhere(client, where)).map((client) => client.displayName)
}

describe("the typed fields of the client filter", () => {
  it("finds nothing extra when no field is filled", () => {
    expect(contactFieldFilters({})).toEqual([])
    expect(found({})).toHaveLength(clients.length)
  })

  it("finds clients of ANY of the chosen specialties, whatever case they were saved in", () => {
    expect(found({ specialties: ["Pediatr"] })).toEqual(["Aysel Məmmədova"])
    expect(found({ specialties: ["Pediatr", "Kardioloq"] }))
      .toEqual(["Aysel Məmmədova", "Rəşad Əliyev", "Nigar Hüseynova"])
    expect(found({ specialties: ["Lor", "Stomatoloq"] })).toEqual(["Lalə Səfərova"])
  })

  it("still finds by the specialty code a link made before could carry", () => {
    expect(found({ specialties: ["CARD"] })).toEqual(["Rəşad Əliyev"])
  })

  it("finds a name by its words in any order, and by the client's code", () => {
    expect(found({ name: "Məmmədova Aysel" })).toEqual(["Aysel Məmmədova"])
    expect(found({ name: "ova" })).toEqual(["Aysel Məmmədova", "Nigar Hüseynova", "Lalə Səfərova"])
    expect(found({ name: "P-004" })).toEqual(["Elvin Quliyev"])
    expect(found({ name: "Aysel Əliyev" })).toEqual([])
  })

  it("finds by the institution's name or code — current workplaces only", () => {
    expect(found({ workplace: "klinika" })).toEqual(["Aysel Məmmədova", "Rəşad Əliyev"])
    expect(found({ workplace: "RX-02" })).toEqual(["Rəşad Əliyev", "Nigar Hüseynova"])
  })

  it("finds by address typed with the district, and by a home address when no institution is asked", () => {
    expect(found({ address: "Nizami 76" })).toEqual(["Aysel Məmmədova", "Rəşad Əliyev"])
    expect(found({ address: "Nizami, Yasamal" })).toEqual(["Aysel Məmmədova", "Rəşad Əliyev", "Lalə Səfərova"])
    expect(found({ address: "Nizami", workplace: "klinika" })).toEqual(["Aysel Məmmədova", "Rəşad Əliyev"])
  })

  it("finds by city or district, including the imported geography columns", () => {
    expect(found({ area: "yasamal" })).toEqual(["Aysel Məmmədova", "Rəşad Əliyev", "Lalə Səfərova"])
    expect(found({ area: "Gəncə" })).toEqual(["Elvin Quliyev"])
    expect(found({ area: "Qazax" })).toEqual(["Elvin Quliyev"])
  })

  it("asks institution, address and district of ONE workplace, not of any two", () => {
    // Rəşad works in the clinic (Yasamal) and the hospital (Nəsimi).
    expect(found({ workplace: "Xəstəxana", area: "Nəsimi" })).toEqual(["Rəşad Əliyev", "Nigar Hüseynova"])
    expect(found({ workplace: "Xəstəxana", area: "Yasamal" })).toEqual([])
    expect(found({ workplaceCustomer: { city: "Bakı" }, area: "Nəsimi", workplace: "klinika" })).toEqual([])
  })

  it("narrows by every filled field together", () => {
    expect(found({ specialties: ["Kardioloq", "Pediatr"], area: "Yasamal", name: "Rəşad" })).toEqual(["Rəşad Əliyev"])
  })
})

describe("the typed fields of the institution filter", () => {
  const institutions = [clinic, hospital, pharmacy]
  const names = (and: object[]) => institutions.filter((row) => matchesPrismaWhere(row, { AND: and })).map((row) => row.name)

  it("finds by name or code, by address with its city, and by city or district", () => {
    expect(names(organizationNameFilter("xəstəxana"))).toEqual(["Respublika Xəstəxanası"])
    expect(names(organizationNameFilter("ZA-07"))).toEqual(["Zeytun Aptek"])
    expect(names(organizationAddressFilter("Bakı Tbilisi"))).toEqual(["Respublika Xəstəxanası"])
    expect(names(organizationAreaFilter("Bakı"))).toEqual(["Mərkəzi Klinika", "Respublika Xəstəxanası"])
    expect(names([...organizationAreaFilter("Bakı"), ...organizationNameFilter("klinika")])).toEqual(["Mərkəzi Klinika"])
  })
})

describe("words of a typed filter", () => {
  it("splits on spaces and commas, drops repeats, and is bounded", () => {
    expect(listFilterWords("  Nizami,  76 ; Nizami ")).toEqual(["Nizami", "76"])
    expect(listFilterWords(null)).toEqual([])
    expect(listFilterWords("a b c d e f g h i")).toHaveLength(MTM_LIST_FILTER_WORD_LIMIT)
  })
})
