// @vitest-environment jsdom
/**
 * The «Клиенты» filter as the person uses it.
 *
 * Owner 2026-10-02, on the row of fifteen pills that stood on this screen: «он
 * не интуитивен и не юзер френдли», with a screenshot of the filter he wants —
 * a named field per thing you look by — and «чтоб была возможность выбирать
 * несколько специальностей».
 *
 * The real screen is rendered; its requests are answered by the real list and
 * facet handlers over five clients held in memory, filtered by the very
 * `where` the handler builds. So a tick in the specialty list is checked by
 * who is left in the table, not by the shape of a request.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn().mockResolvedValue(null),
  requireAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))
vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})
vi.mock("@/lib/mtm/route-permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mtm/route-permissions")>()
  return { ...actual, resolveMtmRouteActor: vi.fn() }
})
vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>()
  const { default: messages } = await import("../../messages/az.json")
  // One translator per namespace, as next-intl gives: the screen keys its
  // loading effects on `t`, and a fresh function every render refetches for ever.
  const translators = new Map<string, unknown>()
  return {
    ...actual,
    useLocale: () => "az",
    useTranslations: (namespace: string) => {
      if (!translators.has(namespace)) {
        translators.set(namespace, actual.createTranslator({ locale: "az", messages: messages as never, namespace: namespace as never }))
      }
      return translators.get(namespace)
    },
  }
})
const navigation = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn() },
  params: new URLSearchParams(""),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => navigation.router,
  usePathname: () => "/mtm/contacts",
  useSearchParams: () => navigation.params,
}))
vi.mock("@/components/help/help-button", () => ({ HelpButton: () => null }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

import { MtmContactExplorer } from "@/components/mtm/contact-explorer"
import { GET as GET_CONTACTS } from "@/app/api/v1/mtm/contacts/route"
import { GET as GET_FACETS } from "@/app/api/v1/mtm/contacts/facets/route"
import { requireAuth } from "@/lib/api-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { MTM_CONTACT_SPECIALTY_DEFAULTS } from "@/lib/mtm/contact-specialties"
import { prisma } from "@/lib/prisma"
import { matchesPrismaWhere } from "./mocks/prisma-where"

const ORG = "org-1"
const SEYMUR = { id: "agent-seymur", name: "Seymur", role: "AGENT", status: "ACTIVE" }

const clinic = { id: "org-clinic", code: "MK-01", name: "Mərkəzi Klinika", objectType: "CLINIC", category: "A", address: "Nizami küçəsi 76", city: "Bakı", district: "Yasamal", region: null, administrativeDistrict: null, locality: null, cityDistrict: null, organizationKind: null }
const hospital = { id: "org-hospital", code: "RX-02", name: "Respublika Xəstəxanası", objectType: "CLINIC", category: "A", address: "Tbilisi prospekti 12", city: "Bakı", district: "Nəsimi", region: null, administrativeDistrict: null, locality: null, cityDistrict: null, organizationKind: null }

function client(
  id: string,
  displayName: string,
  specialtyName: string | null,
  places: Array<typeof clinic>,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    organizationId: ORG,
    deletedAt: null,
    externalCode: id.toUpperCase(),
    displayName,
    type: "DOCTOR",
    status: "ACTIVE",
    category: "B",
    specialtyCode: null,
    specialtyName,
    qualificationCategory: null,
    profile: null,
    phone: null,
    mobilePhone: null,
    workPhone: null,
    whatsappPhone: null,
    email: null,
    verificationStatus: "UNVERIFIED",
    addressStreet: null,
    addressLocality: null,
    addressDistrict: null,
    addressRegion: null,
    workplaces: places.map((customer, index) => ({
      id: `${id}-wp-${index}`,
      customerId: customer.id,
      isPrimary: index === 0,
      deletedAt: null,
      endedOn: null,
      customer,
    })),
    agentAssignments: [] as unknown[],
    dictionaryAssignments: [],
    visits: [],
    routePoints: [],
    ...extra,
  }
}

const CLIENTS = [
  client("d-001", "Aysel Məmmədova", "Pediatr", [clinic]),
  client("d-002", "Rəşad Əliyev", "Kardioloq", [clinic, hospital], {
    agentAssignments: [{ agentId: SEYMUR.id, role: "PRIMARY", deletedAt: null, effectiveFrom: new Date("2026-01-01"), effectiveTo: null, agent: SEYMUR }],
  }),
  client("d-003", "Nigar Hüseynova", "Kardioloq", [hospital]),
  // Saved before the list existed, with a specialty the list does not have.
  client("d-004", "Elvin Quliyev", "Cardiology", [hospital]),
  client("d-005", "Lalə Səfərova", "Lor", [clinic], { status: "INACTIVE" }),
]

let container: HTMLDivElement
let root: Root

async function settle(ms = 0) {
  for (let turn = 0; turn < 6; turn += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, turn === 0 ? ms : 0)) })
  }
}

/** Names in the desktop table (the phone cards repeat the same rows). */
const listed = () => [...container.querySelectorAll("tbody tr td:nth-child(2) a")].map((link) => link.textContent?.trim())
const field = (testId: string) => container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
const labels = () => [...container.querySelectorAll('[data-testid="mtm-contact-filters"] label')].map((label) => label.textContent?.trim())

