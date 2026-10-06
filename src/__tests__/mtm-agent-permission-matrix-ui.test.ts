// @vitest-environment jsdom
/**
 * Route & Field → "Access & permissions" → "What an agent may do".
 *
 * Owner, 2026-10-04: "a role matrix — what the agent can do and what not, for
 * all functions." The one on /settings/roles is not read by any permission
 * check, and he had trusted it. This one is rendered for real, with the real
 * Russian copy: a switch must end as a write to the MTM setting the API reads,
 * and the row must then show what the server holds. Only the network is stubbed.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

type Messages = { [key: string]: string | Messages }
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8")) as Messages
vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) => {
    const node = (ru[namespace] as Messages | undefined)?.[key]
    const raw = typeof node === "string" ? node : `${namespace}.${key}`
    return raw.replace(/\{(\w+)\}/g, (_match, name) => String(values?.[name] ?? ""))
  },
}))

import { MtmAgentPermissionMatrix } from "@/components/mtm/agent-permission-matrix"
import { AGENT_PERMISSION_ROWS } from "@/lib/mtm/agent-permissions"
import type { AccessCard } from "@/lib/mtm/access-roster"
import { MTM_SETTING_DEFAULTS } from "@/lib/mtm-settings"

const card = (
  id: string,
  role: string,
  flags: Pick<AccessCard, "canPlanOwnRoutes" | "canSelfPublishRoutes"> = {},
): AccessCard => ({
  id, name: id, email: null, role, status: "ACTIVE", userId: null, createdAt: "2026-10-01T00:00:00Z", ...flags,
})
const initialCards = (): AccessCard[] => [
  card("a1", "AGENT", { canPlanOwnRoutes: true, canSelfPublishRoutes: true }),
  card("a2", "AGENT", { canPlanOwnRoutes: false, canSelfPublishRoutes: false }),
  card("m1", "MANAGER"),
]
/** The employee cards the server holds; a per-agent grant written here changes them. */
let cards: AccessCard[] = initialCards()

/** What the server holds. A write changes it unless the server ignores the key. */
let stored: Record<string, unknown> = {}
let writes: Record<string, unknown>[] = []
let cardWrites: { id: string; body: Record<string, unknown> }[] = []
let ignoreWrites = false
let refuseWrites = false
let refuseCardWrites = false

let root: Root
let container: HTMLDivElement
const row = (id: string) => document.querySelector(`[data-testid="mtm-agent-permission-${id}"]`) as HTMLElement
const toggleOf = (id: string) => row(id).querySelector('[role="switch"]') as HTMLButtonElement
const settle = async () => {
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
}
const press = async (id: string) => {
  await act(async () => { toggleOf(id).click() })
  await settle()
}

const agentBox = (rowId: string, name: string) => [...row(rowId).querySelectorAll("label")]
  .find((label) => label.textContent === name)?.querySelector('input[type="checkbox"]') as HTMLInputElement | undefined
const tick = async (rowId: string, name: string) => {
  await act(async () => { agentBox(rowId, name)?.click() })
  await settle()
}

/** The page re-reads the cards after a grant and hands the matrix what the server now holds. */
function draw() {
  root.render(createElement(MtmAgentPermissionMatrix, { cards, onCardsChanged: async () => { draw() } }))
}

async function open(settings: Record<string, unknown> = {}) {
  stored = { ...MTM_SETTING_DEFAULTS, ...settings }
  await act(async () => { draw() })
  await settle()
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  writes = []
  cardWrites = []
  cards = initialCards()
  ignoreWrites = false
  refuseWrites = false
  refuseCardWrites = false
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: { method?: string; body?: string }) => {
    const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body })
    if ((init?.method ?? "GET") === "GET") return reply(200, { success: true, data: stored })
    const body = JSON.parse(init?.body ?? "{}") as Record<string, unknown>
    // A per-agent grant is the employee card's own update, not a setting.
    const cardId = /^\/api\/v1\/mtm\/agents\/([^/?]+)$/.exec(String(input))?.[1]
    if (cardId) {
      cardWrites.push({ id: cardId, body })
      if (refuseCardWrites) return reply(403, { error: "Forbidden" })
      cards = cards.map((item) => (item.id === cardId ? { ...item, ...body } : item))
      return reply(200, { success: true })
    }
    writes.push(body)
    if (refuseWrites) return reply(403, { error: "Forbidden" })
    if (ignoreWrites) return reply(200, { success: true, data: { ignoredKeys: Object.keys(body) } })
    stored = { ...stored, ...body }
    return reply(200, { success: true, data: { ignoredKeys: [] } })
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

