// @vitest-environment jsdom
/**
 * An employee's own section, /mtm/agents/[id] (owner, 2026-10-02): «менеджер,
 * переходя в раздел агента, мог привязывать либо отвязывать клиентов» and
 * «заходя к агенту, могу видеть все данные по привязанным к нему клиентам».
 *
 * Before, opening an employee led to their GPS history. Their clients were
 * reachable only from the Clients page — filter by the responsible employee,
 * tick, pick the employee a second time in a dialog.
 *
 * The section, the clients explorer inside it and the assignment dialog are
 * the real components with the real message files. The server is a stand-in
 * that keeps who owns which client and answers the way the routes do: the
 * list honours ownerAgentId / assignmentState / search, the preview refuses
 * a target who is not an active field agent, the execute call moves the
 * ownership. Every check reads the rendered page or the request it sent.
 */
import { act, createElement, type ComponentProps, type FunctionComponent, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { readFileSync } from "node:fs"
import { afterEach, describe, expect, it, vi } from "vitest"
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl"
import { MtmAgentSection } from "@/components/mtm/agent-section"
import { MtmContactExplorer } from "@/components/mtm/contact-explorer"

const navigation = vi.hoisted(() => ({ search: "", replace: vi.fn(), push: vi.fn() }))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigation.replace, push: navigation.push, refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/mtm/agents/agent-anar",
  useSearchParams: () => new URLSearchParams(navigation.search),
}))
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children?: ReactNode; href: string; [key: string]: unknown }) =>
    createElement("a", { href, ...props }, children),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))
vi.mock("@/components/help/help-button", () => ({ HelpButton: () => null }))

const IntlProvider = NextIntlClientProvider as FunctionComponent<
  Omit<ComponentProps<typeof NextIntlClientProvider>, "children"> & { children?: ReactNode }
>

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Agent = { id: string; name: string; role: string; status: string }
type Client = { id: string; name: string; specialty: string; workplace: string; phone: string; ownerId: string | null }
type Call = { url: string; method: string; body: Record<string, unknown> | null }

const ANAR: Agent = { id: "agent-anar", name: "Anar Məmmədov", role: "AGENT", status: "ACTIVE" }
const LEYLA: Agent = { id: "agent-leyla", name: "Leyla Həsənova", role: "AGENT", status: "ACTIVE" }
const TOGRUL: Agent = { id: "agent-togrul", name: "Toğrul Əliyev", role: "MANAGER", status: "ACTIVE" }

let agents: Agent[] = []
let clients: Client[] = []
let calls: Call[] = []
let canTransfer = true
let root: Root | null = null

function seed() {
  agents = [ANAR, LEYLA, TOGRUL]
  clients = [
    { id: "c-aysel", name: "Aysel Quliyeva", specialty: "Kardioloq", workplace: "Mərkəzi Klinika", phone: "+994501112233", ownerId: ANAR.id },
    { id: "c-rauf", name: "Rauf Əliyev", specialty: "Onkoloq", workplace: "Milli Onkologiya Mərkəzi", phone: "+994502223344", ownerId: ANAR.id },
    { id: "c-nigar", name: "Nigar Səfərova", specialty: "Əczaçı", workplace: "Zeytun Aptek 1", phone: "+994503334455", ownerId: null },
    { id: "c-kamran", name: "Kamran Hüseynov", specialty: "Terapevt", workplace: "Bona Dea Hospital", phone: "+994504445566", ownerId: LEYLA.id },
  ]
}

