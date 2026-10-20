// @vitest-environment jsdom
/**
 * The task in one line at the top of «Полевые задачи» (owner, 2026-10-20:
 * «добавить задачу слишком длинный процесс… максимально облегчи»; «если людей
 * будет больше, то список будет длинный, так что надо сделать более
 * интерактивным»). Rendered for real with the Russian copy: «Кому» is found by
 * typing — Azerbaijani letters typed in Latin included — and chosen with the
 * keyboard; the line sends exactly whom, what and the day. Only the network,
 * the toast and the browser's missing layout APIs are stubbed. Fictional people.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

type Messages = { [key: string]: string | Messages }
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8")) as Messages
function message(namespace: string | undefined, key: string): string | undefined {
  let node: string | Messages | undefined = ru
  for (const part of [...(namespace ? namespace.split(".") : []), ...key.split(".")]) {
    node = typeof node === "object" ? node[part] : undefined
  }
  return typeof node === "string" ? node : undefined
}
vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => {
    const t = (key: string, values?: Record<string, unknown>) =>
      (message(namespace, key) ?? `${namespace}.${key}`).replace(/\{(\w+)\}/g, (_match, name) => String(values?.[name] ?? ""))
    t.has = (key: string) => message(namespace, key) !== undefined
    return t
  },
  useLocale: () => "ru",
}))
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("sonner", () => ({ toast: toasts }))

import { MtmTaskQuickAdd, recipientSections, type TaskRecipient } from "@/components/mtm/task-quick-add"
import { quickTaskDueDate } from "@/lib/mtm/task-quick-due"

const copy = (key: string, values?: Record<string, string | number>) =>
  message("mtmTaskQuickAdd", key)!.replace(/\{(\w+)\}/g, (_match, name) => String(values?.[name] ?? ""))

const PEOPLE: TaskRecipient[] = [
  { id: "a-elvin", name: "Elvin Məmmədov", teamId: "t-1", team: { id: "t-1", name: "Bakı — mərkəz" }, pushReady: true, onShift: true, routeToday: { planned: 6, visited: 3 } },
  { id: "a-aysel", name: "Aysel Quliyeva", teamId: "t-1", team: { id: "t-1", name: "Bakı — mərkəz" }, pushReady: false, onShift: false, routeToday: null },
  { id: "a-resad", name: "Rəşad Həsənov", teamId: "t-2", team: { id: "t-2", name: "Sumqayıt" }, pushReady: true, onShift: true, routeToday: null },
  { id: "a-nigar", name: "Nigar Əliyeva", teamId: null, team: null },
]
const BAKU = "Asia/Baku"

let root: Root
let container: HTMLDivElement
const fetchMock = vi.fn()
const onCreated = vi.fn()

async function render(props: Partial<Parameters<typeof MtmTaskQuickAdd>[0]> = {}) {
  await act(async () => {
    root.render(createElement(MtmTaskQuickAdd, { agents: PEOPLE, timezone: BAKU, onCreated, ...props }))
  })
}
const byTestId = <T extends Element = HTMLElement>(id: string) => document.querySelector(`[data-testid="${id}"]`) as T | null
function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}
const key = (target: Element, name: string) => target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }))
const optionNames = () => [...document.querySelectorAll('[role="option"]')].map((option) => option.querySelector(".font-semibold")?.textContent)
async function openWho() {
  await act(async () => { byTestId<HTMLButtonElement>("mtm-task-quick-who")!.click() })
  return byTestId<HTMLInputElement>("mtm-task-quick-search")!
}

beforeEach(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView = vi.fn()
  window.localStorage.clear()
  fetchMock.mockReset().mockResolvedValue({ ok: true, status: 201, json: async () => ({ success: true, data: { id: "task-1" } }) })
  vi.stubGlobal("fetch", fetchMock)
  onCreated.mockReset()
  toasts.success.mockReset()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ""
  vi.unstubAllGlobals()
})

describe("«Кому» is a search, not a long list", () => {
  it("finds a person by two letters, Azerbaijani ones typed in Latin, and by the team", async () => {
    await render()
    const search = await openWho()
    await act(async () => { type(search, "memm") })
    expect(optionNames()).toEqual(["Elvin Məmmədov"])
    expect(document.querySelector('[role="option"] mark')?.textContent).toBe("Məmm")
    await act(async () => { type(search, "sumq") })
    expect(optionNames()).toEqual(["Rəşad Həsənov"])
    await act(async () => { type(search, "zzz") })
    expect(document.body.textContent).toContain(copy("noMatches"))
  })

  it("tells, next to each name, the shift, today's route and whether the pop-up reaches the phone", async () => {
    await render()
    await openWho()
    const elvin = byTestId("mtm-task-quick-option-a-elvin")!.textContent
    expect(elvin).toContain(copy("onShiftRoute", { visited: 3, planned: 6 }))
    expect(elvin).toContain(copy("pushReady"))
    const aysel = byTestId("mtm-task-quick-option-a-aysel")!.textContent
    expect(aysel).toContain(copy("offShift"))
    expect(aysel).toContain(copy("pushOff"))
  })

  it("is chosen with the arrows and Enter, and then says whether the pop-up will reach the phone", async () => {
    await render()
    const search = await openWho()
    await act(async () => { type(search, "bak") })
    expect(optionNames()).toEqual(["Elvin Məmmədov", "Aysel Quliyeva"])
    await act(async () => { key(search, "ArrowDown") })
    await act(async () => { key(search, "Enter") })
    expect(byTestId("mtm-task-quick-who")!.textContent).toContain("Aysel Quliyeva")
    expect(byTestId("mtm-task-quick-reach")!.textContent).toBe(copy("reachNo"))
  })
})

describe("the line sends whom, what and the day", () => {
  it("creates the task due tomorrow at 18:00 company time, clears the text and keeps the person", async () => {
    await render()
    const search = await openWho()
    await act(async () => { type(search, "elv") })
    await act(async () => { key(search, "Enter") })
    await act(async () => { type(byTestId<HTMLInputElement>("mtm-task-quick-title")!, "  Bring the samples  ") })
    await act(async () => { byTestId<HTMLButtonElement>("mtm-task-quick-send")!.click() })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/v1/mtm/tasks")
    expect(init.method).toBe("POST")
    expect(JSON.parse(String(init.body))).toEqual({
      agentId: "a-elvin",
      title: "Bring the samples",
      dueDate: quickTaskDueDate("tomorrow", new Date(), BAKU)!.toISOString(),
    })
    expect(onCreated).toHaveBeenCalledTimes(1)
    expect(toasts.success).toHaveBeenCalledWith(copy("sent", { name: "Elvin Məmmədov" }))
    expect(byTestId<HTMLInputElement>("mtm-task-quick-title")!.value).toBe("")
    expect(byTestId("mtm-task-quick-who")!.textContent).toContain("Elvin Məmmədov")

    // Next time the empty search starts with him.
    await act(async () => { byTestId<HTMLButtonElement>("mtm-task-quick-who")!.click() })
    expect(document.querySelector('[role="group"]')?.getAttribute("aria-label")).toBe(copy("recent"))
    expect(optionNames()[0]).toBe("Elvin Məmmədov")
  })

  it("sends a task without a deadline when «Без срока» is chosen", async () => {
    await render({ defaultAgentId: "a-resad" })
    await act(async () => { type(byTestId<HTMLInputElement>("mtm-task-quick-title")!, "Call the clinic") })
    const due = byTestId<HTMLSelectElement>("mtm-task-quick-due")!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(due, "none")
      due.dispatchEvent(new Event("change", { bubbles: true }))
    })
    await act(async () => { byTestId<HTMLButtonElement>("mtm-task-quick-send")!.click() })
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({ agentId: "a-resad", title: "Call the clinic", dueDate: null })
  })

  it("sends nothing without a person or without the words, and says what is missing", async () => {
    await render()
    await act(async () => { type(byTestId<HTMLInputElement>("mtm-task-quick-title")!, "Orphan") })
    await act(async () => { byTestId<HTMLButtonElement>("mtm-task-quick-send")!.click() })
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(copy("chooseWho"))

    await act(async () => { root.render(createElement(MtmTaskQuickAdd, { agents: PEOPLE, timezone: BAKU, onCreated, defaultAgentId: "a-elvin" })) })
    await act(async () => { type(byTestId<HTMLInputElement>("mtm-task-quick-title")!, "   ") })
    await act(async () => { byTestId<HTMLButtonElement>("mtm-task-quick-send")!.click() })
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(copy("writeWhat"))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("the list with nothing typed", () => {
  it("puts recent people first, then everyone by team, and the people without a team last", () => {
    const sections = recipientSections(PEOPLE, "", ["a-resad", "gone-card"])
    expect(sections.map((section) => [section.kind, section.kind === "team" ? section.team : null, section.agents.map((agent) => agent.id)])).toEqual([
      ["recent", null, ["a-resad"]],
      ["team", "Bakı — mərkəz", ["a-elvin", "a-aysel"]],
      ["team", null, ["a-nigar"]],
    ])
  })
})
