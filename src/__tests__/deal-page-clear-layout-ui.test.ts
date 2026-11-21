// @vitest-environment jsdom
/**
 * The deal page after the owner's redesign (2026-11-21: «раздел сделки
 * перегружен… раздели так, чтоб при желании детали раскрывались… но и чтоб не
 * теряло свою значимость»; later «при наведении на каждую карточку чтоб были
 * подсказки»; the clickable prototype was approved with «Давай»).
 *
 * The real page on real React with the Russian copy the owner reads and the
 * network stubbed. The first deal is his own, the one the page was redesigned
 * on: won, 3,500 AZN, invoice INV-2026-00060 of 4,130 AZN due 28 April and
 * unpaid, nobody answering for it and nobody to talk to. What is checked is
 * what the page does — what it shows, what it sends, what it refuses to send —
 * not which components it is made of. The blocks that live inside a section
 * (product lines, offers, the feed…) have their own tests and are stand-ins.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { readHint } from "./helpers/hint"

type Messages = { [key: string]: string | Messages }
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8")) as Messages
const copy = ru.dealPage as Record<string, string>

const stable = vi.hoisted(() => ({
  session: { data: { user: { id: "u-leyla", role: "admin", organizationId: "org-1", plan: "enterprise", modules: { crm: true, sales: true, procurement: true } } }, status: "authenticated" },
  router: { push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} },
  fields: { isVisible: () => true, isEditable: () => true },
}))
// A block that lives inside a section: its own tests cover it, here it only has to be there or not.
const { standIn } = vi.hoisted(() => ({ standIn: (name: string) => () => createElement("div", { "data-stand-in": name }) }))
vi.mock("next-auth/react", () => ({ useSession: () => stable.session }))
vi.mock("next/navigation", () => ({ useRouter: () => stable.router, useParams: () => ({ id: "deal-1" }), usePathname: () => "/deals/deal-1", useSearchParams: () => new URLSearchParams() }))
vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>()
  const translate = (namespace: string) => actual.createTranslator({ locale: "ru", messages: ru as never, namespace: (namespace || undefined) as never, onError: () => {} })
  const translators = new Map<string, ReturnType<typeof translate>>()
  return {
    useTranslations: (namespace = "") => {
      if (!translators.has(namespace)) translators.set(namespace, translate(namespace))
      return translators.get(namespace)!
    },
    useLocale: () => "ru",
  }
})
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
vi.mock("@/hooks/use-field-permissions", () => ({ useFieldPermissions: () => stable.fields }))
vi.mock("@/components/tour/tour-provider", () => ({ useAutoTour: () => {} }))
vi.mock("@/components/tour/tour-replay-button", () => ({ TourReplayButton: () => null }))
vi.mock("@/components/help/help-button", () => ({ HelpButton: () => null }))
vi.mock("@/components/ui/motion", () => ({ MotionPage: ({ children, className }: { children: unknown; className?: string }) => createElement("div", { className }, children as never) }))
vi.mock("@/components/deal-form", () => ({ DealForm: () => null }))
vi.mock("@/components/delete-confirm-dialog", () => ({ DeleteConfirmDialog: () => null }))
vi.mock("@/components/deals/deal-customer-details", () => ({ DealCustomerDetails: standIn("customer") }))
vi.mock("@/components/deals/quick-action-bar", () => ({ QuickActionBar: standIn("composer") }))
vi.mock("@/components/deals/activity-timeline", () => ({ ActivityTimeline: standIn("timeline") }))
vi.mock("@/components/deals/deal-meddpicc", () => ({ DealMeddpicc: standIn("meddpicc") }))
vi.mock("@/components/deals/ai-suggestions", () => ({ AiSuggestions: standIn("ai-suggestions") }))
vi.mock("@/components/deals/next-best-offers", () => ({ NextBestOffers: standIn("next-best-offers") }))
vi.mock("@/components/adaptive-ai/ai-feedback-widget", () => ({ AiFeedbackWidget: () => null }))
vi.mock("@/components/ai/advisor-record-widget", () => ({ AdvisorRecordWidget: standIn("advisor") }))
vi.mock("@/components/deals/deal-line-items", () => ({ DealLineItems: standIn("lines") }))
vi.mock("@/components/deals/deal-procurement-tab", () => ({ DealProcurementTab: standIn("procurement") }))
vi.mock("@/components/deals/deal-files", () => ({ DealFiles: standIn("files") }))
vi.mock("@/components/deals/deal-change-approvals", () => ({ DealChangeApprovals: standIn("approvals") }))
vi.mock("@/components/deals/offers-tab", () => ({ OffersTab: standIn("offers") }))
vi.mock("@/components/deals/invoices-tab", () => ({ InvoicesTab: standIn("invoices") }))
vi.mock("@/components/call-widget", () => ({ ClickToCallButton: ({ label }: { label?: string }) => createElement("button", { type: "button", "data-stand-in": "call" }, label) }))

import DealDetailPage from "@/app/(dashboard)/deals/[id]/page"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const STAGES = [
  { id: "s-lead", name: "LEAD", displayName: "Lead", color: "#6366f1" },
  { id: "s-prop", name: "PROPOSAL", displayName: "Proposal", color: "#f59e0b" },
  { id: "s-neg", name: "NEGOTIATION", displayName: "Negotiation", color: "#f97316" },
  { id: "s-won", name: "WON", displayName: "Won", color: "#22c55e", isWon: true },
  { id: "s-lost", name: "LOST", displayName: "Lost", color: "#ef4444", isLost: true },
]
const ownerDeal = () => ({
  id: "deal-1", name: "Zeytunpharma — New Deal", stage: "WON", pipelineId: "p1", valueAmount: 3500, currency: "AZN",
  probability: 100, confidenceLevel: 50, assignedTo: null as string | null, assignedToName: null as string | null, notes: null, expectedClose: null as string | null,
  stageChangedAt: null, createdAt: new Date(2026, 2, 17, 10).toISOString(), updatedAt: new Date(2026, 6, 29).toISOString(),
  lostReason: null as string | null, tags: [], contactId: null as string | null, customerNeed: null, salesChannel: null,
  company: { id: "c-zeytun", name: "\"ZEYTUN PHARMACEUTİCALS\" MMC" }, campaign: { id: "k1", name: "1+1 kampaniyası" },
  contact: null as null | { id: string; fullName: string; position: string | null; email: string | null; phone: string | null; avatar: string | null },
  teamMembers: [], contactRoles: [],
})
const ownerInvoice = () => ({
  id: "inv-60", invoiceNumber: "INV-2026-00060", title: "", status: "overdue", totalAmount: 4130, paidAmount: 0, balanceDue: 4130,
  currency: "AZN", issueDate: new Date(2026, 2, 29).toISOString(), dueDate: new Date(2026, 3, 28).toISOString(),
})

let world: {
  deal: ReturnType<typeof ownerDeal>
  invoices: Array<ReturnType<typeof ownerInvoice>>
  tasks: Array<{ id: string; title: string; dueDate: string | null; status: string }>
  rules: Record<string, Array<{ fieldName: string; ruleType: string; ruleValue?: string; errorMessage: string }>>
  /** What the server answers to a stage move: nothing special, or a refusal. */
  refuseStage: null | Array<{ field: string; message: string }>
}
let sent: Array<{ method: string; url: string; body: Record<string, unknown> }>
let container: HTMLDivElement
let root: Root

