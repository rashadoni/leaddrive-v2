// @vitest-environment jsdom
/**
 * The user card shows what the person ends up with while the admin is still
 * choosing — one row per module, the tick on the left, the outcome on the right.
 *
 * The owner, 2026-10-02: "I don't understand how the Roles section and the
 * user's own settings fit together." A manager left with Route & Field alone
 * read "full access to Deals" in the role table and saw no Deals. The page is
 * rendered for real, with the real Russian copy, the real role matrix and the
 * real mask; only the network and the session are stubbed.
 *
 * Route & Field has a third setting the other two do not show — the employee
 * card. The next day the same manager opened Clients and read "Forbidden":
 * she had the module and the role, and no card, and no screen let an admin
 * link one. The row now says so and carries the control.
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
// Stable objects: the page re-fetches whenever `session` changes identity.
const session = {
  data: {
    user: {
      id: "u-admin", organizationId: "org-1", role: "admin", plan: "enterprise", addons: [], hiddenModules: [],
      modules: { crm: true, sales: true, finance: true, mtm: true, settings: true },
    },
  },
  status: "authenticated",
}
const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }
const searchParams = new URLSearchParams()
vi.mock("next-auth/react", () => ({ useSession: () => session, signOut: vi.fn() }))
vi.mock("next/navigation", () => ({
  useRouter: () => router, useSearchParams: () => searchParams, usePathname: () => "/settings/users",
}))
vi.mock("@/components/tour/tour-provider", () => ({ useAutoTour: () => undefined, useTour: () => ({}) }))
vi.mock("@/components/tour/tour-replay-button", () => ({ TourReplayButton: () => null }))
vi.mock("@/components/help/help-button", () => ({ HelpButton: () => null }))

import UsersPage from "@/app/(dashboard)/settings/users/page"
import { TooltipProvider } from "@/components/ui/tooltip"
import { USER_HIDEABLE_MODULE_IDS } from "@/lib/user-module-access"

const person = {
  id: "u-1", name: "Field Manager", email: "field@example.az", role: "manager",
  hiddenModules: USER_HIDEABLE_MODULE_IDS.filter((id) => id !== "mtm"),
  phone: null, department: null, isActive: true, totpEnabled: false, require2fa: false, smsAuthEnabled: false,
  verifiedPhone: null, skills: [], maxTickets: 20, isAvailable: true, preferredLanguage: null,
  createdAt: "2026-10-02T10:00:00Z", lastLogin: null,
}
const roles = ["admin", "manager", "sales", "support", "ticketing", "viewer"]
  .map((id) => ({ id, name: id, color: "blue", isSystem: true, assignable: true }))

type Card = { id: string; name: string; role: string; status: string; userId: string | null; createdAt: string }
const spareCard: Card = { id: "card-spare", name: "Seymur", role: "AGENT", status: "ACTIVE", userId: null, createdAt: "2026-09-01T00:00:00Z" }
const takenCard: Card = { id: "card-taken", name: "Togrul", role: "MANAGER", status: "ACTIVE", userId: "u-admin", createdAt: "2026-08-01T00:00:00Z" }
const ownCard: Card = { id: "card-own", name: "Field Manager", role: "SUPERVISOR", status: "ACTIVE", userId: "u-1", createdAt: "2026-09-10T00:00:00Z" }
let cards: Card[] = []
let writes: { url: string; method: string; body: unknown }[] = []
let cardWriteStatus = 200

let root: Root
let container: HTMLDivElement

const settle = async () => {
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
}
const block = () => document.querySelector('[data-testid="user-access-outcome"]') as HTMLElement
/** module label → [ticked?, the outcome badge, the line under the row]. */
const rows = () => Object.fromEntries([...block().querySelectorAll("li")].map((row) => {
  const tick = row.querySelector<HTMLInputElement>('input[type="checkbox"]')
  const [label, badge] = [...row.querySelectorAll(":scope > div > *")].map((cell) => cell.textContent?.trim() ?? "")
  return [label, [tick ? tick.checked : null, badge, row.querySelector("p")?.textContent?.trim() ?? null]]
}))

