// @vitest-environment jsdom

/**
 * The organization card shows the organization's contact data.
 *
 * Its "Details" tab was built against a pharma master-data reference, and for
 * an organization a manager typed in by hand it printed Etalon ID, OKPO,
 * licence, attribute source, region, territory, polygon, a coordinate-quality
 * block and a shipments block — every one of them a dash or "not connected
 * yet" — while the phone and the contact person the manager had entered were
 * not on the tab at all. Owner, 2026-10-02: "too many extra options here, only
 * the organization's contact data is needed".
 *
 * The first organization below has the shape of that production row (no code,
 * no reference attributes, no shipments, no coordinate receipt). The last one
 * has everything, so the cleanup cannot quietly take master data away from a
 * tenant that imports it.
 *
 * Same day, same card: departments, pharmacy promotions and files came off the
 * tab bar — no tenant on production had a row in any of them. What stays is
 * what a field visit to a pharmacy uses: details, the people there, visits and
 * the agents assigned to it.
 */
import { readFileSync } from "node:fs"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const messages = JSON.parse(readFileSync("messages/en.json", "utf8")) as Record<string, unknown>

// Answers with the key, but only for a key that exists under the namespace the
// component asked for: a label that would print as "mtmCustomers.detail.x" on
// the page fails here instead. One function per namespace, as next-intl hands
// out: the card's loaders depend on `t`, and a fresh one per render refetches
// for ever.
const translators = new Map<string, (key: string) => string>()
function translator(namespace: string) {
  const known = translators.get(namespace)
  if (known) return known
  const translate = (key: string) => {
    const value = `${namespace}.${key}`.split(".").reduce<unknown>(
      (node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined),
      messages,
    )
    if (typeof value !== "string") throw new Error(`missing message ${namespace}.${key}`)
    return key
  }
  translators.set(namespace, translate)
  return translate
}

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => translator(namespace),
  useLocale: () => "en",
}))
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }))
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: unknown }) => createElement("a", { href }, children as never),
}))
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { organizationId: "org-1", role: "admin" } } }),
}))
const orgSwitches = vi.hoisted(() => ({ fieldContacts: true }))
vi.mock("@/hooks/use-mtm-org-settings", () => ({
  useMtmFieldContacts: () => ({ enabled: orgSwitches.fieldContacts, ready: true }),
}))
vi.mock("@/components/mtm/customer-form", () => ({ MtmCustomerForm: () => null }))
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { MtmOrganizationDetail } from "@/components/mtm/organization-detail"
import { organizationReferenceRows } from "@/lib/mtm/organization-card"

const handTyped = {
  id: "customer-1",
  code: null,
  name: "Aptek 1",
  objectType: "STORE",
  category: "B",
  status: "ACTIVE",
  address: "Nizami küçəsi 1",
  region: null,
  administrativeDistrict: null,
  locality: null,
  cityDistrict: null,
  city: "Bakı",
  district: "Yasamal",
  specialization: null,
  organizationKind: null,
  territoryCode: null,
  polygon: null,
  latitude: 40.3777,
  longitude: 49.892,
  phone: null,
  contactPerson: null,
  notes: null,
  geofenceRadius: 100,
  createdAt: "2026-10-02T08:00:00.000Z",
  updatedAt: "2026-10-02T08:00:00.000Z",
  managingManager: null,
  agentAssignments: [],
  _count: { contactWorkplaces: 0, visits: 0 },
  attributeFacts: [],
}

const noShipments = { month: "2026-10", year: "2026", monthTotals: [], yearTotals: [], latestSource: null }

let container: HTMLDivElement
let root: Root

async function renderCard(data: { organization: unknown; commercial?: unknown; coordinateVerification?: unknown }) {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({
      success: true,
      data: {
        asOf: "2026-10-02T08:00:00.000Z",
        timezone: "Asia/Baku",
        capabilities: { canManage: true, canRequestChanges: false },
        commercial: noShipments,
        coordinateVerification: null,
        ...data,
      },
    }),
  })))
  await act(async () => {
    root.render(createElement(MtmOrganizationDetail, { organizationId: "customer-1" }))
  })
  return container.textContent ?? ""
}

function rowValue(label: string): string | null {
  const term = [...container.querySelectorAll("dt")].find((node) => node.textContent === label)
  return term?.nextElementSibling?.textContent ?? null
}

function tabs(): string[] {
  return [...container.querySelectorAll('[role="tab"]')].map((node) => node.textContent ?? "")
}