const json = (data: unknown, status = 200, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ success: status < 400, data, ...extra }), { status, headers: { "content-type": "application/json" } })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date(2026, 10, 21, 15, 0, 0))
  Element.prototype.scrollIntoView = () => {}
  vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => { run(0); return 0 })
  world = { deal: ownerDeal(), invoices: [ownerInvoice()], tasks: [], rules: {}, refuseStage: null }
  sent = []
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method || "GET"
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}
    if (method !== "GET") sent.push({ method, url, body })
    if (url === "/api/v1/deals/deal-1" && method === "PUT") {
      if (body.stage && world.refuseStage) return json(null, 422, { validationErrors: world.refuseStage })
      Object.assign(world.deal, body)
      if (body.assignedTo) world.deal.assignedToName = "Nazrin Shirinova"
      if (body.contactId) world.deal.contact = { id: String(body.contactId), fullName: "Aysel Mammadova", position: "Satınalma", email: "aysel@zeytun.az", phone: "+994501112233", avatar: null }
      return json(world.deal)
    }
    if (url === "/api/v1/deals/deal-1") return json(world.deal)
    if (url === "/api/v1/pipelines/p1") return json({ name: "Продажи", stages: STAGES })
    if (url.startsWith("/api/v1/pipeline-stages/") && url.endsWith("/rules")) return json(world.rules[url.split("/")[4]] || [])
    if (url.startsWith("/api/v1/invoices?")) return json({ invoices: world.invoices })
    if (url === "/api/v1/invoices/inv-60/payments" && method === "POST") {
      const amount = Number(body.amount)
      const invoice = world.invoices[0]
      invoice.paidAmount += amount
      invoice.balanceDue -= amount
      invoice.status = invoice.balanceDue > 0 ? "partially_paid" : "paid"
      return json({ id: "pay-1" }, 201)
    }
    if (url === "/api/v1/tasks" && method === "POST") {
      world.tasks.push({ id: `t${world.tasks.length + 1}`, title: String(body.title), dueDate: String(body.dueDate), status: "todo" })
      return json({ id: "t1" }, 201)
    }
    if (url.startsWith("/api/v1/tasks/") && method === "PATCH") {
      world.tasks = world.tasks.filter((task) => task.id !== url.split("/").pop())
      return json({})
    }
    if (url.startsWith("/api/v1/tasks?")) return url.includes("status=completed") ? json({ tasks: [], total: 0 }) : json({ tasks: world.tasks, total: world.tasks.length })
    if (url.startsWith("/api/v1/users")) return json({ users: [{ id: "u-nazrin", name: "Nazrin Shirinova", email: "n@x.az" }, { id: "u-leyla", name: "Leyla", email: "l@x.az" }] })
    if (url.startsWith("/api/v1/contacts")) return json({ contacts: [{ id: "ct-aysel", fullName: "Aysel Mammadova", position: "Satınalma", companyId: "c-zeytun" }] })
    return json([])
  }))
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)) }) }
const open = async () => { await act(async () => { root.render(createElement(DealDetailPage)) }); await flush() }
const text = (selector: string) => container.querySelector(selector)?.textContent ?? ""
const button = (label: string, scope: ParentNode = container) =>
  [...scope.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === label) as HTMLButtonElement | undefined
