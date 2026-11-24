// @vitest-environment jsdom
/**
 * «Вставить прайс» (owner 2026-11-24): paste, check the packages, save — each package goes through
 * the ordinary «Добавить знание» as a price, and nothing is saved before the person presses save.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>()
  const { default: messages } = await import("../../messages/ru.json")
  const translate = (namespace: string) => actual.createTranslator({ locale: "ru", messages: messages as never, namespace: namespace as never })
  const translators = new Map<string, ReturnType<typeof translate>>()
  return {
    ...actual,
    useLocale: () => "ru",
    useTranslations: (namespace: string) => {
      if (!translators.has(namespace)) translators.set(namespace, translate(namespace))
      return translators.get(namespace)
    },
  }
})

import { PriceListDialog } from "@/components/inbox-learning/price-list-dialog"

let container: HTMLDivElement
let root: Root
let calls: Array<{ url: string; body: unknown }>

function answer(parse: { status: number; body: unknown }) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null })
    if (String(url).endsWith("/price-list")) return new Response(JSON.stringify(parse.body), { status: parse.status })
    return new Response(JSON.stringify({ data: { item: { id: "x" } } }), { status: 201 })
  }))
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  calls = []
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

const flush = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)) })
const el = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
async function press(node: HTMLElement | null) {
  expect(node).not.toBeNull()
  await act(async () => node!.click())
  await flush()
}
async function type(node: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(node, value)
    node.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

describe("«Вставить прайс»", () => {
  it("lays the pasted text out as packages and saves each one as a price", async () => {
    answer({ status: 200, body: { data: { packages: [
      { title: "Başlanğıc", price: "160 AZN / ay", includes: ["500 dəqiqə"], body: "160 AZN / ay\n• 500 dəqiqə" },
      { title: "Biznes", price: "320 AZN / ay", includes: [], body: "320 AZN / ay" },
    ] } } })
    const onSaved = vi.fn()
    await act(async () => root.render(createElement(PriceListDialog, { channelId: "c1", onClose: vi.fn(), onSaved })))
    await type(el("price-list-text") as HTMLTextAreaElement, "Başlanğıc 160 AZN/ay, 500 dəqiqə\nBiznes 320 AZN/ay")
    await press(el("price-list-parse"))

    expect(calls).toEqual([{ url: "/api/v1/settings/inbox-learning/c1/price-list", body: { text: "Başlanğıc 160 AZN/ay, 500 dəqiqə\nBiznes 320 AZN/ay" } }])
    expect(document.querySelectorAll('[data-testid="price-list-package"]')).toHaveLength(2)
    expect(el("price-list-save")?.textContent).toContain("Сохранить 2 пакета")

    await press(el("price-list-save"))
    expect(calls.slice(1)).toEqual([
      { url: "/api/v1/settings/inbox-learning/c1/items", body: { type: "price", title: "Başlanğıc", body: "160 AZN / ay\n• 500 dəqiqə" } },
      { url: "/api/v1/settings/inbox-learning/c1/items", body: { type: "price", title: "Biznes", body: "320 AZN / ay" } },
    ])
    expect(onSaved).toHaveBeenCalledOnce()
  })

  it("says in words when the text has no prices, and saves nothing", async () => {
    answer({ status: 400, body: { error: "nothing_found" } })
    await act(async () => root.render(createElement(PriceListDialog, { channelId: "c1", onClose: vi.fn(), onSaved: vi.fn() })))
    await type(el("price-list-text") as HTMLTextAreaElement, "Salam")
    await press(el("price-list-parse"))
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("В тексте не нашлось цен. Проверьте, что у пакетов указана цена.")
    expect(calls.filter((c) => c.url.endsWith("/items"))).toEqual([])
  })
})
