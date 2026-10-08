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
 *
 * 2026-10-08, shown the old editor still standing under the switches: «эту
 * часть ты оставил без изменений». It is gone: a group of agents gets the same
 * table, and what the old editor offered beyond the switches is kept only
 * where the server acts on it.
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

type Action = { actionKey: string; mode: string; minCount: number; conditions: { customerCategories?: string[]; objectTypes?: string[] } | null; allowWaiver: boolean }
const action = (actionKey: string, mode: string, minCount = 1): Action => ({ actionKey, mode, minCount, conditions: null, allowWaiver: false })
type StoredPolicy = { id: string; name: string; teamId: string | null; visitType: string; priority: number; effectiveFrom: string; effectiveTo: string | null; isActive: boolean; actions: Action[] }

let policies: StoredPolicy[] = []
let teams: { id: string; name: string }[] = []
let access: Record<string, unknown> = {}
let writes: { method: string; url: string; body: Record<string, unknown> }[] = []
let refuse: { status: number; body: unknown } | null = null
let checkAnswer: unknown = null

let root: Root
let container: HTMLDivElement
const settle = async () => {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
}
// A table is the company's by default, or one group's rule by its id.
const COMPANY = "visit-action-switches"
const groupTable = (ruleId: string) => `visit-rule-switches-${ruleId}`
const row = (key: string, table = COMPANY) => container.querySelector(`[data-testid="${table}-row-${key}"]`) as HTMLElement
const switches = (key: string, table = COMPANY) => [...row(key, table).querySelectorAll('[role="switch"]')] as HTMLButtonElement[]
const states = (key: string, table = COMPANY) => switches(key, table).map((button) => [button.getAttribute("aria-checked"), button.disabled])
const press = async (key: string, which: 0 | 1, table = COMPANY) => {
  await act(async () => { switches(key, table)[which].click() })
  await settle()
}
const statusText = () => container.querySelector('[data-testid="visit-action-switches-status"]')?.textContent ?? ""
const groups = () => container.querySelector("#visit-policy-advanced") as HTMLElement
const groupsToggle = () => container.querySelector('[data-testid="visit-policy-advanced-toggle"]') as HTMLButtonElement | null
const openGroups = async () => { await act(async () => { groupsToggle()?.click() }); await settle() }
const click = async (element: Element | null | undefined) => { await act(async () => { (element as HTMLElement).click() }); await settle() }
const byText = (root: ParentNode, text: string) => [...root.querySelectorAll("button")].find((button) => button.textContent?.includes(text)) as HTMLButtonElement | undefined
const choose = async (select: HTMLSelectElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set
  await act(async () => {
    setter?.call(select, value)
    select.dispatchEvent(new Event("change", { bubbles: true }))
  })
  await settle()
}
const refineOf = async (key: string, table = COMPANY) => {
  await click(row(key, table).querySelector("button[aria-expanded]"))
  return container.querySelector(`[data-testid="${table}-refine-${key}"]`) as HTMLElement
}
const ruleRow = (id: string) => container.querySelector(`[data-testid="visit-special-rule-${id}"]`) as HTMLElement
const openRule = async (id: string) => { await click(ruleRow(id).querySelector("button[aria-expanded]")) }
const sentActions = (index: number) => writes[index].body.actions as Action[]

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
  teams = []
  writes = []
  refuse = null
  checkAnswer = null
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: { method?: string; body?: string }) => {
    const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body })
    const url = String(input)
    const method = init?.method ?? "GET"
    if (method === "GET") {
      if (url.includes("/visit-policies")) return reply(200, { success: true, data: { policies, access } })
      if (url.includes("/teams")) return reply(200, { success: true, data: { teams } })
      if (url.includes("/agents")) return reply(200, { success: true, data: { agents: [{ id: "agent-1", name: "Агент Первый" }] } })
      return reply(200, { success: true, data: { customers: [{ id: "place-1", name: "Учреждение Первое" }] } })
    }
    const body = JSON.parse(init?.body ?? "{}") as Record<string, unknown>
    writes.push({ method, url, body })
    if (refuse) return reply(refuse.status, refuse.body)
    if (url.endsWith("/preview")) return reply(200, { success: true, data: checkAnswer })
    if (method === "POST") {
      const created = { id: "rule-new", ...(body as Omit<StoredPolicy, "id">) }
      policies = [created, ...policies]
      return reply(201, { success: true, data: created })
    }
    const id = url.split("/").pop() as string
    if (method === "DELETE") {
      policies = policies.map((policy) => (policy.id === id ? { ...policy, isActive: false } : policy))
      return reply(200, { success: true, data: policies.find((policy) => policy.id === id) })
    }
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

  // What the old editor offered per action beyond the two switches, kept
  // where the server acts on it and one press away on the row itself.
  it("narrows an action to one kind of institution, and says so on the row", async () => {
    await open()
    const refine = await refineOf("PRESENTATION")
    const [byClass, byKind] = [...refine.querySelectorAll("select")] as HTMLSelectElement[]
    expect([...byKind.options].map((option) => option.textContent)).toEqual(["Любой", "Аптека", "Клиника", "Врач", "Магазин", "Другое"])
    expect([...byClass.options].map((option) => option.textContent)).toEqual(["Любой", "VIP", "A", "B", "C", "D"])
    await choose(byKind, "PHARMACY")

    expect(writes.map(({ method, url }) => [method, url])).toEqual([["PUT", "/api/v1/mtm/visit-policies/rule-1"]])
    expect(sentActions(0).find((item) => item.actionKey === "PRESENTATION"))
      .toEqual({ ...action("PRESENTATION", "REQUIRED"), conditions: { objectTypes: ["PHARMACY"] } })
    // Nothing else moved.
    expect(sentActions(0).find((item) => item.actionKey === "PHOTO")).toEqual(action("PHOTO", "OPTIONAL", 2))
    expect(container.querySelector('[data-testid="visit-action-switches-refined-PRESENTATION"]')?.textContent).toBe("только: Аптека")
    expect(refine.textContent).toContain("В остальных учреждениях агент это действие не увидит.")
  })

  it("asks for a minimum number of photos, only for photos and only while they are required", async () => {
    await open()
    // Nothing but photos is counted: no other action has the field.
    expect((await refineOf("PRESENTATION")).querySelector('input[type="number"]')).toBeNull()
    const refine = await refineOf("PHOTO")
    const minimum = () => container.querySelector('[data-testid="visit-action-switches-refine-PHOTO"] input[type="number"]') as HTMLInputElement
    // The photo is optional here: a minimum would bind nobody.
    expect([minimum().value, minimum().disabled]).toEqual(["2", true])
    expect(refine.textContent).toContain("Минимум работает, когда фото обязательно.")

    await press("PHOTO", 1)
    expect(minimum().disabled).toBe(false)
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    await act(async () => {
      setter?.call(minimum(), "3")
      minimum().dispatchEvent(new Event("input", { bubbles: true }))
    })
    // Typing is not a write; leaving the field is.
    expect(writes).toHaveLength(1)
    await act(async () => { minimum().focus(); minimum().blur() })
    await settle()
    expect(writes).toHaveLength(2)
    expect(sentActions(1).find((item) => item.actionKey === "PHOTO")).toEqual(action("PHOTO", "REQUIRED", 3))
    expect(container.querySelector('[data-testid="visit-action-switches-refined-PHOTO"]')?.textContent).toBe("минимум 3")
  })

  it("does not offer what nothing acts on, and keeps it untouched in a rule that has it", async () => {
    policies[0].actions = [{ ...action("PHOTO", "REQUIRED", 2), allowWaiver: true }, action("SIGNATURE", "OPTIONAL", 4)]
    policies[0].visitType = "DEFAULT"
    await open()
    await refineOf("PHOTO")
    // No «a reason may replace it» (the app cannot give one) and no visit type
    // (the app cannot choose one) anywhere on the section.
    expect(container.textContent).not.toMatch(/причин/i)
    expect(container.textContent).not.toContain("Тип визита")
    await press("SIGNATURE", 1)
    expect(sentActions(0).find((item) => item.actionKey === "PHOTO")).toEqual({ ...action("PHOTO", "REQUIRED", 2), allowWaiver: true })
    expect(sentActions(0).find((item) => item.actionKey === "SIGNATURE")).toEqual(action("SIGNATURE", "REQUIRED", 4))
  })
})