const press = async (target: Element | undefined | null) => { expect(target, "the control is on the page").toBeTruthy(); await act(async () => { (target as HTMLElement).click() }); await flush() }
const type = async (input: Element | null, value: string) => {
  expect(input, "the field is on the page").toBeTruthy()
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
  await act(async () => { setter.call(input, value); input!.dispatchEvent(new Event("input", { bubbles: true })) })
}
const submit = async (form: Element | null) => { expect(form).toBeTruthy(); await act(async () => { form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })) }); await flush() }
const todo = () => container.querySelector('[data-tour-id="deal-next-steps"]')!
const stage = (name: string) => container.querySelector(`button[data-stage="${name}"]`) as HTMLButtonElement
const moves = () => sent.filter((call) => call.method === "PUT" && "stage" in call.body)

describe("the owner's deal, as the page opens", () => {
  it("shows the four numbers, the three things to do, and keeps every detail closed", async () => {
    await open()
    expect(text('[data-testid="deal-tile-amount"]')).toContain("3,500 AZN")
    expect(text('[data-testid="deal-tile-payment"]')).toContain("0 из 4,130 AZN")
    expect(text('[data-testid="deal-tile-payment"]')).toContain("Долг 4,130 AZN")
    expect(text('[data-testid="deal-tile-owner"]')).toContain(copy.notAssigned)
    expect(text('[data-testid="deal-tile-next"]')).toContain(copy.notPlanned)

    const steps = [...todo().querySelectorAll("[data-step]")].map((row) => row.getAttribute("data-step"))
    expect(steps).toEqual(["pay:inv-60", "owner", "contact", "plan"])
    expect(todo().textContent).toContain("Получить оплату: 4,130 AZN")
    expect(todo().textContent).toContain("Счёт INV-2026-00060 просрочен на 207 дн.")
    expect(todo().textContent).toContain("0 из 3")

    // Nothing is open: no section's panel, no form, none of the heavy blocks but the kept product lines.
    expect(container.querySelector('[role="tabpanel"]')).toBeNull()
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(4)
    expect([...container.querySelectorAll("[data-stand-in]")].map((n) => n.getAttribute("data-stand-in"))).toEqual(["lines"])
    expect(container.querySelector("form")).toBeNull()
    expect(sent).toEqual([])
  })

  it("says under the cursor what every tile, section and stage is", async () => {
    await open()
    for (const id of ["amount", "payment", "owner", "next"]) {
      expect(await readHint(container.querySelector(`[data-testid="deal-tile-${id}"]`)), `tile ${id}`).toBeTruthy()
    }
    for (const tab of container.querySelectorAll('[role="tab"]')) expect(await readHint(tab), tab.textContent ?? "").toBeTruthy()
    expect(await readHint(stage("LEAD"))).toContain("Лид")
    expect(await readHint(stage("WON"))).toBe(copy.stageHintCurrent)
    expect(await readHint(stage("LOST"))).toBe(copy.stageHintLost)
  })

  it("puts «lost» apart from the track and marks the passed stages", async () => {
    await open()
    const order = [...container.querySelectorAll("button[data-stage]")].map((b) => b.getAttribute("data-stage"))
    expect(order).toEqual(["LEAD", "PROPOSAL", "NEGOTIATION", "WON", "LOST"])
    expect(stage("WON").getAttribute("aria-current")).toBe("step")
    expect(stage("LOST").getAttribute("aria-current")).toBeNull()
  })
})

