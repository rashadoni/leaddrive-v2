// @vitest-environment jsdom
/**
 * «Учреждения» as the owner chose it from a picture, 2026-10-16: one search
 * and the chips with how many each holds, then the institutions one line
 * each — clients there, last visit and by whom, the next one, who is
 * responsible (or «Təyin et») and «Marşruta». On prod the table was 2437 px
 * in a 1148 px frame, with a column of «—» and two of «Məlumat yoxdur».
 *
 * The real screen over the real list handler; the institutions are held in
 * memory and filtered by the very `where` the handler builds, so a chip is
 * checked by who is left in the table.
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
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/mtm/customers",
  useSearchParams: () => new URLSearchParams(""),
}))
vi.mock("@/components/help/help-button", () => ({ HelpButton: () => null }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

import { MtmOrganizationExplorer } from "@/components/mtm/organization-explorer"
import { GET as GET_ORGANIZATIONS } from "@/app/api/v1/mtm/organizations/route"
import { requireAuth } from "@/lib/api-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { mtmClientVisitMonth } from "@/lib/mtm/client-list-quick"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { prisma } from "@/lib/prisma"
import { matchesPrismaWhere } from "./mocks/prisma-where"

const ORG = "org-1"
const SEYMUR = { id: "agent-seymur", name: "Seymur Məmmədov", role: "AGENT" }
const TODAY = new Date(`${currentDateKey(new Date(), "Asia/Baku")}T00:00:00.000Z`)
const inMonth = new Date(mtmClientVisitMonth(TODAY).start.getTime() + 12 * 3_600_000)

function institution(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    organizationId: ORG,
    deletedAt: null,
    code: null,
    name,
    objectType: "CLINIC",
    category: "B",
    status: "ACTIVE",
    address: `${name} küçəsi 1`,
    region: null,
    administrativeDistrict: null,
    locality: null,
    cityDistrict: null,
    city: "Bakı",
    district: null,
    specialization: null,
    organizationKind: null,
    territoryCode: null,
    phone: null,
    contactPerson: null,
    managingManagerId: null,
    managingManager: null,
    latitude: 40.4,
    longitude: 49.8,
    agentAssignments: [] as unknown[],
    attributeFacts: [],
    visits: [] as unknown[],
    routePoints: [] as unknown[],
    _count: { contactWorkplaces: 0, visits: 0 },
    ...extra,
  }
}

const INSTITUTIONS = [
  institution("org-a", "Ağ Klinika", {
    agentAssignments: [{ id: "as-1", agentId: SEYMUR.id, role: "PRIMARY", deletedAt: null, effectiveFrom: new Date("2026-01-01"), effectiveTo: null, agent: SEYMUR }],
    visits: [{ id: "v-1", organizationId: ORG, deletedAt: null, status: "CHECKED_OUT", checkInAt: inMonth, agent: { id: SEYMUR.id, name: SEYMUR.name } }],
    _count: { contactWorkplaces: 4, visits: 1 },
  }),
  institution("org-b", "Bakı Xəstəxanası", {
    routePoints: [{ id: "p-1", routeId: "route-1", plannedTime: null, orderIndex: 0, deletedAt: null, status: "PENDING", route: { organizationId: ORG, deletedAt: null, status: "PLANNED", date: new Date(TODAY.getTime() + 86_400_000), agentId: SEYMUR.id } }],
    _count: { contactWorkplaces: 16, visits: 0 },
  }),
  institution("org-c", "Cənub Poliklinikası", { _count: { contactWorkplaces: 9, visits: 0 } }),
]

let container: HTMLDivElement
let root: Root

async function settle() {
  for (let turn = 0; turn < 8; turn += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  }
}
const field = (testId: string) => container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
async function click(element: Element | null | undefined) {
  if (!(element instanceof HTMLElement)) throw new Error("element not found")
  await act(async () => { element.click() })
  await settle()
}
/** Institution names in the desktop table (the phone cards repeat the rows). */
const listed = () => [...container.querySelectorAll('[data-testid="mtm-organization-grid-scroll"] tbody tr a')]
  .filter((link) => link.getAttribute("href")?.startsWith("/mtm/customers/"))
  .map((link) => link.textContent?.trim())
const chips = () => [...container.querySelectorAll('[data-testid="organization-toolbar"] button[aria-pressed]')]
  .map((chip) => `${chip.textContent?.trim()}${chip.getAttribute("aria-pressed") === "true" ? " ✓" : ""}`)

