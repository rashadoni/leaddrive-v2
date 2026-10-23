// @vitest-environment jsdom
/**
 * The reviewer panel as the admin sees it, with the real Russian copy: the
 * list says how many days are left and how many views were made, the dialog
 * sends exactly the ticked sections and the end of the picked day, the
 * password is shown once, and «Закрыть доступ сейчас» closes it.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

type Messages = { [key: string]: string | Messages }
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8")) as Messages
// The real translator with the real Russian copy: plural forms are part of
// what is being checked.
vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>()
  return {
    useTranslations: (namespace?: string) =>
      actual.createTranslator({ locale: "ru", messages: ru as never, namespace: namespace as never }),
    useLocale: () => "ru",
  }
})
const session = {
  data: {
    user: {
      id: "u-admin", organizationId: "org-1", role: "admin", plan: "enterprise", addons: [], hiddenModules: [],
      modules: { crm: true, sales: true, finance: true, settings: true },
    },
  },
  status: "authenticated",
}
vi.mock("next-auth/react", () => ({ useSession: () => session }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { ReviewerAccessPanel } from "@/components/settings/reviewer-access-panel"

const inDays = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
let grants: unknown[] = []
let calls: { url: string; method: string; body: unknown }[] = []
let root: Root
let container: HTMLDivElement

function setValue(element: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value)
  element.dispatchEvent(new Event("input", { bubbles: true }))
}
const buttonByText = (text: string) =>
  [...document.querySelectorAll("button")].find((button) => button.textContent?.includes(text)) as HTMLButtonElement | undefined
const settle = async () => { for (let i = 0; i < 5; i += 1) await act(async () => { await Promise.resolve() }) }

beforeEach(async () => {
  calls = []
  grants = [{
    id: "g1", name: "Аудитор", email: "audit@firma.az", modules: ["crm"], reason: "NDA", expiresAt: inDays(3),
    createdAt: inDays(-1), revokedAt: null, lastLogin: null, open: true, reads: 4,
  }]
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET"
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (url === "/api/v1/reviewer-access" && method === "POST") {
      return new Response(JSON.stringify({ success: true, data: { id: "g2", email: "new@firma.az", password: "Aa1!secret-once", expiresAt: inDays(7) } }), { status: 201 })
    }
    if (url === "/api/v1/reviewer-access") return new Response(JSON.stringify({ success: true, data: grants }))
    if (method === "DELETE") return new Response(JSON.stringify({ success: true }))
    return new Response(JSON.stringify({ success: true, data: [] }))
  }))
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(createElement(ReviewerAccessPanel)) })
  await settle()
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe("reviewer access panel", () => {
  it("lists a grant with days left and views made", () => {
    const row = document.querySelector('[data-testid="reviewer-access-row"]')!
    expect(row.textContent).toContain("Аудитор")
    expect(row.textContent).toContain("до ")
    expect(row.textContent).toMatch(/Осталось 3 дня|Осталось 4 дня/)
    expect(row.textContent).toContain("4 просмотра")
    expect(buttonByText("Закрыть доступ сейчас")).toBeTruthy()
  })

  it("sends the ticked sections and the end of the picked day, then shows the password once", async () => {
    await act(async () => buttonByText("Дать доступ проверяющему")!.click())
    const dialog = document.querySelector('[data-testid="reviewer-access-dialog"]')!
    await act(async () => {
      setValue(dialog.querySelector("#reviewer-name") as HTMLInputElement, "Новый проверяющий")
      setValue(dialog.querySelector("#reviewer-email") as HTMLInputElement, "new@firma.az")
      setValue(dialog.querySelector("#reviewer-reason") as HTMLInputElement, "Проверка по NDA")
    })
    const boxes = [...dialog.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[]
    expect(boxes.length).toBeGreaterThan(1)
    await act(async () => boxes[0].click())
    const submit = [...dialog.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Дать доступ")!
    await act(async () => submit.click())
    await settle()

    const sent = calls.find((call) => call.method === "POST")!.body as { modules: string[]; expiresAt: string; reason: string }
    expect(sent.modules).toHaveLength(1)
    expect(sent.reason).toBe("Проверка по NDA")
    const end = new Date(sent.expiresAt)
    expect(end.getHours()).toBe(23)
    expect(end.getTime() - Date.now()).toBeLessThanOrEqual(31 * 24 * 60 * 60 * 1000)

    const credentials = document.querySelector('[data-testid="reviewer-access-credentials"]')!
    expect(credentials.textContent).toContain("Aa1!secret-once")
    expect(credentials.textContent).toContain("new@firma.az")
  })

  it("closes the access now", async () => {
    await act(async () => buttonByText("Закрыть доступ сейчас")!.click())
    await settle()
    expect(calls.some((call) => call.method === "DELETE" && call.url === "/api/v1/reviewer-access/g1")).toBe(true)
  })
})