describe("what to do now is done on the spot", () => {
  it("refuses a payment above the debt and sends nothing; records a part, and the numbers follow", async () => {
    await open()
    await press(button(copy.recordPayment, todo()))
    const form = todo().querySelector("form")
    await type(form!.querySelector('input[inputmode="decimal"]'), "9999")
    await submit(form)
    expect(todo().querySelector('[role="alert"]')?.textContent).toContain("Долг 4,130 AZN, больше записать нельзя")
    expect(sent).toEqual([])

    await type(todo().querySelector('form input[inputmode="decimal"]'), "1000")
    await submit(todo().querySelector("form"))
    expect(sent).toEqual([{ method: "POST", url: "/api/v1/invoices/inv-60/payments", body: { amount: 1000, paymentDate: "2026-11-21" } }])
    expect(text('[data-testid="deal-tile-payment"]')).toContain("1,000 из 4,130 AZN")
    expect(text('[data-testid="deal-tile-payment"]')).toContain("Долг 3,130 AZN")
    expect(todo().textContent).toContain("Получить оплату: 3,130 AZN")
    expect(todo().querySelector("form")).toBeNull()
  })

  it("the owner tile opens the choice of a person; the choice is saved and the step is ticked", async () => {
    await open()
    await press(container.querySelector('[data-testid="deal-tile-owner"]'))
    await press(button("NNazrin Shirinova", todo()))
    expect(sent).toEqual([{ method: "PUT", url: "/api/v1/deals/deal-1", body: { assignedTo: "u-nazrin" } }])
    expect(text('[data-testid="deal-tile-owner"]')).toContain("Nazrin Shirinova")
    expect(todo().textContent).toContain("Ответственный: Nazrin Shirinova")
    expect(todo().textContent).toContain("1 из 3")
  })

  it("plans a task for the deal with a date, and the «next step» tile shows it", async () => {
    await open()
    await press(container.querySelector('[data-testid="deal-tile-next"]'))
    const form = todo().querySelector("form")!
    await submit(form)
    expect(todo().querySelector('[role="alert"]')?.textContent).toContain(copy.errPlanText)
    expect(sent).toEqual([])
    await type(form.querySelector("#deal-plan-title"), "обсудить оплату счёта")
    await submit(todo().querySelector("form"))
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ method: "POST", url: "/api/v1/tasks", body: { title: "обсудить оплату счёта", relatedType: "deal", relatedId: "deal-1", assignedTo: "u-leyla" } })
    expect(new Date(String(sent[0].body.dueDate)).getDate()).toBe(24)
    expect(text('[data-testid="deal-tile-next"]')).toContain("обсудить оплату счёта")
    expect(todo().querySelector("[data-plan]")?.textContent).toContain("24 ноября · через 3 дн.")
    expect(text('[data-testid="deal-tile-next"]')).toContain("24 ноября")
  })

  it("when everything is done the list folds into one line", async () => {
    world.deal.assignedTo = "u-nazrin"; world.deal.assignedToName = "Nazrin Shirinova"; world.deal.contactId = "ct-aysel"
    world.deal.contact = { id: "ct-aysel", fullName: "Aysel Mammadova", position: null, email: null, phone: null, avatar: null }
    Object.assign(world.invoices[0], { status: "paid", paidAmount: 4130, balanceDue: 0 })
    await open()
    expect(todo().textContent).toContain(copy.allDone)
    expect(todo().textContent).toContain("3 из 3")
    expect([...todo().querySelectorAll("[data-step]")].map((row) => row.getAttribute("data-step"))).toEqual(["plan"])
    expect(text('[data-testid="deal-tile-payment"]')).toContain(copy.paidInFull)
    await press(button(copy.showSteps, todo()))
    expect(todo().querySelectorAll("[data-step]")).toHaveLength(4)
  })
})

