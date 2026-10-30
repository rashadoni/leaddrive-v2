// @vitest-environment jsdom
/**
 * The «Клиенты» filter as the person uses it.
 *
 * Owner 2026-10-16, from a picture: the page opens on one search and the
 * chips («Все», «Без визита за октябрь», «Не запланированы») with how many
 * each holds; the named fields below are one click away under «Ещё фильтры».
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
import { mtmClientVisitMonth } from "@/lib/mtm/client-list-quick"
import { currentDateKey } from "@/lib/mtm/mobile-week"
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

// The month the list's «без визита за…» is about, as the server counts it.
const TODAY = new Date(`${currentDateKey(new Date(), "Asia/Baku")}T00:00:00.000Z`)
const MONTH = mtmClientVisitMonth(TODAY)
const inMonth = new Date(MONTH.start.getTime() + 12 * 3_600_000)
const lastMonth = new Date(MONTH.start.getTime() - 3 * 86_400_000)

const CLIENTS = [
  client("d-001", "Aysel Məmmədova", "Pediatr", [clinic], {
    // Seen, but last month: still «без визита» this month.
    visits: [{ id: "v-old", organizationId: ORG, deletedAt: null, status: "CHECKED_OUT", checkInAt: lastMonth, checkOutAt: lastMonth, outcome: null, agent: { id: SEYMUR.id, name: "Seymur Məmmədov" } }],
  }),
  client("d-002", "Rəşad Əliyev", "Kardioloq", [clinic, hospital], {
    agentAssignments: [{ agentId: SEYMUR.id, role: "PRIMARY", deletedAt: null, effectiveFrom: new Date("2026-01-01"), effectiveTo: null, agent: SEYMUR }],
    visits: [{ id: "v-now", organizationId: ORG, deletedAt: null, status: "CHECKED_OUT", checkInAt: inMonth, checkOutAt: inMonth, outcome: null, agent: { id: SEYMUR.id, name: "Seymur Məmmədov" } }],
  }),
  client("d-003", "Nigar Hüseynova", "Kardioloq", [hospital], {
    category: "A",
    // On tomorrow's planned route.
    routePoints: [{ id: "p-1", routeId: "route-1", plannedTime: null, orderIndex: 0, deletedAt: null, status: "PENDING", route: { organizationId: ORG, deletedAt: null, status: "PLANNED", date: new Date(TODAY.getTime() + 86_400_000) } }],
  }),
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
/** The named fields' labels (the search box on the page is not one of them). */
const labels = () => [...container.querySelectorAll('[data-testid="mtm-contact-filters"] label')]
  .filter((label) => !label.querySelector('[data-testid="mtm-contact-search"]'))
  .map((label) => label.textContent?.trim())
const chips = () => [...container.querySelectorAll('[data-testid="mtm-contact-toolbar"] button[aria-pressed]')]
  .map((chip) => `${chip.textContent?.trim()}${chip.getAttribute("aria-pressed") === "true" ? " ✓" : ""}`)

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

