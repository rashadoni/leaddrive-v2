// @vitest-environment jsdom
/**
 * The password a manager sets on an agent's card is the one the agent must
 * type on the phone, so the form shows it as written.
 *
 * 2026-10-06: a manager set a field agent's password twice in this form and the
 * mobile app refused him both times. The server was sound — another card in the
 * same company signed in the same minute — the card simply held a different
 * string than the one everybody believed was typed. The field was dots, beside
 * an email field, with nothing telling the browser it was not a sign-in form,
 * so neither a slip of the hand nor a value the browser put there could be seen.
 *
 * The real form, rendered with the Russian copy; only the network is stubbed.
 */
import { act, createElement, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

const ru = JSON.parse(readFileSync("messages/ru.json", "utf8")) as Record<string, Record<string, string>>
vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string) => ru[namespace]?.[key] ?? key,
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

const CARD = {
  id: "agent-1",
  name: "Field Agent",
  email: "agent@example.com",
  phone: "+10000000000",
  externalCode: "AG-001",
  role: "AGENT",
  status: "ACTIVE",
  canPlanOwnRoutes: true,
  canSelfPublishRoutes: false,
  managerId: null,
}

let root: Root
let container: HTMLDivElement
const fetchMock = vi.fn()
const onSaved = vi.fn()
const onOpenChange = vi.fn()

/** `card: null` is the «Добавить агента» form; by default an existing card is opened. */
async function show(open: boolean, card: typeof CARD | null = CARD) {
  await act(async () => {
    root.render(createElement(MtmAgentForm, { open, onOpenChange, onSaved, initialData: card ?? undefined }))
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}

const passwordField = () => container.querySelector<HTMLInputElement>("#agent-password")
const toggle = () => passwordField()?.parentElement?.querySelector<HTMLButtonElement>("button") ?? null

async function type(input: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  await act(async () => {
    setValue?.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

async function save() {
  await act(async () => {
    container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
}

/** Every write the form made: method, address and the body as it left the browser. */
const writes = () => fetchMock.mock.calls
  .map(([url, init]) => ({ url: String(url), init: init as { method?: string; body?: string } | undefined }))
  .filter(({ init }) => init?.method === "PUT" || init?.method === "POST")
  .map(({ url, init }) => ({ method: init?.method, url, body: JSON.parse(init?.body ?? "{}") as Record<string, unknown> }))

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  fetchMock.mockReset()
  onSaved.mockReset()
  onOpenChange.mockReset()
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, data: { agents: [] } }) })
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

describe("agent card — the password the manager sets", () => {
  it("is shown as written, and that exact string is what gets saved", async () => {
    await show(true)
    const field = passwordField()
    expect(field).not.toBeNull()
    await type(field as HTMLInputElement, "Field-Agent-2026!")

    expect([passwordField()?.type, passwordField()?.value]).toEqual(["text", "Field-Agent-2026!"])
    expect(container.textContent).toContain("Сверьте его перед сохранением")

    await save()
    expect(writes().map(({ method, url, body }) => [method, url, body.password])).toEqual([
      ["PUT", "/api/v1/mtm/agents/agent-1", "Field-Agent-2026!"],
    ])
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it("does not pass for a sign-in form, so the browser has no saved password to put there", async () => {
    await show(true)

    const signInShaped = [...container.querySelectorAll("input")]
      .filter((input) => input.id === "password" || input.name === "password" || input.type === "password")
    expect(signInShaped.map((input) => input.id)).toEqual([])
    expect(passwordField()?.getAttribute("autocomplete")).toBe("off")
  })

  it("can be covered with a worded button, and is then marked as a new password, not a saved one", async () => {
    await show(true)
    expect(toggle()?.textContent).toBe("Скрыть")
    await type(passwordField() as HTMLInputElement, "Field-Agent-2026!")

    await act(async () => { toggle()?.click() })
    expect([passwordField()?.type, passwordField()?.getAttribute("autocomplete"), passwordField()?.value, toggle()?.textContent])
      .toEqual(["password", "new-password", "Field-Agent-2026!", "Показать"])

    await act(async () => { toggle()?.click() })
    expect([passwordField()?.type, passwordField()?.value]).toEqual(["text", "Field-Agent-2026!"])
    // Covering and uncovering is not a save.
    expect(writes()).toEqual([])
  })

  it("opens readable and empty every time, whatever was done in it before", async () => {
    await show(true)
    await type(passwordField() as HTMLInputElement, "Field-Agent-2026!")
    await act(async () => { toggle()?.click() })

    await show(false)
    expect(passwordField()).toBeNull()
    await show(true)

    expect([passwordField()?.type, passwordField()?.value]).toEqual(["text", ""])
  })

  it("left empty on an existing card, it is not sent — the agent keeps the password he has", async () => {
    await show(true)
    await save()

    expect(writes().map(({ method, url }) => [method, url])).toEqual([["PUT", "/api/v1/mtm/agents/agent-1"]])
    expect(Object.keys(writes()[0].body)).not.toContain("password")
  })

  it("is shown the same way when a new agent is added", async () => {
    await show(true, null)
    await type(passwordField() as HTMLInputElement, "Field-Agent-2026!")

    expect([passwordField()?.type, passwordField()?.required, passwordField()?.getAttribute("autocomplete")])
      .toEqual(["text", true, "off"])
    await save()
    expect(writes().map(({ method, url, body }) => [method, url, body.password])).toEqual([
      ["POST", "/api/v1/mtm/agents", "Field-Agent-2026!"],
    ])
  })
})
