// @vitest-environment jsdom
/**
 * The «Клиенты» tab of the agent card, rendered for real (owner, 2026-10-16:
 * «при создании агента нужно, чтоб была возможность выбора группы клиентов:
 * специальность, дальше город, дальше регион (район), и дальше список с
 * отмеченными галочками, чтоб при желании можно было оттуда кого-то изъять»;
 * «и при редактировании»). Only the network is stubbed; fictional doctors.
 */
import { act, createElement, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

const ru = JSON.parse(readFileSync("messages/ru.json", "utf8")) as Record<string, Record<string, string>>
vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string) => ru[namespace]?.[key] ?? key,
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }))
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open?: boolean; children?: ReactNode }) => (open ? createElement("div", null, children) : null),
  DialogContent: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  DialogHeader: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  DialogTitle: ({ children }: { children?: ReactNode }) => createElement("h2", null, children),
  DialogFooter: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
}))

import { MtmAgentForm } from "@/components/mtm/agent-form"

const doctor = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, specialty: "Terapevt", agents: [], assignedHere: false, ...extra })
const PICKER = {
  specialties: [{ value: "terapevt", label: "Terapevt", count: 3 }, { value: "qastroenteroloq", label: "Qastroenteroloq", count: 1 }],
  cities: [{ value: "bakı", label: "Bakı", count: 3 }],
  districts: [{ value: "__none__", label: null, count: 3 }],
  groups: [{
    institution: { id: "c1", name: "Fictional Clinic", address: "Fictional st. 1", city: "Bakı", district: null },
    contacts: [doctor("d1", "Fictional Aliyeva"), doctor("d2", "Fictional Babayev", { agents: [{ id: "x", name: "Fictional Other", primary: true }] }), doctor("d3", "Fictional Cavadova")],
  }],
  matching: 3,
  assignedHere: 0,
  asOf: "2026-10-16",
}

let root: Root
let container: HTMLDivElement
const fetchMock = vi.fn()
const onSaved = vi.fn()

const calls = () => fetchMock.mock.calls.map(([url, init]) => ({ url: String(url), method: (init as RequestInit | undefined)?.method ?? "GET", body: (init as RequestInit | undefined)?.body ? JSON.parse(String((init as RequestInit).body)) : null }))
const byTestId = (id: string) => document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`)
const all = (id: string) => [...document.body.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)]
async function click(element: Element | null) {
  await act(async () => { (element as HTMLElement).click() })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}
async function type(id: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`#${id}`)!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}
async function render(initialData?: Record<string, unknown>) {
  await act(async () => { root.render(createElement(MtmAgentForm, { open: true, onOpenChange: vi.fn(), onSaved, initialData: initialData as never })) })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  fetchMock.mockReset()
  onSaved.mockReset()
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET"
    const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })
    if (url.startsWith("/api/v1/mtm/contacts/agent-picker")) {
      const chosen = new URL(url, "http://x").searchParams.getAll("specialty")
      return json({ success: true, data: chosen.length ? PICKER : { ...PICKER, groups: [], matching: 0 } })
    }
    if (url === "/api/v1/mtm/agents" && method === "POST") return json({ success: true, data: { id: "new-agent" } }, 201)
    if (url.startsWith("/api/v1/mtm/agents/") && method === "PUT") return json({ success: true, data: { id: "a1" } })
    if (url === "/api/v1/mtm/contact-assignments/preview") return json({ success: true, data: { previewToken: "p".repeat(64), summary: { assignable: 2 } } })
    if (url === "/api/v1/mtm/contact-assignments") return json({ success: true, data: { summary: { changed: 2 }, excluded: [] } })
    return json({ success: true, data: { agents: [] } })
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