/** The named fields are under «Daha çox filtr» on the Clients page. */
async function openFields() {
  if (field("mtm-contact-more-filters")?.getAttribute("aria-expanded") !== "true") await click(field("mtm-contact-more-filters"))
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
  vi.mocked(prisma.mtmContact.findMany).mockImplementation((async (args: {
    where: Record<string, unknown>
    distinct?: string[]
    include?: { agentAssignments?: { include?: { agent?: { select?: Record<string, boolean> } } } }
  }) => {
    const rows = CLIENTS.filter((row) => matchesPrismaWhere(row, args.where))
    // Prisma hands back only the employee columns the handler selects. A
    // stand-in that returns the whole employee hides a column the handler
    // forgot — that is how «deaktiv» stood under every working employee.
    const agentColumns = args.include?.agentAssignments?.include?.agent?.select
    const asSelected = (row: (typeof CLIENTS)[number]) => !agentColumns ? row : {
      ...row,
      agentAssignments: (row.agentAssignments as Array<{ agent: Record<string, unknown> }>).map((assignment) => ({
        ...assignment,
        agent: Object.fromEntries(Object.entries(assignment.agent).filter(([column]) => agentColumns[column])),
      })),
    }
    // The list is ordered by name, as the handler asks.
    if (!args.distinct) return [...rows].sort((left, right) => left.displayName.localeCompare(right.displayName, "az")).map(asSelected)
    const column = args.distinct[0] as keyof (typeof CLIENTS)[number]
    return [...new Map(rows.map((row) => [row[column], row])).values()]
  }) as never)
  vi.mocked(prisma.mtmContact.count).mockImplementation((async (args: { where: Record<string, unknown> }) => (
    CLIENTS.filter((row) => matchesPrismaWhere(row, args.where)).length
  )) as never)
  // The class line's counts, from the same table and the same `where`.
  vi.mocked(prisma.mtmContact.groupBy).mockImplementation((async (args: { where: Record<string, unknown> }) => {
    const counts = new Map<string, number>()
    for (const row of CLIENTS.filter((row) => matchesPrismaWhere(row, args.where))) counts.set(row.category, (counts.get(row.category) ?? 0) + 1)
    return [...counts].map(([category, all]) => ({ category, _count: { _all: all } }))
  }) as never)

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
  it("opens on the search, the chips and the active clients; the eight named fields are under «Daha çox filtr»", async () => {
    expect(field("mtm-contact-search")).not.toBeNull()
    expect(labels()).toEqual([])
    expect(listed()).toEqual(["Aysel Məmmədova", "Elvin Quliyev", "Nigar Hüseynova", "Rəşad Əliyev"])
    expect(container.textContent).toContain("Tapıldı: 4")
    // «Sıfırla» is offered only once something is set.
    expect(field("mtm-contact-clear-filters")).toBeNull()

    await openFields()
    expect(labels().slice(0, 8)).toEqual([
      "Məsul əməkdaş",
      "İxtisas",
      "Müştəri adı",
      "Ünvan",
      "Şəhər və ya rayon",
      "Müəssisə",
      "Kontakt növü",
      "Status",
    ])
  })

  it("lets several specialties be ticked, and lists the clients of any of them", async () => {
    await openFields()
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
    await openFields()
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
    await openFields()
    expect((field("mtm-contact-workplace") as HTMLInputElement).value).toBe("")
  })

  it("finds by address and by the employee the client is assigned to", async () => {
    await openFields()
    await typeInto("mtm-contact-address", "Nizami 76")
    expect(listed()).toEqual(["Aysel Məmmədova", "Rəşad Əliyev"])

    await choose("mtm-contact-owner", SEYMUR.id)
    expect(listed()).toEqual(["Rəşad Əliyev"])
  })

  // Prod, 2026-10-04, Zeytun Pharma: «deaktiv» under the employee's name in
  // every one of 321 rows, while the employee was working.
  it("marks the responsible employee inactive only when they are", async () => {
    const employeeOf = (id: string) => field(`mtm-contact-owner-${id}`)?.textContent
    expect(employeeOf("d-002")).toBe(SEYMUR.name)

    SEYMUR.status = "INACTIVE"
    try {
      await openFields()
      await choose("mtm-contact-assignment-state", "ASSIGNED")
      expect(employeeOf("d-002")).toBe(`${SEYMUR.name}deaktiv`)
    } finally {
      SEYMUR.status = "ACTIVE"
    }
  })

  it("shows inactive clients when the status field says so", async () => {
    await openFields()
    await choose("mtm-contact-status", "INACTIVE")
    expect(listed()).toEqual(["Lalə Səfərova"])
    await choose("mtm-contact-status", "")
    expect(listed()).toHaveLength(5)
  })

  it("keeps the rarer filters behind «Daha çox filtr», without dropdowns that have nothing to choose", async () => {
    await openFields()
    // The class is not among them: it has a line of its own on the page.
    expect(field("mtm-contact-category")).toBeNull()
    expect(field("mtm-contact-assignment-state")).not.toBeNull()
    expect(field("mtm-contact-coverage-period")).not.toBeNull()
    // Nobody in this tenant has a region, a profile or an institution kind.
    for (const empty of ["region", "administrativeDistrict", "locality", "cityDistrict", "organizationKind", "profile", "qualificationCategory"]) {
      expect(field(`mtm-contact-${empty}`)).toBeNull()
    }

    // The one box over every field, on the page itself.
    await typeInto("mtm-contact-search", "Tbilisi")
    expect(listed()).toEqual(["Elvin Quliyev", "Nigar Hüseynova", "Rəşad Əliyev"])
  })

  it("drops the fields a tenant switched off: no specialty filter, no specialty in the rows", async () => {
    // Column names; the first cell is the «select page» checkbox.
    const headers = () => [...container.querySelectorAll("thead th")].slice(1).map((cell) => cell.textContent?.trim())
    expect(headers()).toEqual(["Kontakt", "Kateqoriya", "İş yeri", "Son ziyarət", "Növbəti ziyarət", "Məsul əməkdaş", "Əməliyyatlar"])
    expect(container.querySelector("tbody")?.textContent).toContain("Pediatr")

    // A tenant that does not visit doctors, reopening the same screen.
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([
      { key: "contactHiddenFields", value: ["specialtyName", "specialtyCode", "qualificationCategory", "profile", "coverage"] },
    ] as never)
    await act(async () => { root.unmount() })
    root = createRoot(container)
    await act(async () => { root.render(createElement(MtmContactExplorer)) })
    await settle()

    await openFields()
    expect(labels().slice(0, 7)).toEqual(["Məsul əməkdaş", "Müştəri adı", "Ünvan", "Şəhər və ya rayon", "Müəssisə", "Kontakt növü", "Status"])
    expect(field("mtm-contact-specialties")).toBeNull()
    expect(headers()).toEqual(["Kontakt", "Kateqoriya", "İş yeri", "Son ziyarət", "Növbəti ziyarət", "Məsul əməkdaş", "Əməliyyatlar"])
    expect(container.querySelector("tbody")?.textContent).not.toContain("Pediatr")
    expect(field("mtm-contact-coverage-period")).toBeNull()
    // The clients themselves are all still there.
    expect(listed()).toHaveLength(4)
  })
})