beforeEach(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  writes = []
  cardWriteStatus = 200
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: { method?: string; body?: string }) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    const reply = (status: number, body: unknown) =>
      ({ ok: status < 400, status, headers: new Headers(), json: async () => body })
    if (method !== "GET") {
      writes.push({ url, method, body: init?.body ? JSON.parse(init.body) : null })
      if (url.includes("/mtm/agents") && cardWriteStatus !== 200) return reply(cardWriteStatus, { error: "Seat limit reached" })
      return reply(200, { success: true, data: { id: "u-1" } })
    }
    if (url.includes("/mtm/agents")) return reply(200, { success: true, data: { agents: cards, total: cards.length } })
    if (url.includes("/settings/roles")) return reply(200, { success: true, data: { roles, permissions: {} } })
    if (url.includes("/voice-budget")) return reply(200, { success: true, data: {} })
    return reply(200, { success: true, data: [person] })
  }))
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

async function openCard(withCards: Card[] = []) {
  cards = withCards
  await act(async () => { root.render(createElement(TooltipProvider, null, createElement(UsersPage))) })
  await settle()
  const edit = [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("Изменить"))
  await act(async () => { edit?.click() })
  await settle()
}

const choose = async (select: HTMLSelectElement | null | undefined, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, value)
    select?.dispatchEvent(new Event("change", { bubbles: true }))
  })
}
const fieldCard = () => document.querySelector<HTMLSelectElement>("#fieldCard")
const save = async () => {
  const submit = [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("Обновить"))
  await act(async () => { submit?.click() })
  await settle()
}
const cardWrites = () => writes.filter((write) => write.url.includes("/mtm/agents"))

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
})

describe("user card — what this person gets", () => {
  it("a manager left with Route & Field alone and no employee card is offered the whole organization", async () => {
    await openCard([spareCard, takenCard])

    expect(block().textContent).toContain("Что получит этот человек")
    expect(rows()).not.toHaveProperty("Кадры")
    expect(rows()).toEqual({
      "Основная": [false, "Скрыт", null],
      // Boards come with CRM and have a tick of their own (owner, 2026-11-06).
      "Доски · Шаблоны задач": [false, "Скрыт", null],
      "Продажи": [false, "Скрыт", null],
      "Финансы": [false, "Скрыт", null],
      "Маршруты и поле · Персонал": [true, "Всё, включая удаление", "В поле — Вся организация."],
      "Настройки": [null, "Только свои уведомления", "У «Настроек» галочки нет: доступ к ним даёт только роль."],
    })
  })

  it("ticking a module back shows at once what the role allows in it", async () => {
    await openCard()
    const sales = [...block().querySelectorAll("li")].find((row) => row.textContent?.includes("Продажи"))
    await act(async () => { sales?.querySelector<HTMLInputElement>("input")?.click() })

    expect(rows()["Продажи"]).toEqual([
      true, "По-разному", "Сделки, Лиды: всё, включая удаление · Предложения: просмотр и правка",
    ])
  })

  it("changing the role re-reads every row; an admin loses the ticks and needs no card", async () => {
    await openCard([ownCard])
    const role = [...document.querySelectorAll("select")].find((select) => select.value === "manager")

    await choose(role, "sales")
    expect(rows()["Маршруты и поле · Персонал"].slice(0, 2)).toEqual([true, "Просмотр и правка"])

    await choose(role, "admin")
    const admin = rows()
    expect([...new Set(Object.values(admin).map(([tick]) => tick))]).toEqual([null])
    expect(admin["Продажи"]).toEqual([null, "Всё, включая удаление", null])
    expect(admin["Маршруты и поле · Персонал"]).toEqual([
      null, "Всё, включая удаление", "Администратор видит всё поле без карточки сотрудника.",
    ])
    expect(fieldCard()).toBeNull()
    expect(admin["Настройки"]).toEqual([null, "Все настройки организации", null])
  })
})

