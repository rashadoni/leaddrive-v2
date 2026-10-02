// @vitest-environment jsdom
/**
 * Route & Field tells a person without an employee card why its lists refuse
 * them — once, above the page — instead of each screen printing "Forbidden".
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

import { MtmFieldScopeNotice } from "@/components/mtm/field-scope-notice"

let root: Root
let container: HTMLDivElement
const fetchMock = vi.fn()

async function render(role: string, status: number, body: unknown) {
  session.data.user.role = role
  fetchMock.mockResolvedValue({ status, ok: status < 400, json: async () => body })
  await act(async () => { root.render(createElement(MtmFieldScopeNotice)) })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
  return document.querySelector('[data-testid="mtm-field-scope-notice"]')
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
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

describe("Route & Field — notice for a login without an employee card", () => {
  it("explains what is missing and where an administrator sets it", async () => {
    const notice = await render("manager", 403, { error: "…", code: "MTM_FIELD_SCOPE_REQUIRED" })

    expect(notice?.textContent).toContain("К вашей учётной записи не привязана карточка сотрудника")
    expect(notice?.textContent).toContain("«Настройки» → «Пользователи»")
  })

  it("stays silent for a person who has a card", async () => {
    expect(await render("manager", 200, { success: true, data: { agents: [] } })).toBeNull()
  })

  it("does not mistake another refusal for a missing card", async () => {
    expect(await render("sales", 403, { error: "Forbidden" })).toBeNull()
  })

  it("does not ask at all for an admin, who needs no card", async () => {
    expect(await render("admin", 403, { code: "MTM_FIELD_SCOPE_REQUIRED" })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