function contactRow(client: Client) {
  const owner = agents.find((agent) => agent.id === client.ownerId)
  return {
    id: client.id,
    externalCode: null,
    displayName: client.name,
    type: "DOCTOR",
    status: "ACTIVE",
    specialtyCode: null,
    specialtyName: client.specialty,
    qualificationCategory: null,
    profile: null,
    category: "A",
    categoryCode: null,
    phone: client.phone,
    mobilePhone: null,
    workPhone: null,
    whatsappPhone: null,
    email: null,
    verificationStatus: "VERIFIED",
    workplaces: [{ id: `w-${client.id}`, isPrimary: true, customer: { id: `org-${client.id}`, code: null, name: client.workplace, objectType: "CLINIC", category: "A", address: "Nizami küçəsi 5", city: "Bakı", district: null } }],
    agentAssignments: owner ? [{ id: `as-${client.id}`, role: "PRIMARY", agent: owner }] : [],
    visits: [{ id: `v-${client.id}`, status: "CHECKED_OUT", checkInAt: "2026-09-28T09:00:00.000Z", checkOutAt: "2026-09-28T09:20:00.000Z", outcome: null }],
    routePoints: [],
    coverage: { available: false, state: "NOT_APPLICABLE", period: { key: "2026-10", start: "2026-10-01", end: "2026-10-31" } },
  }
}

function preview(body: Record<string, unknown>) {
  const ids = body.contactIds as string[]
  const target = agents.find((agent) => agent.id === body.targetAgentId) ?? null
  const rows = ids.map((contactId) => {
    const client = clients.find((item) => item.id === contactId)
    const issues: string[] = []
    if (!client) issues.push("CONTACT_NOT_AVAILABLE")
    if (body.mode === "ASSIGN" && (!target || target.status !== "ACTIVE" || target.role !== "AGENT")) issues.push("TARGET_AGENT_UNAVAILABLE")
    if (body.mode === "ASSIGN" && client?.ownerId === body.targetAgentId) issues.push("TARGET_ALREADY_ASSIGNED")
    if (body.mode === "UNASSIGN" && client && !client.ownerId) issues.push("NO_PRIMARY_ASSIGNMENT")
    return { contactId, displayName: client?.name ?? null, issues, assignable: issues.length === 0 }
  })
  const assignable = rows.filter((row) => row.assignable).length
  return {
    previewToken: "p".repeat(64),
    effectiveFrom: body.effectiveFrom,
    targetAgent: target,
    summary: { selected: rows.length, assignable, excluded: rows.length - assignable, unassigned: 0, openVisitConflicts: 0, routePlanConflicts: 0 },
    rows,
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status })
}

function stubServer() {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null
    calls.push({ url, method, body })
    const path = url.split("?")[0]
    const params = new URL(url, "http://localhost").searchParams

    if (path.startsWith("/api/v1/mtm/agents/")) {
      const agent = agents.find((item) => item.id === decodeURIComponent(path.split("/").pop() ?? ""))
      return agent
        ? json({ success: true, data: { ...agent, phone: "+994550001122", email: null, manager: { id: TOGRUL.id, name: TOGRUL.name }, team: { id: "team-1", name: "Bakı-1" } } })
        : json({ error: "Not found" }, 404)
    }
    if (path === "/api/v1/mtm/contacts/facets") {
      return json({ success: true, data: { specialtyCodes: [], profiles: [], qualificationCategories: [], regions: [], administrativeDistricts: [], localities: [], cityDistricts: [], organizationKinds: [], objectTypes: [], asOf: "2026-10-02" } })
    }
    if (path === "/api/v1/mtm/contacts/views") return json({ success: true, data: { views: [] } })
    if (path === "/api/v1/mtm/contacts") {
      const owner = params.get("ownerAgentId")
      const state = params.get("assignmentState")
      const search = (params.get("search") ?? params.get("name") ?? "").toLowerCase()
      const found = clients
        .filter((client) => !owner || client.ownerId === owner)
        .filter((client) => state === "UNASSIGNED" ? !client.ownerId : state === "ASSIGNED" ? Boolean(client.ownerId) : true)
        .filter((client) => !search || client.name.toLowerCase().includes(search))
      const limit = Number(params.get("limit") ?? "50")
      return json({ success: true, data: {
        contacts: found.slice(0, limit).map(contactRow),
        total: found.length,
        page: 1,
        limit,
        asOf: "2026-10-02",
        timezone: "Asia/Baku",
        coveragePeriod: { key: "2026-10", start: "2026-10-01", end: "2026-10-31" },
        transferSyncScopeKey: "",
        availableAgents: agents,
        capabilities: { canManage: canTransfer, canRequestChanges: false, canTransfer, actorAgentId: null, actorRole: canTransfer ? "ADMIN" : "AGENT" },
      } })
    }
    if (path === "/api/v1/mtm/contact-assignments/preview" && body) return json({ success: true, data: preview(body) })
    if (path === "/api/v1/mtm/contact-assignments" && body) {
      const result = preview(body)
      const changed = result.rows.filter((row) => row.assignable)
      for (const row of changed) {
        const client = clients.find((item) => item.id === row.contactId)
        if (client) client.ownerId = body.mode === "ASSIGN" ? String(body.targetAgentId) : null
      }
      return json({ success: true, data: { summary: { ...result.summary, changed: changed.length }, excluded: result.rows.filter((row) => !row.assignable) } })
    }
    return json({ error: `unexpected ${method} ${url}` }, 500)
  }))
}