beforeEach(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
  vi.mocked(requireAuth).mockResolvedValue({ orgId: ORG, userId: "admin-user", role: "admin", email: "admin@example.com", name: "Admin" } as never)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: null, role: "ADMIN", scopedAgentIds: null } as never)
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmCustomer.findMany).mockImplementation((async (args: { where: Record<string, unknown> }) => (
    INSTITUTIONS.filter((row) => matchesPrismaWhere(row, args.where))
  )) as never)
  vi.mocked(prisma.mtmCustomer.count).mockImplementation((async (args: { where: Record<string, unknown> }) => (
    INSTITUTIONS.filter((row) => matchesPrismaWhere(row, args.where)).length
  )) as never)

  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, "http://localhost:3000")
    if (url.pathname === "/api/v1/mtm/organizations") return GET_ORGANIZATIONS(new NextRequest(url, init as never))
    if (url.pathname === "/api/v1/mtm/organizations/facets") {
      return Response.json({ success: true, data: { region: [], administrativeDistrict: [], locality: [], cityDistrict: [], city: [], specialization: [], organizationKind: [], territoryCode: [], medicalCategories: [], licenseStatuses: [], polygons: [], managers: [], assignableAgents: [SEYMUR], asOf: "2026-10-16" } })
    }
    if (url.pathname === "/api/v1/mtm/organizations/views") return Response.json({ success: true, data: { views: [] } })
    throw new Error(`unexpected request: ${url.pathname}`)
  }))

  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(createElement(MtmOrganizationExplorer, { orgId: ORG })) })
  await settle()
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
})

describe("«Müəssisələr»: one line an institution, the chips over them", () => {
  it("opens on the columns that answer «who, when, whose», without a frame that scrolls on its own", () => {
    const headers = [...container.querySelectorAll('[data-testid="mtm-organization-grid-scroll"] thead th')]
      .slice(1).map((cell) => cell.textContent?.trim())
    expect(headers).toEqual(["Müəssisə və ünvan", "Müştərilər", "Son ziyarət", "Növbəti ziyarət", "Sahə əməkdaşı", "Əməliyyatlar"])
    expect(field("mtm-organization-grid-scroll")?.className).not.toMatch(/max-h|overflow-auto/)
    // The named fields wait under «Daha çox filtr».
    expect(field("organization-name")).toBeNull()
    expect(listed()).toEqual(["Ağ Klinika", "Bakı Xəstəxanası", "Cənub Poliklinikası"])
  })

  it("says how many each chip holds, and a chip narrows the list to what it says", async () => {
    expect(chips()).toEqual([
      "Hamısı3 ✓",
      expect.stringMatching(/ayında gəlinməyənlər2$/),
      "Planlaşdırılmayıb2",
      "Məsul əməkdaşı yoxdur2",
    ])

    await click(field("organization-quick-not-visited"))
    expect(listed()).toEqual(["Bakı Xəstəxanası", "Cənub Poliklinikası"])
    await click(field("organization-quick-not-planned"))
    expect(listed()).toEqual(["Ağ Klinika", "Cənub Poliklinikası"])
    await click(field("organization-quick-unassigned"))
    expect(listed()).toEqual(["Bakı Xəstəxanası", "Cənub Poliklinikası"])
    await click(field("organization-quick-all"))
    expect(listed()).toHaveLength(3)
  })

  it("names who was there last, and «hələ olmayıb» where nobody was", () => {
    const row = (name: string) => [...container.querySelectorAll('[data-testid="mtm-organization-grid-scroll"] tbody tr')]
      .find((tr) => tr.textContent?.includes(name))
    expect(row("Ağ Klinika")?.textContent).toContain("· Seymur M.")
    expect(row("Ağ Klinika")?.textContent).toContain("Seymur Məmmədov")
    expect(row("Cənub Poliklinikası")?.textContent).toContain("hələ olmayıb")
    const hrefs = [...(row("Bakı Xəstəxanası")?.querySelectorAll("a") ?? [])].map((link) => link.getAttribute("href") ?? "")
    expect(hrefs.some((href) => href.startsWith("/mtm/routes?routeId=route-1&"))).toBe(true)
  })

  it("puts an institution on its employee's route in one click, and assigns one nobody has from the row", async () => {
    expect(field("mtm-add-organization-to-route-org-a")?.getAttribute("href")).toBe("/mtm/routes/plan?agentId=agent-seymur&customerId=org-a")
    expect(field("mtm-add-organization-to-route-org-c")?.getAttribute("href")).toBe("/mtm/routes/plan?customerId=org-c")

    expect(field("mtm-organization-assign-one-org-a")).toBeNull()
    await click(field("mtm-organization-assign-one-org-c"))
    expect(document.querySelector('[data-testid="mtm-organization-assignment-dialog"]')).not.toBeNull()
  })
})
