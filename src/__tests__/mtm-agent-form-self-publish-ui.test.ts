// @vitest-environment jsdom
/**
 * The agent card's «publishes his own routes» tick says whether it works.
 *
 * 2026-10-06: an agent saved today's route and could not start it — it was a
 * draft waiting for the manager. Letting him publish it himself took two
 * things on two pages: this tick, and the organization's switch in the
 * module's settings. The tick alone changed nothing and nothing said so. The
 * owner: settings «должны быть интуитивные, а не прятаться где-то».
 *
 * The real form with the Russian copy; only the network is stubbed.
 */
import { act, createElement, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

const ru = JSON.parse(readFileSync("messages/ru.json", "utf8")) as Record<string, Record<string, string>>
vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) =>
    (ru[namespace]?.[key] ?? key).replace(/\{(\w+)\}/g, (_match, name) => String(values?.[name] ?? "")),
}))

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open?: boolean; children?: ReactNode }) =>
    open ? createElement("div", null, children) : null,
  DialogContent: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  DialogHeader: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  DialogTitle: ({ children }: { children?: ReactNode }) => createElement("h2", null, children),
  DialogFooter: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
}))

import { MtmAgentForm } from "@/components/mtm/agent-form"

const card = (overrides: Record<string, unknown> = {}) => ({
  id: "agent-1",
  name: "Field Agent",
  email: "agent@example.com",
  phone: null,
  externalCode: "AG-001",
  role: "AGENT",
  status: "ACTIVE",
  canPlanOwnRoutes: true,
  canSelfPublishRoutes: false,
  managerId: null,
  ...overrides,
})

/** What the server holds for the organization's switch; `undefined` = it could not be read. */
let companySwitch: boolean | undefined
let refuseSwitch = false
let settingWrites: Record<string, unknown>[] = []
let cardWrites: Record<string, unknown>[] = []

let root: Root
let container: HTMLDivElement

async function show(initialData: ReturnType<typeof card>) {
  await act(async () => {
    root.render(createElement(MtmAgentForm, { open: true, onOpenChange: () => {}, onSaved: () => {}, initialData }))
  })
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)) })
}

const publishTick = () => container.querySelector<HTMLInputElement>("#canSelfPublishRoutes")
const waiting = () => container.querySelector<HTMLElement>('[data-testid="mtm-agent-self-publish-company-off"]')
const working = () => container.querySelector<HTMLElement>('[data-testid="mtm-agent-self-publish-company-on"]')
const enable = () => waiting()?.querySelector<HTMLButtonElement>("button") ?? null
const press = async (element: HTMLElement | null) => {
  await act(async () => { element?.click() })
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)) })
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  companySwitch = false
  refuseSwitch = false
  settingWrites = []
  cardWrites = []
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: { method?: string; body?: string }) => {
    const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body })
    const url = String(input)
    const method = init?.method ?? "GET"
    if (url.startsWith("/api/v1/mtm/settings")) {
      if (method === "GET") {
        return companySwitch === undefined
          ? reply(500, { error: "boom" })
          : reply(200, { success: true, data: { routeSelfPublish: companySwitch, geofenceRadius: 300 } })
      }
      const body = JSON.parse(init?.body ?? "{}") as Record<string, unknown>
      settingWrites.push(body)
      if (refuseSwitch) return reply(403, { error: "Forbidden" })
      if (typeof body.routeSelfPublish === "boolean") companySwitch = body.routeSelfPublish
      return reply(200, { success: true, data: { ignoredKeys: [] } })
    }
    if (method !== "GET") cardWrites.push(JSON.parse(init?.body ?? "{}") as Record<string, unknown>)
    return reply(200, { success: true, data: { agents: [] } })
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

describe("agent card — «публикует маршруты сам»", () => {
  it("says the tick does nothing yet while the organization's switch is off, and turns the switch on from here", async () => {
    await show(card({ canSelfPublishRoutes: true }))

    expect(waiting()?.textContent).toContain("Пока не действует: в компании публикация без согласования выключена")
    expect(enable()?.textContent).toBe("Включить в компании")

    await press(enable())
    // Exactly the one switch, and the card itself was not saved by that press.
    expect(settingWrites).toEqual([{ routeSelfPublish: true }])
    expect(cardWrites).toEqual([])
    expect(waiting()).toBeNull()
    expect(working()?.textContent).toContain("галочка действует")
  })

  it("warns as soon as the tick is set, before anything is saved", async () => {
    await show(card({ canSelfPublishRoutes: false }))
    // An agent whose routes the manager publishes: nothing to warn about.
    expect([waiting(), working()]).toEqual([null, null])

    await press(publishTick())
    expect(publishTick()?.checked).toBe(true)
    expect(waiting()).not.toBeNull()
    expect([settingWrites, cardWrites]).toEqual([[], []])
  })

  it("says the tick works when the organization's switch is already on", async () => {
    companySwitch = true
    await show(card({ canSelfPublishRoutes: true }))

    expect(waiting()).toBeNull()
    expect(working()?.textContent).toBe("В компании публикация без согласования включена — галочка действует.")
  })

  it("says so when the switch could not be turned on, and keeps the warning", async () => {
    refuseSwitch = true
    await show(card({ canSelfPublishRoutes: true }))
    await press(enable())

    expect(settingWrites).toEqual([{ routeSelfPublish: true }])
    expect(waiting()?.textContent).toContain("Не удалось включить: Forbidden")
    expect(working()).toBeNull()
  })

  it("claims nothing either way when the organization's switch could not be read", async () => {
    companySwitch = undefined
    await show(card({ canSelfPublishRoutes: true }))

    expect([waiting(), working()]).toEqual([null, null])
  })

  it("is about agents only: a manager's card has no such tick and no warning", async () => {
    await show(card({ role: "MANAGER", canSelfPublishRoutes: true }))

    expect([publishTick(), waiting(), working()]).toEqual([null, null, null])
  })
})