async function click(element: Element | null | undefined) {
  if (!(element instanceof HTMLElement)) throw new Error("element not found")
  await act(async () => { element.click() })
  await settle()
}

async function typeInto(testId: string, value: string) {
  const input = field(testId)
  if (!(input instanceof HTMLInputElement)) throw new Error(`input ${testId} not found`)
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
  // The field applies after a pause in typing.
  await settle(400)
}

async function choose(testId: string, value: string) {
  const select = field(testId)
  if (!(select instanceof HTMLSelectElement)) throw new Error(`select ${testId} not found`)
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!
  await act(async () => {
    setter.call(select, value)
    select.dispatchEvent(new Event("change", { bubbles: true }))
  })
  await settle()
}

/** The checklist opens in a portal, outside the screen's own container. */
const specialtyChoices = () => [...document.body.querySelectorAll<HTMLInputElement>('input[type="checkbox"][value]')]
  .filter((input) => !container.contains(input))
async function tickSpecialty(name: string) {
  const box = specialtyChoices().find((input) => input.value === name)
  if (!box) throw new Error(`specialty «${name}» is not offered`)
  await click(box)
}

beforeEach(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
  vi.mocked(requireAuth).mockResolvedValue({ orgId: ORG, userId: "admin-user", role: "admin", email: "admin@example.com", name: "Admin" } as never)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: null, role: "ADMIN", scopedAgentIds: null } as never)
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([SEYMUR] as never)
  vi.mocked(prisma.mtmCustomer.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmContactDictionary.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmCoveragePolicy.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmCoveragePolicy.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmCoverageSnapshot.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmCoverageSnapshot.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmCoverageSnapshotRow.findMany).mockResolvedValue([])

  // One in-memory table behind the list, its count and the facet dictionaries.
  vi.mocked(prisma.mtmContact.findMany).mockImplementation((async (args: { where: Record<string, unknown>; distinct?: string[] }) => {
    const rows = CLIENTS.filter((row) => matchesPrismaWhere(row, args.where))
    // The list is ordered by name, as the handler asks.
    if (!args.distinct) return [...rows].sort((left, right) => left.displayName.localeCompare(right.displayName, "az"))
    const column = args.distinct[0] as keyof (typeof CLIENTS)[number]
    return [...new Map(rows.map((row) => [row[column], row])).values()]
  }) as never)
  vi.mocked(prisma.mtmContact.count).mockImplementation((async (args: { where: Record<string, unknown> }) => (
    CLIENTS.filter((row) => matchesPrismaWhere(row, args.where)).length
  )) as never)

  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, "http://localhost:3000")
    const request = new NextRequest(url, init as never)
    if (url.pathname === "/api/v1/mtm/contacts") return GET_CONTACTS(request)
    if (url.pathname === "/api/v1/mtm/contacts/facets") return GET_FACETS(request)
    if (url.pathname === "/api/v1/mtm/contacts/views") return Response.json({ success: true, data: { views: [] } })
    throw new Error(`unexpected request: ${url.pathname}`)
  }))

  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(createElement(MtmContactExplorer)) })
  await settle()
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
})

