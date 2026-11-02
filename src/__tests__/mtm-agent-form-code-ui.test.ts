// @vitest-environment jsdom
/**
 * Owner, 2026-10-20, on the agent form's «Agentin xarici kodu»: «тут код
 * агента чтоб автоматически задавался. последовательно». The server gives the
 * code at the save; the form shows, in the empty field, the code it will be.
 * The real form, rendered with the Russian copy; only the network is stubbed.
 */
import { act, createElement, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

const ru = JSON.parse(readFileSync("messages/ru.json", "utf8")) as Record<string, Record<string, string>>
const fill = (text: string, values?: Record<string, unknown>) => text.replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name] ?? `{${name}}`))
vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) => fill(ru[namespace]?.[key] ?? key, values),
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
  email: "",
  phone: "+10000000000",
  externalCode: "AG-004",
  role: "AGENT",
  status: "ACTIVE",
  canPlanOwnRoutes: true,
  canSelfPublishRoutes: false,
  managerId: null,
}

let root: Root
let container: HTMLDivElement
const fetchMock = vi.fn()
let nextCode: { ok: boolean; body: unknown } = { ok: true, body: { success: true, data: { code: "AG-017" } } }
let saveAnswer: { status: number; body: unknown } = { status: 201, body: { success: true, data: { id: "new-agent" } } }

async function show(card: typeof CARD | null) {
  await act(async () => {
    root.render(createElement(MtmAgentForm, { open: true, onOpenChange: vi.fn(), onSaved: vi.fn(), initialData: card ?? undefined }))
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}

const code = () => container.querySelector<HTMLInputElement>('[data-testid="agent-external-code"]')!
const hint = () => container.querySelector('[data-testid="agent-external-code-hint"]')?.textContent ?? null
const alert = () => container.querySelector('[data-testid="mtm-form-error"]')?.textContent ?? ""
const field = (id: string) => container.querySelector<HTMLInputElement>(`#${id}`)!

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

const writes = () => fetchMock.mock.calls
  .map(([url, init]) => ({ url: String(url), init: init as { method?: string; body?: string } | undefined }))
  .filter(({ init }) => init?.method === "PUT" || init?.method === "POST")
  .map(({ url, init }) => ({ method: init?.method, url, body: JSON.parse(init?.body ?? "{}") as Record<string, unknown> }))

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  nextCode = { ok: true, body: { success: true, data: { code: "AG-017" } } }
  saveAnswer = { status: 201, body: { success: true, data: { id: "new-agent" } } }
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url: string, init?: { method?: string }) => {
    if (init?.method === "POST" || init?.method === "PUT") {
      return { ok: saveAnswer.status < 300, status: saveAnswer.status, json: async () => saveAnswer.body }
    }
    if (String(url) === "/api/v1/mtm/agents/next-code") {
      if (!nextCode.ok) throw new Error("offline")
      return { ok: true, status: 200, json: async () => nextCode.body }
    }
    return { ok: true, status: 200, json: async () => ({ success: true, data: { agents: [] } }) }
  })
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

describe("the agent's code on the agent form", () => {
  it("shows a new agent the code it will get, and sends none — the server gives it at the save", async () => {
    await show(null)
    expect(code().value).toBe("")
    expect(code().placeholder).toBe("AG-017 — назначится автоматически")
    expect(hint()).toBe(ru.mtmForms.externalCodeAutoHint)

    await type(field("name"), "Fictional Agent")
    await type(field("phone"), "+994501112233")
    await save()
    const [write] = writes()
    expect([write.method, write.url]).toEqual(["POST", "/api/v1/mtm/agents"])
    expect(write.body.externalCode).toBe("")
  })

  it("keeps a code typed by hand, and the hint gives way to it", async () => {
    await show(null)
    await type(code(), "EXT-9")
    expect(hint()).toBeNull()
    await type(field("name"), "Fictional Agent")
    await type(field("phone"), "+994501112233")
    await save()
    expect(writes()[0].body.externalCode).toBe("EXT-9")
  })

  it("shows a card's own code as it is; cleared, the field says which code the save will give", async () => {
    await show(CARD)
    expect(code().value).toBe("AG-004")
    expect(hint()).toBeNull()
    await type(code(), "")
    expect(code().placeholder).toBe("AG-017 — назначится автоматически")
    expect(hint()).toBe(ru.mtmForms.externalCodeAutoHint)
  })

  it("says in words that the code belongs to another agent", async () => {
    saveAnswer = { status: 409, body: { error: "Another agent already has the code AG-007", code: "MTM_AGENT_CODE_TAKEN" } }
    await show(CARD)
    await type(code(), "AG-007")
    await save()
    expect(alert()).toBe(ru.mtmForms.externalCodeTaken)
  })

  it("still says the code is given by itself when the next one could not be read", async () => {
    nextCode = { ok: false, body: null }
    await show(null)
    expect(code().placeholder).toBe(ru.mtmForms.externalCodeHint)
    expect(hint()).toBe(ru.mtmForms.externalCodeAutoHint)
  })
})
