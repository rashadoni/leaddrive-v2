// @vitest-environment jsdom
/**
 * The visits on top of a doctor's card and an institution's card, as the
 * owner chose them from a picture on 2026-10-16: the last visit — when, who,
 * to whom, what was shown — the visit left open now with «Напомнить агенту»,
 * the next one with «Запланировать», and the latest visits one line each.
 *
 * Before, the doctor's card showed no visit at all (its «История» is the
 * journal of edits) and the institution's visit left open three days said
 * «Davam edir». The real cards are rendered in Russian; the API answers with
 * what `readMtmClientVisitSummary` returns.
 */
import { readFileSync } from "node:fs"
import { act, createElement, type ComponentProps } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { MtmClientVisitLine, MtmClientVisitSummary } from "@/lib/mtm/client-visit-summary"

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { organizationId: "org-1", role: "admin" } } }) }))
vi.mock("next/link", async () => {
  const { createElement: h } = await import("react")
  return { default: ({ href, children, ...rest }: { href: string; children?: unknown }) => h("a", { href, ...rest }, children as never) }
})
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock("@/hooks/use-mtm-org-settings", () => ({ useMtmFieldContacts: () => ({ enabled: true, ready: true }) }))
vi.mock("@/components/mtm/customer-form", () => ({ MtmCustomerForm: () => null }))
vi.mock("@/components/mtm/contact-edit-dialog", () => ({ MtmContactEditDialog: () => null }))
vi.mock("@/components/mtm/contact-class-picker", () => ({ MtmContactClassPicker: () => null }))
vi.mock("@/components/mtm/contact-duplicate-dialog", () => ({ MtmContactDuplicateDecisionDialog: () => null, MtmContactDuplicateReportDialog: () => null }))
vi.mock("@/components/mtm/contact-workplace-dialog", () => ({ MtmContactWorkplaceDialog: () => null, MtmContactWorkplaceEndDialog: () => null }))
vi.mock("@/components/mtm/contact-scoring-panel", () => ({ MtmContactScoringPanel: () => null }))
vi.mock("@/components/mtm/contact-dictionary-assignment-panel", () => ({ MtmContactDictionaryAssignmentPanel: () => null }))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8"))

const HOUR = 3_600_000
const now = Date.now()
const SEYMUR = { id: "agent-seymur", name: "Seymur Məmmədov" }
const CLINIC = { id: "org-clinic", name: "Milli Onkologiya Mərkəzi" }
const AYDIN = { id: "contact-aydin", displayName: "Abbasov Aydın" }

const closed: MtmClientVisitLine = {
  id: "visit-closed", status: "CHECKED_OUT", checkInAt: new Date(now - 9 * 24 * HOUR).toISOString(), checkOutAt: new Date(now - 9 * 24 * HOUR + HOUR).toISOString(),
  outcome: null, agent: SEYMUR, customer: CLINIC, contact: AYDIN, photos: 1, signed: true, shown: [{ product: "Forlaks", pages: 7 }],
}
// Opened three days and two hours ago, never closed.
const open: MtmClientVisitLine = {
  id: "visit-open", status: "CHECKED_IN", checkInAt: new Date(now - (3 * 24 + 2) * HOUR).toISOString(), checkOutAt: null,
  outcome: null, agent: SEYMUR, customer: CLINIC, contact: AYDIN, photos: 0, signed: false, shown: [],
}
const month = new Date(now).toISOString().slice(0, 7)
const summary = (extra: Partial<MtmClientVisitSummary> = {}): MtmClientVisitSummary => ({
  total: 2, month, monthClosed: 1, recent: [open, closed], lastClosed: closed, open, next: null, ...extra,
})

const contact = {
  id: AYDIN.id, externalCode: "DGA.0124", firstName: "Aydın", lastName: "Abbasov", middleName: null, displayName: AYDIN.displayName,
  type: "DOCTOR", specialtyCode: null, specialtyName: "Qastroenteroloq", qualificationCategory: null, profile: null, category: "B", status: "ACTIVE",
  birthDate: null, gender: null, email: null, phone: null, messengerPhone: null, workPhone: null, homePhone: null, mobilePhone: null,
  viberPhone: null, whatsappPhone: null, telegramPhone: null, postalCode: null, addressRegion: null, addressLocality: null, addressDistrict: null,
  addressStreet: null, productCategory: null, categoryData: {}, verificationStatus: "UNVERIFIED", consentStatus: "UNKNOWN", contactPreference: null,
  source: "ADMIN", notes: null, createdAt: "2026-10-03T19:54:00.000Z", updatedAt: "2026-10-03T19:54:00.000Z", duplicateOfContact: null,
  workplaces: [{ id: "wp-1", jobTitle: null, department: null, room: null, phone: null, isPrimary: true, startedOn: null, endedOn: null, source: "ADMIN", customer: { ...CLINIC, code: null, objectType: "CLINIC", category: "B", address: null, city: "Bakı", district: null, phone: null, latitude: 40.4, longitude: 49.8 } }],
  agentAssignments: [{ id: "as-1", role: "PRIMARY", effectiveFrom: "2026-01-01", effectiveTo: null, source: "ADMIN", reason: null, agent: { ...SEYMUR, role: "AGENT", status: "ACTIVE" } }],
  fieldPotentials: [], doctorAssessments: [], changeRequests: [], dictionaryAssignments: [],
}