describe("«Что может агент»", () => {
  it("lists every function with words, never a raw translation key", async () => {
    await open()
    expect(AGENT_PERMISSION_ROWS.filter((item) => !row(item.id)).map((item) => item.id)).toEqual([])
    expect(container.textContent).toContain("Что может агент")
    expect(container.textContent).not.toContain("mtmAccess.")
    expect(row("contactCreateRequest").textContent).toContain("Подать заявку на нового клиента")
    expect(row("contactCreateRequest").textContent).toContain("Где: в мобильном приложении")
    expect(row("contactChangeRequest").textContent).toContain("Где: в мобильном приложении и на сайте")
    expect(row("customerCreateRequest").textContent).toContain("Где: на сайте")
  })

  it("shows what an organization that never touched the switches has", async () => {
    await open()
    const state = (id: string) => [toggleOf(id).getAttribute("aria-checked"), toggleOf(id).textContent]
    expect(state("contactCreateRequest")).toEqual(["true", "Может"])
    expect(state("contactChangeRequest")).toEqual(["true", "Может"])
    expect(state("customerCreateRequest")).toEqual(["true", "Может"])
    expect(state("taskSelfCreate")).toEqual(["true", "Может"])
    expect(state("teamSchedule")).toEqual(["false", "Не может"])
  })

  it("states a system rule in words and offers nothing to press", async () => {
    await open()
    expect(row("masterDataEdit").textContent).toContain("Не может никогда")
    expect(row("masterDataEdit").textContent).toContain("Правило системы")
    expect(row("masterDataEdit").querySelector("button")).toBeNull()
    expect(row("visitExecute").textContent).toContain("Может всегда")
    expect(row("visitExecute").querySelector("button")).toBeNull()
  })

  it("counts per-agent grants over the organization's agents", async () => {
    await open()
    expect(row("routePlanOwn").textContent).toContain("Могут: 1 из 2")
    // The grant is given in this row now; it no longer sends anyone to «Агенты».
    expect(["routePlanOwn", "routeSelfPublish"].filter((id) => row(id).querySelector('a[href="/mtm/agents"]'))).toEqual([])
    expect(row("routeSelfPublish").textContent).toContain("Могут: 1 из 2")
  })

  it("gives a per-agent grant in the row that names it — no other page to find", async () => {
    await open()
    // Active agents by name; a manager's card is not an agent.
    expect([...row("routeSelfPublish").querySelectorAll("label")].map((label) => label.textContent)).toEqual(["a1", "a2"])
    expect([agentBox("routeSelfPublish", "a1")?.checked, agentBox("routeSelfPublish", "a2")?.checked]).toEqual([true, false])

    await tick("routeSelfPublish", "a2")
    expect(cardWrites).toEqual([{ id: "a2", body: { canSelfPublishRoutes: true } }])
    // The card's own update and nothing else: no organization setting is written.
    expect(writes).toEqual([])
    expect(agentBox("routeSelfPublish", "a2")?.checked).toBe(true)
    expect(row("routeSelfPublish").textContent).toContain("Могут: 2 из 2")
  })

  it("takes the right to plan away from one agent, in the row about planning", async () => {
    await open()
    expect([agentBox("routePlanOwn", "a1")?.checked, agentBox("routePlanOwn", "a2")?.checked]).toEqual([true, false])

    await tick("routePlanOwn", "a1")
    expect(cardWrites).toEqual([{ id: "a1", body: { canPlanOwnRoutes: false } }])
    expect(row("routePlanOwn").textContent).toContain("Могут: 0 из 2")
    // Planning has no organization switch above it: a tick there never waits.
    expect(row("routePlanOwn").textContent).not.toContain("Галочки начнут действовать")
  })

  // «Что за включение компании, зачем усложняешь» (owner, 2026-10-06): publishing
  // one's own routes had an organization switch on top of the tick. It is gone.
  it("has no organization switch above the tick: one tick is the whole rule", async () => {
    await open()
    expect(["routePlanOwn", "routeSelfPublish"].filter((id) => row(id).querySelector('[role="switch"]'))).toEqual([])
    expect(container.textContent).not.toContain("Галочки начнут действовать")
    expect(container.textContent).not.toContain("Кроме общего разрешения")
  })

  it("says so when a grant was refused, and keeps showing what the card holds", async () => {
    await open()
    refuseCardWrites = true
    await tick("routeSelfPublish", "a2")
    expect(row("routeSelfPublish").textContent).toContain("Не удалось сохранить: Forbidden")
    expect(agentBox("routeSelfPublish", "a2")?.checked).toBe(false)
  })

  it("offers names only where the grant lives on the employee card", async () => {
    await open()
    const withNames = AGENT_PERMISSION_ROWS.filter((item) => row(item.id).querySelector('input[type="checkbox"]')).map((item) => item.id)
    expect(withNames).toEqual(["routePlanOwn", "routeSelfPublish"])
  })

  it("writes one setting when a switch is pressed and shows what the server now holds", async () => {
    await open()
    await press("contactCreateRequest")
    expect(writes).toEqual([{ agentContactCreateRequests: false }])
    expect(toggleOf("contactCreateRequest").getAttribute("aria-checked")).toBe("false")
    expect(toggleOf("contactCreateRequest").textContent).toBe("Не может")
    // Nothing else moved.
    expect(toggleOf("contactChangeRequest").getAttribute("aria-checked")).toBe("true")

    await press("contactCreateRequest")
    expect(writes[1]).toEqual({ agentContactCreateRequests: true })
    expect(toggleOf("contactCreateRequest").textContent).toBe("Может")
  })

  it("says so when the server did not take the change, and keeps showing the truth", async () => {
    await open()
    ignoreWrites = true
    await press("customerCreateRequest")
    expect(row("customerCreateRequest").textContent).toContain("менять это может только администратор")
    expect(toggleOf("customerCreateRequest").getAttribute("aria-checked")).toBe("true")

    ignoreWrites = false
    refuseWrites = true
    await press("contactChangeRequest")
    expect(row("contactChangeRequest").textContent).toContain("Не удалось сохранить")
    expect(toggleOf("contactChangeRequest").getAttribute("aria-checked")).toBe("true")
  })

  it("blocks a switch that means nothing while the one it needs is off", async () => {
    await open({ taskSelfCreate: false, taskSelfRecurring: true })
    expect(toggleOf("taskSelfRecurring").getAttribute("aria-checked")).toBe("false")
    expect(toggleOf("taskSelfRecurring").disabled).toBe(true)
    expect(row("taskSelfRecurring").textContent).toContain("Работает, только пока включено «Создавать задачи самому себе»")

    await press("taskSelfCreate")
    expect(writes).toEqual([{ taskSelfCreate: true }])
    // Its own stored value comes back with the one it depends on.
    expect(toggleOf("taskSelfRecurring").getAttribute("aria-checked")).toBe("true")
    expect(toggleOf("taskSelfRecurring").disabled).toBe(false)
  })

  it("says the list could not be loaded instead of showing every switch as off", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: "boom" }) })))
    await act(async () => { root.render(createElement(MtmAgentPermissionMatrix, { cards })) })
    await settle()
    expect(container.textContent).toContain("Не удалось загрузить разрешения")
    expect(container.querySelector('[role="switch"]')).toBeNull()
  })
})
