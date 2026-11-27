// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * «Автоответы» (inbox/chatbot-rules), built on the owner's clickable mock (2026-11-27) and merged
 * with the former «Автоматизация». On real React in jsdom with only fetch, the session and the tour
 * stubbed: what a person reads, what each press sends, and that the old address leads here.
 */
vi.mock("next-intl", () => ({
  useLocale: () => "ru",
  useTranslations: () => Object.assign((key: string) => key, { has: () => false }),
}))
const session = { data: { user: { organizationId: "org-1", name: "Лейла" } }, status: "authenticated" }
vi.mock("next-auth/react", () => ({ useSession: () => session }))
vi.mock("@/components/tour/tour-provider", () => ({ useAutoTour: () => undefined }))
vi.mock("@/components/tour/tour-replay-button", () => ({ TourReplayButton: () => null }))
vi.mock("@/components/help/help-button", () => ({ HelpButton: () => null }))
const redirect = vi.fn()
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }))

import AutoRepliesPage from "@/app/(dashboard)/inbox/chatbot-rules/page"
import InboxAutomationMovedPage from "@/app/(dashboard)/inbox/automation/page"

interface Row { id: string; name: string; status: string; channelTypes: string[]; triggerType: string; triggerValue: string | null; responseText: string; priority: number; matchCount: number; createdAt: string; handoffUserIds: string[] }

let container: HTMLDivElement
let root: Root
let rules: Row[]
let features: string[]
let calls: Array<{ method: string; url: string; body: unknown }>

const PEOPLE = [{ id: "u-leyla", name: "Лейла Гасанова" }, { id: "u-rustam", name: "Рустам Алиев" }]
const SAVED = [
  { id: "s1", shortcut: "privet", title: "Приветствие", body: "Здравствуйте, {{contact.first_name}}! Меня зовут {{agent.name}}.", isActive: true },
  { id: "s2", shortcut: "cena", title: "Цена", body: "{{contact.first_name}}, какой товар вас интересует?", isActive: true },
]

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  rules = []
  features = ["chatbotAutoReply"]
  calls = []
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, url, body })
    const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } })
    if (url.startsWith("/api/v1/settings/ai-features")) {
      if (method === "PATCH") features = body.action === "add" ? [...features, body.feature] : features.filter((f) => f !== body.feature)
      return json(200, { data: { features } })
    }
    if (url.startsWith("/api/v1/users/assignable")) return json(200, { success: true, data: PEOPLE })
    if (url.startsWith("/api/v1/divisions")) return json(200, { data: { divisions: [{ id: "b1", key: "SAL", name: "Продажи" }] } })
    if (url.startsWith("/api/v1/message-snippets")) return json(200, { success: true, data: SAVED })
    if (url === "/api/v1/inbox/chatbot-rules") {
      if (method === "POST") {
        const row = { id: `r${rules.length + 1}`, matchCount: 0, createdAt: "2026-11-27", channelTypes: [], handoffUserIds: [], priority: 0, ...body }
        rules.push(row)
        return json(201, { success: true, data: row })
      }
      return json(200, { success: true, data: [...rules].sort((a, b) => b.priority - a.priority) })
    }
    const id = url.split("/").pop()!
    if (method === "PATCH") { rules = rules.map((r) => (r.id === id ? { ...r, ...body } : r)); return json(200, { success: true }) }
    if (method === "DELETE") { rules = rules.filter((r) => r.id !== id); return json(200, { success: true }) }
    return json(404, {})
  }))
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  document.body.innerHTML = ""
  vi.unstubAllGlobals()
})

const flush = () => act(async () => { for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0)) })
const text = () => document.body.textContent ?? ""
const byTest = <T extends HTMLElement = HTMLElement>(id: string) => document.querySelector<T>(`[data-testid="${id}"]`)!
const buttonNamed = (name: string, scope: ParentNode = document) => Array.from(scope.querySelectorAll("button")).find((b) => b.textContent?.trim() === name)!
async function click(el: Element) { await act(async () => { (el as HTMLElement).click() }); await flush() }
async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value)
    el.dispatchEvent(new Event("input", { bubbles: true }))
  })
  await flush()
}
async function press(el: HTMLElement, key: string) {
  await act(async () => { el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })) })
  await flush()
}
/** Typing into the reply text: put the words in and tell React, as a keystroke would. */
async function writeReply(words: string) {
  const editor = byTest("saved-reply-text")
  await act(async () => {
    editor.append(document.createTextNode(words))
    const range = document.createRange()
    range.selectNodeContents(editor)
    range.collapse(false)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    editor.dispatchEvent(new Event("input", { bubbles: true }))
    editor.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
  })
  await flush()
}
async function render() { await act(async () => root.render(createElement(AutoRepliesPage))); await flush() }