describe("agent card — choosing the agent's doctors", () => {
  it("lists nothing, and ticks nothing, until a specialty is chosen", async () => {
    await render()
    await click(byTestId("agent-form-tab-clients"))
    expect(byTestId("agent-clients-start")?.textContent).toContain(ru.mtmForms.clientsPickSpecialtyFirst)
    expect(all("agent-clients-doctor")).toEqual([])
    expect(byTestId("agent-form-submit")?.textContent).toBe(ru.common.create)
  })

  it("creates the agent, then assigns the doctors left ticked — not the one taken out", async () => {
    await render()
    await type("name", "Fictional New Agent")
    await type("phone", "+994501112233")
    await click(byTestId("agent-form-tab-clients"))
    await click(byTestId("agent-clients-specialty"))
    const terapevt = [...document.body.querySelectorAll<HTMLLabelElement>('[data-testid="agent-clients-specialty-options"] label')].find(label => label.textContent?.includes("Terapevt"))!
    await click(terapevt.querySelector("input"))
    expect(calls().some(call => call.url.includes("specialty=terapevt"))).toBe(true)

    // Every doctor found is ticked; the institution opens to take one out.
    expect(byTestId("agent-clients-group-tick")?.getAttribute("aria-checked")).toBe("true")
    await click(document.body.querySelector('[data-testid="agent-clients-group"] button[aria-expanded]'))
    const babayev = all("agent-clients-doctor").find(row => row.textContent?.includes("Fictional Babayev"))!
    // The doctor's other agent is named on the row (the stub translator shows the template).
    expect(babayev.textContent).toContain("уже у:")
    await click(babayev.querySelector('[role="checkbox"]'))
    expect(byTestId("agent-clients-group-tick")?.getAttribute("aria-checked")).toBe("mixed")
    expect(byTestId("agent-form-submit")?.textContent).toBe(ru.mtmForms.createAndAssign)

    await click(byTestId("agent-form-submit"))
    const writes = calls().filter(call => call.method === "POST")
    expect(writes.map(call => call.url)).toEqual(["/api/v1/mtm/agents", "/api/v1/mtm/contact-assignments/preview", "/api/v1/mtm/contact-assignments"])
    expect(writes[0].body).toMatchObject({ name: "Fictional New Agent", phone: "+994501112233" })
    expect(writes[1].body).toMatchObject({ contactIds: ["d1", "d3"], mode: "ASSIGN", targetAgentId: "new-agent", effectiveFrom: "2026-10-16", reason: ru.mtmForms.clientsReason })
    expect(writes[2].body).toMatchObject({ contactIds: ["d1", "d3"], previewToken: "p".repeat(64) })
    expect(onSaved).toHaveBeenCalled()
  })

  it("on an existing card, marks the doctors already the agent's and does not send them again", async () => {
    fetchMock.mockImplementationOnce(async () => ({ ok: true, status: 200, json: async () => ({ success: true, data: { agents: [] } }) }))
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).startsWith("/api/v1/mtm/contacts/agent-picker")) {
        expect(new URL(String(url), "http://x").searchParams.get("agentId")).toBe("a1")
        const chosen = new URL(String(url), "http://x").searchParams.getAll("specialty")
        const groups = [{ ...PICKER.groups[0], contacts: [doctor("d1", "Fictional Aliyeva", { assignedHere: true }), ...PICKER.groups[0].contacts.slice(1)] }]
        return { ok: true, status: 200, json: async () => ({ success: true, data: { ...PICKER, groups: chosen.length ? groups : [], assignedHere: 1 } }) }
      }
      return original(url, init)
    })
    await render({ id: "a1", name: "Fictional Agent", phone: "+994501112233", role: "AGENT", status: "ACTIVE" })
    await click(byTestId("agent-form-tab-clients"))
    await click(byTestId("agent-clients-specialty"))
    await click([...document.body.querySelectorAll<HTMLLabelElement>('[data-testid="agent-clients-specialty-options"] label')][0].querySelector("input"))
    await click(document.body.querySelector('[data-testid="agent-clients-group"] button[aria-expanded]'))
    const aliyeva = all("agent-clients-doctor").find(row => row.textContent?.includes("Fictional Aliyeva"))!
    expect(aliyeva.textContent).toContain(ru.mtmForms.clientsAlreadyHere)
    expect(aliyeva.querySelector<HTMLButtonElement>('[role="checkbox"]')?.disabled).toBe(true)
    await click(byTestId("agent-form-submit"))
    const preview = calls().find(call => call.url === "/api/v1/mtm/contact-assignments/preview")!
    expect(preview.body.contactIds).toEqual(["d2", "d3"])
    expect(calls().find(call => call.method === "PUT")?.url).toBe("/api/v1/mtm/agents/a1")
  })

  it("has no Clients tab for a manager or a supervisor — doctors are a field agent's", async () => {
    await render({ id: "m1", name: "Fictional Manager", phone: "+994501112233", role: "MANAGER", status: "ACTIVE" })
    expect(byTestId("agent-form-tabs")).toBeNull()
  })
})