describe("user card — the employee card behind Route & Field", () => {
  // Owner, 2026-10-03: "a manager must have the permission". A manager handed
  // the module and then refused by every list is not what the admin meant.
  it("a manager without a card gets one over the whole organization on save, unless the admin chooses otherwise", async () => {
    await openCard([spareCard, takenCard])

    expect([fieldCard()?.value, document.querySelector<HTMLSelectElement>("#fieldRole")?.value]).toEqual(["new", "ADMIN"])
    await save()

    expect(cardWrites()).toEqual([
      { url: "/api/v1/mtm/agents", method: "POST", body: { name: "Field Manager", role: "ADMIN", userId: "u-1" } },
    ])
  })

  it("says the lists will refuse the person when the admin leaves them without a card", async () => {
    await openCard([spareCard])
    await choose(fieldCard(), "none")

    expect(rows()["Маршруты и поле · Персонал"]).toEqual([
      true,
      "Нужна карточка сотрудника",
      "Без карточки сотрудника списки клиентов, маршрутов и визитов ответят отказом: чьи данные видит человек, решает она. Выберите карточку или создайте новую.",
    ])
    await save()
    expect(cardWrites()).toEqual([])
  })

  it("does not hand a card to other roles by default", async () => {
    await openCard([spareCard])
    await choose([...document.querySelectorAll("select")].find((select) => select.value === "manager"), "sales")

    expect(fieldCard()?.value).toBe("none")
    expect(rows()["Маршруты и поле · Персонал"].slice(0, 2)).toEqual([true, "Нужна карточка сотрудника"])
  })

  it("offers this person's own card and the unlinked ones, never a colleague's", async () => {
    await openCard([spareCard, takenCard, ownCard])

    expect(fieldCard()?.value).toBe("card-own")
    expect([...(fieldCard()?.options ?? [])].map((option) => option.textContent)).toEqual([
      "Нет карточки", "Seymur — Агент", "Field Manager — Админ", "Создать новую карточку",
    ])
    expect(rows()["Маршруты и поле · Персонал"].slice(0, 2)).toEqual([true, "Всё, включая удаление"])
    expect(document.querySelector('[data-testid="user-field-card"]')?.textContent)
      .toContain("В поле — Админ: своя команда.")
  })

  it("saving without touching the card writes nothing to the field module", async () => {
    await openCard([ownCard])
    await save()

    expect(writes.map((write) => write.url)).toEqual(["/api/v1/users/u-1"])
  })

  it("creates a card with the chosen field role and links it to the login", async () => {
    await openCard([takenCard])
    await choose(fieldCard(), "new")
    await choose(document.querySelector<HTMLSelectElement>("#fieldRole"), "MANAGER")

    expect(rows()["Маршруты и поле · Персонал"].slice(0, 2)).toEqual([true, "Всё, включая удаление"])
    await save()

    expect(cardWrites()).toEqual([
      { url: "/api/v1/mtm/agents", method: "POST", body: { name: "Field Manager", role: "MANAGER", userId: "u-1" } },
    ])
  })

  it("links an existing unlinked card instead of creating a duplicate", async () => {
    await openCard([spareCard])
    await choose(fieldCard(), "card-spare")
    await save()

    expect(cardWrites()).toEqual([
      { url: "/api/v1/mtm/agents/card-spare", method: "PUT", body: { userId: "u-1" } },
    ])
  })

  it("moving to another card releases the old one first; choosing none only releases", async () => {
    await openCard([spareCard, ownCard])
    await choose(fieldCard(), "card-spare")
    await save()

    expect(cardWrites()).toEqual([
      { url: "/api/v1/mtm/agents/card-own", method: "PUT", body: { userId: null } },
      { url: "/api/v1/mtm/agents/card-spare", method: "PUT", body: { userId: "u-1" } },
    ])
  })

  it("says the user was saved and the card was not, when the field module refuses", async () => {
    await openCard([])
    cardWriteStatus = 403
    await choose(fieldCard(), "new")
    await save()

    expect(document.body.textContent).toContain(
      "Пользователь сохранён, но карточку сотрудника привязать не удалось: Seat limit reached",
    )
    expect(block()).not.toBeNull()
  })

  it("leaves the card alone while the module is hidden from the person", async () => {
    await openCard([ownCard])
    const field = [...block().querySelectorAll("li")].find((row) => row.textContent?.includes("Маршруты и поле"))
    await act(async () => { field?.querySelector<HTMLInputElement>("input")?.click() })

    expect(fieldCard()).toBeNull()
    await save()
    expect(cardWrites()).toEqual([])
  })
})