beforeEach(() => {
  orgSwitches.fieldContacts = true
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe("organization card, Details tab", () => {
  it("shows a hand-typed organization as contact data and nothing else", async () => {
    const text = await renderCard({ organization: handTyped })

    expect(text).toContain("detail.contactDetails")
    expect([...container.querySelectorAll("dt")].map((node) => node.textContent)).toEqual([
      "detail.contactPerson",
      "detail.phone",
      "detail.address",
      "detail.locality",
      "detail.cityDistrict",
    ])
    expect(rowValue("detail.address")).toBe("Nizami küçəsi 1")
    expect(rowValue("detail.locality")).toBe("Bakı")
    expect(rowValue("detail.cityDistrict")).toBe("Yasamal")

    const leftovers = [
      "detail.etalonId", "detail.okpo", "detail.notModeled", "detail.license", "detail.noSignedAttribute",
      "detail.attributeSource", "detail.region", "detail.territory", "detail.polygon", "detail.polygonMissing",
      "detail.additionalDetails", "detail.coordinateQuality", "detail.confirmCoordinates",
      "detail.commercialTitle", "detail.noSource",
    ].filter((label) => text.includes(label))
    expect(leftovers).toEqual([])
  })

  it("puts the phone and the contact person the manager entered on the tab", async () => {
    await renderCard({
      organization: { ...handTyped, code: "A-17", phone: "+994501112233", contactPerson: "Leyla Əliyeva", notes: "Giriş həyətdən" },
    })

    expect(rowValue("detail.contactPerson")).toBe("Leyla Əliyeva")
    expect(rowValue("detail.phone")).toBe("+994501112233")
    expect(container.querySelector('dd a[href="tel:+994501112233"]')).not.toBeNull()
    expect(rowValue("detail.notes")).toBe("Giriş həyətdən")
    // The code a tenant did enter stays in the header strip.
    expect(container.textContent).toContain("A-17")
  })

  it("keeps master data, the coordinate receipt and shipments where an organization has them", async () => {
    const text = await renderCard({
      organization: {
        ...handTyped,
        code: "3799",
        specialization: "Kardiologiya",
        region: "Abşeron",
        administrativeDistrict: "Xırdalan",
        territoryCode: "T-04",
        polygon: { type: "Polygon", coordinates: [] },
        attributeFacts: [{
          medicalCategoryCode: "A1",
          medicalCategoryLabels: null,
          licenseStatus: "ACTIVE",
          licenseLabels: null,
          polygonCode: null,
          polygonLabels: null,
          package: { version: 3, sourceSystem: "Etalon", sourceReference: null, sourceObservedAt: "2026-09-01T00:00:00.000Z", effectiveFrom: "2026-09-01T00:00:00.000Z" },
        }],
      },
      commercial: {
        ...noShipments,
        yearTotals: [{ currency: "AZN", amount: "1250.5" }],
        latestSource: { externalDocumentNo: "INV-88", documentDate: "2026-09-12T00:00:00.000Z", status: "POSTED", currency: "AZN", updatedAt: "2026-09-13T00:00:00.000Z", sourceImportJob: null },
      },
      coordinateVerification: {
        id: "receipt-1", latitude: 40.3777, longitude: 49.892, status: "VERIFIED", accuracyMeters: 12,
        sourceSystem: "Field audit", sourceReference: null, sourceObservedAt: "2026-09-20T00:00:00.000Z",
        decisionReason: null, verifiedAt: "2026-09-20T10:00:00.000Z",
      },
    })

    expect(text).toContain("detail.additionalDetails")
    expect(rowValue("detail.specialization")).toBe("Kardiologiya")
    expect(rowValue("detail.category")).toBe("A1")
    expect(rowValue("detail.license")).toBe("ACTIVE")
    expect(rowValue("detail.attributeSource")).toBe("Etalon · v3")
    expect(rowValue("detail.region")).toBe("Abşeron")
    expect(rowValue("detail.administrativeDistrict")).toBe("Xırdalan")
    expect(rowValue("detail.territory")).toBe("T-04")
    expect(rowValue("detail.polygon")).toBe("detail.polygonConfigured")
    expect(text).toContain("detail.coordinateQuality")
    expect(rowValue("detail.coordinateSource")).toBe("Field audit")
    expect(text).toContain("detail.commercialTitle")
    expect(rowValue("detail.latestCommercialDocument")).toBe("INV-88")
  })
})

describe("organization card, tab bar", () => {
  it("offers details, contacts, visits and staff — and nothing else", async () => {
    await renderCard({ organization: handTyped })
    expect(tabs()).toEqual(["detail.tabs.details", "detail.tabs.contacts", "detail.tabs.visits", "detail.tabs.staff"])
  })

  it("still drops contacts for a tenant that switched field contacts off", async () => {
    orgSwitches.fieldContacts = false
    const text = await renderCard({ organization: handTyped })
    expect(tabs()).toEqual(["detail.tabs.details", "detail.tabs.visits", "detail.tabs.staff"])
    expect(text).not.toContain("detail.contacts")
  })
})

describe("organizationReferenceRows", () => {
  it("does not count a blank string as an attribute", () => {
    expect(organizationReferenceRows({
      specialization: "  ", region: "", administrativeDistrict: null, territoryCode: null, polygon: null, attributeFacts: [],
    })).toEqual([])
  })
})
