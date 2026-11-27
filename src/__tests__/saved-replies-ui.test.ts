// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * «Готовые ответы» (settings/snippets), rebuilt on the owner's clickable mock (2026-11-27). On real
 * React in jsdom with only fetch, the session and the tour stubbed: what a person reads, what a
 * click sends, and that the stored body keeps the tokens the inbox composer fills.
 */
vi.mock("next-intl", () => ({
  useLocale: () => "ru",
  useTranslations: () => {
    const translate = (key: string) => key
    translate.has = () => false
    return translate
  },
}))
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { organizationId: "org-1", name: "Лейла Гасанова" } }, status: "authenticated" }),
}))
vi.mock("@/components/tour/tour-provider", () => ({ useAutoTour: () => undefined }))
vi.mock("@/components/tour/tour-replay-button", () => ({ TourReplayButton: () => null }))
vi.mock("@/components/help/help-button", () => ({ HelpButton: () => null }))

import SavedRepliesPage from "@/app/(dashboard)/settings/snippets/page"
import { serializeReplyEditor } from "@/components/inbox/saved-replies/reply-text-editor"

interface Row { id: string; shortcut: string; title: string; body: string; channelTypes: string[]; isActive: boolean; usageCount: number; sortOrder: number }

let container: HTMLDivElement
let root: Root
let rows: Row[]
let calls: Array<{ method: string; url: string; body: unknown }>
let failPut = false

function stubApi() {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, url, body })
    const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } })
    if (method === "GET") return json(200, { success: true, data: rows })
    if (method === "POST") {
      if (rows.some((row) => row.shortcut === body.shortcut)) return json(409, { error: "dup" })
      const row = { id: `r${rows.length + 1}`, usageCount: 0, sortOrder: 0, channelTypes: [], isActive: true, ...body }
      rows.push(row)
      return json(201, { success: true, data: row })
    }
    const id = url.split("/").pop()!
    if (method === "PUT") {
      if (failPut) return json(500, { error: "boom" })
      rows = rows.map((row) => (row.id === id ? { ...row, ...body } : row))
      return json(200, { success: true })
    }
    if (method === "DELETE") { rows = rows.filter((row) => row.id !== id); return json(200, { success: true }) }
    return json(404, {})
  }))
}

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  rows = []
  calls = []
  failPut = false
  stubApi()
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  document.body.innerHTML = ""
  vi.unstubAllGlobals()
})

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
const text = () => document.body.textContent ?? ""
const byTest = <T extends HTMLElement = HTMLElement>(id: string) => document.querySelector<T>(`[data-testid="${id}"]`)!
const buttonNamed = (name: string) => Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.trim() === name)!

async function render() {
  await act(async () => { root.render(createElement(SavedRepliesPage)) })
  await flush()
}

async function click(element: Element) {
  await act(async () => { (element as HTMLElement).click() })
  await flush()
}

async function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
  await flush()
}

/** Typing into the reply text: put the words in and tell React, as a keystroke would. */
async function writeReplyText(words: string) {
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

const reply = (over: Partial<Row>): Row => ({ id: "r1", shortcut: "privet", title: "Приветствие", body: "Здравствуйте, {{contact.first_name}}!", channelTypes: [], isActive: true, usageCount: 0, sortOrder: 0, ...over })

describe("the list of the team's replies", () => {
  it("shows one line per reply with the customer's data as words, not tokens", async () => {
    rows = [
      reply({ id: "r1", shortcut: "privet", usageCount: 3 }),
      reply({ id: "r2", shortcut: "zvonok", title: "Перезвонить", body: "{{contact.first_name}}, {{agent.name}} перезвонит.", channelTypes: ["whatsapp", "sms"], usageCount: 0 }),
    ]
    await render()

    const first = byTest("saved-reply-privet")
    expect(first.textContent).toContain("/privet")
    expect(first.textContent).toContain("Приветствие")
    expect(first.textContent).toContain("Здравствуйте, Имя клиента!")
    expect(first.textContent).toContain("использован 3 раза")
    expect(first.textContent).toContain("Все каналы")
    expect(text()).not.toContain("{{contact.first_name}}")
    expect(byTest("saved-reply-zvonok").textContent).toContain("Моё имя")
    expect(byTest("saved-reply-zvonok").textContent).toContain("ещё не использовался")
  })

  it("switches a reply off with one press, and puts it back when the server refuses", async () => {
    rows = [reply({ id: "r1" })]
    await render()
    const toggle = byTest("saved-reply-privet").querySelector<HTMLButtonElement>('[role="switch"]')!

    await click(toggle)
    expect(calls.find((call) => call.method === "PUT")).toMatchObject({ method: "PUT", url: "/api/v1/message-snippets/r1", body: { isActive: false } })
    expect(rows[0].isActive).toBe(false)
    expect(text()).toContain("Выключен — в списке не показывается, но не удалён")

    failPut = true
    const again = byTest("saved-reply-privet").querySelector<HTMLButtonElement>('[role="switch"]')!
    await click(again)
    expect(again.getAttribute("aria-checked")).toBe("false")
    expect(text()).toContain("Не получилось")
  })

  it("marks a stored reply whose text has a word the inbox will not fill", async () => {
    rows = [reply({ body: "Привет, {{contact.fullname}}" })]
    await render()
    expect(byTest("saved-reply-privet").textContent).toContain("В тексте есть неизвестное слово — исправьте")
  })
})

describe("the first visit", () => {
  it("offers ready replies and saves one with a single press, with the tokens the inbox fills", async () => {
    await render()
    expect(byTest("saved-replies-starters").textContent).toContain("Начните с готовых")
    expect(document.querySelector('[data-testid="saved-replies-list"]')).toBeNull()

    await click(byTest("saved-reply-starter-hello"))

    const post = calls.find((call) => call.method === "POST")!
    expect(post.body).toEqual({
      shortcut: "privet",
      title: "Приветствие",
      body: "Здравствуйте, {{contact.first_name}}! Меня зовут {{agent.name}}. Чем могу помочь?",
      channelTypes: [],
      isActive: true,
    })
    expect(byTest("saved-reply-privet").textContent).toContain("Приветствие")
    expect(byTest("saved-replies-starters").textContent).toContain("Добавлен")
    expect(text()).toContain("наберите /privet в переписке")
  })
})

describe("trying «/» on the page", () => {
  it("opens the team's active replies and inserts the text with a sample customer, counting nothing", async () => {
    rows = [
      reply({ id: "r1", shortcut: "privet", body: "Здравствуйте, {{contact.first_name}}! Меня зовут {{agent.name}}." }),
      reply({ id: "r2", shortcut: "pauza", title: "Выключенный", isActive: false }),
    ]
    await render()
    const input = byTest<HTMLInputElement>("saved-replies-demo-input")

    await typeInto(input, "/")
    const picker = byTest("saved-replies-demo-picker")
    expect(picker.textContent).toContain("/privet")
    expect(picker.textContent).not.toContain("/pauza")
    // The sample agent is the person signed in: their first name.
    expect(picker.textContent).toContain("Здравствуйте, Анна! Меня зовут Лейла.")

    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })) })
    await flush()
    expect(input.value).toBe("Здравствуйте, Анна! Меня зовут Лейла.")
    expect(calls.some((call) => call.url.includes("/use"))).toBe(false)
  })
})