const row = (over: Partial<Row>): Row => ({
  id: "r1", name: "Доставка", status: "active", channelTypes: [], triggerType: "contains", triggerValue: "доставка, çatdırılma",
  responseText: "{{contact.first_name}}, напишите адрес.", priority: 2, matchCount: 17, createdAt: "2026-11-01", handoffUserIds: [], ...over,
})

describe("the page of auto-replies", () => {
  it("shows each rule as a sentence: the words, the reply and who gets the conversation", async () => {
    rules = [row({ handoffUserIds: ["u-leyla"] }), row({ id: "r2", name: "Приветствие", triggerType: "first_message", triggerValue: null, responseText: "Salam!", priority: 1, matchCount: 0, status: "paused" })]
    await render()

    const first = byTest("ar-rule-0")
    expect(first.textContent).toContain("Если пишут")
    expect(first.textContent).toContain("доставка")
    expect(first.textContent).toContain("çatdırılma")
    expect(first.textContent).toContain("«Имя клиента, напишите адрес.»")
    expect(text()).not.toContain("{{contact.first_name}}")
    expect(first.textContent).toContain("передать Лейла Гасанова")
    expect(first.textContent).toContain("сработало 17 раз")
    const second = byTest("ar-rule-1")
    expect(second.textContent).toContain("На первое сообщение в переписке")
    expect(second.textContent).toContain("ещё не срабатывало")
    expect(second.querySelector('[role="switch"]')!.getAttribute("aria-checked")).toBe("false")
  })

  it("turns all auto-replies off with the one switch, and says the rules now answer nobody", async () => {
    rules = [row({})]
    await render()
    expect(byTest("ar-status").textContent).toContain("Автоответы включены")

    await click(byTest("ar-status").querySelector('[role="switch"]')!)
    expect(calls.find((c) => c.method === "PATCH")).toMatchObject({ url: "/api/v1/settings/ai-features", body: { feature: "chatbotAutoReply", action: "remove" } })
    expect(byTest("ar-status").textContent).toContain("Автоответы выключены")
    expect(byTest("ar-warn-off").textContent).toContain("правила ниже сейчас никому не отвечают")
  })

  it("lets you write as a customer and see the rule that fires, its reply and the hand-over — sending nothing", async () => {
    rules = [row({ handoffUserIds: ["u-leyla"], channelTypes: ["whatsapp"] })]
    await render()

    await type(byTest<HTMLInputElement>("ar-test-input"), "Salam, çatdirilma neçəyədir?")
    await click(byTest("ar-test-run"))
    const chat = byTest("ar-test-chat").textContent
    expect(chat).toContain("Сработало правило «Доставка»")
    expect(chat).toContain("Анна, напишите адрес.")
    expect(chat).toContain("Переписка передана: Лейла Гасанова")
    expect(chat).toContain("Сработает только в: WhatsApp")
    expect(calls.filter((c) => c.method !== "GET")).toEqual([])

    await type(byTest<HTMLInputElement>("ar-test-input"), "добрый день")
    await click(byTest("ar-test-run"))
    expect(byTest("ar-test-chat").textContent).toContain("Ни одно правило не подошло — ответит ИИ-агент или менеджер")
  })

  it("tries the greeting only when the box says this is the customer's first message", async () => {
    rules = [row({ id: "g", name: "Приветствие", triggerType: "first_message", triggerValue: null, responseText: "Salam!", priority: 9 }), row({ priority: 1 })]
    await render()
    await type(byTest<HTMLInputElement>("ar-test-input"), "доставка есть?")
    await click(byTest("ar-test-run"))
    expect(byTest("ar-test-chat").textContent).toContain("«Доставка»")

    await click(byTest("ar-test-first"))
    await type(byTest<HTMLInputElement>("ar-test-input"), "доставка есть?")
    await click(byTest("ar-test-run"))
    expect(byTest("ar-test-chat").textContent).toContain("«Приветствие»")
  })

  it("moves a rule down with an arrow by writing the new order", async () => {
    rules = [row({ id: "a", name: "A", priority: 2 }), row({ id: "b", name: "B", priority: 1 })]
    await render()
    await click(byTest("ar-rule-0").querySelector('[aria-label="Ниже"]')!)

    const writes = calls.filter((c) => c.method === "PATCH").map((c) => [c.url, c.body])
    expect(writes).toEqual([["/api/v1/inbox/chatbot-rules/b", { priority: 2 }], ["/api/v1/inbox/chatbot-rules/a", { priority: 1 }]])
    expect(byTest("ar-rule-0").textContent).toContain("B")
  })

  it("on the first visit adds a ready rule with one press, switched on", async () => {
    features = []
    await render()
    expect(byTest("ar-starters").textContent).toContain("Начните с готовых")

    await click(byTest("ar-starter-greeting"))
    expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({
      name: "Приветствие", status: "active", triggerType: "first_message", triggerValue: null,
      responseText: "Здравствуйте, {{contact.first_name}}! Спасибо, что написали — скоро ответим.", channelTypes: [],
    })
    expect(byTest("ar-rule-0").textContent).toContain("Приветствие")
    expect(text()).toContain("Правило «Приветствие» добавлено и уже работает")
  })

  it("keeps the lead block's switch off until a board is chosen", async () => {
    await render()
    await click(byTest("ar-lead").querySelector('[role="switch"]')!)
    expect(calls.some((c) => c.method === "PATCH")).toBe(false)
    expect(text()).toContain("Сначала выберите доску")
  })
})

