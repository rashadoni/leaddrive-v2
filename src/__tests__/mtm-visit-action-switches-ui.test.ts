// @vitest-environment jsdom
/**
 * Route & Field → Settings → «Что агент делает в визите».
 *
 * Owner, 2026-10-07, shown the visit action policies editor: «я хочу, чтоб ты
 * этот раздел настолько улучшил в плане интуитивности и интерактивности, что
 * среднестатистический пользователь с первого раза смог понять, и компактно
 * сделай… обычные переключатели ставь, ползунки».
 *
 * The real settings section, rendered with the real Russian copy; only the
 * network is stubbed, and the stub keeps what was written so a row shows what
 * the server holds after the reload, not what was pressed.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

type Messages = { [key: string]: string | Messages }
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8")) as Messages
vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) => {
    let node: unknown = ru[namespace]
    for (const part of key.split(".")) node = (node as Messages | undefined)?.[part]
    const raw = typeof node === "string" ? node : `${namespace}.${key}`
    return raw.replace(/\{(\w+)\}/g, (_match, name) => String(values?.[name] ?? ""))
  },
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { VisitPolicySettings } from "@/app/(dashboard)/mtm/settings/visit-policy-settings"

type Action = { actionKey: string; mode: string; minCount: number; conditions: null; allowWaiver: boolean }
const action = (actionKey: string, mode: string, minCount = 1): Action => ({ actionKey, mode, minCount, conditions: null, allowWaiver: false })
type StoredPolicy = { id: string; name: string; teamId: string | null; visitType: string; priority: number; effectiveFrom: string; effectiveTo: null; isActive: boolean; actions: Action[] }

let policies: StoredPolicy[] = []
let access: Record<string, unknown> = {}
let writes: { method: string; url: string; body: Record<string, unknown> }[] = []
let refuse: { status: number; body: unknown } | null = null

let root: Root
let container: HTMLDivElement
const settle = async () => {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
}
const row = (key: string) => container.querySelector(`[data-testid="visit-action-switch-${key}"]`) as HTMLElement
const switches = (key: string) => [...row(key).querySelectorAll('[role="switch"]')] as HTMLButtonElement[]
const states = (key: string) => switches(key).map((button) => [button.getAttribute("aria-checked"), button.disabled])
const press = async (key: string, which: 0 | 1) => {
  await act(async () => { switches(key)[which].click() })
  await settle()
}
const statusText = () => container.querySelector('[data-testid="visit-action-switches-status"]')?.textContent ?? ""
const editor = () => container.querySelector("#visit-policy-advanced") as HTMLElement

async function open() {
  await act(async () => { root.render(createElement(VisitPolicySettings)) })
  await settle()
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  policies = [{
    id: "rule-1", name: "Вся компания", teamId: null, visitType: "DEFAULT", priority: 100,
    effectiveFrom: "2026-10-01T00:00:00.000Z", effectiveTo: null, isActive: true,
    actions: [action("PHOTO", "OPTIONAL", 2), action("PRESENTATION", "REQUIRED"), action("SIGNATURE", "OPTIONAL"), action("STOCK_CHECK", "HIDDEN")],
  }]
  access = { kind: "admin", canWriteOrganizationWide: true, writableTeamIds: null }
  writes = []
  refuse = null
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: { method?: string; body?: string }) => {
    const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body })
    const url = String(input)
    const method = init?.method ?? "GET"
    if (method === "GET") {
      if (url.includes("/visit-policies")) return reply(200, { success: true, data: { policies, access } })
      if (url.includes("/teams")) return reply(200, { success: true, data: { teams: [] } })
      if (url.includes("/agents")) return reply(200, { success: true, data: { agents: [] } })
      return reply(200, { success: true, data: { customers: [] } })
    }
    const body = JSON.parse(init?.body ?? "{}") as Record<string, unknown>
    writes.push({ method, url, body })
    if (refuse) return reply(refuse.status, refuse.body)
    if (method === "POST") {
      const created = { id: "rule-new", ...(body as Omit<StoredPolicy, "id">) }
      policies = [created, ...policies]
      return reply(201, { success: true, data: created })
    }
    const id = url.split("/").pop() as string
    policies = policies.map((policy) => (policy.id === id ? { ...policy, ...(body as Partial<StoredPolicy>) } : policy))
    return reply(200, { success: true, data: policies.find((policy) => policy.id === id) })
  }))
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe("«Что агент делает в визите»", () => {
  it("shows every visit action as two switches that read the organization's rule", async () => {
    await open()
    expect(container.textContent).toContain("Что агент делает в визите")
    expect(container.textContent).toContain("Для всей компании")
    // [shown, required] as [checked, disabled]
    expect(states("PHOTO")).toEqual([["true", false], ["false", false]])
    expect(states("PRESENTATION")).toEqual([["true", false], ["true", false]])
    // Hidden: «required» cannot be turned on for something nobody is shown.
    expect(states("STOCK_CHECK")).toEqual([["false", false], ["false", true]])
    // Not in the rule at all = the server's default: shown, not required.
    expect(states("VISIT_NOTE")).toEqual([["true", false], ["false", false]])
    expect(switches("PHOTO").map((button) => button.getAttribute("aria-label"))).toEqual(["Показывать: Фото", "Обязательно: Фото"])
  })

  it("writes one switch at once to that rule, changing nothing else, and then shows what the server holds", async () => {
    await open()
    await press("SIGNATURE", 0)

    expect(writes.map(({ method, url }) => [method, url])).toEqual([["PUT", "/api/v1/mtm/visit-policies/rule-1"]])
    const sent = writes[0].body.actions as Action[]
    expect(Object.keys(writes[0].body)).toEqual(["actions"])
    expect(sent.find((item) => item.actionKey === "SIGNATURE")?.mode).toBe("HIDDEN")
    expect(sent.find((item) => item.actionKey === "PHOTO")).toEqual(action("PHOTO", "OPTIONAL", 2))
    expect(sent.find((item) => item.actionKey === "PRESENTATION")?.mode).toBe("REQUIRED")
    expect(states("SIGNATURE")).toEqual([["false", false], ["false", true]])
    expect(statusText()).toContain("Сохранено")
  })

  it("makes an action required with the second switch", async () => {
    await open()
    await press("PHOTO", 1)
    expect((writes[0].body.actions as Action[]).find((item) => item.actionKey === "PHOTO")).toEqual(action("PHOTO", "REQUIRED", 2))
    expect(states("PHOTO")).toEqual([["true", false], ["true", false]])
  })

  it("creates the organization's rule on the first switch of an organization that has none", async () => {
    policies = []
    await open()
    expect(states("SIGNATURE")).toEqual([["true", false], ["false", false]])
    await press("SIGNATURE", 1)

    expect(writes.map(({ method, url }) => [method, url])).toEqual([["POST", "/api/v1/mtm/visit-policies"]])
    expect(writes[0].body).toMatchObject({ name: "Вся компания", teamId: null, visitType: "DEFAULT", priority: 100, effectiveTo: null, isActive: true })
    expect((writes[0].body.actions as Action[]).map((item) => [item.actionKey, item.mode])).toEqual([
      ["PHOTO", "OPTIONAL"], ["PRESENTATION", "OPTIONAL"], ["SIGNATURE", "REQUIRED"],
      ["VISIT_NOTE", "OPTIONAL"], ["STOCK_CHECK", "OPTIONAL"], ["FEEDBACK", "OPTIONAL"],
    ])
    expect(states("SIGNATURE")).toEqual([["true", false], ["true", false]])
  })

  // The older «photo required on every visit» setting has no switch of its
  // own any more: the settings page hands it to this block.
  it("shows the older «photo required» setting on the photo row and keeps it in the first rule", async () => {
    policies = []
    await act(async () => { root.render(createElement(VisitPolicySettings, { legacyPhotoRequired: true })) })
    await settle()
    expect(states("PHOTO")).toEqual([["true", false], ["true", false]])

    await press("SIGNATURE", 1)
    expect((writes[0].body.actions as Action[]).map((item) => [item.actionKey, item.mode]).slice(0, 3)).toEqual([
      ["PHOTO", "REQUIRED"], ["PRESENTATION", "OPTIONAL"], ["SIGNATURE", "REQUIRED"],
    ])
    expect(states("PHOTO")).toEqual([["true", false], ["true", false]])
  })

  it("stays as it was and says so when the server refuses", async () => {
    await open()
    refuse = { status: 409, body: { error: "Visit policies are disabled", code: "MTM_VISIT_POLICIES_DISABLED" } }
    await press("PHOTO", 0)
    expect(writes).toHaveLength(1)
    expect(states("PHOTO")).toEqual([["true", false], ["false", false]])
    expect(container.querySelector('[data-testid="visit-action-switches"] [role="alert"]')?.textContent?.length ?? 0).toBeGreaterThan(0)
    expect(statusText()).not.toContain("Сохранено")
  })

  it("is read-only for somebody who may not change the organization's rule, and writes nothing", async () => {
    access = { kind: "manager", canWriteOrganizationWide: false, writableTeamIds: ["team-1"] }
    await open()
    expect(container.querySelector('[data-testid="visit-action-switches-read-only"]')?.textContent).toContain("администратор")
    expect(switches("PHOTO").map((button) => button.disabled)).toEqual([true, true])
    await press("PHOTO", 0)
    expect(writes).toEqual([])
  })

  it("keeps the full editor one click below, closed until asked for", async () => {
    await open()
    expect(editor().hidden).toBe(true)
    const toggle = container.querySelector('[data-testid="visit-policy-advanced-toggle"]') as HTMLButtonElement
    expect([toggle.textContent, toggle.getAttribute("aria-expanded")]).toEqual(["Особые правила для групп и типов клиентов", "false"])
    await act(async () => { toggle.click() })
    expect([editor().hidden, toggle.getAttribute("aria-expanded")]).toEqual([false, "true"])
    expect(editor().textContent).toContain("Политики действий на визите")
  })

  it("says how many special rules exist, so they are not a surprise", async () => {
    policies = [...policies, { ...policies[0], id: "rule-team", name: "Аптеки", teamId: "team-1" }]
    await open()
    expect(container.querySelector('[data-testid="visit-policy-advanced-toggle"]')?.textContent).toContain("Особых правил: 1")
  })

  it("does not let the editor below save over a switch with the copy it loaded earlier", async () => {
    await open()
    await press("SIGNATURE", 0)
    await act(async () => { (container.querySelector('[data-testid="visit-policy-advanced-toggle"]') as HTMLButtonElement).click() })
    await settle()
    // The editor's own card for the signature now shows what the switch wrote.
    const save = [...editor().querySelectorAll("button")].find((button) => button.textContent?.includes("Сохранить политику")) as HTMLButtonElement
    await act(async () => { save.click() })
    await settle()
    const editorWrite = writes[1]
    expect(editorWrite.method).toBe("PUT")
    expect((editorWrite.body.actions as Action[]).find((item) => item.actionKey === "SIGNATURE")?.mode).toBe("HIDDEN")
  })
})