describe("the window of a new reply", () => {
  it("keeps the shortcut one word, puts the customer's name in as a word, and stores the token", async () => {
    await render()
    await click(byTest("saved-replies-new"))

    await typeInto(document.querySelector<HTMLInputElement>("#saved-reply-shortcut")!, "Ünvan /Bakı")
    expect(document.querySelector<HTMLInputElement>("#saved-reply-shortcut")!.value).toBe("ünvanbakı")
    expect(byTest("saved-reply-state").textContent).toBe("Дайте ответу название")

    await typeInto(document.querySelector<HTMLInputElement>("#saved-reply-title")!, "Адрес")
    await writeReplyText("Ждём вас, ")
    await click(byTest("saved-reply-insert-contact.first_name"))
    await writeReplyText("! Низами 10.")

    const editor = byTest("saved-reply-text")
    expect(editor.textContent).toContain("Имя клиента")
    expect(byTest("saved-reply-preview").textContent).toBe("Ждём вас, Анна! Низами 10.")
    expect(text()).toContain("В SMS: 26 из 160 знаков")
    expect(byTest("saved-reply-state").textContent).toBe("Готово — можно сохранять")

    await click(byTest("saved-reply-save"))
    const post = calls.find((call) => call.method === "POST")!
    expect(post.body).toEqual({
      shortcut: "ünvanbakı",
      title: "Адрес",
      body: "Ждём вас, {{contact.first_name}}! Низами 10.",
      channelTypes: [],
      isActive: true,
    })
    expect(byTest("saved-reply-ünvanbakı").textContent).toContain("Ждём вас, Имя клиента! Низами 10.")
  })

  it("will not save a word another reply already uses, or a channel choice with no channel", async () => {
    rows = [reply({ id: "r1", shortcut: "privet" })]
    await render()
    await click(byTest("saved-replies-new"))
    await typeInto(document.querySelector<HTMLInputElement>("#saved-reply-shortcut")!, "privet")
    expect(byTest("saved-reply-state").textContent).toBe("Слово /privet уже занято другим ответом")
    expect(byTest<HTMLButtonElement>("saved-reply-save").disabled).toBe(true)

    await typeInto(document.querySelector<HTMLInputElement>("#saved-reply-shortcut")!, "adres")
    await typeInto(document.querySelector<HTMLInputElement>("#saved-reply-title")!, "Адрес")
    await writeReplyText("Низами 10")
    await click(buttonNamed("Только в выбранных"))
    expect(byTest("saved-reply-state").textContent).toBe("Выберите хотя бы один канал")
    await click(buttonNamed("SMS"))
    expect(byTest("saved-reply-state").textContent).toBe("Готово — можно сохранять")
  })

  it("opens a stored reply with its words in place and names an unknown one instead of saving it", async () => {
    rows = [reply({ id: "r1", body: "Привет, {{contact.first_name}} и {{contact.fullname}}" })]
    await render()
    await click(buttonNamed("Изменить"))

    const editor = byTest("saved-reply-text")
    expect(editor.querySelector('[data-reply-variable="contact.first_name"]')?.textContent).toBe("Имя клиента")
    expect(editor.textContent).toContain("{{contact.fullname}}")
    expect(byTest("saved-reply-state").textContent).toBe("{{contact.fullname}} не заменится данными клиента — удалите")
    expect(byTest<HTMLButtonElement>("saved-reply-save").disabled).toBe(true)
  })
})

describe("reading the text back from the editor", () => {
  it("reads browser line breaks as new lines and a variable as its token", () => {
    const box = document.createElement("div")
    box.innerHTML = 'Salam<div><span data-reply-variable="contact.first_name">Müştərinin adı</span>​, xoş gəldiniz</div><div><br></div><div>Sağ olun</div>'
    expect(serializeReplyEditor(box)).toBe("Salam\n{{contact.first_name}}, xoş gəldiniz\n\nSağ olun")
    const br = document.createElement("div")
    br.innerHTML = "Bir<br>İki<br>"
    expect(serializeReplyEditor(br)).toBe("Bir\nİki")
  })
})