function messagesFor(locale: string): AbstractIntlMessages {
  return JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")) as AbstractIntlMessages
}

function words<T>(locale: string, namespace: string): T {
  return namespace.split(".").reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], messagesFor(locale)) as T
}

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template)
}

async function settle(ms = 0) {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
}

async function until(check: () => boolean, what: string) {
  for (let attempt = 0; attempt < 300 && !check(); attempt += 1) await settle(10)
  if (!check()) throw new Error(`timed out waiting for: ${what}`)
}

async function mount(element: ReactNode, locale = "az") {
  const missing: string[] = []
  const container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(IntlProvider, { locale, messages: messagesFor(locale), onError: (error) => { missing.push(error.message) } }, element))
  })
  await settle()
  return { container, missing }
}

async function openSection(options: { agentId?: string; tab?: "attach"; locale?: string } = {}) {
  seed()
  stubServer()
  navigation.search = options.tab ? `tab=${options.tab}` : ""
  return mount(createElement(MtmAgentSection, { agentId: options.agentId ?? ANAR.id }), options.locale)
}

async function click(element: Element | null | undefined) {
  if (!element) throw new Error("nothing to click")
  await act(async () => { element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })) })
}

function buttonNamed(container: HTMLElement, name: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === name)
}

async function choose(container: HTMLElement, testId: string, value: string) {
  const select = container.querySelector<HTMLSelectElement>(`select[data-testid='${testId}']`)
  if (!select) throw new Error(`no select ${testId}`)
  await act(async () => {
    select.value = value
    select.dispatchEvent(new Event("change", { bubbles: true }))
  })
}

async function type(container: HTMLElement, testId: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`input[data-testid='${testId}']`)
  if (!input) throw new Error(`no input ${testId}`)
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  await act(async () => {
    setValue?.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

function columns(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("thead th")).map((cell) => cell.textContent ?? "")
}

/** The desktop table and the phone cards render the same rows; read the table. */
function tableRows(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("tbody tr")).map((row) => row.textContent ?? "")
}

function listCalls(): URLSearchParams[] {
  return calls.filter((call) => call.url.startsWith("/api/v1/mtm/contacts?")).map((call) => new URL(call.url, "http://localhost").searchParams)
}

function posts(path: string): Array<Record<string, unknown>> {
  return calls.filter((call) => call.method === "POST" && call.url === path).map((call) => call.body ?? {})
}

async function tick(container: HTMLElement, clientId: string) {
  const box = container.querySelector<HTMLInputElement>(`tbody [data-testid='mtm-contact-select-${clientId}']`)
  if (!box) throw new Error(`no checkbox for ${clientId}`)
  await act(async () => { box.click() })
}

/** Walk the assignment dialog: review, then apply. The reason is already filled in. */
async function confirmAssignment(container: HTMLElement, locale = "az") {
  const dialog = words<{ review: string; apply: string }>(locale, "mtmContactExplorer.assignment")
  await click(buttonNamed(container, dialog.review))
  await until(() => posts("/api/v1/mtm/contact-assignments/preview").length > 0 && Boolean(buttonNamed(container, fill(dialog.apply, { count: 1 }))), "the preview")
  await click(buttonNamed(container, fill(dialog.apply, { count: 1 })))
  await until(() => posts("/api/v1/mtm/contact-assignments").length > 0, "the assignment to be applied")
  await settle(30)
}

afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = null
  calls = []
  canTransfer = true
  navigation.search = ""
  navigation.replace.mockClear()
  vi.unstubAllGlobals()
  document.body.innerHTML = ""
})

describe("an employee's own section", () => {
  it("shows the employee and every client assigned to them, with the client's data", async () => {
    const { container } = await openSection()
    const section = words<{ tabAssignedCount: string }>("az", "mtmAgentSection")
    await until(() => tableRows(container).length === 2, "the employee's two clients")

    expect(container.querySelector("h1")?.textContent).toBe(ANAR.name)
    // Only this employee's clients were asked for, and only they are listed.
    expect(listCalls()[0].get("ownerAgentId")).toBe(ANAR.id)
    const rows = tableRows(container)
    expect(rows.some((row) => row.includes("Aysel Quliyeva") && row.includes("Kardioloq") && row.includes("Mərkəzi Klinika") && row.includes("+994501112233"))).toBe(true)
    expect(rows.some((row) => row.includes("Rauf Əliyev") && row.includes("Onkoloq") && row.includes("Milli Onkologiya Mərkəzi"))).toBe(true)
    expect(rows.join(" ")).not.toContain("Kamran Hüseynov")
    expect(rows.join(" ")).not.toContain("Nigar Səfərova")
    expect(container.querySelector("[data-testid='mtm-agent-tab-assigned']")?.textContent).toBe(fill(section.tabAssignedCount, { count: 2 }))
    // The Clients page's own chrome stays on the Clients page.
    expect(container.querySelector("[data-testid='mtm-contact-owner']")).toBeNull()
    expect(calls.some((call) => call.url.startsWith("/api/v1/mtm/contacts/views"))).toBe(false)
    expect(navigation.replace).not.toHaveBeenCalled()
  })

  it("detaches a ticked client from the employee", async () => {
    const { container } = await openSection()
    const scope = words<{ unassignFrom: string; unassignReason: string }>("az", "mtmContactExplorer.agentScope")
    const section = words<{ tabAssignedCount: string }>("az", "mtmAgentSection")
    await until(() => tableRows(container).length === 2, "the employee's clients")

    await tick(container, "c-rauf")
    await click(buttonNamed(container, fill(scope.unassignFrom, { name: ANAR.name })))
    await confirmAssignment(container)

    const sent = posts("/api/v1/mtm/contact-assignments")[0]
    expect(sent).toMatchObject({ mode: "UNASSIGN", contactIds: ["c-rauf"], targetAgentId: null, reason: fill(scope.unassignReason, { name: ANAR.name }) })
    expect(clients.find((client) => client.id === "c-rauf")?.ownerId).toBeNull()
    await until(() => tableRows(container).length === 1, "the list without the detached client")
    expect(tableRows(container)[0]).toContain("Aysel Quliyeva")
    expect(container.querySelector("[data-testid='mtm-agent-tab-assigned']")?.textContent).toBe(fill(section.tabAssignedCount, { count: 1 }))
  })

  it("opens the attach tab through the address, so a client card can return to it", async () => {
    const { container } = await openSection()
    await until(() => tableRows(container).length === 2, "the employee's clients")

    await click(container.querySelector("[data-testid='mtm-agent-tab-attach']"))

    expect(navigation.replace).toHaveBeenCalledWith("/mtm/agents/agent-anar?tab=attach", { scroll: false })
  })

  it("attaches a ticked client to this employee without asking who to", async () => {
    const { container } = await openSection({ tab: "attach" })
    const scope = words<{ assignTo: string; assignReason: string }>("az", "mtmContactExplorer.agentScope")
    const section = words<{ tabAssignedCount: string }>("az", "mtmAgentSection")
    await until(() => tableRows(container).length === 1, "the client nobody is responsible for")

    // Clients without a responsible employee come first; nobody's list is filtered in.
    const asked = listCalls().find((params) => params.get("assignmentState") === "UNASSIGNED")
    expect(asked?.get("ownerAgentId")).toBeNull()
    expect(tableRows(container)[0]).toContain("Nigar Səfərova")
    // The explanation sends the manager to the «whose clients» field to take a
    // client over from someone else: it must be in sight, not behind «more».
    expect(container.querySelector("[data-testid='mtm-contact-whose']")).not.toBeNull()
    await until(() => container.querySelector("[data-testid='mtm-agent-tab-assigned']")?.textContent === fill(section.tabAssignedCount, { count: 2 }), "the employee's client count")

    await tick(container, "c-nigar")
    await click(buttonNamed(container, fill(scope.assignTo, { name: ANAR.name })))
    // The employee is fixed: their name is shown, there is no list to choose from.
    expect(container.querySelector("[data-testid='contact-assignment-target-locked']")?.textContent).toBe(ANAR.name)
    expect(container.querySelector("select#contact-assignment-target")).toBeNull()
    await confirmAssignment(container)

    const sent = posts("/api/v1/mtm/contact-assignments")[0]
    expect(sent).toMatchObject({ mode: "ASSIGN", contactIds: ["c-nigar"], targetAgentId: ANAR.id, reason: fill(scope.assignReason, { name: ANAR.name }) })
    expect(clients.find((client) => client.id === "c-nigar")?.ownerId).toBe(ANAR.id)
    await until(() => container.querySelector("[data-testid='mtm-agent-tab-assigned']")?.textContent === fill(section.tabAssignedCount, { count: 3 }), "the count after attaching")
    await until(() => tableRows(container).length === 0, "the attached client to leave the free list")
  })

  // Owner, 2026-10-04, in front of this list on prod: «как понять, привязаны ли
  // эти клиенты к агенту или нет… не понятно, кому привязаны, какая-то каша».
  it("says whose clients the list holds — above it, over the table and in every row", async () => {
    const { container } = await openSection({ locale: "ru" })
    const scope = words<{ assignedTitle: string; assignedHow: string; assignedTotal: string; ownerColumn: string }>("ru", "mtmContactExplorer.agentScope")
    await until(() => tableRows(container).length === 2, "the employee's two clients")

    const explainer = container.querySelector("[data-testid='mtm-agent-scope-explainer']")?.textContent ?? ""
    expect(explainer).toContain(fill(scope.assignedTitle, { name: ANAR.name }))
    expect(explainer).toContain(scope.assignedHow)
    expect(container.querySelector("[data-testid='mtm-contact-result-count']")?.textContent).toBe(fill(scope.assignedTotal, { name: ANAR.name, count: 2 }))
    // The employee stands right after the client in every row.
    expect(columns(container)[2]).toBe(scope.ownerColumn)
    for (const id of ["c-aysel", "c-rauf"]) {
      expect(container.querySelector(`tbody [data-testid='mtm-contact-owner-${id}']`)?.textContent).toBe(ANAR.name)
    }
  })

  it("after a tick says how many clients are chosen and that none is deleted, in plain words", async () => {
    const { container } = await openSection({ locale: "ru" })
    const scope = words<{ selected: string; selectionNote: string }>("ru", "mtmContactExplorer.agentScope")
    const explorer = words<{ assignmentBoundary: string; selection: { custom: string } }>("ru", "mtmContactExplorer")
    await until(() => tableRows(container).length === 2, "the employee's clients")

    await tick(container, "c-rauf")

    const text = container.textContent ?? ""
    expect(text).toContain(fill(scope.selected, { count: 1 }))
    expect(text).toContain(scope.selectionNote)
    expect(text).not.toContain(explorer.assignmentBoundary)
    expect(text).not.toContain(explorer.selection.custom)
  })

  it("keeps the two tab names apart: one is a list, the other an action", async () => {
    for (const locale of ["ru", "az", "en"]) {
      const section = words<{ tabAssigned: string; tabAttach: string }>(locale, "mtmAgentSection")
      const first = (text: string) => text.trim().split(/\s+/)[0].toLowerCase().slice(0, 6)
      // «Привязанные клиенты» next to «Привязать клиентов» read as one button twice.
      expect([locale, first(section.tabAssigned) === first(section.tabAttach)]).toEqual([locale, false])
    }
  })

  it("leaves the coverage column and the audit dates to the Clients page", async () => {
    const section = await openSection({ locale: "ru" })
    const explorer = words<{ coverage: string; asOf: string }>("ru", "mtmContactExplorer")
    await until(() => tableRows(section.container).length === 2, "the employee's clients")
    expect(columns(section.container)).not.toContain(explorer.coverage)
    expect(section.container.textContent).not.toContain(fill(explorer.asOf, { date: "2026-10-02" }))
    await act(async () => { root?.unmount() })
    document.body.innerHTML = ""
    calls = []

    seed()
    stubServer()
    navigation.search = ""
    const page = await mount(createElement(MtmContactExplorer), "ru")
    await until(() => tableRows(page.container).length === 4, "every client")
    expect(columns(page.container)).toContain(explorer.coverage)
    expect(page.container.textContent).toContain(fill(explorer.asOf, { date: "2026-10-02" }))
  })

  it("still says whose clients they are when the list is narrowed", async () => {
    const { container } = await openSection({ locale: "ru" })
    const scope = words<{ assignedFound: string }>("ru", "mtmContactExplorer.agentScope")
    await until(() => tableRows(container).length === 2, "the employee's clients")

    await type(container, "mtm-contact-name", "Aysel")

    await until(() => tableRows(container).length === 1, "the narrowed list")
    expect(container.querySelector("[data-testid='mtm-contact-result-count']")?.textContent).toBe(fill(scope.assignedFound, { name: ANAR.name, count: 1 }))
    // A narrowed list is not the employee's client count.
    const section = words<{ tabAssignedCount: string }>("ru", "mtmAgentSection")
    expect(container.querySelector("[data-testid='mtm-agent-tab-assigned']")?.textContent).toBe(fill(section.tabAssignedCount, { count: 2 }))
  })

  it("on the attach tab shows whose every client is now, and finds a colleague's clients with one field", async () => {
    const { container } = await openSection({ tab: "attach", locale: "ru" })
    const scope = words<{ candidatesTitle: string; freeTotal: string; noOwner: string }>("ru", "mtmContactExplorer.agentScope")
    await until(() => tableRows(container).length === 1, "the client nobody is responsible for")

    expect(container.querySelector("[data-testid='mtm-agent-scope-explainer']")?.textContent).toContain(fill(scope.candidatesTitle, { name: ANAR.name }))
    expect(container.querySelector("[data-testid='mtm-contact-result-count']")?.textContent).toBe(fill(scope.freeTotal, { count: 1 }))
    expect(container.querySelector("tbody [data-testid='mtm-contact-owner-c-nigar']")?.textContent).toBe(scope.noOwner)
    // The employee is not offered their own clients to take over.
    const offered = Array.from(container.querySelectorAll<HTMLOptionElement>("select[data-testid='mtm-contact-whose'] option")).map((option) => option.value)
    expect(offered).toContain(LEYLA.id)
    expect(offered).not.toContain(ANAR.id)

    // Choosing a colleague used to find nothing: the second field still said «nobody's».
    await choose(container, "mtm-contact-whose", LEYLA.id)
    await until(() => tableRows(container).some((row) => row.includes("Kamran Hüseynov")), "the colleague's client")

    const asked = listCalls().at(-1)
    expect(asked?.get("ownerAgentId")).toBe(LEYLA.id)
    expect(asked?.get("assignmentState")).toBeNull()
    expect(tableRows(container)).toHaveLength(1)
    expect(container.querySelector("tbody [data-testid='mtm-contact-owner-c-kamran']")?.textContent).toBe(LEYLA.name)
  })

  it("does not tell someone who may only look how to detach a client", async () => {
    canTransfer = false
    const { container } = await openSection({ locale: "ru" })
    const scope = words<{ assignedTitle: string; assignedHow: string }>("ru", "mtmContactExplorer.agentScope")
    await until(() => tableRows(container).length === 2, "the employee's clients")

    const explainer = container.querySelector("[data-testid='mtm-agent-scope-explainer']")?.textContent ?? ""
    expect(explainer).toContain(fill(scope.assignedTitle, { name: ANAR.name }))
    expect(explainer).not.toContain(scope.assignedHow)
  })

  it("explains why clients cannot be attached to a manager instead of offering a list that would refuse them all", async () => {
    const { container } = await openSection({ agentId: TOGRUL.id, tab: "attach" })
    const section = words<{ attachUnavailableTitle: string }>("az", "mtmAgentSection")
    await until(() => Boolean(container.querySelector("[data-testid='mtm-agent-attach-unavailable']")), "the explanation")

    expect(container.querySelector("[data-testid='mtm-agent-attach-unavailable']")?.textContent).toContain(section.attachUnavailableTitle)
    expect(container.querySelector("[data-testid='mtm-contact-explorer']")).toBeNull()
    expect(listCalls().some((params) => params.get("assignmentState") === "UNASSIGNED")).toBe(false)
  })

  it("offers no attach or detach button to someone who may only look", async () => {
    canTransfer = false
    const { container } = await openSection()
    const scope = words<{ unassignFrom: string; transferToOther: string }>("az", "mtmContactExplorer.agentScope")
    await until(() => tableRows(container).length === 2, "the employee's clients")

    await tick(container, "c-rauf")

    expect(buttonNamed(container, fill(scope.unassignFrom, { name: ANAR.name }))).toBeUndefined()
    expect(buttonNamed(container, scope.transferToOther)).toBeUndefined()
  })

  it("says the employee was not found instead of an empty section", async () => {
    const { container } = await openSection({ agentId: "agent-gone" })
    const section = words<{ notFound: string }>("az", "mtmAgentSection")
    await until(() => Boolean(container.querySelector("[role='alert']")), "the refusal")

    expect(container.querySelector("[role='alert']")?.textContent).toContain(section.notFound)
    expect(listCalls()).toEqual([])
  })

  it.each(["en", "ru", "az"])("shows %s words, not message keys, on both tabs", async (locale) => {
    const assigned = await openSection({ locale })
    await until(() => tableRows(assigned.container).length === 2, "the employee's clients")
    await tick(assigned.container, "c-rauf")
    const assignedText = assigned.container.textContent ?? ""
    await act(async () => { root?.unmount() })
    document.body.innerHTML = ""

    const attach = await openSection({ locale, tab: "attach" })
    await until(() => tableRows(attach.container).length === 1, "the free client")
    await tick(attach.container, "c-nigar")

    for (const text of [assignedText, attach.container.textContent ?? ""]) {
      expect(text).not.toContain("mtmAgentSection.")
      expect(text).not.toContain("mtmContactExplorer.")
      expect(text).not.toContain("mtmAgents.")
    }
    expect([...assigned.missing, ...attach.missing]).toEqual([])
  })
})

describe("the Clients page after the explorer learned about sections", () => {
  it("still offers the responsible-employee filter, saved views and the address state", async () => {
    seed()
    stubServer()
    navigation.search = ""
    const { container } = await mount(createElement(MtmContactExplorer))
    await until(() => tableRows(container).length === 4, "every client")

    expect(container.querySelector("[data-testid='mtm-contact-owner']")).not.toBeNull()
    // There the assignment state is one of the «more filters», closed on a fresh page.
    expect(container.querySelector("[data-testid='mtm-contact-assignment-state']")).toBeNull()
    await click(container.querySelector("[data-testid='mtm-contact-more-filters']"))
    expect(container.querySelector("[data-testid='mtm-contact-assignment-state']")).not.toBeNull()
    expect(calls.some((call) => call.url.startsWith("/api/v1/mtm/contacts/views"))).toBe(true)
    expect(listCalls()[0].get("ownerAgentId")).toBeNull()
    expect(navigation.replace).toHaveBeenCalled()
  })
})