describe("«Müştərilər»: the chips over the list", () => {
  const month = new Intl.DateTimeFormat("az", { month: "long", timeZone: "UTC" })

  it("says how many each chip holds, and a chip narrows the list to what it says", async () => {
    // Four active clients; Rəşad was seen this month; Nigar is on tomorrow's route.
    expect(chips()).toEqual([
      "Hamısı4 ✓",
      expect.stringMatching(/ayında gəlinməyənlər3$/),
      "Planlaşdırılmayıb3",
      "Məsul əməkdaşı yoxdur3",
    ])
    expect(chips()[1]).toContain(month.format(MONTH.start).slice(0, 3))

    await click(field("mtm-contact-quick-not-visited"))
    // Aysel was seen last month: that is not this month.
    expect(listed()).toEqual(["Aysel Məmmədova", "Elvin Quliyev", "Nigar Hüseynova"])
    expect(container.textContent).toContain("Tapıldı: 3")
    expect(navigation.router.replace).toHaveBeenLastCalledWith(expect.stringContaining("quick=NOT_VISITED"), { scroll: false })

    await click(field("mtm-contact-quick-not-planned"))
    expect(listed()).toEqual(["Aysel Məmmədova", "Elvin Quliyev", "Rəşad Əliyev"])

    await click(field("mtm-contact-quick-unassigned"))
    expect(listed()).toEqual(["Aysel Məmmədova", "Elvin Quliyev", "Nigar Hüseynova"])

    await click(field("mtm-contact-quick-all"))
    expect(listed()).toHaveLength(4)
  })

  it("counts the chips within the search, and the reset clears the chip too", async () => {
    await typeInto("mtm-contact-search", "Kardioloq")
    expect(listed()).toEqual(["Nigar Hüseynova", "Rəşad Əliyev"])
    expect(chips().slice(0, 3)).toEqual(["Hamısı2 ✓", expect.stringMatching(/gəlinməyənlər1$/), "Planlaşdırılmayıb1"])

    await click(field("mtm-contact-quick-not-planned"))
    expect(listed()).toEqual(["Rəşad Əliyev"])
    await click(field("mtm-contact-clear-filters"))
    expect(listed()).toHaveLength(4)
    expect(chips()[0]).toBe("Hamısı4 ✓")
  })

  // Owner, 2026-10-21: «я не заметил категории клиентов. Есть ли они? Если
  // есть, то нужно добавить в фильтр, это должно указываться как
  // дополнительный столбец». On Zeytun all 321 were B, and the class chips,
  // shown from two classes up, never appeared.
  it("puts every class the tenant grades with on a line of its own, «0» included, and a press narrows the list", async () => {
    const classLine = () => [...(field("mtm-contact-class-row")?.querySelectorAll("button[aria-pressed]") ?? [])]
      .map((chip) => `${chip.textContent?.trim()}${chip.getAttribute("aria-pressed") === "true" ? " ✓" : ""}`)
    expect(field("mtm-contact-class-row")?.textContent).toContain("Kateqoriya")
    // The default classes A..D: one client A, three B, nobody C or D.
    expect(classLine()).toEqual(["Hamısı4 ✓", "A1", "B3", "C0", "D0"])

    await click(field("mtm-contact-quick-category-A"))
    expect(listed()).toEqual(["Nigar Hüseynova"])
    expect(navigation.router.replace).toHaveBeenLastCalledWith(expect.stringContaining("category=A"), { scroll: false })
    // The counts stay those of every class, so another one is a press away.
    expect(classLine()).toEqual(["Hamısı4", "A1 ✓", "B3", "C0", "D0"])

    await click(field("mtm-contact-quick-category-C"))
    expect(listed()).toEqual([])
    await click(field("mtm-contact-quick-category-all"))
    expect(listed()).toHaveLength(4)
  })

  it("shows the class of every client in a column of its own", () => {
    expect(field("mtm-contact-class-d-003")?.textContent).toBe("A")
    for (const id of ["d-001", "d-002", "d-004"]) expect(field(`mtm-contact-class-${id}`)?.textContent).toBe("B")
  })

  it("says once that visit norms are not set, instead of «Qayda imzalanmayıb» in every row", () => {
    const banner = field("mtm-contact-coverage-unsigned")
    expect(banner?.textContent).toContain("Vizit normaları təyin edilməyib")
    expect(banner?.querySelector("a")?.getAttribute("href")).toBe("/mtm/settings?tab=admin")
    expect(container.querySelector("thead")?.textContent).not.toContain("Əhatə")
    expect(container.querySelector("tbody")?.textContent).not.toContain("Qayda imzalanmayıb")
  })

  it("names who was there last, says «hələ olmayıb» where nobody was, and puts a client on a route in one click", () => {
    expect(field("mtm-contact-last-visit-d-002")?.textContent).toMatch(/· Seymur M\.$/)
    expect(field("mtm-contact-last-visit-d-003")?.textContent).toBe("hələ olmayıb")
    expect(field("mtm-contact-next-visit-d-003")?.querySelector("a")?.getAttribute("href")).toBe("/mtm/routes?routeId=route-1")

    // To the planner of the responsible employee, the client already on the route.
    expect(field("mtm-contact-add-to-route-d-002")?.getAttribute("href"))
      .toBe("/mtm/routes/plan?agentId=agent-seymur&customerId=org-clinic&contactId=d-002")
    // Nobody responsible: the planner opens on its own employee.
    expect(field("mtm-contact-add-to-route-d-001")?.getAttribute("href"))
      .toBe("/mtm/routes/plan?customerId=org-clinic&contactId=d-001")
  })
})

