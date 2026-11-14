// @vitest-environment jsdom
/**
 * «Komandalar və istifadəçilər» (owner, 2026-11-13: Bordio's «Teams & Users»):
 * teams on the left, the organization's people on the right with their team,
 * their role in it and whether they see the boards' reports. Rendered for real
 * with the Azerbaijani copy; only the network and the session are stubbed.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

type Messages = { [key: string]: string | Messages }
const az = JSON.parse(readFileSync("messages/az.json", "utf8")) as Messages
vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>()
  return {
    useTranslations: (namespace?: string) => actual.createTranslator({ locale: "az", messages: az as never, namespace: namespace as never }),
    useLocale: () => "az",
  }
})
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "u-admin", organizationId: "org-1", role: "admin", plan: "enterprise", addons: [], hiddenModules: [], modules: { crm: true, boards: true, settings: true } } }, status: "authenticated" }),
}))
vi.mock("next/link", () => ({
  default: ({ href, children, prefetch: _prefetch, ...rest }: { href: string; children: unknown; prefetch?: boolean }) => createElement("a", { href, ...rest }, children as never),
}))

import TeamsAndUsersPage from "@/app/(dashboard)/boards/teams/page"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
let calls: string[] = []
let canManage = true
const TEAMS = () => [
  { id: "t-trad", name: "Traditional Marketing", members: [{ userId: "nazrin", name: "Nazrin Şirinova", avatar: null, role: "leader" }, { userId: "elvira", name: "Elvira Həsənova", avatar: null, role: "member" }] },
  { id: "t-dig", name: "Digital Marketing", members: [{ userId: "xayala", name: "Xəyalə Xankişiyeva", avatar: null, role: "member" }] },
]
const USERS = () => [
  { id: "boss", name: "Toğrul", email: "boss@z.az", role: "admin", isActive: true, boardReportsHidden: false },
  { id: "nazrin", name: "Nazrin Şirinova", email: "nazrin@z.az", role: "manager", isActive: true, boardReportsHidden: false },
  { id: "elvira", name: "Elvira Həsənova", email: "elvira@z.az", role: "sales", isActive: true, boardReportsHidden: true },
  { id: "xayala", name: "Xəyalə Xankişiyeva", email: "xayala@z.az", role: "sales", isActive: true, boardReportsHidden: false },
  { id: "gone", name: "Faxir", email: "faxir@z.az", role: "sales", isActive: false, boardReportsHidden: false },
]

beforeEach(() => {
  calls = []
  canManage = true
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET"
    if (method !== "GET") calls.push(`${method} ${url} ${typeof init?.body === "string" ? init.body : ""}`.trim())
    const json = (data: unknown, status = 200) => new Response(JSON.stringify({ success: true, data }), { status })
    if (url === "/api/v1/tasks/teams" && method === "GET") return json({ teams: TEAMS(), canManage })
    if (url === "/api/v1/users" && method === "GET") return canManage ? json(USERS()) : new Response("{}", { status: 403 })
    if (url === "/api/v1/users" && method === "POST") return json({ id: "new-1" }, 201)
    return json({})
  }))
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
const flush = () => act(async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve() })
const render = async () => { await act(async () => { root.render(createElement(TeamsAndUsersPage)) }); await flush() }
const person = (id: string) => container.querySelector(`[data-testid="teams-person"][data-user="${id}"]`) as HTMLElement
const pick = async (el: HTMLSelectElement, value: string) => {
  await act(async () => { el.value = value; el.dispatchEvent(new Event("change", { bubbles: true })) })
  await flush()
}
const type = async (el: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value)
    el.dispatchEvent(new Event("input", { bubbles: true }))
  })
}
const click = async (el: Element | null) => { await act(async () => { (el as HTMLElement).click() }); await flush() }

describe("Komandalar və istifadəçilər", () => {
  it("lists the teams with their head-counts and every active person with team, role and reports", async () => {
    await render()
    expect(container.querySelector("h1")?.textContent).toBe("Komandalar və istifadəçilər")
    expect([...container.querySelectorAll('[data-testid="teams-team"]')].map((el) => el.textContent)).toEqual(["Traditional Marketing2", "Digital Marketing1"])
    // The switched-off person is not listed.
    expect([...container.querySelectorAll('[data-testid="teams-person"]')].map((el) => el.getAttribute("data-user"))).toEqual(["boss", "nazrin", "elvira", "xayala"])
    expect((person("nazrin").querySelector('[data-testid="teams-person-team"]') as HTMLSelectElement).value).toBe("t-trad")
    expect((person("nazrin").querySelector('[data-testid="teams-person-role"]') as HTMLSelectElement).value).toBe("leader")
    // Nobody's team: no role to pick. The admin always sees the reports: no switch.
    expect(person("boss").querySelector('[data-testid="teams-person-role"]')).toBeNull()
    expect(person("boss").querySelector('[data-testid="teams-person-reports"]')).toBeNull()
    expect(person("elvira").querySelector('[data-testid="teams-person-reports"]')?.getAttribute("aria-pressed")).toBe("false")
    expect(person("xayala").querySelector('[data-testid="teams-person-reports"]')?.getAttribute("aria-pressed")).toBe("true")
  })

  it("a team picked on the left narrows the people; team, role and reports are changed in the row", async () => {
    await render()
    await click(container.querySelector('[data-testid="teams-team"][data-team="t-dig"] button'))
    expect([...container.querySelectorAll('[data-testid="teams-person"]')].map((el) => el.getAttribute("data-user"))).toEqual(["xayala"])

    await pick(person("xayala").querySelector('[data-testid="teams-person-team"]') as HTMLSelectElement, "t-trad")
    expect(calls).toContain('PUT /api/v1/tasks/teams/members {"userId":"xayala","teamId":"t-trad"}')
    await click(container.querySelector('[data-testid="teams-list"] button'))
    await pick(person("elvira").querySelector('[data-testid="teams-person-role"]') as HTMLSelectElement, "leader")
    expect(calls).toContain('PUT /api/v1/tasks/teams/members {"userId":"elvira","teamId":"t-trad","role":"leader"}')
    await pick(person("elvira").querySelector('[data-testid="teams-person-team"]') as HTMLSelectElement, "")
    expect(calls).toContain('PUT /api/v1/tasks/teams/members {"userId":"elvira","teamId":null}')

    await click(person("xayala").querySelector('[data-testid="teams-person-reports"]'))
    expect(calls).toContain('PUT /api/v1/users/xayala {"boardReportsHidden":true}')
    await click(person("elvira").querySelector('[data-testid="teams-person-reports"]'))
    expect(calls).toContain('PUT /api/v1/users/elvira {"boardReportsHidden":false}')
  })

  it("makes a team, and adds a person who sees the boards only and joins the picked team", async () => {
    await render()
    await click(container.querySelector('[data-testid="teams-create"]'))
    const name = container.querySelector('[data-testid="teams-create-name"]') as HTMLInputElement
    await type(name, "Cust-Serv/MX")
    await act(async () => { name.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })) })
    await flush()
    expect(calls).toContain('POST /api/v1/tasks/teams {"name":"Cust-Serv/MX"}')

    await click(container.querySelector('[data-testid="teams-add-user"]'))
    await type(container.querySelector('[data-testid="teams-new-user-name"]') as HTMLInputElement, "Rəşidə Məmmədova")
    await type(container.querySelector('[data-testid="teams-new-user-email"]') as HTMLInputElement, "rashida@z.az")
    await type(container.querySelector('[data-testid="teams-new-user-password"]') as HTMLInputElement, "S3cret-pass!")
    await pick(container.querySelector('[data-testid="teams-new-user-team"]') as HTMLSelectElement, "t-dig")
    await click(container.querySelector('[data-testid="teams-new-user-save"]'))
    const made = calls.find((c) => c.startsWith("POST /api/v1/users "))!
    const body = JSON.parse(made.slice("POST /api/v1/users ".length))
    expect(body).toMatchObject({ name: "Rəşidə Məmmədova", email: "rashida@z.az", role: "sales" })
    // Everything the organization has but the boards is closed for the new person.
    expect(body.hiddenModules).toContain("crm")
    expect(body.hiddenModules).not.toContain("boards")
    expect(calls).toContain('PUT /api/v1/tasks/teams/members {"userId":"new-1","teamId":"t-dig"}')
  })

  // Owner, 2026-11-14, on the add-user window: «как он будет заходить без пароля?» — the admin hands the password
  // over, so the window says what the server will refuse while it is typed, shows it, and can make one up.
  it("the password box says the server's rules while typing, shows the password, and makes up one the server takes", async () => {
    await render()
    await click(container.querySelector('[data-testid="teams-add-user"]'))
    await type(container.querySelector('[data-testid="teams-new-user-name"]') as HTMLInputElement, "Rəşidə Məmmədova")
    await type(container.querySelector('[data-testid="teams-new-user-email"]') as HTMLInputElement, "rashida@z.az")
    const box = () => container.querySelector('[data-testid="teams-new-user-password"]') as HTMLInputElement
    const save = () => container.querySelector('[data-testid="teams-new-user-save"]') as HTMLButtonElement
    expect(container.querySelector('[data-testid="password-rules"]')?.textContent).toContain("Şifrədə olmalıdır:")

    await type(box(), "Zeytun2024")
    expect(box().getAttribute("aria-invalid")).toBe("true")
    expect(container.querySelector('[data-rule="length"]')?.getAttribute("data-state")).toBe("bad")
    expect(container.querySelector('[data-rule="special"]')?.getAttribute("data-state")).toBe("bad")
    expect(save().disabled).toBe(true)

    expect(box().type).toBe("password")
    await click(container.querySelector('[data-testid="teams-new-user-password-toggle"]'))
    expect(box().type).toBe("text")
    await click(container.querySelector('[data-testid="teams-new-user-password-toggle"]'))
    expect(box().type).toBe("password")

    const make = [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Şifrə yarat")!
    await click(make)
    expect(box().type).toBe("text")
    expect(box().value).toMatch(/^Aa1!.{12,}$/u)
    expect(box().getAttribute("aria-invalid")).toBeNull()
    expect(save().disabled).toBe(false)
    const madeUp = box().value
    await click(save())
    const made = calls.find((c) => c.startsWith("POST /api/v1/users "))!
    expect(JSON.parse(made.slice("POST /api/v1/users ".length)).password).toBe(madeUp)
  })

  // Owner, 2026-11-13: «создал также такое же ограничение к команде и пользователи?» — the section is the
  // admin's. Typed into the address bar by anyone else, it used to open read-only with every colleague's e-mail.
  it("someone who is not the admin does not see the section at all", async () => {
    canManage = false
    await render()
    expect(container.querySelector('[data-testid="teams-admin-only"]')?.textContent).toContain("yalnız administrator")
    expect(container.querySelector('[data-testid="teams-list"]')).toBeNull()
    expect(container.querySelector('[data-testid="teams-people"]')).toBeNull()
    expect(container.querySelectorAll('[data-testid="teams-person"]')).toHaveLength(0)
    expect(container.textContent).not.toContain("@")
    expect(container.querySelector('[data-testid="teams-add-user"]')).toBeNull()
    expect(calls).toEqual([])
  })

  // Owner, same day, on the first cut: «как будто 2008-й год». `data-crm-filter` made the workspace stylesheet
  // draw each team as a bordered chip of its own width, with the name cut short.
  it("the team list is one list of equal rows: no filter chips, the whole name on hover, the page titled by the team picked", async () => {
    await render()
    expect(container.querySelector('[data-testid="teams-list"] [data-crm-filter]')).toBeNull()
    const rows = [...container.querySelectorAll('[data-testid="teams-list"] [data-testid="teams-team"]')] as HTMLElement[]
    // Every row is the same block; only the picked one is filled.
    expect(new Set(rows.map((row) => row.className.replace(/\bbg-muted\b|text-foreground(\/75)?|hover:\S+/gu, "").replace(/\s+/gu, " ").trim())).size).toBe(1)
    expect(rows[0].querySelector("button [title]")?.getAttribute("title")).toBe("Traditional Marketing")
    expect(container.querySelector("#teams-people-title")?.textContent).toBe("Bütün istifadəçilər")
    await click(container.querySelector('[data-testid="teams-team"][data-team="t-dig"] button'))
    expect(container.querySelector("#teams-people-title")?.textContent).toBe("Digital Marketing")
    expect(container.querySelector('[data-testid="teams-team"][data-team="t-dig"] button')?.getAttribute("aria-current")).toBe("true")
    expect(container.querySelector('[data-testid="teams-team"][data-team="t-trad"] button')?.getAttribute("aria-current")).toBeNull()
    // No vertical rules between the people's columns, and no glyph standing in for an icon.
    expect(container.querySelector('[data-testid="teams-people"] td.border-l')).toBeNull()
    expect(container.querySelector('[data-testid="teams-people"]')?.textContent).not.toContain("✓")
  })
})