describe("the window of a rule", () => {
  it("collects words one by one, puts the customer's name in, hands over to a person and sends exactly that", async () => {
    await render()
    await click(byTest("ar-new"))
    await type(document.querySelector<HTMLInputElement>("#ar-name")!, "Цена")
    const words = byTest<HTMLInputElement>("ar-word-input")
    await type(words, "цена"); await press(words, "Enter")
    await type(words, "qiymət"); await press(words, "Enter")
    expect(byTest("ar-words").textContent).toContain("цена")
    expect(byTest("ar-words").textContent).toContain("qiymət")

    await writeReply("Здравствуйте, ")
    await click(byTest("ar-insert-name"))
    expect(byTest("saved-reply-text").textContent).toContain("Имя клиента")
    expect(byTest("ar-preview").textContent).toContain("Здравствуйте, цена?")
    expect(byTest("ar-preview").textContent).toContain("Здравствуйте, Анна")

    expect(byTest("ar-state").textContent).toBe("Готово — можно сохранять")
    await click(buttonNamed("Передать сотруднику"))
    expect(byTest("ar-state").textContent).toBe("Выберите, кому передать")
    await click(buttonNamed("Рустам Алиев", byTest("ar-people")))
    expect(byTest("ar-preview").textContent).toContain("Переписка передана: Рустам Алиев")

    await click(byTest("ar-save"))
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({
      name: "Цена", triggerType: "contains", triggerValue: "цена, qiymət", responseText: "Здравствуйте, {{contact.first_name}}",
      channelTypes: [], handoffUserIds: ["u-rustam"], status: "active", priority: 0,
    })
  })

  it("takes a saved reply, but not one that says «My name» — the bot has none", async () => {
    await render()
    await click(byTest("ar-new"))
    await click(byTest("ar-pick-ready"))
    const list = byTest("ar-ready-list")
    const withAgent = Array.from(list.querySelectorAll("button")).find((b) => b.textContent?.includes("/privet"))!
    expect(withAgent.disabled).toBe(true)
    expect(withAgent.textContent).toContain("у бота нет имени")

    await click(Array.from(list.querySelectorAll("button")).find((b) => b.textContent?.includes("/cena"))!)
    expect(byTest("saved-reply-text").textContent).toBe("Имя клиента, какой товар вас интересует?")
    expect(byTest("ar-preview").textContent).toContain("Анна, какой товар вас интересует?")

    await writeReply(" Я {{agent.name}}")
    await type(document.querySelector<HTMLInputElement>("#ar-name")!, "X")
    await click(buttonNamed("Любое сообщение"))
    expect(byTest("ar-state").textContent).toBe("У бота нет имени — уберите «Моё имя»")
    expect(byTest<HTMLButtonElement>("ar-save").disabled).toBe(true)
  })

  it("opens an old «точно такой текст» rule with that choice and its text in place", async () => {
    rules = [row({ triggerType: "exact", triggerValue: "привет" })]
    await render()
    await click(buttonNamed("Изменить"))
    expect(buttonNamed("Точно такой текст").getAttribute("aria-checked")).toBe("true")
    expect(Array.from(document.querySelectorAll("input")).some((input) => input.value === "привет")).toBe(true)
  })
})

describe("the former «Автоматизация»", () => {
  it("leads to the auto-replies", () => {
    InboxAutomationMovedPage()
    expect(redirect).toHaveBeenCalledWith("/inbox/chatbot-rules")
  })
})