describe("«Müştərilər» opened by the Panel's «Sorğuya bax»", () => {
  /** The page again, at `search`, with a manager whose default view is the cardiologists. */
  async function reopen(search: string) {
    await act(async () => { root.unmount() })
    const answer = globalThis.fetch
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => (
      new URL(input, "http://localhost:3000").pathname === "/api/v1/mtm/contacts/views"
        ? Response.json({ success: true, data: { views: [{ id: "view-cardio", name: "Kardioloqlar", filters: { specialties: ["Kardioloq"] }, isDefault: true, isShared: false, canDelete: true }] } })
        : answer(input, init)
    )))
    navigation.params = new URLSearchParams(search)
    root = createRoot(container)
    await act(async () => { root.render(createElement(MtmContactExplorer)) })
    await settle()
  }

  afterEach(() => { navigation.params = new URLSearchParams("") })

  // The queue's switch in the address is not a filter of the list: the list
  // under the unfolded requests is the one the manager opens every day.
  it("still opens the list on the manager's default view", async () => {
    await reopen("requests=open")
    expect(listed()).toEqual(["Nigar Hüseynova", "Rəşad Əliyev"])
  })

  it("lets a filter in the address win over the default view, as before", async () => {
    await reopen("requests=open&specialty=Pediatr")
    expect(listed()).toEqual(["Aysel Məmmədova"])
  })
})