let posts: Array<{ url: string; body: unknown }> = []
let organizationSummary: MtmClientVisitSummary
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), "https://crm.test")
  if ((init?.method ?? "GET") !== "GET") {
    posts.push({ url: url.pathname, body: JSON.parse(String(init?.body)) })
    return json({ success: true, data: {} })
  }
  if (url.pathname === `/api/v1/mtm/contacts/${AYDIN.id}`) {
    return json({ success: true, data: {
      contact, history: [], activeAssignments: contact.agentAssignments, eligibleBrandPotentialVisits: [], brandPotentialAgents: [],
      availableContactDictionaries: [], dictionaryAssignmentStateHash: "h", contactPolicy: { requiredFields: [], hiddenFields: [], specialties: [], classes: ["A", "B", "C", "D"] },
      visitSummary: summary(), longOpenMinutes: 120, asOf: "2026-10-16", timezone: "Asia/Baku",
      capabilities: { actorAgentId: null, actorRole: "ADMIN", canManage: true, canRequestChanges: false, canRecordBrandPotential: true, canReviewBrandPotential: true, brandPotentialPerAgent: false },
    } })
  }
  if (url.pathname === `/api/v1/mtm/organizations/${CLINIC.id}`) {
    const section = url.searchParams.get("section")
    const organization = section === "visits"
      ? { id: CLINIC.id, name: CLINIC.name, visits: [{ ...open, potential: null, resultNotes: null }, { ...closed, potential: null, resultNotes: null }] }
      : {
          ...CLINIC, code: null, objectType: "CLINIC", category: "B", status: "ACTIVE", address: "Yasamal r-nu, Həsənbəy Zərdabi küçəsi 79B",
          region: null, administrativeDistrict: null, locality: null, cityDistrict: null, city: "Bakı", district: null, specialization: null,
          organizationKind: null, territoryCode: null, polygon: null, latitude: 40.39, longitude: 49.81, phone: null, contactPerson: null, notes: null,
          geofenceRadius: 100, createdAt: "2026-10-13T09:20:00.000Z", updatedAt: "2026-10-13T09:20:00.000Z", managingManager: null,
          agentAssignments: [], _count: { contactWorkplaces: 5, visits: 2 }, attributeFacts: [],
        }
    return json({ success: true, data: {
      organization, asOf: "2026-10-16", timezone: "Asia/Baku", section, commercial: null, coordinateVerification: null,
      capabilities: { canManage: true, canRequestChanges: false },
      ...(section === "summary" ? { visitSummary: organizationSummary, longOpenMinutes: 120 } : {}),
    } })
  }
  return new Response(JSON.stringify({ error: `unexpected ${url.pathname}` }), { status: 500 })
})

let container: HTMLDivElement
let root: Root
async function flush() {
  for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}
async function mount(element: ReturnType<typeof createElement>) {
  const intl: ComponentProps<typeof NextIntlClientProvider> = { locale: "ru", timeZone: "Asia/Baku", messages: ru, onError: () => {}, children: null }
  await act(async () => root.render(createElement(NextIntlClientProvider, intl, element)))
  await flush()
}
const byTestId = (id: string) => {
  const element = container.querySelector(`[data-testid="${id}"]`)
  if (!element) throw new Error(`no [data-testid="${id}"]`)
  return element as HTMLElement
}

beforeEach(() => {
  posts = []
  organizationSummary = summary({ clientsHere: { active: 5, notVisitedThisMonth: 4 } })
  vi.stubGlobal("fetch", fetchMock)
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  fetchMock.mockClear()
})

