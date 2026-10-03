// @vitest-environment jsdom
/**
 * Route & Field shows a login without an employee card ONE explanation in
 * place of the page — not a page whose every list prints "Forbidden" its own
 * way (owner's screenshots of Clients and Routes, 2026-10-03).
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

const ru = JSON.parse(readFileSync("messages/ru.json", "utf8")) as { mtmApiErrors: Record<string, string> }
vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string) =>
    namespace === "mtmApiErrors" ? ru.mtmApiErrors[key] ?? key : `${namespace}.${key}`,
}))
const session = { data: { user: { id: "u-1", role: "manager" } }, status: "authenticated" }
vi.mock("next-auth/react", () => ({ useSession: () => session }))

import { MtmFieldScopeGate } from "@/components/mtm/field-scope-gate"

let root: Root
let container: HTMLDivElement
const fetchMock = vi.fn()
/** Stands for a field page: it counts as mounted the moment it would start fetching. */
let pageMounts = 0
const Page = () => {
  pageMounts += 1
  return createElement("div", { "data-testid": "page" }, "clients list")
}
const notice = () => document.querySelector('[data-testid="mtm-field-scope-notice"]')
const page = () => document.querySelector('[data-testid="page"]')

async function open(role: string, answer: { status: number; body: unknown } | "network-error") {
  session.data.user.role = role
  if (answer === "network-error") fetchMock.mockRejectedValue(new Error("offline"))
  else fetchMock.mockResolvedValue({ status: answer.status, ok: answer.status < 400, json: async () => answer.body })
  await act(async () => { root.render(createElement(MtmFieldScopeGate, null, createElement(Page))) })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  pageMounts = 0
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
})

describe("Route & Field — a login without an employee card", () => {
  it("gets the explanation and where an administrator fixes it, and the page never mounts", async () => {
    await open("manager", { status: 403, body: { error: "…", code: "MTM_FIELD_SCOPE_REQUIRED" } })

    expect(notice()?.textContent).toContain("К вашей учётной записи не привязана карточка сотрудника")
    expect(notice()?.textContent).toContain("«Настройки» → «Пользователи»")
    expect(page()).toBeNull()
    expect(pageMounts).toBe(0)
  })

  it("does not let the page start fetching before the answer is known", async () => {
    session.data.user.role = "sales"
    fetchMock.mockReturnValue(new Promise(() => undefined))
    await act(async () => { root.render(createElement(MtmFieldScopeGate, null, createElement(Page))) })

    expect(pageMounts).toBe(0)
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
  })
})

describe("Route & Field — everyone else sees the page", () => {
  it("a person who has a card", async () => {
    await open("manager", { status: 200, body: { success: true, data: { agents: [] } } })
    expect([notice(), page()?.textContent]).toEqual([null, "clients list"])
  })

  it("a refusal that is not about a missing card is left to the page", async () => {
    await open("sales", { status: 403, body: { error: "Forbidden" } })
    expect([notice(), page()?.textContent]).toEqual([null, "clients list"])
  })

  it("a failed probe never hides the module", async () => {
    await open("manager", "network-error")
    expect([notice(), page()?.textContent]).toEqual([null, "clients list"])
  })

  it("an admin, who needs no card and is not asked", async () => {
    await open("admin", { status: 403, body: { code: "MTM_FIELD_SCOPE_REQUIRED" } })
    expect([notice(), page()?.textContent]).toEqual([null, "clients list"])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