// Audit of the section, owner 2026-11-07: «нет галочки снять со всех» and «при
// наборе не показывает, что именно не соблюдается».
const type = async (input: HTMLInputElement | null, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value)
    input?.dispatchEvent(new Event("input", { bubbles: true }))
  })
}
const allModules = () => document.querySelector<HTMLInputElement>('[data-testid="user-modules-all"] input')
const ticks = () => Object.fromEntries(Object.entries(rows()).filter(([, [tick]]) => tick !== null).map(([label, [tick]]) => [label, tick]))
const ruleStates = () => Object.fromEntries([...document.querySelectorAll<HTMLElement>('[data-testid="password-rules"] li')]
  .map((rule) => [rule.dataset.rule, rule.dataset.state]))

describe("user card — every module with one tick", () => {
  it("takes every module off at once, then one can be ticked back", async () => {
    await openCard()
    await act(async () => { allModules()?.click() }) // some on → all on
    expect(Object.values(ticks()).every(Boolean)).toBe(true)
    expect(allModules()?.checked).toBe(true)

    await act(async () => { allModules()?.click() }) // all on → all off
    expect(Object.values(ticks()).some(Boolean)).toBe(false)
    expect(block().textContent).toContain("Не отмечен ни один модуль")

    const sales = [...block().querySelectorAll("li")].find((row) => row.textContent?.includes("Продажи"))
    await act(async () => { sales?.querySelector<HTMLInputElement>("input")?.click() })
    expect(Object.entries(ticks()).filter(([, on]) => on).map(([label]) => label)).toEqual(["Продажи"])
    expect(allModules()?.indeterminate).toBe(true)
    expect(document.querySelector('[data-testid="user-modules-all"]')?.textContent).toContain("отмечено 1 из 5")

    await save()
    const sent = writes.find((write) => write.method === "PUT")?.body as { hiddenModules: string[] }
    expect(sent.hiddenModules).not.toContain("sales")
    expect(sent.hiddenModules).toEqual(expect.arrayContaining(["crm", "finance", "mtm"]))
  })
})

describe("new user — the password says what is missing while it is typed", () => {
  async function openNew() {
    cards = []
    await act(async () => { root.render(createElement(TooltipProvider, null, createElement(UsersPage))) })
    await settle()
    const add = [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("Добавить"))
    await act(async () => { add?.click() })
    await settle()
  }
  const password = () => document.querySelector<HTMLInputElement>("#password")

  it("shows the rules, ticks them as they are met, and can show the password", async () => {
    await openNew()
    expect(password()?.type).toBe("password")
    expect(ruleStates()).toEqual({ length: "todo", uppercase: "todo", lowercase: "todo", digit: "todo", special: "todo" })

    await type(password(), "zeytun 2026")
    expect(ruleStates()).toEqual({
      length: "bad", uppercase: "bad", lowercase: "ok", digit: "ok", special: "bad", noSpaces: "bad",
    })

    const eye = [...document.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === "Показать пароль")
    await act(async () => { eye?.click() })
    expect(password()?.type).toBe("text")

    await type(password(), "Zeytun-2026-Baku")
    expect(document.querySelector('[data-testid="password-rules"]')?.textContent).toBe("Пароль подходит")
  })

  it("does not send a password the server would refuse, and says so next to the button", async () => {
    await openNew()
    await type(document.querySelector<HTMLInputElement>("#name"), "Aytan")
    await type(document.querySelector<HTMLInputElement>("#email"), "aytan@zeytun.az")
    await type(password(), "Zeytun2026")
    const create = [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("Создать"))
    await act(async () => { create?.closest("form")?.requestSubmit() })
    await settle()

    expect(writes.filter((write) => write.method === "POST")).toEqual([])
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Пароль не подходит")
  })

  it("a generated password passes and is shown so it can be handed over", async () => {
    await openNew()
    const generate = [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("Сгенерировать"))
    await act(async () => { generate?.click() })
    expect(password()?.type).toBe("text")
    expect(password()?.value.length).toBeGreaterThanOrEqual(12)
    expect(document.querySelector('[data-testid="password-rules"]')?.textContent).toBe("Пароль подходит")
  })
})
