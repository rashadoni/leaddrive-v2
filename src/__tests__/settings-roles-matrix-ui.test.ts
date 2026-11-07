// @vitest-environment jsdom
/**
 * The role table, audit of 2026-11-07 (owner: «пересмотри роль матрицу ещё раз»).
 * It kept a grouping of its own that matched nothing on the user card, listed
 * modules the organization does not have, left Meetings out although their
 * access rule is unlike any other, and named built-in roles in English.
 * Rendered for real with the Russian copy and the real role table; only the
 * network and the session are stubbed.
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
const session = {
  data: {
    user: {
      id: "u-admin", organizationId: "org-1", role: "admin", plan: "enterprise", addons: [], hiddenModules: [],
      modules: { crm: true, sales: true, finance: true, mtm: true, settings: true },
    },
  },
  status: "authenticated",
}
vi.mock("next-auth/react", () => ({ useSession: () => session }))
vi.mock("@/components/tour/tour-provider", () => ({ useAutoTour: () => undefined, useTour: () => ({}) }))
vi.mock("@/components/tour/tour-replay-button", () => ({ TourReplayButton: () => null }))
vi.mock("@/components/help/help-button", () => ({ HelpButton: () => null }))

import RolesPage from "@/app/(dashboard)/settings/roles/page"
import { userModuleOptions } from "@/lib/user-module-options"
import { tenantHideableModules } from "@/lib/user-module-access"
import { orgFromSession } from "@/lib/nav-items"

const roles = [
  ...["admin", "manager", "sales", "support", "ticketing", "viewer"]
    .map((id) => ({ id, name: id.toUpperCase(), color: "blue", isSystem: true, assignable: true })),
  { id: "pharmacist", name: "Pharmacist", color: "teal", isSystem: false, assignable: false },
]

let root: Root
let container: HTMLDivElement

beforeEach(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const body = String(input).includes("/settings/roles")
      ? { success: true, data: { roles, permissions: {} } }
      : { success: true, data: [{ role: "manager" }, { role: "manager" }, { role: "viewer" }] }
    return { ok: true, status: 200, headers: new Headers(), json: async () => body }
  }))
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(createElement(RolesPage)) })
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
})

const table = () => document.querySelector("table") as HTMLTableElement
const columns = () => [...table().querySelectorAll("thead th")].map((th) => th.textContent?.trim() ?? "")
/** scope → the level shown for each role column, in column order. */
const row = (scope: string) => [...table().querySelectorAll(`tr[data-matrix-scope="${scope}"] td`)].slice(1).map((td) => td.textContent?.trim())
const groupHeads = () => [...table().querySelectorAll("tr[data-matrix-group] td")].map((td) => td.textContent?.trim())
const firstCells = () => [...table().querySelectorAll("tbody tr[data-matrix-scope] td:first-child > div")].map((cell) => cell.textContent?.trim())

describe("role table", () => {
  it("is grouped by the same ticks as the user card, and only the organization's own", () => {
    const tn = (key: string) => message("nav", key) ?? key
    const ticks = userModuleOptions(tenantHideableModules(orgFromSession(session.data.user)), tn).map((option) => option.label)
    // Multi-scope ticks get a heading row; one-scope ticks are a row of their own.
    const shown = [...groupHeads(), ...firstCells()]
    for (const tick of ticks) expect(shown).toContain(tick)
    expect(shown).toContain("Настройки")
    // Nothing the tenant lacks: no loyalty, marketing, inbox, support rows.
    for (const scope of ["loyalty", "campaigns", "inbox", "tickets", "voip", "ai"]) {
      expect(table().querySelector(`tr[data-matrix-scope="${scope}"]`)).toBeNull()
    }
  })

  it("lists Meetings under Sales with their own rule: nobody deletes, the viewer has none", () => {
    expect(table().querySelector('tr[data-matrix-scope="bookings"] td')?.textContent).toContain("Встречи")
    const [admin, manager, , , , viewer] = row("bookings")
    expect(admin).toBe(message("settings", "accessEdit"))
    expect(manager).toBe(message("settings", "accessEdit"))
    expect(viewer).toBe(message("settings", "accessNone"))
    // …while the viewer reads deals.
    expect(row("deals")[5]).toBe(message("settings", "accessView"))
  })

  it("names built-in roles in the reader's language and marks a role that cannot be given", () => {
    const head = columns()
    expect(head[1]).toContain("Админ")
    expect(head[2]).toContain("Менеджер")
    expect(head[6]).toContain("Наблюдатель")
    expect(head[7]).toContain("Pharmacist")
    expect(head[7]).toContain("нельзя назначить")
    expect(head[2]).toContain("2")
  })
})