describe("«Müştərilər»: the filter as named fields", () => {
  it("opens with eight named fields and the active clients, not a row of fifteen pills", () => {
    expect(labels()).toEqual([
      "Məsul əməkdaş",
      "İxtisas",
      "Müştəri adı",
      "Ünvan",
      "Şəhər və ya rayon",
      "Müəssisə",
      "Kontakt növü",
      "Status",
    ])
    expect(listed()).toEqual(["Aysel Məmmədova", "Elvin Quliyev", "Nigar Hüseynova", "Rəşad Əliyev"])
    expect(container.textContent).toContain("Tapıldı: 4")
    // «Sıfırla» is offered only once something is set.
    expect(field("mtm-contact-clear-filters")).toBeNull()
  })

  it("lets several specialties be ticked, and lists the clients of any of them", async () => {
    await click(field("mtm-contact-specialties"))
    // The tenant's list, then what clients carry beyond it.
    expect(specialtyChoices().map((input) => input.value)).toEqual([...MTM_CONTACT_SPECIALTY_DEFAULTS, "Cardiology"])

    await tickSpecialty("Pediatr")
    expect(listed()).toEqual(["Aysel Məmmədova"])

    await tickSpecialty("Kardioloq")
    expect(listed()).toEqual(["Aysel Məmmədova", "Nigar Hüseynova", "Rəşad Əliyev"])
    expect(field("mtm-contact-specialties")?.textContent).toContain("Pediatr, Kardioloq")
    expect(container.textContent).toContain("Tapıldı: 3")
    // The choice is in the address bar, so the list can be reopened or shared.
    expect(navigation.router.replace).toHaveBeenLastCalledWith(
      expect.stringContaining("specialty=Pediatr&specialty=Kardioloq"),
      { scroll: false },
    )

    await tickSpecialty("Pediatr")
    expect(listed()).toEqual(["Nigar Hüseynova", "Rəşad Əliyev"])
  })

  it("narrows by what is typed into a field, and the fields narrow together", async () => {
    await typeInto("mtm-contact-workplace", "xəstəxana")
    expect(listed()).toEqual(["Elvin Quliyev", "Nigar Hüseynova", "Rəşad Əliyev"])

    await typeInto("mtm-contact-name", "Əliyev Rəşad")
    expect(listed()).toEqual(["Rəşad Əliyev"])

    // He works in the hospital in Nəsimi and in the clinic in Yasamal: the
    // hospital is not in Yasamal, so the three fields together find nobody.
    await typeInto("mtm-contact-area", "Yasamal")
    expect(listed()).toEqual([])
    expect(container.textContent).toContain("Tapıldı: 0")

    await click(field("mtm-contact-clear-filters"))
    expect(listed()).toHaveLength(4)
    expect((field("mtm-contact-workplace") as HTMLInputElement).value).toBe("")
  })

  it("finds by address and by the employee the client is assigned to", async () => {
    await typeInto("mtm-contact-address", "Nizami 76")
    expect(listed()).toEqual(["Aysel Məmmədova", "Rəşad Əliyev"])

    await choose("mtm-contact-owner", SEYMUR.id)
    expect(listed()).toEqual(["Rəşad Əliyev"])
  })

  it("shows inactive clients when the status field says so", async () => {
    await choose("mtm-contact-status", "INACTIVE")
    expect(listed()).toEqual(["Lalə Səfərova"])
    await choose("mtm-contact-status", "")
    expect(listed()).toHaveLength(5)
  })

  it("keeps the rarer filters behind «Daha çox filtr», without dropdowns that have nothing to choose", async () => {
    expect(field("mtm-contact-category")).toBeNull()
    await click(field("mtm-contact-more-filters"))
    expect(field("mtm-contact-category")).not.toBeNull()
    expect(field("mtm-contact-assignment-state")).not.toBeNull()
    expect(field("mtm-contact-search")).not.toBeNull()
    expect(field("mtm-contact-coverage-period")).not.toBeNull()
    // Nobody in this tenant has a region, a profile or an institution kind.
    for (const empty of ["region", "administrativeDistrict", "locality", "cityDistrict", "organizationKind", "profile", "qualificationCategory"]) {
      expect(field(`mtm-contact-${empty}`)).toBeNull()
    }

    // The one box over every field still works for those who used it.
    await typeInto("mtm-contact-search", "Tbilisi")
    expect(listed()).toEqual(["Elvin Quliyev", "Nigar Hüseynova", "Rəşad Əliyev"])
  })
})
