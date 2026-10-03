// @vitest-environment jsdom
/**
 * Route & Field → "Access & permissions": the place inside the module where an
 * administrator gives, changes and takes away a person's field scope.
 *
 * Owner, 2026-10-03, after a manager with the module was refused by Clients and
 * Routes: "a manager must have the permission, and the module needs a section
 * where the admin grants permissions." Field scope is the employee card linked
 * to a login, so every choice here must end as the right write to the agent
 * endpoints. Rendered for real, with the real Russian copy; only the network
 * and the session are stubbed.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

type Messages = { [key: string]: string | Messages }
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8")) as Messages
function message(namespace: string, key: string): string | undefined {
  const node = (ru[namespace] as Messages | undefined)?.[key]
  return typeof node === "string" ? node : undefined
}
vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => {
    const t = (key: string, values?: Record<string, unknown>) => {
      const raw = message(namespace, key) ?? `${namespace}.${key}`
      // Enough ICU for this page: `{name}` and the `few` plural branch.
      const plural = raw.match(/^\{count, plural,.* few \{([^}]*)\}/)
      return (plural ? plural[1].replace("#", String(values?.count)) : raw)
        .replace(/\{(\w+)\}/g, (_match, name) => String(values?.[name] ?? ""))
    }
    t.has = (key: string) => message(namespace, key) !== undefined
    return t
  },
}))
const session = { data: { user: { id: "u-admin", role: "admin" } }, status: "authenticated" }
vi.mock("next-auth/react", () => ({ useSession: () => session }))

import { MtmAccessPanel } from "@/components/mtm/access-panel"
import { USER_HIDEABLE_MODULE_IDS } from "@/lib/user-module-access"

const user = (id: string, name: string, role: string, extra: Record<string, unknown> = {}) =>
  ({ id, name, email: `${id}@example.az`, role, isActive: true, hiddenModules: [], ...extra })
const users = [
  user("u-admin", "Togrul", "admin"),
  user("u-saida", "Saida", "manager"),
  user("u-rep", "Seymur", "sales"),
  user("u-lead", "Leyla", "manager"),
  user("u-office", "Aynur", "support", { hiddenModules: USER_HIDEABLE_MODULE_IDS.filter((id) => id === "mtm") }),
  user("u-gone", "Former", "sales", { isActive: false }),
]
type Card = {
  id: string; name: string; email: string | null; role: string; status: string; userId: string | null
  createdAt: string; canPlanOwnRoutes?: boolean; canSelfPublishRoutes?: boolean
}
let cards: Card[] = []
let writes: { url: string; method: string; body: unknown }[] = []
let refuseWrites = false

let root: Root
let container: HTMLDivElement
const row = (id: string) => document.querySelector(`[data-testid="mtm-access-row-${id}"]`) as HTMLElement
const select = (id: string) => row(id).querySelector("select")
const settle = async () => {
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
}
const choose = async (id: string, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select(id), value)
    select(id)?.dispatchEvent(new Event("change", { bubbles: true }))
  })
  await settle()
}

async function open(withCards: Card[], role = "admin") {
  cards = withCards
  session.data.user.role = role
  await act(async () => { root.render(createElement(MtmAccessPanel)) })
  await settle()
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  writes = []
  refuseWrites = false
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: { method?: string; body?: string }) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body })
    if (method !== "GET") {
      writes.push({ url, method, body: init?.body ? JSON.parse(init.body) : null })
      if (refuseWrites) return reply(403, { error: "Card linking is administrator work" })
      // The server's state after the write, so the re-read shows it.
      const body = JSON.parse(init?.body ?? "{}") as Partial<Card>
      if (method === "POST") {
        cards = [...cards, { id: "card-new", name: String(body.name), email: null, role: String(body.role), status: "ACTIVE", userId: body.userId ?? null, createdAt: "2026-10-03T00:00:00Z" }]
      } else {
        cards = cards.map((card) => (url.endsWith(`/${card.id}`) ? { ...card, ...body } : card))
      }
      return reply(200, { success: true })
    }
    if (url.includes("/mtm/agents")) return reply(200, { success: true, data: { agents: cards } })
    return reply(200, { success: true, data: users })
  }))
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
})

const card = (overrides: Partial<Card> & { id: string }): Card => ({
  name: "Card", email: null, role: "AGENT", status: "ACTIVE", userId: null, createdAt: "2026-09-01T00:00:00Z", ...overrides,
})

describe("Access & permissions — who works in the field and as what", () => {
  it("lists every active login with the scope it has today", async () => {
    await open([
      card({ id: "card-lead", name: "Leyla", role: "MANAGER", userId: "u-lead" }),
      card({ id: "card-mobile", name: "Rep without a login", email: "other@example.az" }),
      card({ id: "card-mobile-2", name: "Another rep" }),
    ])

    expect(row("u-admin").textContent).toContain("Вся организация — администратор CRM")
    expect(row("u-admin").querySelector("select")).toBeNull()
    expect(select("u-saida")?.value).toBe("none")
    expect(row("u-saida").textContent).toContain("Без доступа раздел у сотрудника не откроется.")
    expect(select("u-lead")?.value).toBe("MANAGER")
    expect(row("u-lead").textContent).toContain("Карточка: Leyla")
    expect(row("u-office").textContent).toContain("Модуль скрыт от этого сотрудника")
    expect(row("u-gone")).toBeNull()
    expect(document.body.textContent).toContain("Ещё 2 сотрудника работают только в мобильном приложении")
  })

  it("giving a manager the whole organization creates a card linked to the login", async () => {
    await open([])
    await choose("u-saida", "ADMIN")

    expect(writes).toEqual([
      { url: "/api/v1/mtm/agents", method: "POST", body: { name: "Saida", role: "ADMIN", userId: "u-saida" } },
    ])
    expect(select("u-saida")?.value).toBe("ADMIN")
  })

  it("links the card a field rep already has instead of making a second one", async () => {
    await open([card({ id: "card-rep", name: "Seymur M.", email: "U-REP@example.az " })])
    await choose("u-rep", "AGENT")

    expect(writes).toEqual([
      { url: "/api/v1/mtm/agents/card-rep", method: "PUT", body: { userId: "u-rep", role: "AGENT" } },
    ])
  })

  it("changing the level changes the card's role; taking access away unlinks the login and keeps the card", async () => {
    await open([card({ id: "card-lead", name: "Leyla", role: "MANAGER", userId: "u-lead" })])
    await choose("u-lead", "SUPERVISOR")
    await choose("u-lead", "none")

    expect(writes).toEqual([
      { url: "/api/v1/mtm/agents/card-lead", method: "PUT", body: { role: "SUPERVISOR" } },
      { url: "/api/v1/mtm/agents/card-lead", method: "PUT", body: { userId: null } },
    ])
    expect(select("u-lead")?.value).toBe("none")
  })

  it("lets an agent be allowed to plan and to publish routes", async () => {
    await open([card({ id: "card-rep", name: "Seymur", userId: "u-rep", canPlanOwnRoutes: false, canSelfPublishRoutes: false })])
    const [plan, publish] = [...row("u-rep").querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    expect([plan.checked, publish.checked]).toEqual([false, false])

    await act(async () => { plan.click() })
    await settle()

    expect(writes).toEqual([
      { url: "/api/v1/mtm/agents/card-rep", method: "PUT", body: { canPlanOwnRoutes: true } },
    ])
    expect(row("u-rep").querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[0].checked).toBe(true)
  })

  it("shows a refusal and puts the select back to what the server holds", async () => {
    await open([])
    refuseWrites = true
    await choose("u-saida", "ADMIN")

    expect(row("u-saida").textContent).toContain("Не удалось сохранить: Card linking is administrator work")
    expect(select("u-saida")?.value).toBe("none")
  })

  it("is closed to anyone but an administrator, and asks the API nothing", async () => {
    await open([], "manager")

    expect(document.body.textContent).toContain("Этот раздел открыт только администратору организации.")
    expect(fetch).not.toHaveBeenCalled()
  })
})