describe("moving the deal", () => {
  const atNegotiation = () => { world.deal.stage = "NEGOTIATION"; world.invoices = [] }

  it("lists what the next stage asks for, and does not move the deal while it is unmet", async () => {
    world.deal.stage = "LEAD"; world.invoices = []
    world.rules["s-prop"] = [{ fieldName: "expectedClose", ruleType: "required", errorMessage: "Укажите ожидаемую дату закрытия" }]
    await open()
    expect(todo().textContent).toContain("Укажите ожидаемую дату закрытия")
    expect(todo().textContent).toContain("нужно, чтобы перейти на «Предложение»")

    await press(stage("PROPOSAL"))
    expect(text('[data-testid="deal-stage-guard"]')).toContain("Пока нельзя перевести на «Предложение»")
    expect(text('[data-testid="deal-stage-guard"]')).toContain("Укажите ожидаемую дату закрытия")
    expect(moves()).toEqual([])
    expect(stage("LEAD").getAttribute("aria-current")).toBe("step")
  })

  it("moves between open stages at once", async () => {
    world.deal.stage = "LEAD"; world.invoices = []
    await open()
    await press(stage("PROPOSAL"))
    expect(moves()).toEqual([{ method: "PUT", url: "/api/v1/deals/deal-1", body: { stage: "PROPOSAL" } }])
    expect(stage("PROPOSAL").getAttribute("aria-current")).toBe("step")
  })

  it("shows the server's refusal in place: the server is the authority on a stage's rules", async () => {
    world.deal.stage = "LEAD"; world.invoices = []
    world.refuseStage = [{ field: "tasks", message: "Сначала закройте задачу по сделке" }]
    await open()
    await press(stage("PROPOSAL"))
    expect(text('[data-testid="deal-stage-guard"]')).toContain("Сначала закройте задачу по сделке")
    expect(stage("LEAD").getAttribute("aria-current")).toBe("step")
  })

  it("asks before «won»: it sets off the customer survey and the notifications", async () => {
    atNegotiation()
    await open()
    await press(stage("WON"))
    expect(text('[data-testid="deal-won-confirm"]')).toContain("Перевести сделку на «Выиграна»?")
    expect(moves()).toEqual([])
    await press(button(copy.wonConfirm, container.querySelector('[data-testid="deal-won-confirm"]')!))
    expect(moves()).toEqual([{ method: "PUT", url: "/api/v1/deals/deal-1", body: { stage: "WON" } }])
  })

  it("«lost» does not happen without a reason, and the reason is saved with it", async () => {
    atNegotiation()
    await open()
    await press(stage("LOST"))
    const form = container.querySelector('[data-testid="deal-lost-form"]')!
    await submit(form)
    expect(form.querySelector('[role="alert"]')?.textContent).toContain(copy.errReason)
    expect(moves()).toEqual([])

    await press(button("Цена", form))
    await type(form.querySelector("#deal-lost-note"), "вернуться через полгода")
    await submit(container.querySelector('[data-testid="deal-lost-form"]'))
    expect(moves()).toEqual([{ method: "PUT", url: "/api/v1/deals/deal-1", body: { stage: "LOST", lostReason: "Цена. вернуться через полгода" } }])
    expect(todo().textContent).toContain(copy.lostTitle)
    expect(todo().textContent).toContain("причина: Цена. вернуться через полгода")

    // A lost deal has one thing to do on it: take it back to work.
    await press(button(copy.reopen, todo()))
    expect(moves().at(-1)?.body).toEqual({ stage: "NEGOTIATION" })
  })
})