describe("«Свои правила для групп»", () => {
  const pharmacyTeam = { id: "team-1", name: "Аптечная группа" }
  const clinicTeam = { id: "team-2", name: "Клиники" }
  const groupRule = (id: string, team: { id: string; name: string }, actions: Action[] = []): StoredPolicy => ({
    id, name: team.name, teamId: team.id, visitType: "DEFAULT", priority: 100,
    effectiveFrom: "2026-10-01T00:00:00.000Z", effectiveTo: null, isActive: true, actions,
  })

  // No tenant on production had a single group on 2026-10-08, and the page
  // has no way to make one: a section about groups would be about nobody.
  it("is not offered at all while the organization has no groups of agents", async () => {
    await open()
    expect(groupsToggle()).toBeNull()
    expect(groups().hidden).toBe(true)
    // The company rule is the table above, not an entry of some list below.
    expect(container.textContent).not.toContain("Политики действий на визите")
  })

  it("is one click below once there are groups, closed until asked for", async () => {
    teams = [pharmacyTeam]
    await open()
    expect([groupsToggle()?.textContent, groupsToggle()?.getAttribute("aria-expanded")]).toEqual(["Свои правила для отдельных групп агентов", "false"])
    expect(groups().hidden).toBe(true)
    await openGroups()
    expect([groups().hidden, groupsToggle()?.getAttribute("aria-expanded")]).toEqual([false, "true"])
    expect(container.querySelector('[data-testid="visit-special-rules-empty"]')?.textContent).toContain("Особых правил пока нет")
    // The company rule is never one of «the group rules».
    expect(container.querySelector('[data-testid="visit-special-rule-rule-1"]')).toBeNull()
  })

  it("says how many groups have a rule of their own, so they are not a surprise", async () => {
    teams = [pharmacyTeam]
    policies = [...policies, groupRule("rule-team", pharmacyTeam)]
    await open()
    expect(groupsToggle()?.textContent).toContain("правил: 1")
  })

  it("gives a group a rule that starts as a copy of the company table", async () => {
    teams = [pharmacyTeam, clinicTeam]
    await open()
    await openGroups()
    const add = container.querySelector('[data-testid="visit-special-rule-add"]') as HTMLElement
    expect(byText(add, "Добавить правило")?.disabled).toBe(true)
    await choose(add.querySelector("select") as HTMLSelectElement, "team-1")
    await click(byText(add, "Добавить правило"))

    expect(writes.map(({ method, url }) => [method, url])).toEqual([["POST", "/api/v1/mtm/visit-policies"]])
    expect(writes[0].body).toMatchObject({ name: "Аптечная группа", teamId: "team-1", visitType: "DEFAULT", priority: 100, effectiveTo: null, isActive: true })
    expect(sentActions(0).map((item) => [item.actionKey, item.mode, item.minCount])).toEqual([
      ["PHOTO", "OPTIONAL", 2], ["PRESENTATION", "REQUIRED", 1], ["SIGNATURE", "OPTIONAL", 1],
      ["VISIT_NOTE", "OPTIONAL", 1], ["STOCK_CHECK", "HIDDEN", 1], ["FEEDBACK", "OPTIONAL", 1],
    ])
    // It is listed, already open on its own table, and that group is not offered twice.
    expect(ruleRow("rule-new").textContent).toContain("Группа: Аптечная группа")
    expect(states("PRESENTATION", groupTable("rule-new"))).toEqual([["true", false], ["true", false]])
    expect([...(container.querySelector('[data-testid="visit-special-rule-add"] select') as HTMLSelectElement).options].map((option) => option.value))
      .toEqual(["", "team-2"])
  })

  it("changes that group's rule with the group's own switches, and nobody else's", async () => {
    teams = [pharmacyTeam]
    policies = [...policies, groupRule("rule-team", pharmacyTeam, [action("PHOTO", "OPTIONAL")])]
    await open()
    await openGroups()
    await openRule("rule-team")
    await press("PHOTO", 1, groupTable("rule-team"))

    expect(writes.map(({ method, url }) => [method, url])).toEqual([["PUT", "/api/v1/mtm/visit-policies/rule-team"]])
    expect(Object.keys(writes[0].body)).toEqual(["actions"])
    expect(sentActions(0).find((item) => item.actionKey === "PHOTO")?.mode).toBe("REQUIRED")
    expect(states("PHOTO", groupTable("rule-team"))).toEqual([["true", false], ["true", false]])
    // The company table still says what it said.
    expect(states("PHOTO")).toEqual([["true", false], ["false", false]])
    expect(ruleRow("rule-team").textContent).toContain("обязательно: 1 · скрыто: 0")
  })

  it("deletes a group's rule only after a second, explicit press", async () => {
    teams = [pharmacyTeam]
    policies = [...policies, groupRule("rule-team", pharmacyTeam)]
    await open()
    await openGroups()
    await openRule("rule-team")
    await click(byText(ruleRow("rule-team"), "Удалить правило"))
    expect(writes).toEqual([])
    expect(ruleRow("rule-team").textContent).toContain("Удалить «Аптечная группа»? Группа вернётся к общей таблице.")
    await click(byText(ruleRow("rule-team"), "Отмена"))
    expect(writes).toEqual([])

    await click(byText(ruleRow("rule-team"), "Удалить правило"))
    await click(byText(ruleRow("rule-team"), "Да, удалить"))
    expect(writes.map(({ method, url }) => [method, url])).toEqual([["DELETE", "/api/v1/mtm/visit-policies/rule-team"]])
    expect(ruleRow("rule-team")).toBeNull()
    // …and the group can be given a rule again.
    expect([...(container.querySelector('[data-testid="visit-special-rule-add"] select') as HTMLSelectElement).options].map((option) => option.value))
      .toEqual(["", "team-1"])
  })

  it("lets a manager change his own group's rule and only read another group's", async () => {
    access = { kind: "manager", canWriteOrganizationWide: false, writableTeamIds: ["team-1"] }
    teams = [pharmacyTeam, clinicTeam]
    policies = [...policies, groupRule("rule-own", pharmacyTeam), groupRule("rule-other", clinicTeam)]
    await open()
    await openGroups()

    await openRule("rule-other")
    expect(switches("PHOTO", groupTable("rule-other")).map((button) => button.disabled)).toEqual([true, true])
    expect(container.querySelector(`[data-testid="${groupTable("rule-other")}-read-only"]`)?.textContent).toContain("другой команды")
    expect(byText(ruleRow("rule-other"), "Удалить правило")).toBeUndefined()
    await press("PHOTO", 0, groupTable("rule-other"))
    expect(writes).toEqual([])

    await openRule("rule-own")
    expect(switches("PHOTO", groupTable("rule-own")).map((button) => button.disabled)).toEqual([false, false])
    expect(byText(ruleRow("rule-own"), "Удалить правило")).toBeDefined()
    // He is offered no group that is not his, and both of his already have a rule.
    expect(container.querySelector('[data-testid="visit-special-rule-add"]')).toBeNull()
  })

  it("names what a rule written elsewhere carries that this page never sets", async () => {
    teams = [pharmacyTeam]
    policies = [...policies, { ...groupRule("rule-api", pharmacyTeam), visitType: "AUDIT", priority: 50, effectiveTo: "2026-12-31T23:59:59.999Z" }]
    await open()
    await openGroups()
    expect(ruleRow("rule-api").textContent).toContain("Группа: Аптечная группа · тип визита: AUDIT · до 2026-12-31 · приоритет 50")
  })

  it("answers which rule one agent really gets at one institution", async () => {
    teams = [pharmacyTeam]
    checkAnswer = {
      sourcePolicyName: "Аптечная группа",
      requirements: [action("PHOTO", "REQUIRED", 2), action("SIGNATURE", "HIDDEN"), action("CHECKLIST", "HIDDEN")],
    }
    await open()
    await openGroups()
    const check = container.querySelector('[data-testid="visit-rule-check"]') as HTMLElement
    const [agent, place] = [...check.querySelectorAll("select")] as HTMLSelectElement[]
    expect(byText(check, "Показать")?.disabled).toBe(true)
    await choose(agent, "agent-1")
    await choose(place, "place-1")
    await click(byText(check, "Показать"))

    expect(writes.map(({ method, url, body }) => [method, url, body])).toEqual([
      ["POST", "/api/v1/mtm/visit-policies/preview", { agentId: "agent-1", customerId: "place-1", visitType: "DEFAULT" }],
    ])
    const result = container.querySelector('[data-testid="visit-rule-check-result"]') as HTMLElement
    expect(result.textContent).toContain("Действует правило: Аптечная группа")
    expect([...result.querySelectorAll("li")].map((item) => item.textContent)).toEqual(["ФотоОбязательно ×2", "Подпись клиентаСкрыто"])
  })
})
