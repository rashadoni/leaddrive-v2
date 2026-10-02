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
  return [label, [tick ? tick.checked : null, badge, row.querySelector("p")?.textContent ?? null]]
}))

beforeEach(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const body = String(url).includes("/settings/roles") ? { success: true, data: { roles, permissions: {} } }
      : String(url).includes("/voice-budget") ? { success: true, data: {} }
      : { success: true, data: [person] }
    return { ok: true, status: 200, headers: new Headers(), json: async () => body }
  }))
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(createElement(TooltipProvider, null, createElement(UsersPage))) })
  await settle()
  const edit = [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("Изменить"))
  await act(async () => { edit?.click() })
  await settle()
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
})

describe("user card — what this person gets", () => {
  it("a manager left with Route & Field alone: one module, full; the rest hidden; Settings personal", () => {
    expect(block().textContent).toContain("Что получит этот человек")
    expect(rows()).toEqual({
      "Основная": [false, "Скрыт", null],
      "Продажи": [false, "Скрыт", null],
      "Финансы": [false, "Скрыт", null],
      "Маршруты и поле": [true, "Всё, включая удаление", null],
      "Кадры": [false, "Скрыт", null],
      "Настройки": [null, "Только свои уведомления", "У «Настроек» галочки нет: доступ к ним даёт только роль."],
    })
  })

  it("ticking a module back shows at once what the role allows in it", async () => {
    const sales = [...block().querySelectorAll("li")].find((row) => row.textContent?.includes("Продажи"))
    await act(async () => { sales?.querySelector<HTMLInputElement>("input")?.click() })

    expect(rows()["Продажи"]).toEqual([
      true, "По-разному", "Сделки, Лиды: всё, включая удаление · Предложения: просмотр и правка",
    ])
  })

  it("changing the role re-reads every row, and an admin loses the ticks", async () => {
    const role = [...document.querySelectorAll("select")].find((select) => select.value === "manager")
    const choose = async (value: string) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(role, value)
        role?.dispatchEvent(new Event("change", { bubbles: true }))
      })
    }

    await choose("sales")
    expect(rows()["Маршруты и поле"]).toEqual([true, "Просмотр и правка", null])

    await choose("admin")
    const admin = rows()
    expect([...new Set(Object.values(admin).map(([tick]) => tick))]).toEqual([null])
    expect(admin["Продажи"]).toEqual([null, "Всё, включая удаление", null])
    expect(admin["Настройки"]).toEqual([null, "Все настройки организации", null])
  })
})