describe("the doctor's card", () => {
  it("opens on the visits: last — who and what was shown — open now, and next with «Запланировать»", async () => {
    const { MtmContactDetail } = await import("@/components/mtm/contact-detail")
    await mount(createElement(MtmContactDetail, { contactId: AYDIN.id }))

    const last = byTestId("mtm-client-visit-last").textContent
    expect(last).toContain("· Seymur Məmmədov")
    // On the doctor's card the place is said, not the doctor.
    expect(last).toContain("Milli Onkologiya Mərkəzi · показал «Forlaks» · 7 стр. · 1 фото · подпись")

    const openCell = byTestId("mtm-client-visit-open").textContent
    expect(openCell).toContain("Визит не закрыт агентом")
    expect(openCell).toContain("3 дня")
    expect(byTestId("mtm-client-visit-remind").textContent).toContain("Напомнить агенту")

    const plan = "/mtm/routes/plan?agentId=agent-seymur&customerId=org-clinic&contactId=contact-aydin"
    expect(byTestId("mtm-client-visit-next").textContent).toContain("не запланирован")
    expect(byTestId("mtm-client-visit-plan").getAttribute("href")).toBe(plan)
    expect(byTestId("mtm-contact-to-route").getAttribute("href")).toBe(plan)

    // The latest visits, one line each, the left-open one said so.
    expect(byTestId("mtm-client-visit-visit-open").textContent).toContain("Не закрыт агентом · 3 дня")
    expect(byTestId("mtm-client-visit-visit-closed").textContent).toContain("Закрыт")
    expect(byTestId("mtm-client-visit-list").textContent).toContain("Визиты · 2")
  })

  it("reminds the agent with one direct message, never closing the visit", async () => {
    const { MtmContactDetail } = await import("@/components/mtm/contact-detail")
    await mount(createElement(MtmContactDetail, { contactId: AYDIN.id }))

    await act(async () => { byTestId("mtm-client-visit-remind").click() })
    await flush()

    expect(posts).toHaveLength(1)
    expect(posts[0]).toMatchObject({ url: "/api/v1/mtm/operations/messages", body: { type: "DIRECT", agentIds: [SEYMUR.id] } })
  })
})

describe("the institution's card", () => {
  it("opens on its visits — to which doctor, what was shown — with the clients here, «Назначить» and «В маршрут»", async () => {
    const { MtmOrganizationDetail } = await import("@/components/mtm/organization-detail")
    await mount(createElement(MtmOrganizationDetail, { organizationId: CLINIC.id }))

    expect(byTestId("mtm-client-visit-last").textContent).toContain("к Abbasov Aydın · показал «Forlaks»")
    expect(byTestId("mtm-client-visit-open").textContent).toContain("к Abbasov Aydın")
    const clients = byTestId("mtm-client-visit-clients").textContent
    expect(clients).toContain("5 клиентов")
    expect(clients).toMatch(/4 без визита за \S+/)
    expect(clients).toContain("Следующий визит не запланирован")

    // Nobody responsible: said, and one click to name somebody.
    expect(container.textContent).toContain("Ответственный не назначен")
    expect(byTestId("mtm-organization-detail-assign").getAttribute("href")).toBe(`/mtm/customers?assignmentTarget=${CLINIC.id}&assignmentMode=ASSIGN`)
    expect(byTestId("mtm-organization-detail-to-route").getAttribute("href")).toBe(`/mtm/routes/plan?customerId=${CLINIC.id}`)

    // The visits tab is the one open, its visits read with the card.
    expect(byTestId("mtm-client-visit-visit-open").textContent).toContain("Не закрыт агентом · 3 дня")
    expect(byTestId("mtm-client-visit-visit-closed").textContent).toContain("к Abbasov Aydın · показал «Forlaks» · 7 стр. · 1 фото · подпись")
    expect(container.textContent).not.toContain("Davam edir")
  })

  it("says the next visit when there is one, and offers no «Запланировать» then", async () => {
    organizationSummary = summary({ open: null, recent: [closed], next: { routeId: "route-9", date: "2026-10-20", plannedTime: null, agent: SEYMUR }, clientsHere: { active: 5, notVisitedThisMonth: 0 } })
    const { MtmOrganizationDetail } = await import("@/components/mtm/organization-detail")
    await mount(createElement(MtmOrganizationDetail, { organizationId: CLINIC.id }))

    const next = byTestId("mtm-client-visit-next")
    expect(next.textContent).toContain("20 окт. · Seymur Məmmədov")
    expect(next.querySelector("a")?.getAttribute("href")).toBe("/mtm/routes?routeId=route-9")
    expect(container.querySelector('[data-testid="mtm-client-visit-plan"]')).toBeNull()
    expect(byTestId("mtm-client-visit-clients").textContent).toMatch(/все с визитом за/)
  })
})
