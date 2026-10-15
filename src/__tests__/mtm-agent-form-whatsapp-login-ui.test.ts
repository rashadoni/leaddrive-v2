// @vitest-environment jsdom
/**
 * Owner, 2026-10-16: «для МТМ-агентов также сделай, чтоб там также по номеру
 * телефона авторизовались. Мы создаём агента, его номер указываем, и когда он
 * заходит в приложение, авторизуется через OTP. Одно и то же правило для
 * сотрудников и агентов полевых».
 *
 * So the agent's card asks for a WhatsApp number and no password: nobody but
 * the agent ever knows it (before, a manager typed it and handed it over — on
 * 2026-10-06 one typed it twice and the phone refused both, the card held
 * something else). The real form, rendered with the Russian copy; only the
 * network is stubbed.
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

const field = (id: string) => container.querySelector<HTMLInputElement>(`#${id}`)
const note = () => container.querySelector('[data-testid="agent-code-login-note"]')?.textContent ?? ""
const alert = () => container.querySelector(".text-red-500")?.textContent ?? ""

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

describe("agent card — signing in by a code from WhatsApp", () => {
  it("has no password field at all, on a new card or an existing one", async () => {
    for (const card of [null, CARD]) {
      await show(true, card)
      expect([...container.querySelectorAll("input")].filter((input) => input.type === "password" || /password/i.test(input.id + input.name))).toEqual([])
      expect(note()).toBe(ru.mtmForms.codeLoginNote)
      await show(false, card)
    }
  })

  it("asks a new card for the number, starting with the country code, and sends no password", async () => {
    fetchMock.mockImplementation(async (_url: string, init?: { method?: string }) => init?.method === "POST"
      ? { ok: true, status: 201, json: async () => ({ success: true, data: { id: "new" } }) }
      : { ok: true, status: 200, json: async () => ({ success: true, data: { agents: [] } }) })
    await show(true, null)
    expect(field("phone")?.value).toBe("+994")
    expect(field("phone")?.required).toBe(true)
    await type(field("name") as HTMLInputElement, "Fictional Agent")
    await type(field("phone") as HTMLInputElement, "+994 50 111 22 33")
    await save()
    const [write] = writes()
    expect([write.method, write.url]).toEqual(["POST", "/api/v1/mtm/agents"])
    expect(write.body).toMatchObject({ name: "Fictional Agent", phone: "+994 50 111 22 33" })
    expect("password" in write.body).toBe(false)
  })

  it("refuses a new card's number without the country code before anything is sent", async () => {
    await show(true, null)
    await type(field("name") as HTMLInputElement, "Fictional Agent")
    await type(field("phone") as HTMLInputElement, "050 111 22 33")
    await save()
    expect(writes()).toEqual([])
    expect(alert()).toBe(ru.mtmForms.whatsappPhoneInvalid)
  })

  it("says in words that the number belongs to someone else", async () => {
    fetchMock.mockImplementation(async (_url: string, init?: { method?: string }) => init?.method === "POST"
      ? { ok: false, status: 409, json: async () => ({ error: "taken", code: "MTM_AGENT_PHONE_TAKEN" }) }
      : { ok: true, status: 200, json: async () => ({ success: true, data: { agents: [] } }) })
    await show(true, null)
    await type(field("name") as HTMLInputElement, "Fictional Agent")
    await type(field("phone") as HTMLInputElement, "+994501112233")
    await save()
    expect(alert()).toBe(ru.mtmForms.whatsappPhoneTaken)
  })

  it("does not send an unchanged number back, so an old-style one is left alone", async () => {
    await show(true, { ...CARD, phone: "050 999 88 77" })
    await type(field("name") as HTMLInputElement, "Renamed Agent")
    await save()
    expect(writes()).toHaveLength(1)
    expect(writes()[0].body.phone).toBeUndefined()
    expect(writes()[0].body.name).toBe("Renamed Agent")
  })

  it("warns on a card without a number that the agent cannot sign in by a code", async () => {
    await show(true, { ...CARD, phone: "" })
    expect(note()).toBe(ru.mtmForms.codeLoginNoPhone)
  })
})