describe("the details open on demand", () => {
  it("a section opens in place with its parts; a tile leads to the right one", async () => {
    await open()
    const tabs = [...container.querySelectorAll('[role="tab"]')] as HTMLButtonElement[]
    expect(tabs.map((tab) => tab.querySelector("span.text-sm")?.textContent)).toEqual(["Клиент", "Продажа", "Деньги и закупки", "История"])
    expect(tabs[2].textContent).toContain("Счета: 1 · закупки")

    await press(tabs[3])
    const panel = container.querySelector('[role="tabpanel"]')!
    expect([...panel.querySelectorAll("button[data-part]")].map((b) => b.getAttribute("data-part"))).toEqual(["feed", "stages", "files"])
    expect(panel.querySelector('[data-stand-in="timeline"]')).not.toBeNull()

    await press(container.querySelector('[data-testid="deal-tile-payment"]'))
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain("Деньги и закупки")
    expect(container.querySelector('[role="tabpanel"] [data-stand-in="invoices"]')).not.toBeNull()
    expect(container.querySelector('[data-stand-in="timeline"]')).toBeNull()

    await press(button(copy.collapse, container.querySelector('[role="tabpanel"]')!))
    expect(container.querySelector('[role="tabpanel"]')).toBeNull()
  })

  it("«reach out» without a contact says so and leads to adding one", async () => {
    await open()
    await press(button(copy.reach))
    const panel = container.querySelector('[data-testid="deal-reach"]')!
    expect(panel.textContent).toContain(copy.reachNoContact)
    await press(button(copy.addContact, panel))
    await press(button("AAysel MammadovaSatınalma", todo()))
    expect(sent).toEqual([{ method: "PUT", url: "/api/v1/deals/deal-1", body: { contactId: "ct-aysel" } }])

    // With a contact who has a phone: a call, a letter, and WhatsApp opened with the reminder about this invoice.
    await press(button(copy.reach))
    const reach = container.querySelector('[data-testid="deal-reach"]')!
    expect(reach.textContent).toContain("Aysel Mammadova")
    const link = reach.querySelector('a[href^="https://wa.me/"]') as HTMLAnchorElement
    expect(link.href.startsWith("https://wa.me/994501112233?text=")).toBe(true)
    expect(decodeURIComponent(link.href.split("?text=")[1])).toContain("INV-2026-00060 на 4,130 AZN")
  })
})
